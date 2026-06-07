/**
 * HiNest 일정 위젯 (macOS) — 알림센터/데스크톱에 다가오는 일정 표시.
 *
 * iOS 위젯과 거의 동일하지만 macOS 위젯 사이즈(systemSmall/Medium/Large)에 맞춰
 * 여백·폰트만 미세 조정. 데이터 흐름은 같다 — App Group 의 세션 토큰으로
 * /api/widget/schedule/today 호출.
 *
 * 토큰은 별도 HiNestWidgetApp(SwiftUI) 의 로그인 화면이 채워 넣는다 — 메인 Electron
 * 앱과는 현재 독립적. (향후 Keychain 공유 또는 공유 파일로 자동 동기화 예정.)
 */
import WidgetKit
import SwiftUI

private let APP_GROUP = "group.com.hivits.hinest"
private let API_BASE = "https://nest.hi-vits.com"
private let TOKEN_KEY = "hinest.session.token"

// MARK: - Models

struct WidgetEvent: Codable, Identifiable {
    let id: String
    let title: String
    let startAt: Date
    let endAt: Date
    let color: String
    let category: String
}

private struct WidgetResponse: Codable {
    let events: [WidgetEvent]
    let nextRefreshAt: Date?
}

// MARK: - Timeline Provider

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let events: [WidgetEvent]
    let signedIn: Bool
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(date: Date(), events: sampleEvents(), signedIn: true)
    }
    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        Task { completion(await fetchEntry()) }
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            let now = Date()
            let nextHint = entry.events.first?.startAt ?? now.addingTimeInterval(15 * 60)
            let fallback = now.addingTimeInterval(15 * 60)
            let refresh = max(now.addingTimeInterval(60), min(nextHint, fallback))
            completion(Timeline(entries: [entry], policy: .after(refresh)))
        }
    }
    private func fetchEntry() async -> ScheduleEntry {
        let defaults = UserDefaults(suiteName: APP_GROUP)
        guard let token = defaults?.string(forKey: TOKEN_KEY), !token.isEmpty else {
            return ScheduleEntry(date: Date(), events: [], signedIn: false)
        }
        guard let url = URL(string: "\(API_BASE)/api/widget/schedule/today") else {
            return ScheduleEntry(date: Date(), events: [], signedIn: true)
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 8
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return ScheduleEntry(date: Date(), events: [], signedIn: true)
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let body = try decoder.decode(WidgetResponse.self, from: data)
            return ScheduleEntry(date: Date(), events: body.events, signedIn: true)
        } catch {
            return ScheduleEntry(date: Date(), events: [], signedIn: true)
        }
    }
    private func sampleEvents() -> [WidgetEvent] {
        let now = Date()
        return [
            WidgetEvent(id: "s1", title: "팀 스탠드업", startAt: now.addingTimeInterval(1800), endAt: now.addingTimeInterval(3600), color: "#3B5CF0", category: "MEETING"),
            WidgetEvent(id: "s2", title: "디자인 리뷰", startAt: now.addingTimeInterval(7200), endAt: now.addingTimeInterval(10800), color: "#E11D48", category: "MEETING"),
        ]
    }
}

// MARK: - View

struct HiNestScheduleWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family
    var body: some View {
        switch family {
        case .systemSmall:  SmallView(entry: entry)
        case .systemMedium: MediumView(entry: entry)
        case .systemLarge:  LargeView(entry: entry)
        default:            MediumView(entry: entry)
        }
    }
}

private struct Header: View {
    let date: Date
    var body: some View {
        HStack(spacing: 4) {
            Text("HiNest")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(Color(red: 0.23, green: 0.36, blue: 0.94))
            Text("·").font(.system(size: 11)).foregroundColor(.secondary)
            Text(date, format: .dateTime.month().day().weekday(.abbreviated))
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
        }
    }
}

private struct EmptyState: View {
    let signedIn: Bool
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: signedIn ? "calendar.badge.checkmark" : "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 24, weight: .light))
                .foregroundColor(.secondary)
            Text(signedIn ? "다가오는 일정이 없어요" : "위젯 앱에 로그인하면 표시돼요")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct EventRow: View {
    let event: WidgetEvent
    let compact: Bool
    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: event.color))
                .frame(width: 3).frame(maxHeight: .infinity)
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(.system(size: compact ? 12 : 13, weight: .bold))
                    .lineLimit(compact ? 1 : 2)
                    .foregroundColor(.primary)
                Text(timeRange(event))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
    private func timeRange(_ e: WidgetEvent) -> String {
        let f = DateFormatter()
        f.dateFormat = "a h:mm"
        f.locale = Locale(identifier: "ko_KR")
        return "\(f.string(from: e.startAt)) – \(f.string(from: e.endAt))"
    }
}

private struct SmallView: View {
    let entry: ScheduleEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Header(date: entry.date)
            if let first = entry.events.first {
                EventRow(event: first, compact: false)
                Spacer(minLength: 0)
            } else {
                EmptyState(signedIn: entry.signedIn)
            }
        }
        .padding(13)
        .containerBackground(for: .widget) { Color(.windowBackgroundColor) }
    }
}

private struct MediumView: View {
    let entry: ScheduleEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Header(date: entry.date)
            if entry.events.isEmpty {
                EmptyState(signedIn: entry.signedIn)
            } else {
                ForEach(entry.events.prefix(3)) { e in
                    EventRow(event: e, compact: true)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(13)
        .containerBackground(for: .widget) { Color(.windowBackgroundColor) }
    }
}

private struct LargeView: View {
    let entry: ScheduleEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Header(date: entry.date)
            if entry.events.isEmpty {
                EmptyState(signedIn: entry.signedIn)
            } else {
                ForEach(entry.events.prefix(7)) { e in
                    EventRow(event: e, compact: true)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(15)
        .containerBackground(for: .widget) { Color(.windowBackgroundColor) }
    }
}

// MARK: - Widget Bundle

@main
struct HiNestScheduleWidget: Widget {
    let kind: String = "HiNestScheduleWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            HiNestScheduleWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("일정")
        .description("HiNest 의 다가오는 일정을 한눈에 확인하세요.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - Helpers

private extension Color {
    init(hex: String) {
        let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var rgb: UInt64 = 0
        Scanner(string: s).scanHexInt64(&rgb)
        let r = Double((rgb >> 16) & 0xFF) / 255.0
        let g = Double((rgb >> 8) & 0xFF) / 255.0
        let b = Double(rgb & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
