// macOS のカレンダー（EventKit）を読み、録音の開始時刻に重なる予定を渡す（ADR-040）。
//
// EventKit は Electron からは触れないため、micwatch と同じく小さなヘルパーにする。
// TCC は子プロセスの問い合わせを親のアプリに帰属させるので、許可のダイアログには
// アプリの名前と、その Info.plist の NSCalendarsFullAccessUsageDescription が出る。
//
// 読むだけで書き込みはしない。外部への送信もない。
//
//   calendarevents status                 権限の状態を 1 行
//   calendarevents request                権限を求め、結果の状態を 1 行
//   calendarevents events <fromMs> <toMs> 区間に重なる予定を JSON の配列で
//
// 権限が無いまま events を呼ぶと、終了コード 2 で何も出さない。

import EventKit
import Foundation

let store = EKEventStore()

func statusName(_ status: EKAuthorizationStatus) -> String {
  switch status {
  case .fullAccess: return "granted"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "not-determined"
  case .writeOnly: return "write-only"
  @unknown default: return "unknown"
  }
}

func currentStatus() -> String {
  statusName(EKEventStore.authorizationStatus(for: .event))
}

func requestAccess() -> String {
  let done = DispatchSemaphore(value: 0)
  // 結果は完了ハンドラの引数ではなく状態を読み直して返す。
  // 既に拒否済みの場合はダイアログが出ず、ハンドラは false だけを返すため。
  store.requestFullAccessToEvents { _, _ in done.signal() }
  done.wait()
  return currentStatus()
}

func statusName(_ status: EKParticipantStatus) -> String {
  switch status {
  case .accepted: return "accepted"
  case .declined: return "declined"
  case .tentative: return "tentative"
  case .pending: return "pending"
  default: return "unknown"
  }
}

func kindName(_ type: EKParticipantType) -> String {
  switch type {
  case .person: return "person"
  case .room: return "room"
  case .resource: return "resource"
  case .group: return "group"
  default: return "unknown"
  }
}

/// 参加者の URL は `mailto:` であることが多い。それ以外（電話番号など）は捨てる。
func email(of participant: EKParticipant) -> String? {
  let url = participant.url
  guard url.scheme?.lowercased() == "mailto" else { return nil }
  let address = url.absoluteString.dropFirst("mailto:".count)
  return address.isEmpty ? nil : String(address).removingPercentEncoding
}

func attendeeJSON(_ participant: EKParticipant) -> [String: Any] {
  var json: [String: Any] = [
    "isSelf": participant.isCurrentUser,
    "status": statusName(participant.participantStatus),
    "kind": kindName(participant.participantType),
  ]
  if let name = participant.name { json["name"] = name }
  if let email = email(of: participant) { json["email"] = email }
  return json
}

func eventJSON(_ event: EKEvent) -> [String: Any] {
  var json: [String: Any] = [
    "title": event.title ?? "",
    "startMs": Int64(event.startDate.timeIntervalSince1970 * 1000),
    "endMs": Int64(event.endDate.timeIntervalSince1970 * 1000),
    "allDay": event.isAllDay,
    "attendees": (event.attendees ?? []).map(attendeeJSON),
  ]
  // 会議の URL がどこに入るかはサービスによって違う（Google は本文、Outlook は場所や URL 欄）。
  // 判定はアプリ側（MeetingStart）で行い、ここでは素のまま渡す（ADR-041）。
  if let id = event.eventIdentifier { json["id"] = id }
  if let url = event.url { json["url"] = url.absoluteString }
  if let location = event.location { json["location"] = location }
  if let notes = event.notes { json["notes"] = notes }
  return json
}

func printEvents(fromMs: Double, toMs: Double) {
  guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { exit(2) }

  let predicate = store.predicateForEvents(
    withStart: Date(timeIntervalSince1970: fromMs / 1000),
    end: Date(timeIntervalSince1970: toMs / 1000),
    calendars: nil)
  let events = store.events(matching: predicate).map(eventJSON)

  guard let data = try? JSONSerialization.data(withJSONObject: events) else { exit(1) }
  FileHandle.standardOutput.write(data)
  print()
}

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "status":
  print(currentStatus())
case "request":
  print(requestAccess())
case "events":
  guard args.count == 4, let from = Double(args[2]), let to = Double(args[3]) else { exit(64) }
  printEvents(fromMs: from, toMs: to)
default:
  FileHandle.standardError.write(Data("usage: calendarevents status|request|events <fromMs> <toMs>\n".utf8))
  exit(64)
}
