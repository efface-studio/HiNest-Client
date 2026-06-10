import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import BrandLockup from "../components/BrandLockup";
import SoftInput from "../components/SoftInput";

/**
 * 초대키 가입 페이지 — 로그인과 동일한 Toss 톤.
 * 한 화면, 한 흐름 — 초대키부터 비밀번호까지 순서대로 채워 \"가입하기\" 한 번에.
 */
export default function SignupPage() {
  const { user, signup } = useAuth();
  const nav = useNavigate();
  const [inviteKey, setInviteKey] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await signup({ inviteKey, name, email, password });
      nav("/");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      {/* iOS 노치 회피 — 고정 pt-8 대신 var(--sa-top, env(safe-area-inset-top)) 가산 (LoginPage 와 동일). */}
      <header className="px-6 pb-4 flex items-center" style={{ paddingTop: "calc(var(--sa-top, env(safe-area-inset-top)) + 2rem)" }}>
        <BrandLockup height={36} />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-9">
            <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
              함께 시작해요
            </h1>
            <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
              관리자에게 받은 초대키로 워크스페이스에 합류하세요.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <SoftInput
              placeholder="초대키  (예: HN-XXXX-XXXX)"
              value={inviteKey}
              onChange={(v) => setInviteKey(v.trim())}
              required
              maxLength={100}
              mono
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SoftInput
                placeholder="이름"
                value={name}
                onChange={setName}
                required
                maxLength={200}
                autoComplete="name"
              />
              <SoftInput
                type="email"
                placeholder="업무 이메일"
                value={email}
                onChange={setEmail}
                required
                maxLength={200}
                autoComplete="email"
              />
            </div>
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
              {loading ? "가입 중…" : "가입하기"}
            </button>
          </form>

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

          {/* 초대키가 없는 신규 회사는 회사 등록 신청으로 안내 */}
          <div className="mt-4 text-center text-[12.5px]">
            <span className="text-ink-400">초대키가 없는 새 회사인가요? </span>
            <Link
              to="/company-signup"
              className="font-semibold transition"
              style={{ color: "var(--c-brand)" }}
            >
              회사 등록 신청
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
