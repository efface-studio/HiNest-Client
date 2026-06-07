/**
 * HiNest 일정 위젯 — 홈 화면에 다가오는 일정을 표시.
 *
 * 데이터 흐름:
 *   1. 메인 앱이 로그인 시 App Group 의 UserDefaults 에 세션 토큰을 저장
 *      (NSE 가 이미 그 토큰으로 채팅 아바타를 받는 것과 동일한 group).
 *   2. 위젯 TimelineProvider 가 그 토큰으로 GET /api/widget/schedule/today 호출.
 *   3. 응답을 Timeline 으로 만들어 WidgetKit 에 넘김 — refresh 는 next 일정 시작 시각
 *      또는 15분 후 중 빠른 쪽.
 *
 * 크기:
 *   - systemSmall (2x2) : 첫 1건만 큼직하게
 *   - systemMedium (4x2): 다가오는 3–4건 리스트
 *   - systemLarge (4x4) : 6–8건 + 시간 헤더 (iPad)
 */
import WidgetKit
import SwiftUI

private let APP_GROUP = "group.com.hivits.hinest"
private let API_BASE = "https://nest.hi-vits.com" // 운영 Vercel 도메인 — 위젯도 동일 origin 사용
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
    /// nil = 토큰 미설정(아직 로그인 안 함)
    let signedIn: Bool
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry {
        ScheduleEntry(date: Date(), events: sampleEvents(), signedIn: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        Task {
            let entry = await fetchEntry()
            completion(entry)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        Task {
            let entry = await fetchEntry()
            // 다음 갱신 시점: nextRefreshAt or 15분 후(최소). next 가 너무 가까우면 1분 최소 보장.
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
        case .systemSmall:
            SmallView(entry: entry)
        case .systemMedium:
            MediumView(entry: entry)
        case .systemLarge:
            LargeView(entry: entry)
        default:
            MediumView(entry: entry)
        }
    }
}

private struct Header: View {
    let date: Date
    var body: some View {
        HStack(spacing: 4) {
            Text("HiNest")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(Color(red: 0.23, green: 0.36, blue: 0.94))
            Text("·")
                .font(.system(size: 10))
                .foregroundColor(.secondary)
            Text(date, format: .dateTime.month().day().weekday(.abbreviated))
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.secondary)
        }
    }
}

private struct EmptyState: View {
    let signedIn: Bool
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: signedIn ? "calendar.badge.checkmark" : "person.crop.circle.badge.exclamationmark")
                .font(.system(size: 22, weight: .light))
                .foregroundColor(.secondary)
            Text(signedIn ? "다가오는 일정이 없어요" : "앱에 로그인하면 표시돼요")
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
        HStack(alignment: .top, spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(hex: event.color))
                .frame(width: 3)
                .frame(maxHeight: .infinity)
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
        .padding(12)
        .containerBackground(for: .widget) { Color(.systemBackground) }
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
        .padding(12)
        .containerBackground(for: .widget) { Color(.systemBackground) }
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
        .padding(14)
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }
}

// MARK: - Widget Entry

@main
struct HiNestScheduleWidget: Widget {
    let kind: String = "HiNestScheduleWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            HiNestScheduleWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("일정")
        .description("다가오는 일정을 한눈에 확인하세요.")
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
