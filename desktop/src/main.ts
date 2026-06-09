import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, Notification, systemPreferences } from "electron";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { setupAutoUpdater } from "./autoUpdater";

/**
 * HiNest 데스크톱 메인 프로세스.
 *
 * 설계 원칙:
 *  - 앱은 "원격 URL 로드" 방식 → 웹 UI 수정 시 앱 재배포 불필요
 *  - 웹앱의 Web Notifications API 호출이 OS 네이티브 토스트로 자동 매핑됨
 *  - 트레이 아이콘, 단일 인스턴스, 딥링크(hinest://) 지원
 */

const isDev = !!process.env.HINEST_DEV;
// 배포 빌드는 기본적으로 Vercel 에 올라간 웹앱을 로드.
// HINEST_URL 환경변수로 덮어쓰기 가능 (스테이징/로컬 테스트용).
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
 * 기기 고유 ID — userData 폴더에 한 번만 생성해서 고정한다.
 * 서버는 (userId, deviceId) 조합으로 Touch ID 등록을 관리하기 때문에,
 * 앱 재설치 시 deviceId 가 새로 만들어지면 기존 등록은 무효화되어 재등록 필요.
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

  // 다운로드 파일명 = 업로드 원본명. 웹은 <a download="원본명"> 으로 저장하지만, Electron 에선
  // cross-origin(/uploads → api.*) 다운로드 시 download 속성이 무시되고 URL 마지막 경로(스토리지 키,
  // 예: 1780787010314-8a229...)가 파일명이 되는 문제가 있다. will-download 에서 직접 원본명을 강제한다.
  //   우선순위: URL 의 ?name=<원본명>  →  Content-Disposition filename*  →  filename  →  기본(키)
  mainWindow.webContents.session.on("will-download", (_e, item) => {
    try {
      let name = "";
      // 1) ?name= 쿼리 — 리다이렉트 체인 전체를 훑는다.
      //    /uploads/<key>?download=1&name=<원본명> 은 서버에서 S3 presigned URL 로 302 되는데,
      //    item.getURL() 은 리다이렉트 "후" 의 S3 URL(=name 없음)을 줄 수 있다. getURLChain() 은
      //    원본 요청 URL 부터 담으므로 거기서 name= 을 찾아야 파일명이 키 해시로 깨지지 않는다.
      const chain: string[] =
        typeof item.getURLChain === "function" && item.getURLChain().length
          ? item.getURLChain()
          : [item.getURL()];
      for (const link of chain) {
        try {
          const q = new URL(link).searchParams.get("name");
          if (q) { name = decodeURIComponent(q); break; }
        } catch {}
      }
      // 2) Content-Disposition (RFC5987 filename*=UTF-8'' 우선, 그다음 filename=)
      if (!name) {
        const cd = item.getContentDisposition?.() || "";
        const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
        const plain = /filename="?([^";]+)"?/i.exec(cd);
        if (star) name = decodeURIComponent(star[1]);
        else if (plain) name = plain[1];
      }
      // 3) 그래도 없으면 Electron 기본(getFilename)
      if (!name) name = item.getFilename();
      // 경로 구분자 제거(보안) 후 저장 대화상자 기본 파일명으로.
      name = name.replace(/[/\\]/g, "_").trim();
      if (name) item.setSaveDialogOptions({ defaultPath: name });
    } catch {
      /* 실패해도 Electron 기본 동작으로 진행 — 다운로드 자체는 막지 않는다 */
    }
  });

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

  // 데모/스크린샷 전용 — HINEST_DEMO_UPDATE=1 로 실행하면 창 로드 직후 3초 뒤에
  // 가짜 updateDownloaded IPC 이벤트를 쏴서 배너 UI 를 강제 표출.
  // (실제 자동 업데이트 로직과 별개 — 실제 릴리스 확인은 autoUpdater 가 담당)
  // HINEST_DEMO_UPDATE_HARD=1 까지 붙이면 /api/version 응답을 가로채서
  // min 버전을 높게 리턴 → 하드 업데이트 모드 ("나중에" 없음, 무조건 재시작).
  if (process.env.HINEST_DEMO_UPDATE === "1") {
    if (process.env.HINEST_DEMO_UPDATE_HARD === "1") {
      const fake = {
        latest: "0.2.0",
        min: "0.2.0",
        releasedAt: new Date().toISOString(),
        notes: "중요 보안 업데이트 — 즉시 적용이 필요합니다.",
      };
      const dataUrl =
        "data:application/json," + encodeURIComponent(JSON.stringify(fake));
      mainWindow.webContents.session.webRequest.onBeforeRequest(
        (details, callback) => {
          if (/\/api\/version(\?|$)/.test(details.url)) {
            callback({ redirectURL: dataUrl });
            return;
          }
          callback({});
        }
      );
    }
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        try {
          mainWindow?.webContents.send("hinest:updateDownloaded", {
            version: "0.2.0",
            notes: "데모용 가짜 업데이트 이벤트 — 실제 새 버전 아님",
          });
        } catch {}
      }, 3000);
    });
  }

  // 프로덕션에서도 DevTools 토글 허용 (WebAuthn/Touch ID 디버깅용)
  // ⌘⌥I (macOS) / Ctrl+Shift+I (기타)
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    const isMac = process.platform === "darwin";
    const toggleCombo =
      (isMac && input.meta && input.alt && input.key.toLowerCase() === "i") ||
      (!isMac && input.control && input.shift && input.key.toLowerCase() === "i");
    if (toggleCombo) {
      mainWindow?.webContents.toggleDevTools();
    }
    // ⌘R / Ctrl+R 강제 새로고침
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
        // 보안: http/https 만 외부 브라우저로 연다. file:/javascript:/커스텀 스킴은
        // 사용자 렌더 콘텐츠(채팅 등)에 끼어들 수 있으므로 openExternal 에 넘기지 않음.
        if (u.protocol === "http:" || u.protocol === "https:") shell.openExternal(url);
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

/**
 * 첫 실행에 자동 시작(OS 로그인 시 트레이 상주)을 기본 ON 으로 등록.
 * → 앱이 꺼져 있어도 컴퓨터를 켤 때마다 트레이로 자동 실행되어 알람을 항상 받는다.
 *
 * 한 번만 초기화: flag 파일이 있으면 skip — 사용자가 토글로 OFF 한 후엔 우리가 다시 켜지 않음.
 * 사용자 설정 폴더(app.getPath('userData'))에 flag 를 저장하므로 앱 업데이트 후에도 유지.
 * dev 빌드(packaged 아님)는 안전상 skip — npm run dev 가 사용자 로그인 항목을 건드리지 않게.
 */
function initAutoLaunchDefault() {
  if (!app.isPackaged) return;
  try {
    const flagPath = path.join(app.getPath("userData"), "auto-launch-initialized");
    if (fs.existsSync(flagPath)) return;
    app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
    fs.writeFileSync(flagPath, String(Date.now()));
    console.log("[autoLaunch] enabled by default on first run");
  } catch (e) {
    console.warn("[autoLaunch] init failed", e);
  }
}

app.whenReady().then(() => {
  // Windows 에서 알림 타이틀바에 "Electron" 대신 HiNest 로 뜨게
  if (process.platform === "win32") {
    app.setAppUserModelId("com.hivits.hinest");
  }
  createWindow();
  createTray();
  setupAutoUpdater(() => mainWindow);
  initAutoLaunchDefault();

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
    } else if (process.platform === "win32" && mainWindow) {
      if (count > 0) {
        const badge = nativeImage.createFromDataURL(FALLBACK_ICON);
        mainWindow.setOverlayIcon(badge, `${count} unread`);
      } else {
        mainWindow.setOverlayIcon(null, "");
      }
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

// 파일 다운로드 — 렌더러가 넘긴 (절대) URL 을 메인 webContents 가 직접 받는다.
// <a download> 의 cross-origin 302·창 네비게이션 불안정을 피해 will-download 가 단번에 떠
// 원본 파일명(?name=)으로 저장된다. http/https 만 허용(스킴 화이트리스트).
ipcMain.handle("hinest:downloadFile", (_e, url: unknown) => {
  try {
    if (typeof url !== "string") return { ok: false, error: "invalid url" };
    const lower = url.trim().toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      return { ok: false, error: "disallowed scheme" };
    }
    mainWindow?.webContents.downloadURL(url);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

ipcMain.handle("hinest:showNotification", (_e, opts: { title: string; body?: string; silent?: boolean; icon?: string }) => {
  try {
    // 발신자 아바타(dataURL) 가 오면 알림 아이콘으로 사용. (Win/Linux 확실, macOS 는 빌드로 검증)
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
 * 자동 시작 (OS 로그인 시 트레이 상주) — 사용자 토글.
 * macOS: 표준 LaunchAgent 등록(서명 무관). openAsHidden=true 로 윈도우 없이 트레이만 시작.
 * Windows: 레지스트리 Run 키. AppData 의 \"squirrel-aware\" 옵션은 electron-builder NSIS 가 처리.
 * 패키징 안 됐을 땐(dev) 동작 안 함 — 그래도 IPC 는 항상 응답해 렌더러가 깨지지 않게.
 */
ipcMain.handle("hinest:getAutoLaunch", () => {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
});

ipcMain.handle("hinest:setAutoLaunch", (_e, enabled: boolean) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      // macOS: hidden 시작 = Dock 잠깐 안 보이고 트레이만(알림 수신 목적).
      openAsHidden: true,
    });
    return { ok: true, enabled: app.getLoginItemSettings().openAtLogin };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
});

/**
 * 네이티브 Touch ID 프롬프트.
 * Electron 내부 Chromium 은 WebAuthn 플랫폼 인증기를 노출하지 않기 때문에
 * macOS Local Authentication 을 main 프로세스에서 직접 호출한다.
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
