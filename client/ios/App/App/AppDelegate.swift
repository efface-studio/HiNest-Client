import UIKit
import SwiftUI
import Capacitor
#if canImport(WidgetKit)
import WidgetKit
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // 저장된 앱 테마(light/dark/system)를 첫 페인트 전에 윈도우에 적용 — 다크/라이트 깜빡임 방지.
        // 이전엔 Info.plist 로 라이트를 '강제'해 다크모드 사용자의 탭바·상태바가 라이트로 고정됐다.
        // 이제 마지막으로 저장된 사용자 테마를 읽어 윈도우 트레잇을 맞춘다(없으면 라이트 = 브랜드 기본).
        //   light  → .light,  dark → .dark,  system → .unspecified(OS 설정 따라감)
        let mode = UserDefaults.standard.string(forKey: "hinest.interfaceStyle") ?? "light"
        switch mode {
        case "dark": window?.overrideUserInterfaceStyle = .dark
        case "system": window?.overrideUserInterfaceStyle = .unspecified
        default: window?.overrideUserInterfaceStyle = .light
        }
        // 키보드가 올라올 때 WKWebView 가 위로 줄어들면서 그 아래(키보드 영역·하단 safe-area)에
        // 윈도우/루트 뷰의 기본 배경(검정)이 드러나던 버그 수정. 윈도우 배경을 테마를 따르는
        // 동적 색(라이트=#F5F6F8 = 웹뷰 배경과 동일, 다크=systemBackground=검정)으로 칠해
        // 드러나는 영역이 항상 테마와 일치하게 한다. (루트 뷰 배경은 MainViewController 에서 동일색으로 설정)
        window?.backgroundColor = .hinestChromeBackground
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // APNs 원격 푸시 등록 콜백 — @capacitor/push-notifications 가 이 NotificationCenter 이벤트를
    // 구독해 디바이스 토큰을 JS 의 'registration' 리스너로 전달한다. 이 두 메서드가 없으면
    // PushNotifications.register() 가 토큰을 못 받아 서버 등록(/api/push/register)이 일어나지 않고
    // 푸시가 영영 오지 않는다. (Capacitor 기본 템플릿에 누락돼 있던 것)
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}

// ============================================================================
// 네이티브 Liquid Glass 하단 탭 바 (iOS 26 UIGlassEffect)
//  - 웹(WebView) 위에 실제 애플 Liquid Glass 머티리얼의 "떠 있는" 탭 바를 올린다.
//  - 탭 선택은 notifyListeners("tabSelected") 로 웹 라우터에 전달, 웹은 현재 경로를
//    setSelected 로 다시 알려 하이라이트를 동기화한다.
//  - iOS 26 미만 / 호스트 뷰 없음 → configure 가 reject → 웹 CSS 글래스 바가 그대로 폴백.
//    (즉 이 플러그인이 동작하지 않아도 앱은 절대 깨지지 않는다.)
// ============================================================================
@objc(LiquidGlassTabBarPlugin)
public class LiquidGlassTabBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiquidGlassTabBarPlugin"
    public let jsName = "LiquidGlassTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSelected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBadge", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVisible", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "confirm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSharedToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setInterfaceStyle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "promptInput", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "presentShareSheet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prewarmAvatars", returnType: CAPPluginReturnPromise),
    ]

    private var tabBarView: UITabBar?
    private var keys: [String] = []
    private let brandColor = UIColor(red: 0x3B / 255.0, green: 0x5C / 255.0, blue: 0xF0 / 255.0, alpha: 1.0)

    override public func load() {
        NSLog("[LGTB] plugin loaded (discovered by Capacitor)")
    }

    /// NSE(채팅 발신자 아바타) 캐시 프리워밍 — 앱이 채팅방 목록을 열 때 발신 가능성 있는 멤버들의
    /// 아바타를 미리 다운로드해 NSE 와 동일한 App Group 캐시(avatar-cache/<퍼센트인코딩 경로>)에 넣어둔다.
    /// 그러면 "첫 알림은 캐시 미스 → 다운로드가 NSE 시간예산을 못 맞춰 앱아이콘으로 폴백"하던 게 사라지고
    /// 첫 알림부터 통신알림 아바타로 뜬다. NSE(NotificationService.swift) 의 cacheFile/fetch 스킴과 정확히 일치.
    @objc func prewarmAvatars(_ call: CAPPluginCall) {
        let paths = (call.getArray("paths", String.self) ?? []).filter { $0.hasPrefix("/uploads/") }
        let groupId = "group.com.hivits.hinest"
        let apiBase = "https://nest.hi-vits.com"
        guard !paths.isEmpty,
              let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else {
            call.resolve(["cached": 0]); return
        }
        let dir = base.appendingPathComponent("avatar-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let token = UserDefaults(suiteName: groupId)?.string(forKey: "hinest.session.token")
        // 이미 캐시된 건 건너뛴다(불필요 다운로드 0). NSE 와 동일한 키(.alphanumerics 퍼센트 인코딩).
        let targets: [(String, URL)] = paths.compactMap { p in
            let key = p.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? p
            let file = dir.appendingPathComponent(key)
            return FileManager.default.fileExists(atPath: file.path) ? nil : (p, file)
        }
        if targets.isEmpty { call.resolve(["cached": 0]); return }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        let session = URLSession(configuration: config)
        let dg = DispatchGroup()
        let lock = NSLock(); var ok = 0
        for (p, file) in targets {
            var urlStr = apiBase + p
            if let token = token, !token.isEmpty,
               let enc = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
                urlStr += (urlStr.contains("?") ? "&" : "?") + "token=" + enc
            }
            guard let url = URL(string: urlStr) else { continue }
            dg.enter()
            session.dataTask(with: url) { data, response, _ in
                defer { dg.leave() }
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 200, let data = data, !data.isEmpty, UIImage(data: data) != nil {
                    try? data.write(to: file, options: .atomic)
                    lock.lock(); ok += 1; lock.unlock()
                }
            }.resume()
        }
        dg.notify(queue: .main) { call.resolve(["cached": ok]) }
    }

    /// 알림 서비스 확장(NSE)이 채팅 발신자 아바타(/uploads, 인증 필요)를 받을 수 있도록,
    /// 앱 세션 토큰을 공유 App Group 에 기록한다. JS 가 로그인/세션복원 시 호출, 로그아웃 시 빈 값으로 제거.
    /// ⚠️ Xcode 에서 앱+NSE 타깃에 App Group(group.com.hivits.hinest) capability 가 설정돼야 동작한다.
    ///    미설정이면 suiteName 이 nil → 무동작(무해). NSE 는 같은 그룹에서 이 키를 읽는다.
    @objc func setSharedToken(_ call: CAPPluginCall) {
        let token = call.getString("token") ?? ""
        let groupId = call.getString("group") ?? "group.com.hivits.hinest"
        if let defaults = UserDefaults(suiteName: groupId) {
            if token.isEmpty {
                defaults.removeObject(forKey: "hinest.session.token")
            } else {
                defaults.set(token, forKey: "hinest.session.token")
            }
        }
        // 일정 위젯도 같은 토큰을 쓰니, 토큰 갱신 즉시 다음 타임라인 갱신을 요청한다.
        // (로그인 직후 위젯이 '로그인 필요' 빈 상태에 머무르는 회귀 방지)
        // WidgetCenter 는 iOS 14+ — Capacitor 8 의 deployment target 보다 훨씬 낮아 안전.
        if #available(iOS 14.0, *) {
            #if canImport(WidgetKit)
            // 위젯 extension 이 빌드 타깃에 포함됐을 때만 컴파일.
            // (아직 Xcode 에 widget target 안 추가됐어도 메인 앱 빌드는 통과)
            WidgetCenter.shared.reloadTimelines(ofKind: "HiNestScheduleWidget")
            #endif
        }
        call.resolve()
    }

    /// 문자열 테마 모드 → UIUserInterfaceStyle 매핑.
    static func uiStyle(from raw: String?) -> UIUserInterfaceStyle {
        switch raw {
        case "dark": return .dark
        case "light": return .light
        default: return .unspecified // "system" 또는 미설정 → OS 설정 따라감
        }
    }

    /// 앱 테마를 네이티브 윈도우/탭바에 반영한다. JS(theme.tsx)가 테마 변경 시 호출.
    /// - light/dark: 명시 고정. system: .unspecified 로 OS 설정 따라감(웹의 prefers-color-scheme 도 정상 동작).
    /// 저장값은 다음 실행의 didFinishLaunching 가 읽어 첫 페인트부터 올바른 색을 그린다(깜빡임 방지).
    @objc func setInterfaceStyle(_ call: CAPPluginCall) {
        let mode = call.getString("style") ?? "light" // light | dark | system
        UserDefaults.standard.set(mode, forKey: "hinest.interfaceStyle")
        let style = LiquidGlassTabBarPlugin.uiStyle(from: mode)
        DispatchQueue.main.async {
            self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            self.tabBarView?.overrideUserInterfaceStyle = style
        }
        call.resolve()
    }

    /// 애플 기본 바텀시트(UISheetPresentationController) 로 공유 UI 를 띄운다.
    /// 내용(대상 미리보기 + 대화방·동료 목록 다중선택 + 전송)은 SwiftUI 로 그리고, 목록/전송 API 는
    /// JS 가 넘긴 세션 토큰으로 호출한다(웹뷰와 동일 세션). medium/large detent + 그래버 = 정품 룩앤필.
    @objc func presentShareSheet(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "MEMO"
        let title = call.getString("title") ?? ""
        let snippet = call.getString("snippet")
        let href = call.getString("href") ?? "/"
        let token = call.getString("token") ?? ""
        // apiBase 미지정 시 운영 오리진. (웹 빌드의 VITE_API_BASE 와 동일해야 /api 가 맞는다.)
        let apiBase = (call.getString("apiBase") ?? "https://nest.hi-vits.com").trimmingCharacters(in: .init(charactersIn: "/"))
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.resolve(["presented": false]); return
            }
            let payload = SharePayloadData(kind: kind, title: title, snippet: snippet, href: href)
            var hostRef: UIViewController?
            let root = NativeShareSheetView(payload: payload, apiBase: apiBase, token: token, onClose: {
                hostRef?.dismiss(animated: true)
            })
            let host = UIHostingController(rootView: root)
            hostRef = host
            host.overrideUserInterfaceStyle = LiquidGlassTabBarPlugin.uiStyle(from: UserDefaults.standard.string(forKey: "hinest.interfaceStyle"))
            if let sheet = host.sheetPresentationController {
                sheet.detents = [.medium(), .large()]
                sheet.prefersGrabberVisible = true
                sheet.preferredCornerRadius = 22
                sheet.prefersScrollingExpandsWhenScrolledToEdge = true
            }
            presenter.present(host, animated: true)
            call.resolve(["presented": true])
        }
    }

    @objc func configure(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        // 초기 선택 탭 키(현재 경로). 없으면 첫 탭으로 폴백.
        let selected = call.getString("selected")
        NSLog("[LGTB] configure called, tabs=\(tabs.count)")
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                NSLog("[LGTB] no host view -> reject")
                call.reject("no-host-view"); return
            }
            self.build(host: host, tabs: tabs, selected: selected)
            NSLog("[LGTB] configured (real UITabBar), active=true")
            call.resolve(["active": true])
        }
    }

    /// 실제 애플 UIKit 탭 바(UITabBar) 를 웹뷰 위에 올린다. iOS 26 에선 시스템이 자동으로
    /// Liquid Glass 머티리얼을 입힌다(앱이 직접 그리지 않음 = 정품 시스템 컴포넌트).
    /// iOS 26 미만에선 일반 탭 바로 자연스럽게 폴백.
    private func build(host: UIView, tabs: [JSObject], selected: String? = nil) {
        tabBarView?.removeFromSuperview()
        keys.removeAll()

        let tabBar = UITabBar()
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.tintColor = brandColor
        // 탭바 트레잇을 앱 테마(저장값)에 맞춘다. 윈도우를 따라가도 되지만, addSubview 직후
        // 부모 트레잇을 즉시 반영하지 않는 미세한 frame 갭이 있어 명시적으로 같은 값을 박는다.
        // light→.light / dark→.dark / system→.unspecified(윈도우=OS 따라감).
        tabBar.overrideUserInterfaceStyle = LiquidGlassTabBarPlugin.uiStyle(from: UserDefaults.standard.string(forKey: "hinest.interfaceStyle"))

        var items: [UITabBarItem] = []
        for (i, tab) in tabs.enumerated() {
            keys.append((tab["key"] as? String) ?? "")
            // 앱 기존 아이콘(에셋 카탈로그) 사용 — template 렌더링으로 탭 바가 회색/브랜드색 틴트.
            let item = UITabBarItem(
                title: (tab["title"] as? String) ?? "",
                image: UIImage(named: (tab["icon"] as? String) ?? "")?.withRenderingMode(.alwaysTemplate),
                tag: i
            )
            // 선택된 탭 라벨을 살짝 더 두껍게(semibold). 비선택은 regular. (글래스 배경은 건드리지 않음)
            item.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 10, weight: .regular)], for: .normal)
            item.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 10, weight: .semibold)], for: .selected)
            items.append(item)
        }
        tabBar.setItems(items, animated: false)
        // 초기 선택을 현재 경로 탭으로 맞춘다. 기본값(items.first = 개요)으로 두면 새로고침
        // 때 개요가 한 번 하이라이트됐다가 현재 탭으로 점프하는(개요 깜빡임) 문제가 생긴다.
        // 매칭 탭이 없으면(탭이 아닌 경로: /profile 등) applySelected 와 동일하게 선택 없음(nil).
        if let sel = selected, let i = keys.firstIndex(of: sel), i < items.count {
            tabBar.selectedItem = items[i]
        } else {
            tabBar.selectedItem = nil
        }

        host.addSubview(tabBar)
        NSLayoutConstraint.activate([
            tabBar.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: host.bottomAnchor),
        ])
        tabBarView = tabBar
    }

    private func applySelected(_ key: String) {
        guard let tb = tabBarView, let items = tb.items else { return }
        if let i = keys.firstIndex(of: key), i < items.count {
            tb.selectedItem = items[i]
        } else {
            tb.selectedItem = nil
        }
    }

    @objc func setSelected(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        DispatchQueue.main.async {
            self.applySelected(key)
            call.resolve()
        }
    }

    @objc func setVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        DispatchQueue.main.async {
            self.tabBarView?.isHidden = !visible
            call.resolve()
        }
    }

    /// 애플 기본 확인 다이얼로그(UIAlertController .alert) — 화면 중앙에 뜨고 취소+확인(예:
    /// 로그아웃) 버튼을 나란히 가진다. 재확인용. resolve({confirmed}). VC 없으면 confirmed:false.
    @objc func confirm(_ call: CAPPluginCall) {
        let title = call.getString("title")
        let message = call.getString("message")
        let confirmText = call.getString("confirmText") ?? "확인"
        let cancelText = call.getString("cancelText") ?? "취소"
        let destructive = call.getBool("destructive") ?? false
        // alertOnly=true → 단일 버튼 알림(취소 없음). secondaryText → 3지선다 가운데 버튼.
        let alertOnly = call.getBool("alertOnly") ?? false
        let secondaryText = call.getString("secondaryText")
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.resolve(["confirmed": false, "action": "cancel"]); return
            }
            // .alert = 화면 중앙 다이얼로그(하단 액션시트 아님).
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            if !alertOnly {
                alert.addAction(UIAlertAction(title: cancelText, style: .cancel) { _ in
                    call.resolve(["confirmed": false, "action": "cancel"])
                })
            }
            if let sec = secondaryText, !sec.isEmpty {
                alert.addAction(UIAlertAction(title: sec, style: .default) { _ in
                    call.resolve(["confirmed": false, "action": "secondary"])
                })
            }
            alert.addAction(UIAlertAction(title: confirmText, style: destructive ? .destructive : .default) { _ in
                call.resolve(["confirmed": true, "action": "confirm"])
            })
            vc.present(alert, animated: true)
        }
    }

    /// 햅틱 피드백 — JS(버튼·토글 탭 등)에서 호출. style: light|medium|heavy|selection|success|warning|error.
    /// 메인 스레드에서 즉시 발생. 비지원 기기/시뮬레이터는 무음 no-op.
    @objc func haptic(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch style {
            case "selection":
                UISelectionFeedbackGenerator().selectionChanged()
            case "success":
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning":
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error":
                UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "medium":
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case "heavy":
                UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            default:
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }
        call.resolve()
    }

    /// 텍스트 입력 1개를 받는 애플 기본 다이얼로그(UIAlertController + textField).
    /// resolve({ value, cancelled }). 취소/없음이면 cancelled:true.
    @objc func promptInput(_ call: CAPPluginCall) {
        let title = call.getString("title")
        let message = call.getString("message")
        let confirmText = call.getString("confirmText") ?? "확인"
        let cancelText = call.getString("cancelText") ?? "취소"
        let placeholder = call.getString("placeholder")
        let defaultValue = call.getString("defaultValue") ?? ""
        let secure = call.getBool("secure") ?? false
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.resolve(["cancelled": true]); return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addTextField { tf in
                tf.placeholder = placeholder
                tf.text = defaultValue
                tf.isSecureTextEntry = secure
            }
            alert.addAction(UIAlertAction(title: cancelText, style: .cancel) { _ in
                call.resolve(["cancelled": true])
            })
            alert.addAction(UIAlertAction(title: confirmText, style: .default) { _ in
                let v = alert.textFields?.first?.text ?? ""
                call.resolve(["cancelled": false, "value": v])
            })
            vc.present(alert, animated: true)
        }
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        let count = call.getInt("count") ?? 0
        DispatchQueue.main.async {
            if let items = self.tabBarView?.items, let i = self.keys.firstIndex(of: key), i < items.count {
                items[i].badgeValue = count > 0 ? (count > 99 ? "99+" : "\(count)") : nil
            }
            call.resolve()
        }
    }
}

// 실제 UITabBar 탭 선택 → 웹 라우터로 전달.
extension LiquidGlassTabBarPlugin: UITabBarDelegate {
    public func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        let i = item.tag
        guard i >= 0, i < keys.count else { return }
        // 탭 전환 시 선택 햅틱 — 네이티브 탭바 느낌. (실제 OS 탭바도 selection feedback 을 준다)
        let gen = UISelectionFeedbackGenerator()
        gen.selectionChanged()
        notifyListeners("tabSelected", data: ["key": keys[i]])
    }
}

/// Capacitor 브리지 VC 서브클래스.
/// 앱에 직접 넣은(app-local) 플러그인은 Capacitor 가 자동 발견하지 못하므로(npm 패키지
/// 플러그인만 자동 등록됨) 여기서 명시적으로 등록한다. Main.storyboard 의 customClass 를
/// 이 클래스로 지정해야 적용된다.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiquidGlassTabBarPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyChromeBackground()
        // ⚠️ Capacitor 8 은 WKWebView 자체가 루트 view 다(CAPBridgeViewController.loadView: `view = webView`).
        // 그리고 WebViewDelegationHandler 가 초기 로드 시 isOpaque=false 로 뒀다가 didFinish 에서
        // 원래 값(기본 true)으로 **되돌린다**. 불투명 WKWebView 는 웹이 안 칠한 픽셀(키보드가 떠서
        // webView frame 이 줄면 생기는 하단 띠)을 backgroundColor 가 아니라 **검정**으로 합성한다.
        // 따라서 viewDidLoad 단계에서만 칠하면 첫 네비게이션 didFinish 가 isOpaque 를 true 로 덮어써
        // 다시 검정이 된다. 로드가 끝난 뒤(viewDidAppear) 발화하는 .capacitorViewDidAppear 알림에
        // 재적용해 isOpaque=false 를 영구화한다. (멱등이라 여러 번 불려도 무해)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(applyChromeBackground),
            name: .capacitorViewDidAppear,
            object: nil
        )
    }

    /// 키보드가 올라오며 WebView(=루트 view)가 위로 줄어들 때, 그 아래로 드러나는 띠가 검정으로
    /// 합성되지 않도록 한다. 핵심은 webView.isOpaque=false(검정 합성 차단) + webView/scrollView
    /// 배경을 테마색으로 칠하기. view 는 곧 webView 지만 명시적으로 같이 칠해 둔다(2차 안전망).
    @objc private func applyChromeBackground() {
        view.backgroundColor = .hinestChromeBackground
        // 핵심: 불투명 해제 + webView/scrollView 배경을 테마색으로. (Capacitor didFinish 복원 무력화)
        webView?.isOpaque = false
        webView?.backgroundColor = .hinestChromeBackground
        webView?.scrollView.backgroundColor = .hinestChromeBackground
    }
}

extension UIColor {
    /// 웹뷰 뒤(키보드 영역·safe-area 등 네이티브 chrome) 배경에 쓰는 동적 색.
    /// 키보드가 인접하는 영역(채팅 입력바·로그인 폼·바텀시트)은 모두 --c-surface 라, 키보드 둥근
    /// 윗모서리 뒤로 드러나는 chrome 을 --c-surface 에 맞춰야 모서리가 이질적으로 떠 보이지 않는다.
    /// - 라이트: #FFFFFF (웹 --c-surface(light)). --c-bg(#F5F6F8)은 살짝 회색이라 흰 surface 와 이음매가 보였다.
    /// - 다크:   #171A20 (웹 --c-surface(dark)).  --c-bg(#0E1014)은 더 어두워 이음매가 보였다.
    /// userInterfaceStyle 에 따라 OS 가 자동으로 두 값 사이를 전환한다.
    static let hinestChromeBackground = UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0x17 / 255.0, green: 0x1A / 255.0, blue: 0x20 / 255.0, alpha: 1.0)
            : UIColor(red: 0xFF / 255.0, green: 0xFF / 255.0, blue: 0xFF / 255.0, alpha: 1.0)
    }
}

// ============================================================================
// MARK: - 네이티브 공유 시트 (SwiftUI) — 애플 기본 바텀시트 안에 표시
// ============================================================================

struct SharePayloadData {
    let kind: String      // ANNOUNCEMENT | MEMO | MEETING | DOCUMENT | JOURNAL
    let title: String
    let snippet: String?
    let href: String
}

private struct ShareUsersResp: Decodable { let users: [ShareUser] }
private struct ShareUser: Decodable, Identifiable {
    let id: String
    let name: String
    let team: String?
    let position: String?
    let avatarColor: String?
    let avatarUrl: String?
    let isDeveloper: Bool?
}
private struct ShareRoomsResp: Decodable { let rooms: [ShareRoom] }
private struct ShareRoom: Decodable, Identifiable {
    let id: String
    let name: String
    let type: String
}

/// share 카테고리 라벨/아이콘.
private func shareKindMeta(_ kind: String) -> (label: String, icon: String) {
    switch kind {
    case "ANNOUNCEMENT": return ("공지", "📢")
    case "MEETING": return ("회의록", "📝")
    case "DOCUMENT": return ("문서", "📄")
    case "JOURNAL": return ("업무일지", "🗒️")
    default: return ("메모", "📌")
    }
}

private func colorFromHex(_ hex: String?) -> Color {
    guard let hex = hex else { return Color(red: 0.23, green: 0.36, blue: 0.94) }
    let s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    var rgb: UInt64 = 0
    Scanner(string: s).scanHexInt64(&rgb)
    return Color(
        red: Double((rgb >> 16) & 0xff) / 255.0,
        green: Double((rgb >> 8) & 0xff) / 255.0,
        blue: Double(rgb & 0xff) / 255.0
    )
}

struct NativeShareSheetView: View {
    let payload: SharePayloadData
    let apiBase: String
    let token: String
    let onClose: () -> Void

    @State private var rooms: [ShareRoom] = []
    @State private var users: [ShareUser] = []
    @State private var query: String = ""
    @State private var pickedUsers: Set<String> = []
    @State private var pickedRooms: Set<String> = []
    @State private var loading = true
    @State private var sending = false
    @State private var sent = false
    @State private var errorText: String?

    private let brand = Color(red: 0.23, green: 0.36, blue: 0.94)

    private var filteredRooms: [ShareRoom] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let base = rooms.filter { $0.type != "DIRECT" }
        if q.isEmpty { return base }
        return base.filter { $0.name.lowercased().contains(q) }
    }
    private var filteredUsers: [ShareUser] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        if q.isEmpty { return users }
        return users.filter {
            $0.name.lowercased().contains(q)
            || ($0.team?.lowercased().contains(q) ?? false)
            || ($0.position?.lowercased().contains(q) ?? false)
        }
    }
    private var total: Int { pickedUsers.count + pickedRooms.count }

    var body: some View {
        VStack(spacing: 0) {
            header
            previewCard
            searchBar
            Divider()
            if loading {
                Spacer(); ProgressView().tint(brand); Spacer()
            } else if let err = errorText {
                Spacer()
                VStack(spacing: 8) {
                    Text("불러오지 못했어요").font(.system(size: 14, weight: .bold))
                    Text(err).font(.system(size: 12)).foregroundColor(.secondary).multilineTextAlignment(.center)
                }.padding()
                Spacer()
            } else {
                list
            }
            sendButton
        }
        .background(Color(uiColor: .systemBackground))
        .task { await load() }
    }

    private var header: some View {
        HStack {
            Text("공유").font(.system(size: 17, weight: .bold))
            Spacer()
            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 22)).foregroundColor(Color(uiColor: .tertiaryLabel))
            }
        }
        .padding(.horizontal, 18).padding(.top, 14).padding(.bottom, 8)
    }

    private var previewCard: some View {
        let meta = shareKindMeta(payload.kind)
        return HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(brand).frame(width: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(meta.icon) \(meta.label)").font(.system(size: 11, weight: .bold)).foregroundColor(brand)
                Text(payload.title).font(.system(size: 14, weight: .bold)).lineLimit(1)
                if let s = payload.snippet, !s.isEmpty {
                    Text(s).font(.system(size: 12)).foregroundColor(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(brand.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 18).padding(.bottom, 8)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundColor(.secondary).font(.system(size: 14))
            TextField("이름 또는 대화방 검색", text: $query)
                .font(.system(size: 15)).autocorrectionDisabled()
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 18).padding(.bottom, 10)
    }

    private var list: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 2) {
                if !filteredRooms.isEmpty {
                    sectionHeader("대화방")
                    ForEach(filteredRooms) { r in
                        row(
                            id: r.id, picked: pickedRooms.contains(r.id),
                            avatar: AnyView(initialAvatar(text: String(r.name.prefix(1)), color: Color(red: 0.30, green: 0.35, blue: 0.41), prefixHash: true)),
                            title: r.name, subtitle: r.type == "TEAM" ? "팀방" : "그룹방"
                        ) { toggleRoom(r.id) }
                    }
                }
                if !filteredUsers.isEmpty {
                    sectionHeader("동료")
                    ForEach(filteredUsers) { u in
                        row(
                            id: u.id, picked: pickedUsers.contains(u.id),
                            avatar: AnyView(userAvatar(u)),
                            title: u.name,
                            subtitle: [u.team, u.position].compactMap { $0 }.joined(separator: " · ")
                        ) { toggleUser(u.id) }
                    }
                }
                if filteredRooms.isEmpty && filteredUsers.isEmpty {
                    Text("검색 결과가 없어요").font(.system(size: 12)).foregroundColor(.secondary)
                        .frame(maxWidth: .infinity).padding(.vertical, 40)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
        }
    }

    private func sectionHeader(_ t: String) -> some View {
        Text(t).font(.system(size: 10, weight: .bold)).foregroundColor(.secondary)
            .padding(.horizontal, 8).padding(.top, 10).padding(.bottom, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(id: String, picked: Bool, avatar: AnyView, title: String, subtitle: String, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 12) {
                avatar.frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(.primary).lineLimit(1)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(.system(size: 11)).foregroundColor(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 21)).foregroundColor(picked ? brand : Color(uiColor: .tertiaryLabel))
            }
            .padding(.horizontal, 8).padding(.vertical, 7)
            .background(picked ? brand.opacity(0.08) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func userAvatar(_ u: ShareUser) -> some View {
        ZStack {
            Circle().fill(colorFromHex(u.avatarColor))
            Text(String(u.name.prefix(1))).font(.system(size: 14, weight: .bold)).foregroundColor(.white)
            if let url = u.avatarUrl, let full = avatarURL(url) {
                AsyncImage(url: full) { img in img.resizable().scaledToFill() } placeholder: { Color.clear }
                    .clipShape(Circle())
            }
        }
    }
    private func initialAvatar(text: String, color: Color, prefixHash: Bool) -> some View {
        ZStack {
            Circle().fill(color)
            Text((prefixHash ? "#" : "") + text).font(.system(size: 13, weight: .bold)).foregroundColor(.white)
        }
    }

    private var sendButton: some View {
        VStack(spacing: 0) {
            Divider()
            Button(action: { Task { await send() } }) {
                Text(sent ? "공유했어요 ✓" : (sending ? "보내는 중…" : (total > 0 ? targetLabel() : "받을 사람을 선택해 주세요")))
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(total > 0 && !sending && !sent ? brand : brand.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
            }
            .disabled(total == 0 || sending || sent)
            .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 8)
        }
    }

    private func targetLabel() -> String {
        var parts: [String] = []
        if pickedUsers.count > 0 { parts.append("\(pickedUsers.count)명") }
        if pickedRooms.count > 0 { parts.append("\(pickedRooms.count)개 대화방") }
        return parts.joined(separator: " · ") + "에 공유"
    }

    private func toggleUser(_ id: String) {
        if pickedUsers.contains(id) { pickedUsers.remove(id) } else { pickedUsers.insert(id) }
        UISelectionFeedbackGenerator().selectionChanged()
    }
    private func toggleRoom(_ id: String) {
        if pickedRooms.contains(id) { pickedRooms.remove(id) } else { pickedRooms.insert(id) }
        UISelectionFeedbackGenerator().selectionChanged()
    }

    private func avatarURL(_ path: String) -> URL? {
        if path.hasPrefix("http") { return URL(string: path) }
        var s = "\(apiBase)\(path)"
        if !token.isEmpty {
            s += (path.contains("?") ? "&" : "?") + "token=\(token)"
        }
        return URL(string: s)
    }

    private func authedRequest(_ path: String) -> URLRequest? {
        guard let url = URL(string: "\(apiBase)\(path)") else { return nil }
        var req = URLRequest(url: url)
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.timeoutInterval = 12
        return req
    }

    @MainActor private func load() async {
        loading = true; errorText = nil
        do {
            async let u: ShareUsersResp = fetch("/api/users")
            async let r: ShareRoomsResp = fetch("/api/chat/rooms")
            let (uu, rr) = try await (u, r)
            await MainActor.run {
                self.users = uu.users
                self.rooms = rr.rooms
                self.loading = false
            }
        } catch {
            await MainActor.run { self.errorText = "네트워크 오류"; self.loading = false }
        }
    }

    private func fetch<T: Decodable>(_ path: String) async throws -> T {
        guard let req = authedRequest(path) else { throw URLError(.badURL) }
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(T.self, from: data)
    }

    @MainActor private func send() async {
        guard total > 0, !sending else { return }
        sending = true
        guard let url = URL(string: "\(apiBase)/api/chat/share") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let body: [String: Any] = [
            "kind": payload.kind,
            "title": payload.title,
            "snippet": payload.snippet ?? "",
            "href": payload.href,
            "userIds": Array(pickedUsers),
            "roomIds": Array(pickedRooms),
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            await MainActor.run {
                if ok {
                    sent = true
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { onClose() }
                } else {
                    sending = false
                    errorText = "전송 실패"
                }
            }
        } catch {
            await MainActor.run { sending = false; errorText = "전송 실패" }
        }
    }
}
