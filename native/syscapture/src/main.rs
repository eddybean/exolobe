//! システム音声（相手の声）を WASAPI のプロセス loopback で取り込み、16bit モノラルの PCM を stdout に流す。
//!
//! 使い方: `syscapture --sample-rate <Hz> [--exclude-pid <PID>]`
//!
//! - `--exclude-pid` のプロセスとその子孫（Exolobe 自身）の音は録らない。プレビューなどが
//!   相手の声のトラックに混ざらないようにするため（Windows 10 2004 以降の除外モード）。
//!   省くと自分（syscapture）だけを除く。音を出さないので、実質すべての音を録る（テスト録音用）。
//! - 変換は WASAPI に任せる（AUTOCONVERTPCM）。指定のサンプルレート・16bit・モノラルで受け取り、
//!   そのまま書き出すので、audiotee と同じ PCM の取り決めで TypeScript 側の扱いを揃えられる。
//! - stdin が閉じたら止まる。親（Electron の main）が落ちてもパイプが閉じるので、取り残されない。
//! - 失敗は stderr に 1 行書き、段階ごとの終了コードで返す（TypeScript 側が理由に読み替える）。

use std::io::{Read, Write};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl, IAudioCaptureClient,
    IAudioClient, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVE_FORMAT_PCM, WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{BLOB, COINIT_MULTITHREADED, CoInitializeEx, IAgileObject, IAgileObject_Impl};
use windows::Win32::System::Threading::{CreateEventW, INFINITE, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;
use windows_core::{Interface, Ref, implement};

/// 終了コード。TypeScript 側（SysCaptureSource）と揃える。
const EXIT_USAGE: u8 = 2;
/// プロセス loopback を開けない。Windows 10 2004 より前の OS など。
const EXIT_ACTIVATE: u8 = 3;
/// 開けたが、指定の形式で初期化・開始できない。
const EXIT_INITIALIZE: u8 = 4;
/// 取り込みの途中で失敗した。
const EXIT_CAPTURE: u8 = 5;

/// 待つ間隔。stdin が閉じたことにこの間隔で気付く。
const WAIT_MS: u32 = 100;
/// WASAPI の共有バッファの長さ（100ns 単位で 200ms）。
const BUFFER_DURATION: i64 = 2_000_000;

struct Args {
    sample_rate: u32,
    exclude_pid: u32,
}

fn parse_args() -> Result<Args, String> {
    let mut sample_rate = None;
    let mut exclude_pid = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().ok_or_else(|| format!("{arg} の値がありません"))?;
        match arg.as_str() {
            "--sample-rate" => {
                sample_rate = Some(
                    value
                        .parse::<u32>()
                        .map_err(|_| format!("不正なサンプルレート: {value}"))?,
                )
            }
            "--exclude-pid" => exclude_pid = Some(value.parse::<u32>().map_err(|_| format!("不正な PID: {value}"))?),
            _ => return Err(format!("知らない引数: {arg}")),
        }
    }
    let sample_rate = sample_rate.ok_or("--sample-rate がありません")?;
    if !(8_000..=48_000).contains(&sample_rate) {
        return Err(format!("サンプルレートは 8000〜48000 です: {sample_rate}"));
    }
    Ok(Args {
        sample_rate,
        exclude_pid: exclude_pid.unwrap_or_else(std::process::id),
    })
}

/// ActivateAudioInterfaceAsync の完了を知らせるだけの受け手。
/// 完了は別のスレッドから呼ばれるので、IAgileObject を名乗ってマーシャリングを要らなくする。
#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Completion {
    done: isize,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(&self, _operation: Ref<IActivateAudioInterfaceAsyncOperation>) -> windows_core::Result<()> {
        unsafe { SetEvent(HANDLE(self.done as *mut _)) }
    }
}

impl IAgileObject_Impl for Completion_Impl {}

fn activate(exclude_pid: u32) -> windows_core::Result<IAudioClient> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: exclude_pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // blob は params（スタック上）を指すだけなので、drop で PropVariantClear に解放させてはいけない。
    let variant = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });
    unsafe {
        let done = CreateEventW(None, false, false, None)?;
        let handler: IActivateAudioInterfaceCompletionHandler = Completion { done: done.0 as isize }.into();
        let operation = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &handler,
        )?;
        WaitForSingleObject(done, INFINITE);
        let mut result = windows_core::HRESULT(0);
        let mut unknown = None;
        operation.GetActivateResult(&mut result, &mut unknown)?;
        result.ok()?;
        unknown
            .ok_or_else(|| windows_core::Error::from_hresult(windows_core::HRESULT(-1)))?
            .cast()
    }
}

/// stdin が閉じたら立つ旗。親が落ちたときもパイプが閉じるので同じ扱いになる。
fn watch_stdin() -> Arc<AtomicBool> {
    let closed = Arc::new(AtomicBool::new(false));
    let flag = closed.clone();
    std::thread::spawn(move || {
        let mut sink = [0u8; 256];
        let mut stdin = std::io::stdin();
        while matches!(stdin.read(&mut sink), Ok(n) if n > 0) {}
        flag.store(true, Ordering::SeqCst);
    });
    closed
}

/// 開始からの経過時間と、書き出した量を突き合わせる。
/// 何も鳴っていない間は WASAPI がパケットを返さないことがあるため、足りない分を無音で埋める。
/// 埋めないと、マイクのトラックとの時刻が無音の長さだけずれる。
struct Clock {
    started: Instant,
    written: u64,
    sample_rate: u32,
}

impl Clock {
    fn missing_frames(&self) -> u64 {
        let expected = (self.started.elapsed().as_secs_f64() * self.sample_rate as f64) as u64;
        expected.saturating_sub(self.written)
    }
}

type Failure = (u8, String);

fn fail(code: u8, stage: &str) -> impl Fn(windows_core::Error) -> Failure {
    move |e| (code, format!("{stage}: {e}"))
}

fn capture(args: &Args) -> Result<(), Failure> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(fail(EXIT_ACTIVATE, "CoInitializeEx"))?;
    let client = activate(args.exclude_pid).map_err(fail(EXIT_ACTIVATE, "activate"))?;

    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: 1,
        nSamplesPerSec: args.sample_rate,
        nAvgBytesPerSec: args.sample_rate * 2,
        nBlockAlign: 2,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    let (event, capture) = unsafe {
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                    | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
                BUFFER_DURATION,
                0,
                &format,
                None,
            )
            .map_err(fail(EXIT_INITIALIZE, "Initialize"))?;
        let event = CreateEventW(None, false, false, None).map_err(fail(EXIT_INITIALIZE, "CreateEvent"))?;
        client
            .SetEventHandle(event)
            .map_err(fail(EXIT_INITIALIZE, "SetEventHandle"))?;
        let capture: IAudioCaptureClient = client.GetService().map_err(fail(EXIT_INITIALIZE, "GetService"))?;
        client.Start().map_err(fail(EXIT_INITIALIZE, "Start"))?;
        (event, capture)
    };

    let closed = watch_stdin();
    let mut stdout = std::io::stdout().lock();
    let mut clock = Clock {
        started: Instant::now(),
        written: 0,
        sample_rate: args.sample_rate,
    };
    let zeros = vec![0u8; args.sample_rate as usize * 2];
    // 親が読むのをやめたら（パイプが閉じたら）書き込みが失敗するので、そこで終わる。
    let mut write = |bytes: &[u8], clock: &mut Clock| -> Result<(), Failure> {
        stdout
            .write_all(bytes)
            .map_err(|e| (EXIT_CAPTURE, format!("stdout: {e}")))?;
        clock.written += (bytes.len() / 2) as u64;
        Ok(())
    };

    while !closed.load(Ordering::SeqCst) {
        let signaled = unsafe { WaitForSingleObject(event, WAIT_MS) } == WAIT_OBJECT_0;
        let mut received = false;
        loop {
            let frames = unsafe { capture.GetNextPacketSize() }.map_err(fail(EXIT_CAPTURE, "GetNextPacketSize"))?;
            if frames == 0 {
                break;
            }
            let mut data = std::ptr::null_mut::<u8>();
            let mut count = 0u32;
            let mut flags = 0u32;
            unsafe { capture.GetBuffer(&mut data, &mut count, &mut flags, None, None) }
                .map_err(fail(EXIT_CAPTURE, "GetBuffer"))?;
            let mut length = count as usize * 2;
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                while length > 0 {
                    let n = length.min(zeros.len());
                    write(&zeros[..n], &mut clock)?;
                    length -= n;
                }
            } else {
                write(unsafe { std::slice::from_raw_parts(data, length) }, &mut clock)?;
            }
            unsafe { capture.ReleaseBuffer(count) }.map_err(fail(EXIT_CAPTURE, "ReleaseBuffer"))?;
            received = true;
        }
        // パケットが来ている間は WASAPI の時刻に任せ、来なくなったときだけ経過時間まで無音で埋める。
        if !signaled && !received {
            let mut missing = clock.missing_frames() as usize * 2;
            while missing > 0 {
                let n = missing.min(zeros.len());
                write(&zeros[..n], &mut clock)?;
                missing -= n;
            }
        }
    }
    unsafe {
        let _ = client.Stop();
    }
    Ok(())
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("syscapture: {message}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    match capture(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, message)) => {
            eprintln!("syscapture: {message}");
            ExitCode::from(code)
        }
    }
}
