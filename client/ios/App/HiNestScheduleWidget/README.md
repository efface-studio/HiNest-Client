# HiNest 일정 위젯 (iOS / iPadOS)

홈 화면에 다가오는 일정을 보여주는 WidgetKit extension.

## 데이터 흐름

```
[메인 앱]                        [App Group]                   [위젯]
로그인 ──► setSharedToken(token) ─► UserDefaults ◄──── Provider.fetchEntry()
                                  group.com.hivits.hinest                │
                                  key: hinest.session.token              ▼
                                                                GET /api/widget/schedule/today
                                                                       │
                                                                       ▼
                                                                SwiftUI Timeline
```

- 메인 앱 로그인 시 `LiquidGlassTabBarPlugin.setSharedToken` 이 토큰을 App Group 에 저장
  (이미 NSE — 알림 확장 — 이 같은 패턴으로 사용 중)
- 위젯 Provider 가 그 토큰으로 `/api/widget/schedule/today` 호출
- 토큰 갱신 시 `WidgetCenter.shared.reloadTimelines` 로 즉시 다시 그림

## Xcode 에 target 등록 (최초 1회)

이 폴더(`HiNestScheduleWidget`)는 소스만 포함. Xcode 프로젝트에 widget extension target 으로 등록은 **수동 1회** 작업.

### 단계

1. **Xcode 에서 `client/ios/App/App.xcworkspace` 열기**
2. 좌측 트리에서 **App** 프로젝트 클릭 → 하단 **`+`** 버튼 → **Add Target**
3. 템플릿: **iOS** 탭 → **Widget Extension** 선택 → Next
4. 필드:
   - **Product Name**: `HiNestScheduleWidget`
   - **Team**: 기존 메인 앱과 동일
   - **Bundle Identifier** (자동): `com.hivits.hinest.HiNestScheduleWidget`
   - **Include Configuration Intent**: ❌ 끔 (Static configuration 사용)
   - Finish → "Activate" 묻거든 **Activate**
5. Xcode 가 자동 생성한 `HiNestScheduleWidget` 폴더 안의 파일(템플릿)을 **모두 삭제** (Move to Trash)
6. 트리에서 `HiNestScheduleWidget` 그룹에 우클릭 → **Add Files to "App"** → 이 폴더의 `HiNestScheduleWidget.swift`, `Info.plist`, `HiNestScheduleWidget.entitlements`, `README.md` 선택 → **Add to targets: HiNestScheduleWidget** 체크 → Add
7. **target 설정**:
   - **Signing & Capabilities**: 메인 앱과 같은 Team 선택, **`+ Capability` → App Groups** → `group.com.hivits.hinest` 체크 (없으면 Apple Developer Portal 에서 같은 그룹 등록 후 새로 추가)
   - **Build Settings → Code Signing Entitlements**: `HiNestScheduleWidget/HiNestScheduleWidget.entitlements`
   - **Build Settings → Info.plist File**: `HiNestScheduleWidget/Info.plist`
   - **Deployment Info → Minimum Deployments**: iOS 16.0 이상 (containerBackground 사용 — iOS 17+ 권장)
8. **메인 앱 target → General → Frameworks, Libraries, and Embedded Content** → **`+`** → `HiNestScheduleWidget.appex` 선택 → "Embed Without Signing" 또는 default
9. **Build & Run** — 시뮬레이터 홈 화면에서 길게 눌러 위젯 추가 → "HiNest" 검색

### 확인

- 로그인 한 상태에서 시뮬레이터 홈 → 위젯 갤러리 → "HiNest 일정" 추가
- 일정이 표시됨 (없으면 "다가오는 일정이 없어요")
- 로그아웃하면 다음 타임라인 갱신 시 "앱에 로그인하면 표시돼요"

## 디버깅

- 위젯 콘솔: Xcode → Debug → Attach to Process → `HiNestScheduleWidget`
- 강제 reload: 메인 앱에서 로그인/로그아웃 → AppDelegate 의 `setSharedToken` 이 `WidgetCenter.shared.reloadTimelines` 호출
- 데이터 확인: `defaults read group.com.hivits.hinest hinest.session.token` (시뮬레이터 Mac 터미널)

## API

`GET /api/widget/schedule/today` — 다음 36h 안의 일정 최대 12건, 최소 필드만.

```json
{
  "events": [
    { "id": "...", "title": "팀 스탠드업", "startAt": "2026-06-08T10:00:00.000Z",
      "endAt": "2026-06-08T10:30:00.000Z", "color": "#3B5CF0", "category": "MEETING" }
  ],
  "nextRefreshAt": "2026-06-08T10:00:00.000Z",
  "generatedAt": "2026-06-08T08:00:00.000Z"
}
```
