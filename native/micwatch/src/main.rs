//! 「他のアプリがマイクを使っているか」を見張り、状態が変わったら 1 行出す（Windows 版、ADR-027 / ADR-048）。
//! macOS 版（main.swift）と同じ取り決めで、出力は `1`（どこかで使用中）か `0` の 1 行だけ。起動直後に 1 度出し、
//! 以降は変化したときだけ出す。TypeScript 側（MicUsageProbe）は両方の OS で同じものを使う。
//!
//! 調べ方は WASAPI のセッション。有効な録音デバイスごとに音声セッションを列挙し、動いている（Active）ものが
//! あれば使用中とみなす。音声データには触れない。レジストリの CapabilityAccessManager（LastUsedTimeStop が 0 の
//! アプリ）も候補だったが、落ちたアプリの記録が使用中のまま残ることがあり、どのプロセスかも分からないので採らない。
//!
//! 自分（Exolobe）のマイク使用は数えない。親（Electron の main）とその子孫（renderer、Chromium の音声サービス）の
//! セッションを除く。親が終わったら自分も終わる（孤児になって見張り続けない）。

use std::collections::HashMap;
use std::io::Write;
use std::process::ExitCode;

use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AudioSessionStateActive, DEVICE_STATE_ACTIVE, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator, eCapture,
};
use windows::Win32::System::Com::{CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject};
use windows::core::Interface;

/// 見に行く間隔。録音を促すのは数十秒以上使われ続けてからなので、1 秒で足りる。
const POLL_MS: u32 = 1_000;

/// 祖先をたどる上限。親子の記録が輪になっていても止まるように。
const MAX_DEPTH: usize = 64;

/// pid が root そのものか、その子孫か。parent_of は「pid の親」を返す。
fn is_in_tree(pid: u32, root: u32, parent_of: &HashMap<u32, u32>) -> bool {
    let mut current = pid;
    for _ in 0..MAX_DEPTH {
        if current == root {
            return true;
        }
        match parent_of.get(&current) {
            Some(&parent) if parent != current && parent != 0 => current = parent,
            _ => return false,
        }
    }
    false
}

/// 状態が変わったときだけ出す。最初の 1 回は必ず出す。
struct Reporter {
    last: Option<bool>,
}

impl Reporter {
    fn next(&mut self, in_use: bool) -> Option<&str> {
        if self.last == Some(in_use) {
            return None;
        }
        self.last = Some(in_use);
        Some(if in_use { "1" } else { "0" })
    }
}

/// いま動いているプロセスの「pid から親の pid」の表。
fn process_parents() -> HashMap<u32, u32> {
    let mut parents = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return parents;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    parents
}

/// 自分以外（root の木の外）のプロセスが、どれかの録音デバイスで音声セッションを動かしているか。
fn someone_else_capturing(devices: &IMMDeviceEnumerator, root: u32) -> windows::core::Result<bool> {
    let parents = process_parents();
    unsafe {
        let collection = devices.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
        for i in 0..collection.GetCount()? {
            let device = collection.Item(i)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            let sessions = manager.GetSessionEnumerator()?;
            for j in 0..sessions.GetCount()? {
                let session = sessions.GetSession(j)?;
                if session.GetState()? != AudioSessionStateActive {
                    continue;
                }
                // pid が取れないセッションは、自分のものと確かめられないので使用中として数える。
                let pid = session
                    .cast::<IAudioSessionControl2>()
                    .and_then(|s| s.GetProcessId())
                    .unwrap_or(0);
                if pid == 0 || !is_in_tree(pid, root, &parents) {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

fn main() -> ExitCode {
    let me = std::process::id();
    let root = process_parents().get(&me).copied().unwrap_or(0);
    // 親が終わったら自分も終わる。親の様子が分からなければ、stdout が閉じるまで動く。
    let parent = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, root) }.unwrap_or(HANDLE::default());

    let devices: IMMDeviceEnumerator = match unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .and_then(|()| CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL))
    } {
        Ok(devices) => devices,
        Err(e) => {
            eprintln!("micwatch: {e}");
            return ExitCode::from(3);
        }
    };

    let mut reporter = Reporter { last: None };
    let mut stdout = std::io::stdout().lock();
    loop {
        // 調べられなかった回は「使われていない」に倒す（使用中のまま固定すると録音を促し続ける）。
        let in_use = someone_else_capturing(&devices, root).unwrap_or(false);
        if let Some(line) = reporter.next(in_use) {
            // 親が読むのをやめたら（パイプが閉じたら）終わる。
            if writeln!(stdout, "{line}").and_then(|()| stdout.flush()).is_err() {
                return ExitCode::SUCCESS;
            }
        }
        if parent.is_invalid() {
            std::thread::sleep(std::time::Duration::from_millis(POLL_MS as u64));
        } else if unsafe { WaitForSingleObject(parent, POLL_MS) } == WAIT_OBJECT_0 {
            return ExitCode::SUCCESS;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_and_descendants_are_in_the_tree() {
        // 10（main）の下に 20（renderer）、その下に 30（音声サービス）。99 は別のアプリ。
        let parents = HashMap::from([(20, 10), (30, 20), (10, 1), (99, 1)]);

        assert!(is_in_tree(10, 10, &parents));
        assert!(is_in_tree(30, 10, &parents));
        assert!(!is_in_tree(99, 10, &parents));
    }

    #[test]
    fn unknown_or_looping_parents_end_outside_the_tree() {
        let parents = HashMap::from([(5, 6), (6, 5)]);

        assert!(!is_in_tree(5, 10, &parents));
        assert!(!is_in_tree(42, 10, &parents));
    }

    #[test]
    fn reports_first_state_and_changes_only() {
        let mut reporter = Reporter { last: None };

        let lines: Vec<_> = [false, false, true, true, false]
            .into_iter()
            .map(|s| reporter.next(s).map(String::from))
            .collect();

        assert_eq!(
            lines,
            [Some("0".into()), None, Some("1".into()), None, Some("0".into())]
        );
    }
}
