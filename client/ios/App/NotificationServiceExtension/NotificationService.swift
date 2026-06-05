import UserNotifications
import Intents

/// HiNest 푸시 알림 서비스 확장 — Communication Notification(발신자 아바타).
///
/// 채팅 푸시(`aps.mutable-content: 1` + `senderName`)가 오면 발신자 아바타를 받아
/// `INSendMessageIntent` 를 도네이트해, iOS 가 "발신자 프로필 사진 + 코너에 작은 앱 로고"
/// 형태(카톡/iMessage 스타일)로 알림을 표시하게 만든다.
///
/// ⚠️ 이 파일만으로는 동작하지 않는다. 아래 셋업이 필요(자세한 건 README.md):
///   1) Xcode 에서 이 파일을 담는 Notification Service Extension 타깃 추가.
///   2) 앱 + 확장 모두 "Communication Notifications" 엔타이틀먼트(+ App ID 권한 in Apple 포털).
///   3) 앱 + 확장이 같은 App Group(`group.com.hivits.hinest`) 공유, 앱은 로그인 시 세션 토큰을
///      이 그룹의 UserDefaults(`hinest.session.token`)에 기록(아바타 /uploads 인증용).
///   4) 서버 푸시 페이로드: `aps.mutable-content=1`, `senderName`, `senderAvatarPath`(/uploads/...),
///      `aps.thread-id`(roomId) — 서버측은 이미 구현됨(lib/apns.ts, lib/notify.ts).
final class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?

    /// 앱 본체와 합의된 App Group / API 오리진. 실제 값으로 맞출 것.
    private let appGroupId = "group.com.hivits.hinest"
    private let apiBase = "https://nest.hi-vits.com" // = VITE_API_BASE

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        guard let best = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content); return
        }
        self.bestAttempt = best

        let info = request.content.userInfo
        // senderName 이 없으면 채팅 알림이 아니다 → 원본 그대로 전달.
        guard let senderName = info["senderName"] as? String, !senderName.isEmpty else {
            contentHandler(best); return
        }
        let avatarPath = info["senderAvatarPath"] as? String
        let roomId = (info["aps"] as? [String: Any])?["thread-id"] as? String

        fetchAvatar(path: avatarPath) { [weak self] image in
            self?.deliverCommunication(best, senderName: senderName, roomId: roomId, image: image)
        }
    }

    private func deliverCommunication(_ content: UNMutableNotificationContent,
                                      senderName: String, roomId: String?, image: INImage?) {
        let handle = INPersonHandle(value: roomId ?? senderName, type: .unknown)
        let sender = INPerson(personHandle: handle, nameComponents: nil, displayName: senderName,
                              image: image, contactIdentifier: nil, customIdentifier: nil)

        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: nil,
            conversationIdentifier: roomId,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        if let image = image { intent.setImage(image, forParameterNamed: \.sender) }

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate(completion: nil)

        if let updated = try? content.updating(from: intent) {
            contentHandler?(updated)
        } else {
            contentHandler?(content)
        }
    }

    /// 아바타(/uploads/...)를 App Group 세션 토큰으로 인증해 받아 INImage 로.
    private func fetchAvatar(path: String?, completion: @escaping (INImage?) -> Void) {
        guard let path = path, path.hasPrefix("/uploads/") else { completion(nil); return }
        let token = UserDefaults(suiteName: appGroupId)?.string(forKey: "hinest.session.token")
        var urlStr = apiBase + path
        if let token = token, !token.isEmpty,
           let enc = token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            urlStr += (urlStr.contains("?") ? "&" : "?") + "token=" + enc
        }
        guard let url = URL(string: urlStr) else { completion(nil); return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            completion(data.flatMap { INImage(imageData: $0) })
        }.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let best = bestAttempt { handler(best) }
    }
}
