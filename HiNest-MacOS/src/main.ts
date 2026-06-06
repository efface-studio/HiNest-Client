import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, Notification, systemPreferences } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/**
 * HiNest for macOS — Mac App Store(샌드박스) 빌드의 메인 프로세스.
 *
 * desktop/ (Developer ID 직접 배포 + 자동 업데이트) 버전을 기반으로 하되,
 * App Store 정책에 맞춰 다음을 제거/변경했다:
 *  - electron-updater 자동 업데이트 제거 (앱 스토어가 업데이트를 담당; 자체 업데이트는 리젝 사유)
 *  - 데모용 가짜 업데이트 이벤트 코드 제거
 *  - 샌드박스 entitlements (build/entitlements.mas.plist) 적용은 electron-builder 가 처리
 *
 * 그 외 동작은 동일:
 *  - 원격 URL 로드 방식 → 웹 UI 수정 시 앱 재제출 불필요
 *  - 웹앱의 Web Notifications API → OS 네이티브 토스트 자동 매핑
 *  - 트레이 아이콘, 단일 인스턴스, 네이티브 Touch ID, dock 배지
 */

const isDev = !!process.env.HINEST_DEV;
// 배포 빌드는 Vercel 에 올라간 웹앱을 로드. HINEST_URL 로 덮어쓰기 가능(스테이징/테스트).
const PROD_URL = "https://nest.hi-vits.com";
const DEFAULT_URL = isDev
  ? "http://localhost:1000"
  : process.env.HINEST_URL ?? PROD_URL;

// 단일 인스턴스 — 이미 떠있으면 기존 창 포커스
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

/**
 * 기기 고유 ID — userData 폴더(샌드박스 컨테이너 내부)에 한 번만 생성해 고정한다.
 * 서버는 (userId, deviceId) 조합으로 Touch ID 등록을 관리하므로,
 * 재설치 시 deviceId 가 바뀌면 기존 등록은 무효화되어 재등록이 필요하다.
 */
function ensureDeviceId(): string {
  const dir = app.getPath("userData");
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const file = path.join(dir, "device-id.txt");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 16) return existing;
  } catch {}
  const id = crypto.randomUUID();
  try { fs.writeFileSync(file, id, "utf8"); } catch {}
  return id;
}

function createWindow() {
  // preload 에서 process.env 로 버전·deviceId 전달
  process.env.HINEST_APP_VERSION = app.getVersion();
  process.env.HINEST_DEVICE_ID = ensureDeviceId();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: "HiNest",
    backgroundColor: "#F5F6F8",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(DEFAULT_URL);

  // 창 상태 변경 시 렌더러에 알려서 상단 여백을 동적으로 조정
  const sendFullscreenState = () => {
    try {
      mainWindow?.webContents.send(
        "hinest:fullscreen",
        !!mainWindow?.isFullScreen() || !!mainWindow?.isSimpleFullScreen()
      );
    } catch {}
  };
  mainWindow.on("enter-full-screen", sendFullscreenState);
  mainWindow.on("leave-full-screen", sendFullscreenState);
  mainWindow.on("enter-html-full-screen", sendFullscreenState);
  mainWindow.on("leave-html-full-screen", sendFullscreenState);
  mainWindow.webContents.on("did-finish-load", sendFullscreenState);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // DevTools 토글(⌘⌥I) + 강제 새로고침(⌘R) — WebAuthn/Touch ID 디버깅용
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    const isMac = process.platform === "darwin";
    const toggleCombo =
      (isMac && input.meta && input.alt && input.key.toLowerCase() === "i") ||
      (!isMac && input.control && input.shift && input.key.toLowerCase() === "i");
    if (toggleCombo) {
      mainWindow?.webContents.toggleDevTools();
    }
    const reloadCombo =
      (isMac && input.meta && input.key.toLowerCase() === "r") ||
      (!isMac && input.control && input.key.toLowerCase() === "r");
    if (reloadCombo && !input.shift) {
      mainWindow?.webContents.reload();
    }
  });

  // 외부 링크는 시스템 기본 브라우저로
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      const origin = new URL(DEFAULT_URL).origin;
      if (u.origin !== origin) {
        shell.openExternal(url);
        return { action: "deny" };
      }
    } catch {}
    return { action: "allow" };
  });

  // macOS: 닫기 버튼은 트레이로 숨기고 계속 실행 (Slack 스타일)
  mainWindow.on("close", (e) => {
    if (process.platform === "darwin" && !quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "..", "assets", "trayIcon.png");
  const image = nativeImage.createFromPath(iconPath).isEmpty()
    ? nativeImage.createEmpty()
    : nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL(FALLBACK_ICON) : image);
  tray.setToolTip("HiNest");
  const menu = Menu.buildFromTemplate([
    { label: "HiNest 열기", click: () => showWindow() },
    { type: "separator" },
    {
      label: "새 메시지 알림 테스트",
      click: () => {
        new Notification({
          title: "HiNest",
          body: "데스크톱 앱 알림 동작 확인 ✅",
        }).show();
      },
    },
    { type: "separator" },
    { label: "종료", click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showWindow());
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.on("second-instance", () => {
  showWindow();
});

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* ======= IPC: 렌더러 ↔ 메인 ======= */

ipcMain.handle("hinest:setBadge", (_e, count: number) => {
  try {
    if (process.platform === "darwin") {
      app.dock?.setBadge(count > 0 ? String(count) : "");
    }
  } catch {}
});

// 외부 URL 을 OS 기본 브라우저로 — 렌더러에서 명시적으로 호출.
// 보안: http/https/mailto/tel 만 허용. javascript:, file:, hinest:// 등 차단.
ipcMain.handle("hinest:openExternal", async (_e, url: unknown) => {
  try {
    if (typeof url !== "string") return { ok: false, error: "invalid url" };
    const lower = url.trim().toLowerCase();
    const allowed = ["http://", "https://", "mailto:", "tel:"];
    if (!allowed.some((p) => lower.startsWith(p))) {
      return { ok: false, error: "disallowed scheme" };
    }
    await shell.openExternal(url);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle("hinest:flashFrame", () => {
  try {
    mainWindow?.flashFrame(true);
  } catch {}
});

ipcMain.handle("hinest:showNotification", (_e, opts: { title: string; body?: string; silent?: boolean; icon?: string }) => {
  try {
    // 발신자 아바타(dataURL) 가 오면 알림 아이콘으로 사용. (macOS 에서 적용되는지 빌드로 검증)
    const icon = opts.icon ? nativeImage.createFromDataURL(opts.icon) : undefined;
    const n = new Notification({ title: opts.title, body: opts.body, silent: opts.silent, ...(icon && !icon.isEmpty() ? { icon } : {}) });
    n.on("click", () => showWindow());
    n.show();
  } catch {}
});

ipcMain.handle("hinest:relaunch", () => {
  quitting = true;
  app.relaunch();
  app.exit(0);
});

/**
 * 네이티브 Touch ID 프롬프트.
 * Electron 내부 Chromium 은 WebAuthn 플랫폼 인증기를 노출하지 않기 때문에
 * macOS Local Authentication 을 main 프로세스에서 직접 호출한다. (샌드박스에서 동작)
 */
ipcMain.handle("hinest:canTouchID", () => {
  try {
    if (process.platform !== "darwin") return false;
    return !!systemPreferences.canPromptTouchID?.();
  } catch {
    return false;
  }
});

ipcMain.handle("hinest:promptTouchID", async (_e, reason: string) => {
  if (process.platform !== "darwin") {
    return { ok: false, error: "touchid_only_macos" };
  }
  try {
    await systemPreferences.promptTouchID(reason || "HiNest 총관리자 인증");
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

/* 작은 1x1 투명 PNG — 트레이 아이콘 파일 없을 때 최소 대체용 */
const FALLBACK_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR42u3OAQ0AAAgDINc/9Fs" +
  "BBSRIu0mJQigoKCgoKCgoKCgoKCgoKCgoKHgBg9ECQFvZZz8AAAAASUVORK5CYII=";
