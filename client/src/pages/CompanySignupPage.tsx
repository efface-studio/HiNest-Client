import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import BrandLockup from "../components/BrandLockup";
import SoftInput from "../components/SoftInput";

// Tailwind md breakpoint(1024px) 미만은 회사 등록 폼이 너무 길고 입력 정확도가 떨어져
// 데스크탑 전용으로 운영. URL 로 직접 들어와도 안내 화면으로 막는다.
const MOBILE_MQ = "(max-width: 1023.98px)";

/**
 * 회사 가입 신청 페이지 — 새 회사(테넌트)를 등록하고 첫 관리자 계정을 만든다.
 * 초대키 가입(SignupPage)과 달리 회사 자체를 새로 만들기 때문에 플랫폼 운영자의
 * 승인 전까지 로그인할 수 없다 → 제출 성공 시 세션을 발급하지 않고 "승인 대기" 안내를 띄운다.
 */
export default function CompanySignupPage() {
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [bizRegNo, setBizRegNo] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // 모바일/태블릿 가드 — 진입점은 LoginPage·SignupPage 에서 hidden md:block 으로 숨겼지만,
  // URL 직접 입력/뒤로가기로 들어올 수 있어 페이지 자체에서도 막는다. 회전·크기 변화 대응.
  const [isMobile, setIsMobile] = useState<boolean>(
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (user) return <Navigate to="/" replace />;
  // 모바일/태블릿은 그냥 조용히 로그인으로 리다이렉트(안내 화면 없이).
  if (isMobile) return <Navigate to="/login" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await api("/api/auth/company-signup", {
        method: "POST",
        json: {
          companyName,
          contactName,
          email,
          password,
          contactPhone: contactPhone || undefined,
          bizRegNo: bizRegNo || undefined,
        },
      });
      setDone(true);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
        {/* iOS 노치 회피 — var(--sa-top, env(safe-area-inset-top)) 가산 (LoginPage 와 동일). */}
        <header className="px-6 pb-4 flex items-center" style={{ paddingTop: "calc(var(--sa-top, env(safe-area-inset-top)) + 2rem)" }}>
          <BrandLockup height={36} />
        </header>
        <main className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-[400px] text-center">
            <div
              className="w-16 h-16 rounded-3xl grid place-items-center mx-auto mb-7"
              style={{
                background: "color-mix(in srgb, var(--c-brand) 12%, transparent)",
                color: "var(--c-brand)",
              }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h1 className="text-[24px] font-extrabold text-ink-900 tracking-tight leading-tight">
              가입 신청이 접수됐어요
            </h1>
            <p className="text-[14px] text-ink-500 mt-3 leading-relaxed">
              운영자가 <b className="text-ink-700">{companyName}</b> 의 가입을 확인하고 있어요.
              승인이 완료되면 <b className="text-ink-700">{email}</b> 로 가입하신 관리자 계정으로
              로그인할 수 있어요.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center w-full mt-8 transition"
              style={{
                background: "var(--c-brand)",
                color: "#fff",
                height: 54,
                borderRadius: 14,
                fontSize: 16,
                fontWeight: 800,
                letterSpacing: "-0.01em",
              }}
            >
              로그인 화면으로
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      {/* iOS 노치 회피 — var(--sa-top, env(safe-area-inset-top)) 가산 (LoginPage 와 동일). */}
      <header className="px-6 pb-4 flex items-center" style={{ paddingTop: "calc(var(--sa-top, env(safe-area-inset-top)) + 2rem)" }}>
        <BrandLockup height={36} />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-9">
            <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
              회사 등록 신청
            </h1>
            <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
              회사 정보를 입력하면 운영자 승인 후 워크스페이스를 사용할 수 있어요.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <SoftInput
              placeholder="회사명"
              value={companyName}
              onChange={setCompanyName}
              required
              maxLength={200}
              autoComplete="organization"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SoftInput
                placeholder="담당자 이름"
                value={contactName}
                onChange={setContactName}
                required
                maxLength={100}
                autoComplete="name"
              />
              <SoftInput
                placeholder="연락처 (선택)"
                value={contactPhone}
                onChange={setContactPhone}
                maxLength={40}
                autoComplete="tel"
              />
            </div>
            <SoftInput
              type="email"
              placeholder="업무 이메일 (관리자 로그인 ID)"
              value={email}
              onChange={setEmail}
              required
              maxLength={200}
              autoComplete="email"
            />
            <SoftInput
              type="password"
              placeholder="비밀번호 (8자 이상)"
              value={password}
              onChange={setPassword}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
            <SoftInput
              placeholder="사업자등록번호 (선택)"
              value={bizRegNo}
              onChange={setBizRegNo}
              maxLength={40}
            />

            {err && (
              <div
                className="text-[12.5px] font-semibold leading-snug"
                style={{ color: "var(--c-danger)", paddingTop: 2 }}
              >
                {err}
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
              {loading ? "신청 중…" : "가입 신청하기"}
            </button>
          </form>

          <p className="mt-4 text-center text-[11.5px] text-ink-400 leading-relaxed">
            가입 신청 시{" "}
            <Link to="/terms" className="font-semibold hover:text-ink-700 transition" style={{ color: "var(--c-brand)" }}>이용약관</Link>
            {" "}및{" "}
            <Link to="/privacy" className="font-semibold hover:text-ink-700 transition" style={{ color: "var(--c-brand)" }}>개인정보처리방침</Link>
            에 동의하는 것으로 간주합니다.
          </p>

          <div className="mt-5 flex items-center justify-center gap-4 text-[12.5px]">
            <span className="text-ink-500">이미 계정이 있나요?</span>
            <Link
              to="/login"
              className="font-semibold transition"
              style={{ color: "var(--c-brand)" }}
            >
              로그인
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
