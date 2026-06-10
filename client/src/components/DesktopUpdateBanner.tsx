import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * 데스크톱 앱 업데이트 유도 배너.
 *
 * - 5분마다 서버의 /api/version 호출 → 최신 버전 정보 확인
 * - window.hinest.appVersion 과 비교해서 다르면 배너 노출
 * - "지금 재시작" 버튼 → window.hinest.relaunch() 호출로 앱 재시작
 * - "나중에" 버튼 → 30분 스누즈
 *
 * Electron 환경이 아닌 일반 웹 브라우저에서는 표시하지 않음 (isDesktop 체크).
 */

type VersionInfo = {
  latest: string;
  min: string;
  releasedAt: string;
  notes?: string;
};

const SNOOZE_KEY = "hinest.update.snoozeUntil";

function isSnoozed() {
  const v = localStorage.getItem(SNOOZE_KEY);
  if (!v) return false;
  return Date.now() < Number(v);
}

function snoozeFor(ms: number) {
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms));
}

function compare(a: string, b: string) {
  // semver-ish 비교: 1.2.3 vs 1.2.4
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export default function DesktopUpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [show, setShow] = useState(false);
  const [hardUpdate, setHardUpdate] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  // electron-updater 가 실제로 다운로드를 끝낸 경우에만 true. quitAndInstall 이 의미 있음.
  const [downloaded, setDownloaded] = useState<{ version: string; notes?: string } | null>(null);
  // 자동 다운로드 진행률 (0~100). null 이면 아직 다운로드 중이 아님.
  const [progress, setProgress] = useState<number | null>(null);
  // electron-updater 가 쓰는 게 아니라 배너가 직접 쏜 체크의 실패 여부.
  // unpackaged dev / 서명 실패 / 네트워크 장애 등 폴백 경로 진입 트리거.
  const [autoFallback, setAutoFallback] = useState(false);
  const loadedRef = useRef(false);

  const isDesktop = !!window.hinest?.isDesktop;
  const current = window.hinest?.appVersion ?? "";

  async function check() {
    if (!isDesktop || !current) return;
    try {
      const res = await api<VersionInfo>("/api/version");
      setInfo(res);
      const needsUpdate = compare(current, res.latest) < 0;
      const belowMin = compare(current, res.min) < 0;
      if (belowMin) {
        setHardUpdate(true);
        setShow(true);
      } else if (needsUpdate && !isSnoozed()) {
        setShow(true);
      } else {
        setShow(false);
      }
    } catch {}
  }

  useEffect(() => {
    if (!isDesktop) return;
    if (loadedRef.current) return;
    loadedRef.current = true;
    check();
    const t = setInterval(check, 5 * 60 * 1000); // 5분
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, []);

  // electron-updater 가 설치 파일 다운로드를 끝낸 시점
  useEffect(() => {
    if (!isDesktop) return;
    const off = window.hinest?.onUpdateDownloaded?.((v) => {
      setDownloaded(v);
      setProgress(100);
      setRelaunching(false);
      setShow(true);
    });
    return () => { try { off?.(); } catch {} };
  }, [isDesktop]);

  // 다운로드 진행률 실시간 반영 (0~100)
  useEffect(() => {
    if (!isDesktop) return;
    const off = window.hinest?.onUpdateProgress?.((p) => {
      setProgress(Math.max(0, Math.min(100, Math.round(p.percent))));
    });
    return () => { try { off?.(); } catch {} };
  }, [isDesktop]);

  function openDownloadPage() {
    const url = "https://nest.hi-vits.com/download";
    if (window.hinest?.openExternal) {
      window.hinest.openExternal(url).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
  }

  async function onRelaunch() {
    setRelaunching(true);
    setAutoFallback(false);
    try {
      // 1) 이미 electron-updater 가 다운로드 끝냈으면 즉시 설치 후 재시작.
      if (downloaded && window.hinest?.quitAndInstall) {
        const res = (await window.hinest.quitAndInstall()) as
          | { ok: boolean; error?: string }
          | void;
        if (res && typeof res === "object" && res.ok === false) {
          // 패키징 안된 빌드 등 → 수동 다운로드 페이지로 폴백
          setAutoFallback(true);
          setRelaunching(false);
          openDownloadPage();
        }
        // quitAndInstall 이 성공하면 앱이 바로 종료되므로 이 줄 이후는 실행 안 됨.
        return;
      }

      // 2) 아직 다운로드 안 됨 → electron-updater 체크 트리거.
      //    autoDownload=true 라 곧바로 다운로드 시작 → onUpdateProgress 로 진행률 업데이트
      //    → onUpdateDownloaded 발생 시 배너가 자동으로 "설치 후 재시작" 상태로 전환.
      if (window.hinest?.checkForUpdates) {
        setProgress(0);
        const res = await window.hinest.checkForUpdates();
        if (!res.ok) {
          // 패키징 안된 빌드 / 네트워크 실패 / 릴리스 없음 → 다운로드 페이지로 폴백
          setAutoFallback(true);
          setProgress(null);
          setRelaunching(false);
          openDownloadPage();
          return;
        }
        // 체크 성공 — 다운로드가 진행되는 동안 relaunching 상태 유지.
        // onUpdateDownloaded 에서 relaunching=false 로 꺼짐.
        return;
      }

      // 3) 브릿지 자체 없음 (웹 브라우저 Electron 아님) — 다운로드 페이지로
      setAutoFallback(true);
      setRelaunching(false);
      openDownloadPage();
    } catch {
      setAutoFallback(true);
      setRelaunching(false);
      openDownloadPage();
    }
  }

  function onSnooze() {
    snoozeFor(30 * 60 * 1000); // 30분
    setShow(false);
  }

  if (!isDesktop) return null;
  if (!show) return null;
  // info 가 아직 없어도 다운로드 이벤트만으로 배너 노출 가능
  if (!info && !downloaded) return null;

  return (
    <div
      // 모바일 뷰포트에서 고정 380px 은 오른쪽 5px + 왼쪽 화면 이탈 → 가로 스크롤 발생.
      // left-4/right-4 로 화면폭 맞춤, sm 이상에서만 고정폭 380px.
      // bottom 은 safe-area-inset 고려 (notch 기기에서 하단 홈바에 가려짐 방지).
      className="fixed left-4 right-4 z-[80] sm:left-auto sm:right-5 sm:w-[380px] panel p-0 overflow-hidden"
      style={{
        bottom: "calc(1.25rem + var(--sa-bottom, env(safe-area-inset-bottom, 0px)))",
        boxShadow: "0 10px 28px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.12)",
      }}
    >
      <div
        className="px-4 py-3 flex items-start gap-3"
        style={{ background: "var(--c-brand)", color: "var(--c-brand-fg)" }}
      >
        <div className="w-8 h-8 rounded-lg bg-white/20 grid place-items-center flex-shrink-0">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M21 3v5h-5M3 21v-5h5" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-extrabold">
            {hardUpdate
              ? "업데이트가 필요합니다"
              : downloaded
                ? "새 버전이 다운로드됐어요"
                : "새 버전이 준비되었어요"}
          </div>
          <div className="text-[11.5px] opacity-90 tabular mt-0.5">
            {current} → <b>{downloaded?.version ?? info?.latest}</b>
          </div>
        </div>
        {!hardUpdate && (
          <button
            onClick={onSnooze}
            className="text-white/80 hover:text-white"
            title="30분 뒤 다시 알림"
            aria-label="닫기"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      <div className="p-4">
        <div className="text-[12.5px] text-ink-700 leading-relaxed whitespace-pre-wrap">
          {downloaded
            ? "설치 파일 다운로드가 완료됐어요. 지금 재시작하면 새 버전으로 바로 실행됩니다."
            : autoFallback
              ? "자동 업데이트를 실행할 수 없어서 다운로드 페이지를 열었어요. 최신 설치 파일을 받아서 업데이트해 주세요."
              : progress !== null && progress < 100
                ? "새 버전을 백그라운드에서 내려받고 있어요. 다 받으면 바로 설치 후 재시작할 수 있어요."
                : (info?.notes ?? "최신 HiNest 데스크톱 앱으로 업데이트할 수 있어요. 재시작하면 바로 적용됩니다.")}
        </div>
        {hardUpdate && (
          <div className="mt-2 p-2 rounded-md bg-red-50 border border-red-100 text-[11.5px] text-red-700 font-bold">
            현재 버전은 더 이상 사용할 수 없어요. 업데이트 후 계속 이용할 수 있습니다.
          </div>
        )}
        {progress !== null && progress < 100 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-ink-600 mb-1 tabular">
              <span>다운로드 중</span>
              <span className="font-bold">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${progress}%`, background: "var(--c-brand)" }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-4">
          {!hardUpdate && !autoFallback && (
            <button onClick={onSnooze} className="btn-ghost btn-xs" disabled={relaunching || (progress !== null && progress < 100)}>
              나중에
            </button>
          )}
          {autoFallback ? (
            <button onClick={openDownloadPage} className="btn-primary btn-xs">
              다운로드 페이지 다시 열기
            </button>
          ) : (
            <button
              onClick={onRelaunch}
              className="btn-primary btn-xs"
              disabled={relaunching || (progress !== null && progress < 100)}
            >
              {progress !== null && progress < 100
                ? `다운로드 중… ${progress}%`
                : relaunching
                  ? "설치 준비 중…"
                  : downloaded
                    ? "지금 설치 후 재시작"
                    : "지금 업데이트"}
            </button>
          )}
        </div>
        {!autoFallback && !downloaded && (
          <div className="mt-2 text-right">
            <button
              onClick={openDownloadPage}
              className="text-[11px] text-ink-500 hover:text-ink-700 underline underline-offset-2"
            >
              다운로드 페이지에서 직접 받기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
