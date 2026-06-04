import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
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
    ]

    private var tabBarView: UITabBar?
    private var keys: [String] = []
    private let brandColor = UIColor(red: 0x3B / 255.0, green: 0x5C / 255.0, blue: 0xF0 / 255.0, alpha: 1.0)

    override public func load() {
        NSLog("[LGTB] plugin loaded (discovered by Capacitor)")
    }

    @objc func configure(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        NSLog("[LGTB] configure called, tabs=\(tabs.count)")
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController?.view else {
                NSLog("[LGTB] no host view -> reject")
                call.reject("no-host-view"); return
            }
            self.build(host: host, tabs: tabs)
            NSLog("[LGTB] configured (real UITabBar), active=true")
            call.resolve(["active": true])
        }
    }

    /// 실제 애플 UIKit 탭 바(UITabBar) 를 웹뷰 위에 올린다. iOS 26 에선 시스템이 자동으로
    /// Liquid Glass 머티리얼을 입힌다(앱이 직접 그리지 않음 = 정품 시스템 컴포넌트).
    /// iOS 26 미만에선 일반 탭 바로 자연스럽게 폴백.
    private func build(host: UIView, tabs: [JSObject]) {
        tabBarView?.removeFromSuperview()
        keys.removeAll()

        let tabBar = UITabBar()
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.tintColor = brandColor

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
        tabBar.selectedItem = items.first

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

    /// 애플 기본 확인 시트(UIAlertController .actionSheet) — 로그아웃 등 재확인용.
    /// resolve({confirmed}). VC 없으면 confirmed:false.
    @objc func confirm(_ call: CAPPluginCall) {
        let title = call.getString("title")
        let message = call.getString("message")
        let confirmText = call.getString("confirmText") ?? "확인"
        let cancelText = call.getString("cancelText") ?? "취소"
        let destructive = call.getBool("destructive") ?? false
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.resolve(["confirmed": false]); return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .actionSheet)
            alert.addAction(UIAlertAction(title: confirmText, style: destructive ? .destructive : .default) { _ in
                call.resolve(["confirmed": true])
            })
            alert.addAction(UIAlertAction(title: cancelText, style: .cancel) { _ in
                call.resolve(["confirmed": false])
            })
            // 아이패드는 액션시트에 앵커가 필요(없으면 크래시) — 화면 하단 중앙에 앵커.
            if let pop = alert.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 40, width: 0, height: 0)
                pop.permittedArrowDirections = []
            }
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
