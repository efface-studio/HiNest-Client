import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import Logo from "./Logo";
import { confirmAsync } from "./ConfirmHost";
import {
  authenticateWithPasskey,
  canUsePasskey,
  listPasskeys,
  registerPasskey,
  removePasskey,
} from "../lib/passkey";

type Session = { active: boolean; expiresAt?: number };
type PasskeyRow = { id: string; deviceName?: string; createdAt: string; lastUsedAt?: string | null };
type DesktopBioRow = { id: string; deviceId: string; deviceName?: string; createdAt: string; lastUsedAt?: string | null };

export default function SuperStepUpGate({ children }: { children: React.ReactNode }) {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [cap, setCap] = useState<{ supported: boolean; platform: boolean }>({ supported: false, platform: false });
  const [nativeTouch, setNativeTouch] = useState(false);
  const [desktopBios, setDesktopBios] = useState<DesktopBioRow[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const pwRef = useRef<HTMLInputElement>(null);
  // 현재 기기의 deviceId 가 서버 등록 목록에 있는지로 "이 기기 등록 여부" 판단
  const enrolledHere = !!deviceId && desktopBios.some((d) => d.deviceId === deviceId);

  async function checkSession() {
    try {
      const res = await api<Session>("/api/auth/super-session");
      setSession(res);
    } finally {
      setChecking(false);
    }
  }

  const isElectron = typeof window !== "undefined" && !!window.hinest?.isDesktop;

  async function loadPasskeys() {
    try {
      const { passkeys } = await listPasskeys();
      setPasskeys(passkeys);
    } catch { setPasskeys([]); }
  }

  async function loadDesktopBios() {
    try {
      const r = await api<{ devices: DesktopBioRow[] }>("/api/auth/desktop-biometric");
      setDesktopBios(r.devices ?? []);
    } catch { setDesktopBios([]); }
  }

  useEffect(() => {
    checkSession();
    canUsePasskey().then(setCap);
    loadPasskeys();
    loadDesktopBios();
    // Electron 네이티브 Touch ID 가능 여부 + deviceId 수집 (window.hinest 는 hinest.d.ts 에서 타입)
    const bridge = window.hinest;
    if (bridge?.deviceId) setDeviceId(bridge.deviceId);
    bridge?.canTouchID?.()
      .then((ok) => setNativeTouch(!!ok))
      .catch(() => setNativeTouch(false));
  }, []);

  useEffect(() => {
    if (!session?.active) return;
    setPassword("");
    const tick = () => {
      if (!session.expiresAt) return;
      const left = Math.max(0, session.expiresAt - Date.now());
      setRemaining(left);
      if (left <= 0) setSession({ active: false });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [session?.active, session?.expiresAt]);

  useEffect(() => {
    if (checking || session?.active) return;
    // 80ms 지연은 모달이 마운트되며 슬라이드-인 하는 동안 포커스 이동이 동시에 일어나
    // iOS Safari 에서 키보드가 올라오다 말고 취소되는 현상 회피용.
    // 언마운트/세션변화로 effect 가 다시 돌 때 이전 타이머를 정리하지 않으면
    // 포커스가 사라진 input 에 .focus() 를 호출해 조용히 실패함.
    const t = setTimeout(() => pwRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [checking, session?.active]);

  // 처음 super 가 됐을 때 step-up 비번이 아예 없는 케이스 — 별도 setup 화면으로 분기.
  const [needsSetup, setNeedsSetup] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const res = await api<{ expiresAt: number }>("/api/auth/step-up", { method: "POST", json: { password } });
      setSession({ active: true, expiresAt: res.expiresAt });
    } catch (e: any) {
      // 서버가 SUPER_PW_NOT_SET 코드를 주면 setup UI 로 분기.
      if (e?.code === "SUPER_PW_NOT_SET") {
        setNeedsSetup(true);
        setErr("");
      } else {
        setErr(e.message ?? "인증 실패");
      }
    } finally { setLoading(false); }
  }

  async function submitSetup(next: string, confirm: string, loginPassword: string) {
    setErr("");
    if (next !== confirm) { setErr("새 비밀번호가 일치하지 않아요"); return; }
    if (next.length < 8) { setErr("8자 이상 입력해 주세요"); return; }
    if (!loginPassword) { setErr("로그인 비밀번호로 본인 확인이 필요해요"); return; }
    setLoading(true);
    try {
      // 세션 쿠키만 탈취된 공격자가 super 비번을 마음대로 처음 설정하지 못하도록
      // 로그인 비번을 함께 보내 본인 확인 (서버 정책과 일치).
      await api("/api/auth/super-password", { method: "POST", json: { next, loginPassword } });
      // 설정 직후 자동으로 step-up 진행 — 사용자 한 번 더 입력 안 해도 되도록.
      const res = await api<{ expiresAt: number }>("/api/auth/step-up", { method: "POST", json: { password: next } });
      setNeedsSetup(false);
      setPassword("");
      setSession({ active: true, expiresAt: res.expiresAt });
    } catch (e: any) {
      setErr(e?.message ?? "설정 실패");
    } finally { setLoading(false); }
  }

  async function useBiometric() {
    setErr(""); setBioLoading(true);
    try {
      const r = await authenticateWithPasskey();
      if (r.super) setSession({ active: true, expiresAt: r.expiresAt });
      else setErr("패스키 인증은 완료됐지만 개발자 권한이 아닙니다");
    } catch (e: any) {
      if (e?.name === "NotAllowedError" || e?.message?.includes("operation either timed out")) {
        setErr("인증이 취소되었거나 시간이 초과됐어요");
      } else {
        setErr(e?.message ?? "패스키 인증 실패");
      }
    } finally { setBioLoading(false); }
  }

  /** Electron 데스크톱 앱 전용 네이티브 Touch ID 흐름 (사전 등록 필수) */
  async function useNativeTouchID() {
    const bridge = window.hinest;
    if (!bridge?.promptTouchID || !deviceId) return;
    setErr(""); setBioLoading(true);
    try {
      const r = await bridge.promptTouchID("HiNest 개발자 접근을 위해 Touch ID 로 인증해주세요");
      if (!r?.ok) throw new Error(r?.error || "Touch ID 인증 실패");
      const res = await api<{ expiresAt: number }>("/api/auth/desktop-biometric/stepup", {
        method: "POST",
        headers: { "x-hinest-desktop": "1" },
        json: { deviceId },
      });
      setSession({ active: true, expiresAt: res.expiresAt });
    } catch (e: any) {
      setErr(e?.message ?? "Touch ID 인증 실패");
    } finally { setBioLoading(false); }
  }

  async function lock() {
    await api("/api/auth/step-down", { method: "POST" });
    setSession({ active: false });
  }

  if (checking) return <div className="py-20 grid place-items-center"><div className="t-caption">세션 확인 중…</div></div>;

  if (!session?.active) {
    const hasPasskey = passkeys.length > 0;
    const canRegister = cap.supported && cap.platform;

    return (
      <div className="min-h-[70vh] grid place-items-center">
        <div className="w-full max-w-[440px]">
          <div className="flex items-center justify-center mb-5"><Logo size={22} /></div>
          <div className="panel p-7 relative overflow-hidden">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-xl bg-ink-900 text-white grid place-items-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="10" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </div>
              <div>
                <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">민감한 영역</div>
                <div className="h-title">개발자 콘솔 접근</div>
              </div>
            </div>

            <p className="text-[12.5px] text-ink-600 leading-[1.55] mb-5">
              민감한 영역이라 15분 단위 재확인이 필요해요.
            </p>

            {/* 데스크톱 앱 — 네이티브 Touch ID (이 기기가 등록되어있을 때만) */}
            {nativeTouch && enrolledHere && (
              <button
                onClick={useNativeTouchID}
                disabled={bioLoading}
                className="w-full h-[52px] rounded-xl border-2 border-ink-900 bg-ink-900 text-white hover:bg-ink-800 transition flex items-center justify-center gap-2 font-bold mb-3"
              >
                {bioLoading ? (
                  <span className="text-[13px]">인증 중…</span>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 11c-1.5 0-3 .5-4 2M12 7c-3 0-6 2-6 6M12 3c-5 0-9 4-9 9v3M12 15v6M15 14v7M18 13c0 2 0 4-1 6M21 12a9 9 0 0 0-15-7" />
                    </svg>
                    <span className="text-[14px]">Touch ID 로 인증</span>
                  </>
                )}
              </button>
            )}

            {/* 웹 — WebAuthn 패스키 (등록된 경우만) */}
            {!nativeTouch && hasPasskey && (
              <button
                onClick={useBiometric}
                disabled={bioLoading}
                className="w-full h-[52px] rounded-xl border-2 border-ink-900 bg-ink-900 text-white hover:bg-ink-800 transition flex items-center justify-center gap-2 font-bold mb-3"
              >
                {bioLoading ? (
                  <span className="text-[13px]">인증 중…</span>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 11c-1.5 0-3 .5-4 2M12 7c-3 0-6 2-6 6M12 3c-5 0-9 4-9 9v3M12 15v6M15 14v7M18 13c0 2 0 4-1 6M21 12a9 9 0 0 0-15-7" />
                    </svg>
                    <span className="text-[14px]">Touch ID / Face ID 로 인증</span>
                  </>
                )}
              </button>
            )}

            {((nativeTouch && enrolledHere) || (!nativeTouch && hasPasskey)) && (
              <div className="relative my-3 flex items-center gap-3">
                <div className="flex-1 h-px bg-ink-150" />
                <span className="text-[11px] text-ink-400">또는 비밀번호</span>
                <div className="flex-1 h-px bg-ink-150" />
              </div>
            )}

            {needsSetup ? (
              <SuperPwSetupForm
                onSubmit={submitSetup}
                err={err}
                loading={loading}
                onCancel={() => { setNeedsSetup(false); setErr(""); }}
              />
            ) : (
              <form onSubmit={submitPassword} className="space-y-3">
                <div>
                  {!hasPasskey && <label className="field-label">비밀번호</label>}
                  <input ref={pwRef} className="input" type="password" placeholder="현재 비밀번호"
                    value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {err && (
                  <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-100 text-[12px] font-semibold text-red-700">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
                      <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
                    </svg>
                    {err}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" className="btn-ghost" onClick={() => nav("/")}>돌아가기</button>
                  <button className="btn-primary btn-lg flex-1" disabled={loading || !password}>
                    {loading ? "확인 중…" : "인증하고 진입"}
                  </button>
                </div>
              </form>
            )}
          </div>

          {!hasPasskey && canRegister && (
            <div className="mt-4 panel p-4 bg-ink-25 border-dashed">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-500 text-white grid place-items-center flex-shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 11c-1.5 0-3 .5-4 2M12 7c-3 0-6 2-6 6M12 3c-5 0-9 4-9 9v3M12 15v6M15 14v7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-extrabold text-ink-900">생체 인증을 설정하세요</div>
                  <div className="text-[11px] text-ink-600 mt-1 leading-[1.5]">
                    이 기기에 Touch ID / Face ID 를 등록하면 다음 번엔 비밀번호 없이 잠금 해제할 수 있어요. 먼저 위에서 비밀번호로 인증해주세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          <ul className="mt-4 text-[11px] text-ink-500 space-y-1 px-2">
            <li>· 세션은 <b>15분</b>간 유지되며 만료 시 자동 잠깁니다.</li>
            <li>· 브라우저를 닫거나 로그아웃하면 즉시 해제됩니다.</li>
          </ul>
        </div>
      </div>
    );
  }

  // 인증 완료 상태
  return (
    <div>
      <SuperSessionBanner remaining={remaining} onLock={lock} />
      {nativeTouch ? (
        <DesktopBiometricPanel
          devices={desktopBios}
          deviceId={deviceId}
          reload={loadDesktopBios}
        />
      ) : (
        <PasskeyPanel passkeys={passkeys} cap={cap} reload={loadPasskeys} />
      )}
      {children}
    </div>
  );
}

function SuperSessionBanner({ remaining, onLock }: { remaining: number; onLock: () => void }) {
  const sec = Math.ceil(remaining / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const pct = Math.max(0, Math.min(100, (remaining / (15 * 60 * 1000)) * 100));
  const warn = remaining < 3 * 60 * 1000;
  return (
    <div className={`mb-4 panel p-0 overflow-hidden ${warn ? "border-amber-300" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className={`w-8 h-8 rounded-lg grid place-items-center flex-shrink-0 ${warn ? "bg-amber-100 text-amber-700" : "bg-ink-900 text-white"}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold text-ink-900">
            개발자 세션 활성 <span className={`ml-2 tabular ${warn ? "text-amber-700" : "text-ink-500"}`}>{mm}:{ss.toString().padStart(2, "0")} 남음</span>
          </div>
          <div className="text-[11px] text-ink-500">만료 시 자동 잠금. \"잠그기\" 로 즉시 해제 가능.</div>
        </div>
        <button className="btn-ghost btn-xs" onClick={onLock}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          잠그기
        </button>
      </div>
      <div className="h-[2px] bg-ink-100">
        <div className={`h-full transition-all ${warn ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** 절대 날짜 "2026. 4. 17. 13:05" 짧은 형식 */
function formatAbsolute(iso: string) {
  const d = new Date(iso);
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}.${mm}.${dd} ${hh}:${mi}`;
}

/** 상대시간(오늘/어제/N일 전/N달 전) — 현재 사용 안 함, 백업용 */
function formatRelative(iso: string) {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHr < 24) return `${diffHr}시간 전`;
  if (diffDay === 1) return "어제";
  if (diffDay < 7) return `${diffDay}일 전`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}달 전`;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

function EmptyDevicesState() {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-dashed border-ink-200 bg-ink-25">
      <div className="w-10 h-10 rounded-xl bg-ink-100 text-ink-500 grid place-items-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="12" rx="2" /><path d="M2 20h20M8 16v4M16 16v4" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-ink-900">아직 등록된 기기가 없습니다</div>
        <div className="text-[11.5px] text-ink-500 mt-0.5 leading-[1.5]">
          아래에서 이 맥북을 등록하면 다음부터 비밀번호 없이 Touch ID 로 잠금을 해제할 수 있어요.
        </div>
      </div>
    </div>
  );
}

function DesktopBiometricPanel({
  devices, deviceId, reload,
}: {
  devices: DesktopBioRow[];
  deviceId: string;
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const enrolledHere = devices.some((d) => d.deviceId === deviceId);

  async function enroll() {
    if (!deviceId) return;
    setErr(""); setBusy(true);
    try {
      // 등록할 때도 본인 확인용으로 Touch ID 한 번 더 받자 — 실수 등록 방지
      const bridge = window.hinest;
      if (bridge?.promptTouchID) {
        const r = await bridge.promptTouchID("이 기기를 개발자 Touch ID 잠금 해제에 등록합니다");
        if (!r?.ok) throw new Error(r?.error || "Touch ID 확인 실패");
      }
      await api("/api/auth/desktop-biometric/enroll", {
        method: "POST",
        headers: { "x-hinest-desktop": "1" },
        json: { deviceId, deviceName: name || undefined },
      });
      setName("");
      reload();
    } catch (e: any) {
      setErr(e?.message ?? "등록 실패");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    const ok = await confirmAsync({
      title: "Touch ID 해제",
      description: "이 기기의 Touch ID 등록을 해제할까요?",
      tone: "danger",
      confirmLabel: "해제",
    });
    if (!ok) return;
    await api(`/api/auth/desktop-biometric/${id}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="mb-4 panel p-0 overflow-hidden">
      {/* 헤더 */}
      <div className="px-5 py-3.5 border-b border-ink-100 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <div className="text-[13.5px] font-bold text-ink-900 tracking-[-0.01em]">등록된 기기</div>
          <div className="text-[11.5px] text-ink-400 tabular">총 {devices.length}대</div>
        </div>
        <div className="text-[11px] text-ink-500">
          Touch ID 잠금 해제가 허용된 기기 목록
        </div>
      </div>

      {/* 컬럼 헤더 — 테이블 느낌 */}
      {devices.length > 0 && (
        <div className="px-5 py-2 border-b border-ink-100 bg-ink-25 grid grid-cols-[1fr_130px_130px_60px] gap-3 text-[10.5px] font-bold text-ink-500 uppercase tracking-[0.06em]">
          <div>기기</div>
          <div>등록일</div>
          <div>최근 사용</div>
          <div className="text-right">관리</div>
        </div>
      )}

      {/* 기기 리스트 */}
      <div>
        {devices.length === 0 && (
          <div className="px-5 py-8 text-center">
            <div className="text-[12.5px] text-ink-500">아직 등록된 기기가 없습니다.</div>
            <div className="text-[11px] text-ink-400 mt-1">아래에서 이 맥북을 등록해주세요.</div>
          </div>
        )}

        {devices.map((d) => {
          const me = d.deviceId === deviceId;
          return (
            <div
              key={d.id}
              className="px-5 py-3 border-b border-ink-100 last:border-b-0 grid grid-cols-[1fr_130px_130px_60px] gap-3 items-center hover:bg-ink-25 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink-900 truncate flex items-center gap-2">
                  {d.deviceName ?? <span className="text-ink-400 font-normal italic">이름 없음</span>}
                  {me && (
                    <span className="text-[10.5px] font-bold text-brand-500 tracking-wide">
                      · 현재 기기
                    </span>
                  )}
                </div>
                <div className="text-[10.5px] text-ink-400 tabular mt-0.5 truncate">
                  {/*
                    서버는 보안상 deviceId 를 응답에서 제외한다(auth.ts: select 에 deviceId 없음
                    — 세션 탈취 시 step-up 우회 악용 방지). 따라서 d.deviceId 는 항상 undefined 라
                    여기서 .slice 하면 전체 게이트가 throw 했음. 감사 로그와 동일하게 행 id 앞 8자를
                    식별자로 쓴다(서버: row.id.slice(0,8)).
                  */}
                  ID {d.id.slice(0, 8)}
                </div>
              </div>
              <div className="text-[12px] text-ink-600 tabular">
                {formatAbsolute(d.createdAt)}
              </div>
              <div className="text-[12px] text-ink-600 tabular">
                {d.lastUsedAt ? formatAbsolute(d.lastUsedAt) : <span className="text-ink-400">—</span>}
              </div>
              <div className="text-right">
                <button
                  onClick={() => remove(d.id)}
                  className="text-[11.5px] font-semibold text-ink-500 hover:text-danger transition-colors"
                >
                  해제
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 이 기기 등록 섹션 */}
      {!enrolledHere && (
        <div className="border-t border-ink-100 px-5 py-4 bg-ink-25">
          <div className="text-[11.5px] font-bold text-ink-700 mb-2">이 기기 추가</div>
          <div className="flex items-center gap-2">
            <input
              className="input flex-1"
              placeholder="기기 이름 (예: 내 맥북)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) enroll(); }}
              maxLength={40}
            />
            <button className="btn-primary" onClick={enroll} disabled={busy || !deviceId || !name.trim()}>
              {busy ? "등록 중…" : "등록"}
            </button>
          </div>
          <div className="text-[10.5px] text-ink-500 mt-2 leading-[1.5]">
            등록 시 macOS Touch ID 확인을 한 번 요청합니다.
          </div>
        </div>
      )}

      {err && (
        <div className="border-t border-red-100 px-5 py-2.5 bg-red-50 text-[12px] font-semibold text-red-700">
          {err}
        </div>
      )}
    </div>
  );
}

function PasskeyPanel({
  passkeys, cap, reload,
}: {
  passkeys: PasskeyRow[];
  cap: { supported: boolean; platform: boolean };
  reload: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [deviceName, setDeviceName] = useState("");

  async function register() {
    setErr(""); setLoading(true);
    try {
      await registerPasskey(deviceName || undefined);
      setDeviceName("");
      reload();
    } catch (e: any) {
      if (e?.name === "NotAllowedError") setErr("등록이 취소됐어요");
      else setErr(e?.message ?? "등록 실패");
    } finally { setLoading(false); }
  }

  async function remove(id: string) {
    const ok = await confirmAsync({
      title: "패스키 삭제",
      description: "이 기기의 패스키를 삭제할까요?",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    await removePasskey(id);
    reload();
  }

  return (
    <div className="mb-4 panel p-0 overflow-hidden">
      <div className="section-head">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-brand-500 text-white grid place-items-center">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 11c-1.5 0-3 .5-4 2M12 7c-3 0-6 2-6 6M12 3c-5 0-9 4-9 9v3M12 15v6M15 14v7M18 13c0 2 0 4-1 6M21 12a9 9 0 0 0-15-7" />
            </svg>
          </div>
          <div className="title">패스키 · 생체 인증 기기</div>
          <span className="text-[11px] text-ink-400 tabular">{passkeys.length}대</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {passkeys.length === 0 && (
          <div className="text-[12px] text-ink-500">
            아직 등록된 패스키가 없어요. 아래에서 이 기기에 Touch ID/Face ID 를 등록하면 다음부터 비밀번호 없이 잠금 해제할 수 있어요.
          </div>
        )}
        {passkeys.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-ink-150">
            <div className="w-8 h-8 rounded-lg bg-ink-100 text-ink-700 grid place-items-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 11c-1.5 0-3 .5-4 2M12 7c-3 0-6 2-6 6M12 3c-5 0-9 4-9 9v3M12 15v6M15 14v7" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-ink-900">{p.deviceName ?? "기기"}</div>
              <div className="text-[11px] text-ink-500 tabular">
                등록 {new Date(p.createdAt).toLocaleDateString("ko-KR")}
                {p.lastUsedAt && <> · 최근 사용 {new Date(p.lastUsedAt).toLocaleDateString("ko-KR")}</>}
              </div>
            </div>
            <button className="btn-ghost btn-xs text-danger border-red-200 hover:bg-red-50" onClick={() => remove(p.id)}>
              삭제
            </button>
          </div>
        ))}

        {cap.supported && cap.platform ? (
          <div className="flex items-center gap-2 pt-2 border-t border-ink-100">
            <input
              className="input flex-1"
              placeholder="기기 이름 (예: 내 맥북)"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              maxLength={40}
            />
            <button className="btn-primary" onClick={register} disabled={loading}>
              {loading ? "등록 중…" : "이 기기 등록"}
            </button>
          </div>
        ) : (
          <div className="text-[11px] text-ink-500 pt-2 border-t border-ink-100">
            {!cap.supported
              ? "이 브라우저는 WebAuthn을 지원하지 않아요."
              : "이 기기에서 플랫폼 생체 인증을 사용할 수 없어요. (Touch ID/Face ID/Windows Hello 등 필요)"}
          </div>
        )}

        {err && <div className="text-[12px] font-semibold text-danger">{err}</div>}
      </div>
    </div>
  );
}

function SuperPwSetupForm({
  onSubmit,
  err,
  loading,
  onCancel,
}: {
  onSubmit: (next: string, confirm: string, loginPassword: string) => void;
  err: string;
  loading: boolean;
  onCancel: () => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loginPw, setLoginPw] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(next, confirm, loginPw); }}
      className="space-y-3"
    >
      <div className="p-3 rounded-md bg-brand-50 border border-brand-100 text-[12px] text-brand-700">
        개발자 권한이 부여됐어요. 처음 진입이라 <b>개발자 전용 비밀번호</b> 를 설정해 주세요.
        (8자 이상, 일반 로그인 비밀번호와 달라야 함)
        <div className="mt-1.5 text-ink-500">본인 확인을 위해 <b>현재 로그인 비밀번호</b> 도 함께 입력해 주세요.</div>
      </div>
      <div>
        <label className="field-label">현재 로그인 비밀번호</label>
        <input className="input" type="password" autoFocus value={loginPw} onChange={(e) => setLoginPw(e.target.value)} minLength={1} maxLength={128} required autoComplete="current-password" />
      </div>
      <div>
        <label className="field-label">새 개발자 비밀번호</label>
        <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" />
      </div>
      <div>
        <label className="field-label">한 번 더 입력</label>
        <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} maxLength={128} required autoComplete="new-password" />
      </div>
      {err && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-100 text-[12px] font-semibold text-red-700">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0">
            <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {err}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={loading}>취소</button>
        <button className="btn-primary btn-lg flex-1" disabled={loading || !next || !confirm || !loginPw}>
          {loading ? "설정 중…" : "설정하고 진입"}
        </button>
      </div>
    </form>
  );
}

