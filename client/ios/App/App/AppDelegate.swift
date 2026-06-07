import UIKit
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
    ]

    private var tabBarView: UITabBar?
    private var keys: [String] = []
    private let brandColor = UIColor(red: 0x3B / 255.0, green: 0x5C / 255.0, blue: 0xF0 / 255.0, alpha: 1.0)

    override public func load() {
        NSLog("[LGTB] plugin loaded (discovered by Capacitor)")
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
}
