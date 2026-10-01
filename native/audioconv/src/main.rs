//! 録音の保存と音声の取り込みを Windows 標準の Media Foundation で行う（ADR-048）。macOS の afconvert に当たる。
//!
//! 使い方:
//!   audioconv encode --input <WAV> --output <m4a> --bitrate <bps>
//!     WAV を AAC-LC の m4a（MPEG-4）にする。サンプルレートは入力のまま保つ。
//!     Windows の AAC エンコーダはレートごとに使えるビットレートが決まっているので、指定に一番近いものを選ぶ。
//!     入力のレートをそもそも扱えない（8kHz など）ときは、扱える一番近いレートに上げてから符号化する。
//!   audioconv decode --input <音声> --output <WAV> --sample-rate <Hz>
//!     Media Foundation が読める音声を 16bit モノラルの WAV にする。複数チャンネルは混ぜて 1ch にする
//!     （片チャンネルを捨てると、そちらにしか入っていない話者が丸ごと消える、ADR-030）。
//!
//! どちらも出力は一時ファイルに書いてから置き換えるので、失敗したときに半端な出力は残らない。
//! 失敗は stderr に 1 行書き、段階ごとの終了コードで返す（TypeScript 側が理由に読み替える）。

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoTaskMemFree};
use windows_core::{GUID, HSTRING};

/// 終了コード。TypeScript 側（MediaFoundation の Encoder / Decoder）と揃える。
const EXIT_USAGE: u8 = 2;
/// 入力を開けない・音声として読めない。
const EXIT_INPUT: u8 = 3;
/// 出力の形式を作れない（エンコーダが受け付けないなど）。
const EXIT_OUTPUT: u8 = 4;
/// 変換の途中で失敗した。
const EXIT_CONVERT: u8 = 5;

type Failure = (u8, String);

fn fail(code: u8, stage: &str) -> impl Fn(windows_core::Error) -> Failure {
    move |e| (code, format!("{stage}: {e}"))
}

enum Command {
    Encode {
        input: PathBuf,
        output: PathBuf,
        bitrate: u32,
    },
    Decode {
        input: PathBuf,
        output: PathBuf,
        sample_rate: u32,
    },
}

fn parse_args() -> Result<Command, String> {
    let mut args = std::env::args().skip(1);
    let command = args.next().ok_or("encode か decode を指定してください")?;
    let mut input = None;
    let mut output = None;
    let mut number = None;
    while let Some(flag) = args.next() {
        let value = args.next().ok_or_else(|| format!("{flag} の値がありません"))?;
        match flag.as_str() {
            "--input" => input = Some(PathBuf::from(value)),
            "--output" => output = Some(PathBuf::from(value)),
            "--bitrate" | "--sample-rate" if number.is_none() => {
                number = Some((
                    flag.clone(),
                    value.parse::<u32>().map_err(|_| format!("不正な数値: {value}"))?,
                ))
            }
            _ => return Err(format!("知らない引数: {flag}")),
        }
    }
    let input = input.ok_or("--input がありません")?;
    let output = output.ok_or("--output がありません")?;
    match (command.as_str(), number) {
        ("encode", Some((flag, bitrate))) if flag == "--bitrate" && bitrate > 0 => {
            Ok(Command::Encode { input, output, bitrate })
        }
        ("decode", Some((flag, rate))) if flag == "--sample-rate" && (8_000..=48_000).contains(&rate) => {
            Ok(Command::Decode {
                input,
                output,
                sample_rate: rate,
            })
        }
        ("encode", _) => Err("encode には 0 より大きい --bitrate が要ります".into()),
        ("decode", _) => Err("decode には 8000〜48000 の --sample-rate が要ります".into()),
        _ => Err(format!("知らないコマンド: {command}")),
    }
}

fn media_type(subtype: &GUID, rate: u32, channels: u32) -> windows_core::Result<IMFMediaType> {
    unsafe {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels)?;
        t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate)?;
        t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        Ok(t)
    }
}

/// 16bit 整数の PCM。
fn pcm_type(rate: u32, channels: u32) -> windows_core::Result<IMFMediaType> {
    let t = media_type(&MFAudioFormat_PCM, rate, channels)?;
    unsafe {
        t.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2 * channels)?;
        t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * 2 * channels)?;
        t.SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1)?;
    }
    Ok(t)
}

const AUDIO_STREAM: u32 = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;

/// 入力の最初の音声ストリームだけを、指定の PCM で読むリーダー。
/// 映像付きのファイル（mp4 など）でも音声だけを取り出す。
fn open_reader(input: &Path) -> Result<IMFSourceReader, Failure> {
    unsafe {
        let reader =
            MFCreateSourceReaderFromURL(&HSTRING::from(input.as_os_str()), None).map_err(fail(EXIT_INPUT, "open"))?;
        reader
            .SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)
            .map_err(fail(EXIT_INPUT, "select"))?;
        reader
            .SetStreamSelection(AUDIO_STREAM, true)
            .map_err(fail(EXIT_INPUT, "no audio stream"))?;
        Ok(reader)
    }
}

/// 入力のサンプルレートとチャンネル数。
fn native_format(reader: &IMFSourceReader) -> Result<(u32, u32), Failure> {
    unsafe {
        let native = reader
            .GetNativeMediaType(AUDIO_STREAM, 0)
            .map_err(fail(EXIT_INPUT, "native type"))?;
        let rate = native
            .GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND)
            .map_err(fail(EXIT_INPUT, "sample rate"))?;
        let channels = native
            .GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)
            .map_err(fail(EXIT_INPUT, "channels"))?;
        Ok((rate, channels))
    }
}

/// 読めたサンプルを順に渡す。サンプルが無い（ギャップ）ときは飛ばす。
fn read_all(reader: &IMFSourceReader, mut each: impl FnMut(&IMFSample) -> Result<(), Failure>) -> Result<(), Failure> {
    loop {
        let mut flags = 0u32;
        let mut sample = None;
        unsafe { reader.ReadSample(AUDIO_STREAM, 0, None, Some(&mut flags), None, Some(&mut sample)) }
            .map_err(fail(EXIT_CONVERT, "read"))?;
        if let Some(sample) = sample.as_ref() {
            each(sample)?;
        }
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            return Ok(());
        }
    }
}

/// サンプルの中身（PCM のバイト列）を取り出す。
fn bytes_of(sample: &IMFSample) -> Result<Vec<u8>, Failure> {
    unsafe {
        let buffer = sample
            .ConvertToContiguousBuffer()
            .map_err(fail(EXIT_CONVERT, "buffer"))?;
        let mut data = std::ptr::null_mut::<u8>();
        let mut length = 0u32;
        buffer
            .Lock(&mut data, None, Some(&mut length))
            .map_err(fail(EXIT_CONVERT, "lock"))?;
        let bytes = std::slice::from_raw_parts(data, length as usize).to_vec();
        buffer.Unlock().map_err(fail(EXIT_CONVERT, "unlock"))?;
        Ok(bytes)
    }
}

/// 出力の横に置く一時ファイル。最後に置き換えるので、失敗しても半端な出力が残らない。
fn partial_path(output: &Path) -> PathBuf {
    let mut name = output.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

fn finish(partial: &Path, output: &Path) -> Result<(), Failure> {
    std::fs::rename(partial, output).map_err(|e| (EXIT_CONVERT, format!("rename: {e}")))
}

/// 16bit モノラルの WAV のヘッダ。
fn wav_header(rate: u32, data_bytes: u32) -> Vec<u8> {
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&rate.to_le_bytes());
    h.extend_from_slice(&(rate * 2).to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data_bytes.to_le_bytes());
    h
}

/// 入力を 16bit モノラル・指定のレートで読み、WAV に書く。
/// レートの変換とチャンネルの混ぜ合わせは Source Reader に任せる（読み手が変換器を挟む）。
fn decode(input: &Path, output: &Path, sample_rate: u32) -> Result<(), Failure> {
    use std::io::{Seek, SeekFrom, Write};
    let reader = open_reader(input)?;
    unsafe {
        reader.SetCurrentMediaType(
            AUDIO_STREAM,
            None,
            &pcm_type(sample_rate, 1).map_err(fail(EXIT_OUTPUT, "type"))?,
        )
    }
    .map_err(fail(EXIT_INPUT, "convert to pcm"))?;

    let partial = partial_path(output);
    let result = (|| {
        let mut file = std::fs::File::create(&partial).map_err(|e| (EXIT_OUTPUT, format!("create: {e}")))?;
        file.write_all(&wav_header(sample_rate, 0))
            .map_err(|e| (EXIT_OUTPUT, format!("write: {e}")))?;
        let mut written: u64 = 0;
        read_all(&reader, |sample| {
            let bytes = bytes_of(sample)?;
            written += bytes.len() as u64;
            file.write_all(&bytes)
                .map_err(|e| (EXIT_CONVERT, format!("write: {e}")))
        })?;
        let data_bytes =
            u32::try_from(written).map_err(|_| (EXIT_CONVERT, "4GB を超える音声は扱えません".to_string()))?;
        file.seek(SeekFrom::Start(0))
            .map_err(|e| (EXIT_CONVERT, format!("seek: {e}")))?;
        file.write_all(&wav_header(sample_rate, data_bytes))
            .map_err(|e| (EXIT_CONVERT, format!("write: {e}")))?;
        Ok(())
    })();
    match result {
        Ok(()) => finish(&partial, output),
        Err(failure) => {
            let _ = std::fs::remove_file(&partial);
            Err(failure)
        }
    }
}

/// AAC-LC のプロファイル・レベルの値（0x28〜0x2B）。0x2C 以降は HE-AAC で、Windows では使わない（ADR-048）。
const AAC_LC_PROFILES: std::ops::RangeInclusive<u32> = 0x28..=0x2B;

/// Windows の AAC エンコーダが、この入力から AAC-LC で出せるビットレート（bps）とプロファイル・レベルの一覧。
/// エンコーダはレートごとに決まったビットレートしか受け付けず、受け付けないレート（8kHz など）では空になる。
/// 同じレートとビットレートでも HE-AAC の候補が混ざるので、LC だけを残す。
fn aac_bitrates(rate: u32, channels: u32) -> Vec<(u32, u32)> {
    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Audio,
        guidSubtype: MFAudioFormat_PCM,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Audio,
        guidSubtype: MFAudioFormat_AAC,
    };
    let mut activates = std::ptr::null_mut::<Option<IMFActivate>>();
    let mut count = 0u32;
    let flags = MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER;
    if unsafe {
        MFTEnumEx(
            MFT_CATEGORY_AUDIO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut activates,
            &mut count,
        )
    }
    .is_err()
        || activates.is_null()
    {
        return Vec::new();
    }
    let list = unsafe { std::slice::from_raw_parts_mut(activates, count as usize) };
    let mut found = Vec::new();
    if let Some(Some(activate)) = list.first() {
        unsafe {
            if let Ok(transform) = activate.ActivateObject::<IMFTransform>()
                && let Ok(pcm) = pcm_type(rate, channels)
                && transform.SetInputType(0, &pcm, 0).is_ok()
            {
                let mut index = 0;
                while let Ok(candidate) = transform.GetOutputAvailableType(0, index) {
                    if candidate.GetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND) == Ok(rate)
                        && candidate.GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS) == Ok(channels)
                        && let Ok(bytes) = candidate.GetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND)
                        && let Ok(profile) = candidate.GetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION)
                        && AAC_LC_PROFILES.contains(&profile)
                    {
                        found.push((bytes * 8, profile));
                    }
                    index += 1;
                }
            }
            let _ = activate.ShutdownObject();
        }
    }
    for activate in list.iter_mut() {
        drop(activate.take());
    }
    unsafe { CoTaskMemFree(Some(activates as *const _)) };
    found.sort_unstable();
    found.dedup();
    found
}

/// 符号化する形式（レートと bps）を選ぶ。入力のレートを保てるならそれを使い、ビットレートは指定に一番近いもの
/// （同じ近さなら高い方）にする。保てなければ、扱える中で入力に一番近いレート（同じ近さなら高い方）に上げ下げする。
fn choose_format(input_rate: u32, channels: u32, bitrate: u32) -> Option<(u32, u32, u32)> {
    // 設定で選べるレート（SUPPORTED_SAMPLE_RATES）と揃える。
    const RATES: [u32; 7] = [8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000];
    let mut rates: Vec<u32> = RATES.iter().copied().filter(|r| *r != input_rate).collect();
    rates.sort_by_key(|r| (r.abs_diff(input_rate), u32::MAX - r));
    rates.insert(0, input_rate);
    rates.into_iter().find_map(|rate| {
        let bitrates = aac_bitrates(rate, channels);
        bitrates
            .into_iter()
            .min_by_key(|(b, _)| (b.abs_diff(bitrate), u32::MAX - b))
            .map(|(b, profile)| (rate, b, profile))
    })
}

/// WAV を AAC-LC の m4a にする。選んだレートとビットレートは stdout に 1 行で知らせる。
fn encode(input: &Path, output: &Path, bitrate: u32) -> Result<(), Failure> {
    let reader = open_reader(input)?;
    let (input_rate, input_channels) = native_format(&reader)?;
    // AAC エンコーダは 1ch と 2ch だけを受け付ける。録音（mix.wav）は 1ch。
    let channels = input_channels.clamp(1, 2);
    let (rate, chosen, profile) = choose_format(input_rate, channels, bitrate).ok_or_else(|| {
        (
            EXIT_OUTPUT,
            format!("AAC で符号化できる形式がありません（{input_rate}Hz {channels}ch）"),
        )
    })?;
    let pcm = pcm_type(rate, channels).map_err(fail(EXIT_OUTPUT, "type"))?;
    unsafe { reader.SetCurrentMediaType(AUDIO_STREAM, None, &pcm) }.map_err(fail(EXIT_INPUT, "convert to pcm"))?;

    let aac = media_type(&MFAudioFormat_AAC, rate, channels).map_err(fail(EXIT_OUTPUT, "type"))?;
    unsafe {
        aac.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, chosen / 8)
            .map_err(fail(EXIT_OUTPUT, "type"))?;
        // 明示しないと、同じレートとビットレートで HE-AAC が選ばれることがある（32kHz・32kbps など）。
        aac.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, profile)
            .map_err(fail(EXIT_OUTPUT, "type"))?;
        // MPEG-4 のコンテナには ADTS ヘッダの無い素の AAC を入れる。
        aac.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)
            .map_err(fail(EXIT_OUTPUT, "type"))?;
    }

    let partial = partial_path(output);
    let result = (|| unsafe {
        let mut attributes = None;
        MFCreateAttributes(&mut attributes, 1).map_err(fail(EXIT_OUTPUT, "attributes"))?;
        let attributes = attributes.ok_or((EXIT_OUTPUT, "attributes".to_string()))?;
        // 一時ファイルの拡張子（.part）から入れ物を推せないので、MPEG-4 と明示する。
        attributes
            .SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_MPEG4)
            .map_err(fail(EXIT_OUTPUT, "attributes"))?;
        let writer = MFCreateSinkWriterFromURL(&HSTRING::from(partial.as_os_str()), None, &attributes)
            .map_err(fail(EXIT_OUTPUT, "create"))?;
        let stream = writer.AddStream(&aac).map_err(fail(EXIT_OUTPUT, "aac"))?;
        writer
            .SetInputMediaType(stream, &pcm, None)
            .map_err(fail(EXIT_OUTPUT, "encoder input"))?;
        writer.BeginWriting().map_err(fail(EXIT_OUTPUT, "begin"))?;
        read_all(&reader, |sample| {
            writer.WriteSample(stream, sample).map_err(fail(EXIT_CONVERT, "write"))
        })?;
        writer.Finalize().map_err(fail(EXIT_CONVERT, "finalize"))
    })();
    match result {
        Ok(()) => {
            finish(&partial, output)?;
            println!("rate={rate} bitrate={chosen}");
            Ok(())
        }
        Err(failure) => {
            let _ = std::fs::remove_file(&partial);
            Err(failure)
        }
    }
}

fn main() -> ExitCode {
    let command = match parse_args() {
        Ok(command) => command,
        Err(message) => {
            eprintln!("audioconv: {message}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let started = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .and_then(|()| unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET) });
    if let Err(e) = started {
        eprintln!("audioconv: startup: {e}");
        return ExitCode::from(EXIT_CONVERT);
    }
    let result = match &command {
        Command::Encode { input, output, bitrate } => encode(input, output, *bitrate),
        Command::Decode {
            input,
            output,
            sample_rate,
        } => decode(input, output, *sample_rate),
    };
    unsafe {
        let _ = MFShutdown();
    }
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err((code, message)) => {
            eprintln!("audioconv: {message}");
            ExitCode::from(code)
        }
    }
}
