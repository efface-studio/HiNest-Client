# 안드로이드(Google Play) 제출 가이드 — HiNest

Capacitor Android 앱을 Google Play 에 올리는 전체 절차. 코드/스캐폴드는 준비돼 있고(`client/android`),
아래는 **사용자(계정·시크릿)가 해야 하는 수동 단계**와 **빌드 방법**이다.

- 앱 ID: `com.hivits.hinest` (iOS 와 동일)
- 버전: `versionName 1.0.0`, `versionCode 1` (`client/android/app/build.gradle`)
- 푸시: FCM (서버 `server/src/lib/fcm.ts` — APNs 와 동일 아키텍처, env-gated)

---

## 0. 빌드 환경 (1회)
- **JDK 17 또는 21** (현재 머신은 JDK 25 — Android Gradle Plugin 미지원. `JAVA_HOME` 을 17/21 로).
- **Android Studio** (Android SDK + 빌드도구). 설치 후 `ANDROID_HOME` 설정.
- 동기화: 레포에서 `cd client && npm run cap:android` → Android Studio 가 열리고 Gradle sync.

## 1. 업로드 keystore 생성 (1회, 안전 보관 — 절대 커밋·분실 금지)
```bash
keytool -genkey -v -keystore hinest-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias hinest
```
- 생성한 `hinest-upload.jks` 는 **레포 밖 안전한 곳**에 보관(분실 시 앱 업데이트 영구 불가 — Play App Signing 등록 전제).
- `client/android/keystore.properties` 생성(이미 .gitignore 됨):
  ```properties
  storeFile=/absolute/path/hinest-upload.jks
  storePassword=********
  keyAlias=hinest
  keyPassword=********
  ```
- CI 에선 env 로: `HINEST_ANDROID_KEYSTORE`(경로), `HINEST_ANDROID_STORE_PASSWORD`, `HINEST_ANDROID_KEY_ALIAS`, `HINEST_ANDROID_KEY_PASSWORD`.

## 2. FCM(푸시) 설정 — Firebase
> iOS=APNs 와 동일하게, Android 알림은 FCM 이 필요. 안 하면 앱은 정상이나 **안드로이드 알림만 안 옴**.

1. [Firebase 콘솔](https://console.firebase.google.com) → 프로젝트 생성(또는 기존).
2. Android 앱 추가 → 패키지명 `com.hivits.hinest` → **`google-services.json`** 다운로드 →
   `client/android/app/google-services.json` 에 둠(이미 .gitignore — 커밋 안 됨). build.gradle 이 있으면 자동 적용.
3. **서버 발송 자격**: 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성" → JSON 다운로드.
   서버 env 에 둘 중 하나:
   - `FCM_SERVICE_ACCOUNT_JSON` = (그 JSON 전체 문자열), 또는
   - `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY`(PEM, `\n` 이스케이프 가능)
   → 서버 재배포하면 `fcmEnabled()`=true 가 되어 안드로이드 토큰으로 자동 발송.
4. **클라 빌드 플래그 `VITE_ANDROID_FCM=1`** (필수): 안드로이드 푸시 등록은 이 플래그가
   `1` 일 때만 켜진다.
   ```bash
   cd client && VITE_ANDROID_FCM=1 npm run cap:android   # 또는 bundleRelease 전 sync
   ```
   > ⚠️ 왜 플래그로 가두나: `PushNotifications.register()` 는 내부적으로
   > `FirebaseMessaging.getInstance()` 를 호출하는데, `google-services.json` 이 없어
   > FirebaseApp 이 초기화 안 된 빌드에선 **네이티브 크래시(IllegalStateException)** 가 난다
   > (JS try/catch 로 못 잡음). 그래서 google-services.json 을 실제로 넣은 빌드에서만
   > `VITE_ANDROID_FCM=1` 로 푸시를 켠다. 플래그 없이 빌드하면 앱은 정상, 안드로이드 알림만 안 옴.

## 3. 릴리스 AAB 빌드
```bash
cd client && npm run cap:android      # 웹 빌드 + cap sync + Android Studio
# Android Studio: Build > Generate Signed Bundle / APK > Android App Bundle
#  또는 CLI:
cd client/android && ./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
```
keystore.properties(또는 env)가 있으면 서명된 AAB 가 나온다.

## 4. Google Play Console 제출
1. [Play Console](https://play.google.com/console) 개발자 등록(1회 $25).
2. 앱 생성 → 패키지명 `com.hivits.hinest`.
3. **Play App Signing** 활성(권장) — 업로드 키로 서명해 올리면 Google 이 배포 서명 관리.
4. 스토어 등록정보: 앱 이름·설명·아이콘(512px)·피처 그래픽(1024×500)·스크린샷(폰/태블릿).
5. **개인정보처리방침 URL**: `https://nest.hi-vits.com/privacy` (이미 있음).
6. 데이터 보안 양식, 콘텐츠 등급, 타깃 연령.
7. 내부 테스트 트랙에 AAB 업로드 → 검증 후 프로덕션 출시.

## 5. 업데이트 흐름 (iOS 와 동일)
- **웹 번들 변경**: Capacitor Live Updates(Capgo)로 OTA — 스토어 재심사 없이 반영(`directUpdate:true`).
- **네이티브 변경(권한·플러그인·SDK)**: `versionCode` 올려 새 AAB 제출 → 재심사.

---

## 코드에 이미 반영된 것 (이 레포)
- `client/android` — Capacitor 플랫폼 스캐폴드(appId, compileSdk 36, INTERNET + POST_NOTIFICATIONS).
- `client/android/app/build.gradle` — keystore.properties/env 기반 릴리스 서명, versionName 1.0.0.
- `.gitignore` — keystore·google-services.json 등 시크릿 제외.
- `server/src/lib/fcm.ts` + `notify.ts` — FCM 발송(env-gated, APNs 와 병행, platform 라우팅).
- `client/src/lib/pushNotifications.ts` — iOS·Android 공용 푸시 등록(platform 자동 전송).
  안드로이드는 `VITE_ANDROID_FCM=1` 빌드에서만 register() 호출(Firebase 미설정 크래시 방지).

## 남은 수동 단계 체크리스트
- [ ] JDK 17/21 + Android Studio + ANDROID_HOME
- [ ] 업로드 keystore 생성 + keystore.properties(또는 CI env)
- [ ] Firebase 프로젝트 + google-services.json + 서버 FCM 서비스계정 env
- [ ] 서명된 AAB 빌드
- [ ] Play Console 등록($25) + 스토어 리스팅 + AAB 업로드
