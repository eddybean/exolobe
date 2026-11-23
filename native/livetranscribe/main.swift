// 録音中のライブ字幕のための小さなヘルパー（ADR-050）。
//
// SpeechAnalyzer（macOS 26+）は Swift からしか呼べないため、applelm と同じく同梱の CLI にする。
// 認識は OS のプロセスで動き、音声もテキストも端末の外に出ない。
//
//   livetranscribe status --locale ja-JP
//       使えるかを 1 行の JSON で（{"availability":"available","assets":"installed"}）
//   livetranscribe stream --locale ja-JP --sample-rate 16000
//       stdin に [track 1B][len 4B LE][Int16 LE モノラル PCM] の枠で 2 トラックを受け、
//       結果を stdout に JSON 行で流す。stdin が閉じたら残りを確定させて終わる。
//
// 2 トラックは 1 プロセスで受け、SpeechAnalyzer をトラックごとに 1 つ持つ。track 0 = システム音声（相手）、
// 1 = マイク（自分）。認識の本体は OS のデーモン側（localspeechrecognition）にあり、プロセスを分けて隔離する得が小さい。
//
// stream の出力（1 行 1 件）:
//   {"type":"downloading"}   初回だけ、OS が認識のモデルを取得している
//   {"type":"ready"}         認識を始めた
//   {"type":"caption","track":0,"kind":"volatile"|"final","text":"…","startMs":0,"endMs":1200}
// 終了コード: 0 正常 / 2 OS が非対応 / 3 言語が非対応 / 1 その他（理由は stderr）。

import AVFoundation
import Foundation
#if canImport(Speech)
import Speech
#endif

let stdoutLock = NSLock()
func emit(_ object: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  stdoutLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  stdoutLock.unlock()
}

func fail(_ code: Int32, _ message: String) -> Int32 {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  return code
}

func option(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

/// stdin から正確に n バイト読む。EOF なら nil。
func readExactly(_ n: Int) -> Data? {
  var buffer = Data()
  while buffer.count < n {
    let chunk = FileHandle.standardInput.readData(ofLength: n - buffer.count)
    if chunk.isEmpty { return nil }
    buffer.append(chunk)
  }
  return buffer
}

#if canImport(Speech)
@available(macOS 26.0, *)
func makeTranscriber(_ locale: Locale) -> SpeechTranscriber {
  // .fastResults が無いと volatile が 10 秒ほどまとめて届き、字幕として役に立たない。
  SpeechTranscriber(
    locale: locale, transcriptionOptions: [],
    reportingOptions: [.volatileResults, .fastResults],
    attributeOptions: [.audioTimeRange])
}

@available(macOS 26.0, *)
func status(_ localeId: String) async -> Int32 {
  guard SpeechTranscriber.isAvailable else {
    emit(["availability": "unavailable"])
    return 0
  }
  guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
  else {
    emit(["availability": "unsupported-locale"])
    return 0
  }
  // AssetInventory.status は導入済みでも .supported を返す（macOS 27.0.1 で確かめた）ので、
  // 導入済みかは installedLocales で見る。assetInstallationRequest は呼ぶだけで言語を予約するので
  // status では使わない（予約は 1 アプリ 5 言語まで）。
  let installed = await SpeechTranscriber.installedLocales.contains {
    $0.identifier(.bcp47) == locale.identifier(.bcp47)
  }
  emit(["availability": "available", "assets": installed ? "installed" : "downloadable"])
  return 0
}

// 読み取りのスレッドだけが push し、結果の受け取りは別の Task で行う。push 同士は重ならない。
@available(macOS 26.0, *)
final class Track: @unchecked Sendable {
  let index: Int
  let transcriber: SpeechTranscriber
  let analyzer: SpeechAnalyzer
  let continuation: AsyncStream<AnalyzerInput>.Continuation
  let stream: AsyncStream<AnalyzerInput>
  let converter: AVAudioConverter
  let inFormat: AVAudioFormat
  let outFormat: AVAudioFormat

  init(index: Int, locale: Locale, inFormat: AVAudioFormat) async throws {
    self.index = index
    transcriber = makeTranscriber(locale)
    guard let best = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
      let converter = AVAudioConverter(from: inFormat, to: best)
    else { throw NSError(domain: "livetranscribe", code: 1) }
    outFormat = best
    self.inFormat = inFormat
    self.converter = converter
    analyzer = SpeechAnalyzer(modules: [transcriber])
    (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
  }

  func push(_ pcm: Data) {
    let frames = AVAudioFrameCount(pcm.count / 2)
    guard frames > 0, let input = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: frames)
    else { return }
    input.frameLength = frames
    pcm.withUnsafeBytes { raw in
      let src = raw.bindMemory(to: Int16.self)
      let dst = input.int16ChannelData![0]
      for i in 0..<Int(frames) { dst[i] = Int16(littleEndian: src[i]) }
    }
    let capacity = AVAudioFrameCount(
      Double(frames) * outFormat.sampleRate / inFormat.sampleRate) + 32
    guard let output = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
    var given = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if given {
        status.pointee = .noDataNow
        return nil
      }
      given = true
      status.pointee = .haveData
      return input
    }
    if output.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: output)) }
  }
}

@available(macOS 26.0, *)
func stream(_ localeId: String, sampleRate: Double) async -> Int32 {
  guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: localeId))
  else { return fail(3, "unsupported-locale") }
  guard
    let inFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: false)
  else { return fail(1, "bad-format") }

  do {
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [makeTranscriber(locale)]) {
      emit(["type": "downloading"])
      try await request.downloadAndInstall()
    }
    let tracks = [
      try await Track(index: 0, locale: locale, inFormat: inFormat),
      try await Track(index: 1, locale: locale, inFormat: inFormat),
    ]
    var collectors: [Task<Void, Error>] = []
    for track in tracks {
      collectors.append(
        Task {
          for try await result in track.transcriber.results {
            emit([
              "type": "caption",
              "track": track.index,
              "kind": result.isFinal ? "final" : "volatile",
              "text": String(result.text.characters),
              "startMs": Int((result.range.start.seconds * 1000).rounded()),
              "endMs": Int((result.range.end.seconds * 1000).rounded()),
            ])
          }
        })
      try await track.analyzer.start(inputSequence: track.stream)
    }
    emit(["type": "ready"])

    // stdin の読み取りは止まる呼び出しなので、協調スレッドを塞がないよう専用のスレッドで回す。
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      Thread {
        while let header = readExactly(5) {
          let index = Int(header[header.startIndex])
          let length = header.subdata(in: 1..<5).withUnsafeBytes {
            Int(UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)))
          }
          guard let pcm = readExactly(length) else { break }
          if index < tracks.count { tracks[index].push(pcm) }
        }
        done.resume()
      }.start()
    }

    for track in tracks { track.continuation.finish() }
    // macOS 27 では finalizeAndFinishThroughEndOfInput が返らないことがある。確定を待つのは
    // 呼び出し側（アプリ）が kill するまでの間だけ。タスクグループは子が返るまで抜けないので、
    // 時間切れはプロセスごと終える。
    DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) { exit(0) }
    await withTaskGroup(of: Void.self) { group in
      for track in tracks {
        group.addTask { try? await track.analyzer.finalizeAndFinishThroughEndOfInput() }
      }
    }
    for collector in collectors { _ = try? await collector.value }
    return 0
  } catch {
    return fail(1, "\(error)")
  }
}
#endif

func run() async -> Int32 {
  let command = CommandLine.arguments.dropFirst().first ?? ""
  let localeId = option("--locale") ?? "ja-JP"
  #if canImport(Speech)
  if #available(macOS 26.0, *) {
    switch command {
    case "status": return await status(localeId)
    case "stream":
      return await stream(localeId, sampleRate: Double(option("--sample-rate") ?? "16000") ?? 16000)
    default: return fail(64, "usage: livetranscribe status|stream --locale <id> [--sample-rate <hz>]")
    }
  }
  #endif
  if command == "status" {
    emit(["availability": "unsupported-os"])
    return 0
  }
  return fail(2, "unsupported-os")
}

exit(await run())
