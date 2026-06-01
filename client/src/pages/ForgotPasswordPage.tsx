import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import BrandLockup from "../components/BrandLockup";
import SoftInput from "../components/SoftInput";

/**
 * 비밀번호 찾기 — 이메일 인증 메일을 발송.
 * 보안:
 *   서버는 가입 여부와 무관하게 항상 200 을 돌려준다(enumeration 차단).
 *   따라서 화면도 "메일을 보냈어요" 한 가지 응답만 보여준다.
 */
export default function ForgotPasswordPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  if (user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      await api("/api/auth/password-reset/request", { method: "POST", json: { email } });
      setSent(true);
    } catch (e: any) {
      setErr(e?.message ?? "요청에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      <header className="px-6 pt-8 pb-4 flex items-center">
        <BrandLockup height={36} />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[400px]">
          {!sent ? (
            <>
              <div className="mb-9">
                <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
                  비밀번호를 잊으셨나요?
                </h1>
                <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
                  가입하신 업무 이메일로 재설정 링크를 보내드릴게요.<br />
                  계정이 잠겨있어도 이 메일로 풀 수 있어요.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-3">
                <SoftInput
                  type="email"
                  placeholder="업무 이메일"
                  value={email}
                  onChange={setEmail}
                  required
                  maxLength={200}
                  autoComplete="email"
                />

                {err && (
                  <div className="text-[12.5px] font-semibold leading-snug" style={{ color: "var(--c-danger)", paddingTop: 2 }}>
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
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
                  {loading ? "메일 발송 중…" : "재설정 링크 받기"}
                </button>
              </form>

              <div className="mt-5 flex items-center justify-center gap-4 text-[12.5px]">
                <Link to="/login" className="text-ink-500 hover:text-ink-900 transition font-semibold">
                  ← 로그인으로 돌아가기
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="mb-7">
                <div className="text-[48px] mb-4 leading-none">📬</div>
                <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
                  메일을 보냈어요
                </h1>
                <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
                  <strong className="text-ink-900">{email}</strong> 으로 비밀번호 재설정 링크를 발송했어요.<br />
                  메일함을 확인하시고 <strong>30분 안에</strong> 새 비밀번호를 설정해 주세요.
                </p>
              </div>

              <div
                className="rounded-xl p-4 text-[12.5px] leading-relaxed mb-6"
                style={{
                  background: "color-mix(in srgb, var(--c-brand) 8%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--c-brand) 22%, transparent)",
                  color: "var(--c-text-1)",
                }}
              >
                <div className="font-bold mb-1">메일이 오지 않았다면?</div>
                <ul className="list-disc list-inside space-y-0.5 text-ink-600">
                  <li>스팸함 / 프로모션 함을 확인해 주세요</li>
                  <li>이메일 주소를 정확히 입력했는지 확인해 주세요</li>
                  <li>5분이 지나도 안 오면 다시 요청해 주세요</li>
                </ul>
              </div>

              <Link
                to="/login"
                className="block w-full text-center transition"
                style={{
                  background: "var(--c-brand)",
                  color: "#fff",
                  height: 54,
                  lineHeight: "54px",
                  borderRadius: 14,
                  fontSize: 15,
                  fontWeight: 800,
                  letterSpacing: "-0.01em",
                }}
              >
                로그인으로 돌아가기
              </Link>

              <button
                type="button"
                onClick={() => { setSent(false); setErr(""); }}
                className="mt-3 block w-full text-center text-[12.5px] font-semibold text-ink-500 hover:text-ink-900 transition"
              >
                다른 이메일로 다시 요청
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
