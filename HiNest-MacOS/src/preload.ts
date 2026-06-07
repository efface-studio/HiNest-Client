import { contextBridge, ipcRenderer } from "electron";

/**
 * 렌더러 전용 안전 브릿지 (Mac App Store 빌드).
 * 웹앱이 `window.hinest` 로 호출 가능. desktop/ 버전과 표면(shape)은 동일하되,
 * 자동 업데이트 API 는 무해한 스텁으로 대체한다 — App Store 가 업데이트를 담당하므로
 * electron-updater 를 싣지 않지만, 웹앱이 같은 API 를 호출해도 깨지지 않게 한다.
 */
contextBridge.exposeInMainWorld("hinest", {
  platform: process.platform,
  isDesktop: true,
  // App Store 빌드 식별 플래그 — 웹앱이 "데스크톱 앱 받기"/자체 업데이트 UI 를
  // 숨기는 데 활용할 수 있다(없어도 무방).
  isMacAppStore: true,
  appVersion: process.env.HINEST_APP_VERSION ?? "",
  deviceId: process.env.HINEST_DEVICE_ID ?? "",
  setBadge: (count: number) => ipcRenderer.invoke("hinest:setBadge", count),
  flashFrame: () => ipcRenderer.invoke("hinest:flashFrame"),
  openExternal: (url: string) => ipcRenderer.invoke("hinest:openExternal", url),
  showNotification: (opts: { title: string; body?: string; silent?: boolean; icon?: string }) =>
    ipcRenderer.invoke("hinest:showNotification", opts),
  relaunch: () => ipcRenderer.invoke("hinest:relaunch"),
  getAutoLaunch: () => ipcRenderer.invoke("hinest:getAutoLaunch") as Promise<boolean>,
  setAutoLaunch: (enabled: boolean) =>
    ipcRenderer.invoke("hinest:setAutoLaunch", enabled) as Promise<{ ok: boolean; enabled?: boolean; error?: string }>,
  canTouchID: () => ipcRenderer.invoke("hinest:canTouchID") as Promise<boolean>,
  promptTouchID: (reason: string) =>
    ipcRenderer.invoke("hinest:promptTouchID", reason) as Promise<{ ok: boolean; error?: string }>,
  onFullscreenChange: (cb: (isFs: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(!!v);
    ipcRenderer.on("hinest:fullscreen", handler);
    return () => ipcRenderer.removeListener("hinest:fullscreen", handler);
  },

  // ─── 자동 업데이트: App Store 빌드에선 비활성(무해한 스텁) ──────────────
  // 앱 스토어가 업데이트를 담당하므로 electron-updater 를 싣지 않는다.
  // 웹앱(DesktopUpdateBanner 등)이 호출해도 안전하도록 no-op 으로 둔다.
  checkForUpdates: () => Promise.resolve({ ok: false as const, version: null }),
  quitAndInstall: () => Promise.resolve(),
  onUpdateDownloaded: (_cb: (info: { version: string; notes?: string }) => void) => () => {},
  onUpdateProgress: (_cb: (p: { percent: number }) => void) => () => {},
});
