/**
 * HiNest macOS 위젯 호스트 앱 — minimal SwiftUI 앱.
 *
 * 사용자가 보는 화면은 거의 없음. 위젯 갤러리에 "HiNest 일정" 이 등장하려면 호스트 앱이
 * 적어도 1번 실행돼야 하고, 토큰 입력/관리 UI 만 작은 창으로 노출.
 *
 * 향후: Electron 메인 앱(HiNest-MacOS)과 토큰 자동 동기화 — 현재는 사용자가 1회 로그인.
 */
import SwiftUI
import WidgetKit

@main
struct HiNestWidgetApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .frame(minWidth: 360, idealWidth: 420, minHeight: 320, idealHeight: 400)
        }
        .windowResizability(.contentSize)
    }
}
