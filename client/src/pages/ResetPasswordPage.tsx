import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import BrandLockup from "../components/BrandLockup";
import SoftInput from "../components/SoftInput";

/**
 * 비밀번호 재설정 — 메일 링크의 token 으로 새 비밀번호 설정.
 * 성공 시 잠금도 자동 해제 + 기존 모든 세션 강제 로그아웃되어 안전.
 */
export default function ResetPasswordPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") ?? "";

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  if (user) return <Navigate to="/" replace />;

  // 토큰이 아예 없으면 잘못된 진입 — 안내만 보여주고 끝.
  if (!token) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
        {/* iOS 노치 회피 — env(safe-area-inset-top) 가산 (LoginPage 와 동일). */}
        <header className="px-6 pb-4 flex items-center" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}>
          <BrandLockup height={36} />
        </header>
        <main className="flex-1 flex items-center justify-center px-6 pb-12">
          <div className="w-full max-w-[400px] text-center">
            <div className="text-[48px] mb-4 leading-none">🔗</div>
            <h1 className="text-[22px] font-extrabold text-ink-900 tracking-tight">
              유효하지 않은 링크
            </h1>
            <p className="text-[14px] text-ink-500 mt-3 leading-relaxed">
              비밀번호 재설정 링크가 비어있어요. 메일에 포함된 링크를 통째로 클릭해 주세요.
            </p>
            <Link
              to="/forgot-password"
              className="inline-block mt-7 px-6 py-3 rounded-xl font-bold text-[14px] transition"
              style={{ background: "var(--c-brand)", color: "#fff" }}
            >
              재설정 메일 다시 요청
            </Link>
          </div>
        </main>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (pw1.length < 8) { setErr("비밀번호는 8자 이상이어야 해요."); return; }
    if (pw1 !== pw2)    { setErr("비밀번호 확인이 일치하지 않아요."); return; }
    setLoading(true);
    try {
      await api("/api/auth/password-reset/confirm", {
        method: "POST",
        json: { token, newPassword: pw1 },
      });
      setDone(true);
      // 잠시 보여주고 로그인으로 이동.
      setTimeout(() => nav("/login", { replace: true }), 1800);
    } catch (e: any) {
      setErr(e?.message ?? "재설정에 실패했어요. 링크가 만료됐을 수 있어요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      {/* iOS 노치 회피 — env(safe-area-inset-top) 가산 (LoginPage 와 동일). */}
      <header className="px-6 pb-4 flex items-center" style={{ paddingTop: "calc(env(safe-area-inset-top) + 2rem)" }}>
        <BrandLockup height={36} />
      </header>

      <main className="flex-1 flex items-center justify-center px-6 pb-12">
        <div className="w-full max-w-[400px]">
          {done ? (
            <div className="text-center">
              <div className="text-[48px] mb-4 leading-none">✅</div>
              <h1 className="text-[24px] font-extrabold text-ink-900 tracking-tight">
                새 비밀번호로 변경됐어요
              </h1>
              <p className="text-[14px] text-ink-500 mt-3 leading-relaxed">
                계정 잠금도 자동으로 풀렸어요. 잠시 후 로그인 화면으로 이동합니다…
              </p>
            </div>
          ) : (
            <>
              <div className="mb-9">
                <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight">
                  새 비밀번호 설정
                </h1>
                <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
                  변경 후엔 모든 기기에서 자동으로 로그아웃되어요. 잠긴 계정도 함께 풀려요.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-3">
                <SoftInput
                  type="password"
                  placeholder="새 비밀번호 (8자 이상)"
                  value={pw1}
                  onChange={setPw1}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <SoftInput
                  type="password"
                  placeholder="새 비밀번호 확인"
                  value={pw2}
                  onChange={setPw2}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                />

                {err && (
                  <div className="text-[12.5px] font-semibold leading-snug" style={{ color: "var(--c-danger)", paddingTop: 2 }}>
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !pw1 || !pw2}
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
                  {loading ? "변경 중…" : "비밀번호 변경"}
                </button>
              </form>

              <div className="mt-5 flex items-center justify-center gap-4 text-[12.5px]">
                <Link to="/login" className="text-ink-500 hover:text-ink-900 transition font-semibold">
                  ← 로그인으로 돌아가기
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
