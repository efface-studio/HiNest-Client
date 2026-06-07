/**
 * HiNest 위젯 호스트 — 로그인/토큰 관리 화면.
 *
 * 동작:
 *   - 로그인 안 됨: 이메일·비밀번호 입력 → POST /api/auth/login → 토큰을 App Group 에 저장
 *   - 로그인 됨: '연결됨' 표시 + 위젯 재로드 버튼 + 로그아웃
 *
 * 향후 Electron 메인 앱과 토큰 자동 동기화 시 이 화면은 상태 확인용으로 축소.
 */
import SwiftUI
import WidgetKit

private let APP_GROUP = "group.com.hivits.hinest"
private let API_BASE = "https://nest.hi-vits.com"
private let TOKEN_KEY = "hinest.session.token"
private let USER_NAME_KEY = "hinest.session.userName"

struct ContentView: View {
    @AppStorage(TOKEN_KEY, store: UserDefaults(suiteName: APP_GROUP))
    private var token: String = ""
    @AppStorage(USER_NAME_KEY, store: UserDefaults(suiteName: APP_GROUP))
    private var userName: String = ""

    @State private var email = ""
    @State private var password = ""
    @State private var loading = false
    @State private var error: String? = nil

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 36, weight: .light))
                .foregroundColor(.blue)
            Text("HiNest 일정 위젯")
                .font(.system(size: 16, weight: .bold))

            if token.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("HiNest 계정으로 로그인하면 위젯에 일정이 표시돼요.")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                    TextField("이메일", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .disableAutocorrection(true)
                    SecureField("비밀번호", text: $password)
                        .textFieldStyle(.roundedBorder)
                    if let error = error {
                        Text(error).font(.system(size: 11)).foregroundColor(.red)
                    }
                    Button(action: { Task { await login() } }) {
                        HStack {
                            Spacer()
                            Text(loading ? "로그인 중…" : "로그인").bold()
                            Spacer()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(loading || email.isEmpty || password.isEmpty)
                }
            } else {
                VStack(spacing: 8) {
                    HStack(spacing: 6) {
                        Circle().fill(Color.green).frame(width: 8, height: 8)
                        Text("연결됨").font(.system(size: 13, weight: .semibold))
                    }
                    if !userName.isEmpty {
                        Text(userName).font(.system(size: 12)).foregroundColor(.secondary)
                    }
                    Text("알림센터 → 위젯 편집 → 'HiNest 일정' 추가")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    HStack {
                        Button("위젯 새로고침") {
                            WidgetCenter.shared.reloadTimelines(ofKind: "HiNestScheduleWidget")
                        }
                        Button("로그아웃") { logout() }
                            .foregroundColor(.red)
                    }
                }
            }
            Spacer()
        }
        .padding(20)
    }

    private func login() async {
        loading = true
        error = nil
        defer { loading = false }
        guard let url = URL(string: "\(API_BASE)/api/auth/login") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["email": email, "password": password]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let http = response as? HTTPURLResponse else {
                error = "응답을 처리할 수 없어요"
                return
            }
            if http.statusCode != 200 {
                error = "로그인 실패 (\(http.statusCode))"
                return
            }
            if let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let t = obj["token"] as? String {
                token = t
                if let user = obj["user"] as? [String: Any], let name = user["name"] as? String {
                    userName = name
                }
                WidgetCenter.shared.reloadTimelines(ofKind: "HiNestScheduleWidget")
                password = ""
            } else {
                error = "토큰을 받지 못했어요"
            }
        } catch {
            self.error = "연결 실패: \(error.localizedDescription)"
        }
    }

    private func logout() {
        token = ""
        userName = ""
        WidgetCenter.shared.reloadTimelines(ofKind: "HiNestScheduleWidget")
    }
}

#Preview {
    ContentView()
}
