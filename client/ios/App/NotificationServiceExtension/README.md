# 채팅 알림 발신자 아바타 (Communication Notification)

채팅 푸시를 카톡/iMessage처럼 **발신자 프로필 사진 + 코너에 작은 앱 로고**로 표시하기 위한
Notification Service Extension(NSE) 설정 가이드.

> 이 폴더의 `NotificationService.swift`는 **아직 어떤 Xcode 타깃에도 속하지 않은 템플릿**입니다.
> 현재 앱 빌드에는 영향이 없고, 아래 단계를 거쳐 NSE 타깃에 넣어야 동작합니다.
> ⚠️ 이 코드는 샌드박스(Xcode 없음)에서 **컴파일 검증을 못 했습니다.** Xcode에서 빌드·실기기 테스트 필요.

## 이미 끝난 것 (서버 — 배포만 하면 됨)
서버는 채팅 APNs 페이로드에 NSE가 쓸 데이터를 이미 싣습니다 (`server/src/lib/apns.ts`, `lib/notify.ts`):
- `aps.mutable-content = 1` — NSE 호출 트리거 (senderName 있을 때만 = 채팅만)
- `senderName` — 발신자 표시 이름
- `senderAvatarPath` — `/uploads/...` 상대경로
- `aps.thread-id = roomId` — 대화 그룹핑 (#303)

## 남은 것 (네이티브 — Xcode/Apple 포털, 사용자/네이티브 빌드 작업)

### 1. NSE 타깃 추가
Xcode → File → New → Target → **Notification Service Extension**. 이름 예: `NotificationServiceExtension`.
생성된 `NotificationService.swift`를 이 폴더의 것으로 교체(또는 내용 복사). Deployment Target은 앱과 동일하게.

### 2. App Group 공유 (아바타 인증용)
앱 타깃 + NSE 타깃 **둘 다** Signing & Capabilities → **App Groups** 추가 → 동일 그룹
`group.com.hivits.hinest` 체크. (Apple 포털 App ID에도 App Group 권한 필요.)

그리고 **앱이 로그인 시 세션 토큰을 이 그룹에 기록**해야 NSE가 `/uploads`(인증 필요) 아바타를 받습니다.
`AppDelegate.swift`(또는 작은 Capacitor 플러그인)에서, JS가 토큰을 받은 직후 호출되게:
```swift
UserDefaults(suiteName: "group.com.hivits.hinest")?
    .set(sessionToken, forKey: "hinest.session.token")
```
JS에서 네이티브로 토큰을 넘기는 브리지가 필요합니다(로그인/세션복원 시 1회). 로그아웃 시 제거.

> **대안(App Group 없이):** 서버가 푸시에 **짧은 수명 서명 URL**(`/uploads/x?token=<단기토큰>`)을 직접
> 실으면 NSE는 그 URL을 그대로 받으면 됩니다. App Group/토큰기록이 불필요한 대신, 푸시·서버로그에
> 토큰이 남는 보안 트레이드오프가 있습니다(감사에서 지적된 JWT-in-URL 확장). 팀이 택1.
> 이 경우 서버 `notify.ts`에서 `senderAvatarPath` 대신 절대 서명 URL을 싣도록 바꾸고, NSE의
> `fetchAvatar`는 토큰 부착 로직을 빼면 됩니다.

### 3. Communication Notifications 엔타이틀먼트
- Apple Developer 포털 → 앱 App ID → **Communication Notifications** capability 활성화 → 프로비저닝 재생성.
- Xcode에서 **앱 타깃 + NSE 타깃 둘 다** `com.apple.developer.usernotifications.communication = true` 엔타이틀먼트 추가.

### 4. 빌드 & 테스트
- `npm run cap:ios`로 웹 자산 동기화 후 Xcode 빌드(앱+확장 임베드 확인).
- 실기기에서 채팅 수신 → 발신자 아바타로 뜨는지 확인. (mutable-content는 lock/background에서 NSE 호출)
- NSE 디버깅: Xcode에서 NSE 스킴 선택 후 attach.

## 동작 요약
채팅 푸시 도착 → `mutable-content`로 NSE 깨어남 → `senderAvatarPath`를 App Group 토큰으로 받아
`INSendMessageIntent`(sender=발신자, image=아바타) 도네이트 → `content.updating(from: intent)`로
Communication Notification 스타일 적용 → 발신자 아바타 + 코너 앱로고로 표시.

NSE가 없거나 실패해도 `aps.alert`로 **일반 알림으로 정상 표시**(현재와 동일)되므로 점진 적용 안전.
