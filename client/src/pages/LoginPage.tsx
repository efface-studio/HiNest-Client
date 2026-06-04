import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import BrandLockup from "../components/BrandLockup";
import SoftInput from "../components/SoftInput";
import { isInstalledApp } from "../lib/platform";

// 회사(테넌트) 상태로 로그인이 막힌 경우의 코드 — 비밀번호 오류처럼 빨갛게 보이지 않게 별도 톤 처리.
const COMPANY_ERROR_CODES = ["COMPANY_PENDING", "COMPANY_SUSPENDED", "COMPANY_REJECTED", "COMPANY_INACTIVE"];

/**
 * 로그인 페이지 — Toss 의 \"한 화면에 한 흐름\" 디자인 원칙을 따른다.
 *  - 카드/패널 없이 흰 배경 위에 큰 인사말 + 두 개의 입력 + 큰 primary 버튼
 *  - 입력 필드는 보더 대신 옅은 회색 fill (\#F4F6FA) — 포커스 시 브랜드 링
 *  - 부차 액션(가입 / 미리보기 / 앱 다운로드) 은 하단에 약하게
 */
export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [errCode, setErrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 총관리자(superAdmin)는 운영 콘솔로, 그 외 사용자는 회사 앱 홈으로.
  if (user) return <Navigate to={user.superAdmin ? "/super-admin" : "/"} replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setErrCode(null);
    setLoading(true);
    try {
      const u = await login(email, password);
      nav(u.superAdmin ? "/super-admin" : "/");
    } catch (e: any) {
      setErr(e.message);
      // 서버가 ACCOUNT_LOCKED 같은 코드를 message JSON 에 포함하는 경우를 위해
      // 우선 message 안에 "잠겨" 단어가 있는지로 fallback 판정.
      const isLocked = (e?.code === "ACCOUNT_LOCKED") || /잠겨|잠겼|잠긴|LOCKED/i.test(e?.message ?? "");
      setErrCode(isLocked ? "ACCOUNT_LOCKED" : (e?.code ?? null));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      {/* 상단 — 로고만 살짝.
          iOS 단독형(standalone) PWA 는 status-bar 가 black-translucent 라 콘텐츠가
          노치/상태바 아래까지 풀스크린으로 깔린다. pt-8(고정 28px) 만으론 로고가 상단
          safe-area 를 침범하므로, env(safe-area-inset-top) 를 더해 노치 아래로 내린다.
          데스크톱·브라우저는 inset=0 이라 기존 28px 그대로 유지된다. */}
      <header
        className="px-6 pb-4 flex items-center"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}
      >
        <BrandLockup height={36} />
      </header>

      {/* 본문 — 중앙 정렬, 한 단 */}
      <main className="flex-1 flex items-center justify-center px-6 pb-32">
        <div className="w-full max-w-[360px]">
          {/* 인사말 */}
          <div className="mb-9">
            <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
              어서 오세요
            </h1>
            <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
              이메일과 비밀번호로 워크스페이스에 들어갈 수 있어요.
            </p>
          </div>

          {/* 폼 */}
          <form onSubmit={submit} className="space-y-3">
            <SoftInput
              type="email"
              placeholder="이메일"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              required
              maxLength={200}
            />
            <SoftInput
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              required
              maxLength={128}
            />

            {err && (
              <div
                className="text-[12.5px] font-semibold leading-snug"
                style={{
                  color:
                    errCode === "COMPANY_PENDING"
                      ? "var(--c-warning)"
                      : errCode && COMPANY_ERROR_CODES.includes(errCode)
                        ? "var(--c-text-2)"
                        : "var(--c-danger)",
                  paddingTop: 2,
                }}
              >
                {err}
                {errCode === "ACCOUNT_LOCKED" && (
                  <div className="mt-2">
                    <Link
                      to="/forgot-password"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-bold transition"
                      style={{
                        background: "color-mix(in srgb, var(--c-brand) 12%, transparent)",
                        color: "var(--c-brand)",
                        border: "1px solid color-mix(in srgb, var(--c-brand) 26%, transparent)",
                      }}
                    >
                      🔑 이메일로 잠금 풀고 비밀번호 재설정
                    </Link>
                  </div>
                )}
                {errCode === "COMPANY_PENDING" && (
                  <div className="mt-1.5 text-ink-500 font-medium">
                    승인이 완료되면 같은 이메일로 바로 로그인할 수 있어요.
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full transition disabled:opacity-60"
              style={{
                marginTop: 18,
                background: "var(--c-brand)",
                color: "#fff",
                height: 54,
                borderRadius: 14,
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}
            >
              {loading ? "로그인 중…" : "로그인"}
            </button>
          </form>

          {/* 보조 액션 */}
          <div className="mt-5 flex items-center justify-center gap-4 text-[12.5px]">
            <Link
              to="/signup"
              className="text-ink-500 hover:text-ink-900 transition font-semibold"
            >
              초대키로 가입
            </Link>
            <span className="text-ink-300">·</span>
            <Link
              to="/forgot-password"
              className="text-ink-500 hover:text-ink-900 transition font-semibold"
            >
              비밀번호 찾기
            </Link>
            <span className="text-ink-300">·</span>
            <Link
              to="/preview"
              className="font-semibold transition"
              style={{ color: "var(--c-brand)" }}
            >
              둘러보기
            </Link>
          </div>

          {/* 새 회사 셀프 가입 — 멀티테넌트 진입점 */}
          <div className="mt-4 text-center text-[12.5px]">
            <span className="text-ink-400">회사를 새로 시작하시나요? </span>
            <Link
              to="/company-signup"
              className="font-semibold transition"
              style={{ color: "var(--c-brand)" }}
            >
              회사 등록 신청
            </Link>
          </div>

          {/* 앱 다운로드 — 설치형 앱(데스크톱·모바일 네이티브) 안에서는 숨김 */}
          {!isInstalledApp() && (
            <div className="mt-10 text-center">
              <Link
                to="/download"
                className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-400 hover:text-ink-700 transition"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                데스크톱 · 모바일 앱
              </Link>
            </div>
          )}

          {/* 법적 고지 — 스토어 요건상 어디서든 접근 가능해야 함 */}
          <div className="mt-8 flex items-center justify-center gap-3 text-[11px] text-ink-400">
            <Link to="/privacy" className="hover:text-ink-700 transition">개인정보처리방침</Link>
            <span className="text-ink-300">·</span>
            <Link to="/terms" className="hover:text-ink-700 transition">이용약관</Link>
          </div>
        </div>
      </main>
    </div>
  );
}

