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
    ]

    private var glassView: UIView?
    private var buttons: [UIButton] = []
    private var keys: [String] = []
    private var badgeViews: [String: UILabel] = [:]
    private let brandColor = UIColor(red: 0x3B / 255.0, green: 0x5C / 255.0, blue: 0xF0 / 255.0, alpha: 1.0)

    @objc func configure(_ call: CAPPluginCall) {
        let tabs = call.getArray("tabs", JSObject.self) ?? []
        DispatchQueue.main.async {
            guard #available(iOS 26.0, *) else { call.reject("liquid-glass-unavailable"); return }
            guard let host = self.bridge?.viewController?.view else { call.reject("no-host-view"); return }
            self.build(host: host, tabs: tabs)
            call.resolve(["active": true])
        }
    }

    @available(iOS 26.0, *)
    private func build(host: UIView, tabs: [JSObject]) {
        glassView?.removeFromSuperview()
        buttons.removeAll(); keys.removeAll(); badgeViews.removeAll()

        // 실제 애플 Liquid Glass 머티리얼.
        let effectView = UIVisualEffectView(effect: UIGlassEffect())
        effectView.translatesAutoresizingMaskIntoConstraints = false
        effectView.layer.cornerRadius = 26
        effectView.clipsToBounds = true
        host.addSubview(effectView)

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        effectView.contentView.addSubview(stack)

        for (i, tab) in tabs.enumerated() {
            let key = (tab["key"] as? String) ?? ""
            let title = (tab["title"] as? String) ?? ""
            let sf = (tab["sf"] as? String) ?? "circle"
            keys.append(key)

            var cfg = UIButton.Configuration.plain()
            cfg.image = UIImage(systemName: sf)
            cfg.imagePlacement = .top
            cfg.imagePadding = 3
            cfg.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 18, weight: .semibold)
            var cont = AttributeContainer()
            cont.font = UIFont.systemFont(ofSize: 10.5, weight: .semibold)
            cfg.attributedTitle = AttributedString(title, attributes: cont)
            cfg.baseForegroundColor = .secondaryLabel

            let btn = UIButton(configuration: cfg)
            btn.tag = i
            btn.addTarget(self, action: #selector(self.onTap(_:)), for: .touchUpInside)
            stack.addArrangedSubview(btn)
            buttons.append(btn)
        }

        let guide = host.safeAreaLayoutGuide
        let widthC = effectView.widthAnchor.constraint(equalTo: guide.widthAnchor, constant: -24)
        widthC.priority = .defaultHigh
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: effectView.contentView.topAnchor),
            stack.bottomAnchor.constraint(equalTo: effectView.contentView.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: effectView.contentView.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: effectView.contentView.trailingAnchor, constant: -6),
            effectView.centerXAnchor.constraint(equalTo: guide.centerXAnchor),
            effectView.bottomAnchor.constraint(equalTo: guide.bottomAnchor, constant: -8),
            effectView.heightAnchor.constraint(equalToConstant: 58),
            effectView.widthAnchor.constraint(lessThanOrEqualToConstant: 480),
            widthC,
        ])
        glassView = effectView
    }

    @objc private func onTap(_ sender: UIButton) {
        let i = sender.tag
        guard i >= 0, i < keys.count else { return }
        applySelected(i)
        notifyListeners("tabSelected", data: ["key": keys[i]])
    }

    private func applySelected(_ index: Int) {
        for (i, btn) in buttons.enumerated() {
            guard var cfg = btn.configuration else { continue }
            cfg.baseForegroundColor = (i == index) ? brandColor : .secondaryLabel
            btn.configuration = cfg
        }
    }

    @objc func setSelected(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        DispatchQueue.main.async {
            self.applySelected(self.keys.firstIndex(of: key) ?? -1)
            call.resolve()
        }
    }

    @objc func setVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        DispatchQueue.main.async {
            self.glassView?.isHidden = !visible
            call.resolve()
        }
    }

    @objc func setBadge(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? ""
        let count = call.getInt("count") ?? 0
        DispatchQueue.main.async {
            self.updateBadge(key: key, count: count)
            call.resolve()
        }
    }

    private func updateBadge(key: String, count: Int) {
        guard let i = keys.firstIndex(of: key), i < buttons.count else { return }
        badgeViews[key]?.removeFromSuperview()
        badgeViews[key] = nil
        guard count > 0 else { return }
        let btn = buttons[i]
        let badge = UILabel()
        badge.text = count > 99 ? "99+" : "\(count)"
        badge.font = UIFont.systemFont(ofSize: 10, weight: .bold)
        badge.textColor = .white
        badge.textAlignment = .center
        badge.backgroundColor = .systemRed
        badge.layer.cornerRadius = 8
        badge.clipsToBounds = true
        badge.translatesAutoresizingMaskIntoConstraints = false
        btn.addSubview(badge)
        NSLayoutConstraint.activate([
            badge.heightAnchor.constraint(equalToConstant: 16),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 16),
            badge.topAnchor.constraint(equalTo: btn.topAnchor, constant: 1),
            badge.centerXAnchor.constraint(equalTo: btn.centerXAnchor, constant: 13),
        ])
        badgeViews[key] = badge
    }
}
