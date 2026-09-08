// 「他のアプリがマイクを使っているか」を見張り、状態が変わったら 1 行出す。
//
// 会議が始まっているのに録音を押し忘れていることを検知するために使う。
// マイクを使っているのが通話アプリかどうかまでは分からないが、ブラウザの
// Google Meet も含めてすべての会議を等しく拾えるのが、プロセス名を見る方式に
// 対する利点。音声データには一切触れず、デバイスの状態を読むだけなので
// TCC の許可は要らず、録音インジケータも点灯しない。
//
// 出力は `1`（どこかで使用中）か `0` の 1 行のみ。起動直後に 1 度出し、
// 以降は変化したときだけ出す。

import CoreAudio
import Foundation

private func propertyAddress(
  _ selector: AudioObjectPropertySelector,
  _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

private func audioDevices() -> [AudioDeviceID] {
  var address = propertyAddress(kAudioHardwarePropertyDevices)
  var size: UInt32 = 0

  guard
    AudioObjectGetPropertyDataSize(
      AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr
  else { return [] }

  let count = Int(size) / MemoryLayout<AudioDeviceID>.size
  var devices = [AudioDeviceID](repeating: 0, count: count)

  guard
    AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices) == noErr
  else { return [] }

  return devices
}

private func hasInput(_ device: AudioDeviceID) -> Bool {
  var address = propertyAddress(
    kAudioDevicePropertyStreamConfiguration, kAudioDevicePropertyScopeInput)
  var size: UInt32 = 0

  guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr, size > 0 else {
    return false
  }

  let buffer = UnsafeMutableRawPointer.allocate(
    byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
  defer { buffer.deallocate() }

  guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, buffer) == noErr else {
    return false
  }

  let list = UnsafeMutableAudioBufferListPointer(
    buffer.assumingMemoryBound(to: AudioBufferList.self))
  return list.contains { $0.mNumberChannels > 0 }
}

private func isRunningSomewhere(_ device: AudioDeviceID) -> Bool {
  var address = propertyAddress(kAudioDevicePropertyDeviceIsRunningSomewhere)
  var running: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)

  guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running) == noErr else {
    return false
  }

  return running != 0
}

/// 入力デバイスを毎回列挙し直す。ヘッドセットの抜き差しでデバイスが
/// 入れ替わっても取りこぼさないよう、プロパティリスナではなくポーリングにする。
private func micIsInUse() -> Bool {
  audioDevices().contains { hasInput($0) && isRunningSomewhere($0) }
}

setbuf(stdout, nil)

var previous: Bool?

while true {
  // 親（アプリ）が落ちたら道連れにする。無限ループなので、放っておくと
  // アプリを終了したあともマイクを見張り続ける孤児プロセスが残る。
  if getppid() == 1 { exit(0) }

  let current = micIsInUse()
  if current != previous {
    print(current ? "1" : "0")
    previous = current
  }
  Thread.sleep(forTimeInterval: 2)
}
