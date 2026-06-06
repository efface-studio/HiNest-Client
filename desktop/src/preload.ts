import { contextBridge, ipcRenderer } from "electron";

/**
 * 렌더러 전용 안전 브릿지.
 * 웹앱이 `window.hinest` 로 호출 가능.
 */
contextBridge.exposeInMainWorld("hinest", {
  platform: process.platform,
  isDesktop: true,
  appVersion: process.env.HINEST_APP_VERSION ?? "",
  deviceId: process.env.HINEST_DEVICE_ID ?? "",
  setBadge: (count: number) => ipcRenderer.invoke("hinest:setBadge", count),
  flashFrame: () => ipcRenderer.invoke("hinest:flashFrame"),
  openExternal: (url: string) => ipcRenderer.invoke("hinest:openExternal", url),
  showNotification: (opts: { title: string; body?: string; silent?: boolean; icon?: string }) =>
    ipcRenderer.invoke("hinest:showNotification", opts),
  relaunch: () => ipcRenderer.invoke("hinest:relaunch"),
  canTouchID: () => ipcRenderer.invoke("hinest:canTouchID") as Promise<boolean>,
  promptTouchID: (reason: string) =>
    ipcRenderer.invoke("hinest:promptTouchID", reason) as Promise<{ ok: boolean; error?: string }>,
  onFullscreenChange: (cb: (isFs: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(!!v);
    ipcRenderer.on("hinest:fullscreen", handler);
    return () => ipcRenderer.removeListener("hinest:fullscreen", handler);
  },

  // ─── 자동 업데이트 (electron-updater) ────────────────────────────────
  checkForUpdates: () =>
    ipcRenderer.invoke("hinest:checkForUpdates") as Promise<{ ok: boolean; version?: string | null; error?: string }>,
  quitAndInstall: () => ipcRenderer.invoke("hinest:quitAndInstall"),
  onUpdateDownloaded: (cb: (info: { version: string; notes?: string }) => void) => {
    const handler = (_e: unknown, v: { version: string; notes?: string }) => cb(v);
    ipcRenderer.on("hinest:updateDownloaded", handler);
    return () => ipcRenderer.removeListener("hinest:updateDownloaded", handler);
  },
  onUpdateProgress: (cb: (p: { percent: number }) => void) => {
    const handler = (_e: unknown, v: { percent: number }) => cb(v);
    ipcRenderer.on("hinest:updateProgress", handler);
    return () => ipcRenderer.removeListener("hinest:updateProgress", handler);
  },
});
