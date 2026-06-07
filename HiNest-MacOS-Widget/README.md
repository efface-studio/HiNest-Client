# HiNest macOS 위젯 (SwiftUI)

macOS 알림센터·데스크톱에 HiNest 일정 위젯을 표시하는 별도 native 앱.

기존 Electron 기반 `HiNest-MacOS` 데스크탑 앱은 채팅·알림 메인 기능을 담당하고,
**이 앱은 위젯 호스트 역할만** 합니다 (사용자 보기 화면은 거의 없음 — 위젯 갤러리에 등장하기 위해 minimal SwiftUI window 하나).

## 구조

```
HiNest-MacOS-Widget/
├── HiNestWidgetApp/          ← macOS 앱 (호스트, minimal UI)
│   ├── HiNestWidgetApp.swift
│   ├── ContentView.swift
│   ├── Info.plist
│   └── HiNestWidgetApp.entitlements
├── HiNestScheduleWidget/     ← WidgetKit Extension
│   ├── HiNestScheduleWidget.swift  (← iOS 와 거의 동일, 색·여백만 macOS 조정)
│   ├── Info.plist
│   └── HiNestScheduleWidget.entitlements
└── Shared/                   ← iOS·macOS 공통(나중에 분리 시 사용)
```

## 데이터 흐름

iOS 위젯과 동일한 패턴:

```
[Electron HiNest-MacOS]                    [App Group]              [SwiftUI HiNest-MacOS-Widget]
로그인 토큰 ──► (개선 작업 필요: 토큰 ─►  group.com.hivits.hinest ◄──── 위젯 Provider
              파일 또는 Keychain                                    ▼
              으로 공유)                                          /api/widget/schedule/today
```

⚠️ **현재 한계**: Electron 앱과 macOS native 앱은 같은 sandbox 안에 있지 않아서, Electron 이 직접 App Group UserDefaults 에 쓸 수 없음. 두 가지 방법:

### Option A — Keychain 공유 (권장)
Electron 앱에서 `node-keytar` 로 시스템 Keychain 에 저장 → SwiftUI 위젯에서 `Security.framework` 로 같은 키 읽음. 같은 Team ID 이면 Keychain access group 으로 공유 가능.

### Option B — 공유 파일
Electron 이 `~/Library/Group Containers/group.com.hivits.hinest/token` 에 직접 쓰기 (entitlements 필요). 가장 간단.

### Option C — 별도 로그인 (단순)
SwiftUI 앱 안에서 사용자가 1회 로그인 → 그 토큰을 자체 Keychain 에 저장 → 위젯이 사용. Electron 과 무관.

→ **현재 시작은 Option C**로 진행. 이후 Option A/B 로 자동 동기화 개선.

## Xcode 프로젝트 만들기 (최초 1회)

1. Xcode → File → New → Project → **macOS** 탭 → **App** → Next
2. 필드:
   - Product Name: **HiNest-MacOS-Widget**
   - Team: 메인 앱과 동일
   - Bundle Identifier: `com.hivits.hinest.widget`
   - Interface: **SwiftUI**, Language: **Swift**, Testing: 끔
   - Location: `/Users/seojiwan/Documents/Develop/HiNest/` (이 폴더가 자동 생성됨)
3. 생성 직후, Xcode 가 만든 `HiNest-MacOS-Widget` 폴더 안의 템플릿 파일 삭제 후 본 폴더의 파일을 Add Files
4. **+ 새 target → Widget Extension** (iOS 와 동일):
   - Product Name: `HiNestScheduleWidget`
   - Bundle ID: `com.hivits.hinest.widget.HiNestScheduleWidget`
   - Platform: **macOS**
   - Include Configuration Intent: ❌
5. 두 target 모두:
   - Signing & Capabilities → App Groups: `group.com.hivits.hinest`
   - 이 폴더의 `.entitlements` 파일을 Code Signing Entitlements 에 지정
6. Build & Run — 알림센터 우측 상단 → "위젯 편집" → "HiNest 일정" 추가

## 빌드 / 배포

- 개발: Xcode 에서 직접 빌드
- 배포: 별도 .app 으로 만들어 Electron 메인 앱 인스톨러에 번들링 (`Contents/Library/Widgets/`) — electron-builder `extraResources` 에 추가

## 주의

- 이 SwiftUI 앱은 사용자가 "쓰는" 앱이 아니라 위젯 호스트. Dock 에 안 나오게 `LSUIElement = YES` 옵션 검토.
- 토큰 동기화는 위 Option C 로 시작 → 추후 Electron 과 자동 동기화 개선.
