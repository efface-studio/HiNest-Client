/**
 * Electron 자동 업데이트.
 *
 * - electron-updater 를 사용해 GitHub Releases 에서 업데이트를 확인한다.
 * - 업데이트가 있으면 백그라운드에서 다운로드 → 완료 시 렌더러에 알림.
 * - 사용자가 "지금 재시작" 을 누르면 quitAndInstall() 으로 설치 + 재시작.
 *
 * 렌더러 UI (DesktopUpdateBanner) 는 기존 /api/version 기반 배너도 병행해서 유지하는데,
 * 이건 "이 버전이 더 이상 지원되지 않음" 같은 서버 주도 강제 업데이트용이고,
 * electron-updater 는 일반적인 "새 버전 받아오기" 용이다. 두 개가 충돌하지 않게,
 * auto-update 가 다운로드 완료하면 별도의 IPC 이벤트(hinest:updateDownloaded)로 알린다.
 *
 * publish 설정은 desktop/package.json 의 build.publish 에 있음 (GitHub Releases).
 * 로컬 개발 / 서명 없는 빌드에서는 자동 업데이트가 실패하는데, 에러는 조용히 무시.
 */

import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

let initialized = false;

export function setupAutoUpdater(getWindow: () => BrowserWindow | null) {
  if (initialized) return;
  initialized = true;

  // IPC 핸들러는 패키징 여부와 무관하게 **항상** 등록.
  // 렌더러(배너) 가 invoke 했을 때 "handler 없음" 에러가 나지 않도록.
  // 개발모드에선 { ok:false, error:"unpackaged" } 를 반환해 배너가 폴백 경로(다운로드 페이지)로 진입.
  ipcMain.handle("hinest:checkForUpdates", async () => {
    if (!app.isPackaged) return { ok: false, error: "unpackaged" };
    try {
      const res = await autoUpdater.checkForUpdates();
      return { ok: true, version: res?.updateInfo?.version ?? null };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  ipcMain.handle("hinest:quitAndInstall", async () => {
    if (!app.isPackaged) return { ok: false, error: "unpackaged" };
    try {
      // isSilent=false, isForceRunAfter=true → 설치 후 자동 재실행.
      // NSIS/DMG 는 이 호출이 동기적으로 앱을 종료시키므로 반환값이 실제로 전달될 일은 거의 없지만,
      // 실패 시를 대비해 try/catch.
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  });

  // 개발 모드 / 패키징 안 된 앱에서는 폴링/리스너는 건너뜀 (electron-updater 는 asar 패키지 필요)
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  const notify = (channel: string, payload?: any) => {
    try {
      getWindow()?.webContents.send(channel, payload);
    } catch {}
  };

  autoUpdater.on("checking-for-update", () => notify("hinest:updateChecking"));
  autoUpdater.on("update-available", (info) => notify("hinest:updateAvailable", { version: info.version }));
  autoUpdater.on("update-not-available", () => notify("hinest:updateNone"));
  autoUpdater.on("download-progress", (p) => {
    notify("hinest:updateProgress", {
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    notify("hinest:updateDownloaded", { version: info.version, notes: info.releaseNotes });
  });
  autoUpdater.on("error", (err) => {
    // 네트워크 에러 / 서명 없는 빌드 등은 조용히 로그만
    console.warn("[autoUpdater] error:", err?.message ?? err);
    notify("hinest:updateError", { message: String(err?.message ?? err) });
  });

  const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
  const check = () => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn("[autoUpdater] checkForUpdates failed:", e?.message ?? e);
    });
  };
  // 창 뜨고 5초 뒤에 첫 체크 (부팅 직후 네트워크 준비 시간 확보)
  setTimeout(check, 5_000);
  setInterval(check, CHECK_INTERVAL_MS);
}
