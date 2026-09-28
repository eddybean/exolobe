// macOS の Apple Intelligence（FoundationModels）で要約を作るための小さなヘルパー（ADR-046）。
//
// FoundationModels は Swift からしか呼べないため、micwatch / calendarevents と同じく同梱の CLI にする。
// モデルは OS のプロセスで動き、プロンプトも応答も端末の外に出ない（Private Cloud Compute は使わない）。
//
//   applelm status    使えるかを 1 行の JSON で（{"availability":"available","contextSize":8192}）
//   applelm respond   stdin のプロンプトに 1 回だけ応答し、本文を stdout へ
//
// 分割・統合はアプリ側（LlamaCppSummarizer）が担う。コンテキストは 8192 トークンしかないので、
// 呼ぶたびに新しいセッションを作り、前のやり取りを持ち越さない。
//
// respond の終了コード: 0 成功 / 2 使えない / 3 安全フィルタが拒否 / 4 コンテキスト超過 /
// 5 言語が非対応 / 1 その他。理由の詳細は stderr に出す。

import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

func fail(_ code: Int32, _ message: String) -> Int32 {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  return code
}

func printJSON(_ object: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  print(String(decoding: data, as: UTF8.self))
}

// 評価は macOS 27 のモデル（コンテキスト 8192）で行った。26 のモデルは 4096 で、品質も確かめていない。
// SDK は 27 でも、最低対応 OS（14.2）で起動できるよう FoundationModels は弱リンクにしてある。
func run() async -> Int32 {
  let command = CommandLine.arguments.dropFirst().first ?? ""
  guard command == "status" || command == "respond" else {
    return fail(64, "usage: applelm status | applelm respond < prompt")
  }

  #if canImport(FoundationModels)
  if #available(macOS 27.0, *) {
    // 要約は与えた文章の書き換えなので、拒否の誤検知が少ないガードレールを使う。
    // 既定のままだと、会議で普通に出る話題（事故・病気など）で応答ごと落ちることがある。
    let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)

    let availability: String
    switch model.availability {
    case .available: availability = "available"
    case .unavailable(.deviceNotEligible): availability = "device-not-eligible"
    case .unavailable(.appleIntelligenceNotEnabled): availability = "apple-intelligence-not-enabled"
    case .unavailable(.modelNotReady): availability = "model-not-ready"
    case .unavailable: availability = "unavailable"
    }

    if command == "status" {
      if availability == "available" {
        printJSON(["availability": availability, "contextSize": model.contextSize])
      } else {
        printJSON(["availability": availability])
      }
      return 0
    }

    guard availability == "available" else { return fail(2, availability) }

    let prompt = String(decoding: FileHandle.standardInput.readDataToEndOfFile(), as: UTF8.self)
    do {
      // Gemma（node-llama-cpp の既定）と同じく貪欲法にする。同じ文字起こしから毎回同じ要約が出る。
      let response = try await LanguageModelSession(model: model)
        .respond(to: prompt, options: GenerationOptions(samplingMode: .greedy))
      print(response.content)
      return 0
    } catch let error as LanguageModelSession.GenerationError {
      switch error {
      case .guardrailViolation, .refusal: return fail(3, "\(error)")
      case .exceededContextWindowSize: return fail(4, "\(error)")
      case .unsupportedLanguageOrLocale: return fail(5, "\(error)")
      default: return fail(1, "\(error)")
      }
    } catch {
      return fail(1, "\(error)")
    }
  }
  #endif

  if command == "status" {
    printJSON(["availability": "unsupported-os"])
    return 0
  }
  return fail(2, "unsupported-os")
}

exit(await run())
