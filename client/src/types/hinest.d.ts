export {};

declare global {
  interface Window {
    hinest?: {
      platform: "darwin" | "win32" | "linux" | string;
      isDesktop: true;
      appVersion: string;
      /** preload 에서 main 프로세스가 생성한 UUID — 서버에 Touch ID 등록 시 키로 사용 */
      deviceId?: string;
      setBadge: (count: number) => Promise<void>;
      flashFrame: () => Promise<void>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      showNotification: (opts: { title: string; body?: string; silent?: boolean; icon?: string }) => Promise<void>;
      relaunch: () => Promise<void>;
      onFullscreenChange: (cb: (isFs: boolean) => void) => () => void;
      // ─── macOS 네이티브 Touch ID ─────────────────────────────────
      // Electron Chromium 이 WebAuthn 플랫폼 인증기를 노출하지 않아서
      // main 프로세스가 systemPreferences.promptTouchID 로 OS 프롬프트를 직접 띄움.
      canTouchID?: () => Promise<boolean>;
      promptTouchID?: (reason: string) => Promise<{ ok: boolean; error?: string }>;
      // ─── 자동 업데이트 ──────────────────────────────────────────
      checkForUpdates?: () => Promise<{ ok: boolean; version?: string | null; error?: string }>;
      quitAndInstall?: () => Promise<{ ok: boolean; error?: string } | void>;
      onUpdateDownloaded?: (cb: (info: { version: string; notes?: string }) => void) => () => void;
      onUpdateProgress?: (cb: (p: { percent: number }) => void) => () => void;
    };
    // Capacitor 가 네이티브(iOS/Android) WebView 에 주입하는 전역.
    // @capacitor/core 를 import 하지 않고 런타임 감지에만 쓰는 최소 타입.
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => "ios" | "android" | "web";
    };
  }
}
