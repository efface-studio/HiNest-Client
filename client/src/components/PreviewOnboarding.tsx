import { useEffect, useRef, useState } from "react";
import { isPreviewMode } from "../lib/previewMock";

/**
 * 미리보기 진입 직후 한 번만 노출되는 온보딩 오버레이.
 *  - 4단계 풀스크린 가이드 (블러된 다크 배경 + 브랜드 오라 블롭 + 풍부한 모션)
 *  - 키보드: ←/→ 이동, Enter 다음/시작, ESC 닫기
 *  - sessionStorage 로 dismiss 기억 → 같은 탭 안에서 재안내 X
 *  - 미리보기 모드가 아니면 절대 렌더 안 함
 */

const KEY = "hinest:preview-onboarded";

type Step = {
  emoji: string;
  kicker: string;
  title: string;
  body: string;
  bullets?: string[];
  accent?: string; // 이번 스텝의 메인 컬러 (이모지 글로우 / 진행률에 사용)
};

const STEPS: Step[] = [
  {
    emoji: "👋",
    kicker: "Welcome",
    title: "HiNest 미리보기에 오신 걸 환영해요",
    body: "사내 협업에 필요한 모든 흐름을 한 화면에서 둘러보실 수 있어요. 데이터는 모두 데모이고, 변경 사항은 저장되지 않습니다.",
    accent: "#6366F1",
  },
  {
    emoji: "🧭",
    kicker: "Navigation",
    title: "왼쪽 사이드바로 페이지 이동",
    body: "워크스페이스에는 일정 · 회의록 · 결재 · 근태 · 문서 등 자주 쓰는 메뉴가 모여있어요. 대기 항목이 있으면 옆에 빨간 카운트로 표시됩니다.",
    bullets: [
      "개요 — 출근/오늘 일정/공지 한눈에",
      "회의록 — 노션 스타일 리치 에디터",
      "전자결재 — 출장 · 외근 · 지출 · 구매",
    ],
    accent: "#06B6D4",
  },
  {
    emoji: "💬",
    kicker: "Communication",
    title: "우측 하단 채팅으로 팀과 소통",
    body: "1:1 DM 부터 팀방, 전사 공지방까지 사내톡으로 처리해요. 이모지 반응 · 코드 블록 · 이미지 공유 모두 지원합니다.",
    accent: "#EC4899",
  },
  {
    emoji: "🛡️",
    kicker: "Admin",
    title: "개발자 페이지로 운영도 한 곳에서",
    body: "활동 로그 / 세션 관리 / 에러 대시보드 / 헬스체크 / Feature Flag 등 11개 운영 도구가 통합돼 있어요. ADMIN 권한이라 사이드바 \"관리\" 카테고리에서 진입 가능.",
    accent: "#A78BFA",
  },
];

export default function PreviewOnboarding() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1); // 슬라이드 방향
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPreviewMode()) return;
    let done = false;
    try { done = sessionStorage.getItem(KEY) === "1"; } catch {}
    if (done) return;
    const t = setTimeout(() => setOpen(true), 400);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    try { sessionStorage.setItem(KEY, "1"); } catch {}
    setOpen(false);
  }

  function go(delta: 1 | -1) {
    setDir(delta);
    setStep((n) => Math.max(0, Math.min(STEPS.length - 1, n + delta)));
  }

  // 키보드 단축키
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); dismiss(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (step === STEPS.length - 1) dismiss(); else go(1);
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); if (step > 0) go(-1); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;
  const accent = s.accent || "var(--c-brand)";

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 hinest-onb-overlay overflow-hidden"
      style={{ zIndex: 10000 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-onboarding-title"
    >
      {/* 배경 오라 블롭 — 천천히 떠다니는 컬러 블롭 3개 */}
      <div className="hinest-onb-aura" aria-hidden>
        <span className="hinest-onb-blob blob-1" style={{ background: "radial-gradient(circle, #6366F1 0%, transparent 60%)" }} />
        <span className="hinest-onb-blob blob-2" style={{ background: "radial-gradient(circle, #EC4899 0%, transparent 60%)" }} />
        <span className="hinest-onb-blob blob-3" style={{ background: "radial-gradient(circle, #06B6D4 0%, transparent 60%)" }} />
      </div>

      {/* 미세 그레인 노이즈 (SVG) — AI 룩 탈피용 텍스처 */}
      <div className="hinest-onb-noise" aria-hidden />

      {/* 상단 바 — 브랜드 마크 + 챕터 카운터 + 건너뛰기. 노치/다이내믹아일랜드 회피용 safe-area 패딩. */}
      <div
        className="hinest-onb-topbar absolute top-0 left-0 right-0 flex items-center justify-between px-6 sm:px-8"
        style={{ paddingTop: "max(24px, calc(env(safe-area-inset-top) + 8px))" }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="inline-block rounded-md"
            style={{
              width: 22,
              height: 22,
              background: "linear-gradient(135deg, #6366F1, #A78BFA)",
              boxShadow: "0 0 24px rgba(124,58,237,0.45)",
            }}
          />
          <span className="text-[12.5px] font-bold tracking-wide" style={{ color: "rgba(255,255,255,0.9)" }}>
            HiNest <span style={{ color: "rgba(255,255,255,0.5)" }}>· 둘러보기</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="hidden sm:inline-block text-[11.5px] font-mono tracking-[0.18em] tabular-nums"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="hinest-onb-skip text-[12px] font-semibold transition"
            style={{
              color: "rgba(255,255,255,0.78)",
              padding: "7px 14px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.07)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            건너뛰기 <span style={{ opacity: 0.55, marginLeft: 4, fontSize: 10 }}>ESC</span>
          </button>
        </div>
      </div>

      {/* 본문 — 가운데 정렬, 슬라이드 전환 */}
      <div className="absolute inset-0 flex items-center justify-center px-6">
        <div
          key={step}
          className="w-full max-w-[560px] text-center hinest-onb-card"
          style={{ ["--slide-from" as any]: `${dir * 24}px` }}
        >
          {/* 카테고리 키커 */}
          <div
            className="hinest-onb-kicker text-[11px] font-bold uppercase tracking-[0.24em] mb-5"
            style={{ color: accent }}
          >
            {s.kicker}
          </div>

          {/* 이모지 + 글로우 링 */}
          <div className="hinest-onb-emoji-wrap relative inline-flex items-center justify-center mb-7">
            <span
              className="hinest-onb-ring"
              aria-hidden
              style={{
                background: `radial-gradient(circle, ${accent}aa 0%, ${accent}00 70%)`,
              }}
            />
            <span className="hinest-onb-emoji text-[78px] leading-none relative">{s.emoji}</span>
          </div>

          {/* 제목 */}
          <h2
            id="preview-onboarding-title"
            className="hinest-onb-title text-[30px] sm:text-[36px] font-extrabold tracking-tight leading-[1.15]"
            style={{
              color: "#fff",
              textShadow: "0 4px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            {s.title}
          </h2>

          {/* 본문 */}
          <p
            className="hinest-onb-body mt-5 text-[15px] sm:text-[16.5px] leading-relaxed mx-auto max-w-[500px]"
            style={{
              color: "rgba(255,255,255,0.78)",
              textShadow: "0 1px 12px rgba(0,0,0,0.4)",
            }}
          >
            {s.body}
          </p>

          {/* 불릿 */}
          {s.bullets && (
            <ul className="hinest-onb-bullets mt-6 inline-flex flex-col items-start gap-2.5 text-left mx-auto">
              {s.bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-[14px]"
                  style={{
                    color: "rgba(255,255,255,0.88)",
                    textShadow: "0 1px 10px rgba(0,0,0,0.35)",
                    animationDelay: `${0.5 + i * 0.07}s`,
                  }}
                >
                  <span
                    className="mt-[7px] inline-block rounded-full flex-shrink-0"
                    style={{
                      width: 6,
                      height: 6,
                      background: accent,
                      boxShadow: `0 0 14px ${accent}`,
                    }}
                  />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 하단 — 진행률 바 + 액션 + 키보드 힌트 */}
      <div className="absolute left-0 right-0 bottom-7 sm:bottom-10 flex flex-col items-center gap-5 px-6 hinest-onb-bottom">
        {/* 가는 진행률 라인 */}
        <div className="relative" style={{ width: 220, height: 3 }}>
          <div className="absolute inset-0 rounded-full" style={{ background: "rgba(255,255,255,0.14)" }} />
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${((step + 1) / STEPS.length) * 100}%`,
              background: `linear-gradient(90deg, ${accent}, #fff)`,
              boxShadow: `0 0 16px ${accent}`,
            }}
          />
        </div>

        {/* 액션 */}
        <div className="flex items-center gap-2.5">
          {!isFirst && (
            <button
              type="button"
              onClick={() => go(-1)}
              className="hinest-onb-btn-ghost px-5 py-3 rounded-full text-[13px] font-semibold transition"
              style={{
                color: "rgba(255,255,255,0.88)",
                background: "rgba(255,255,255,0.07)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              ← 이전
            </button>
          )}
          {!isLast ? (
            <button
              type="button"
              className="hinest-onb-btn-primary px-7 py-3 rounded-full text-[13.5px] font-extrabold transition relative overflow-hidden"
              style={{
                background: "#fff",
                color: "#0B0E14",
                boxShadow: `0 10px 40px ${accent}55, 0 4px 16px rgba(0,0,0,0.25)`,
              }}
              onClick={() => go(1)}
            >
              <span className="relative z-10">다음 →</span>
            </button>
          ) : (
            <button
              type="button"
              className="hinest-onb-btn-primary px-7 py-3 rounded-full text-[13.5px] font-extrabold transition relative overflow-hidden"
              style={{
                background: "#fff",
                color: "#0B0E14",
                boxShadow: `0 10px 40px ${accent}55, 0 4px 16px rgba(0,0,0,0.25)`,
              }}
              onClick={dismiss}
            >
              <span className="relative z-10">시작하기</span>
            </button>
          )}
        </div>

        {/* 키보드 힌트 */}
        <div
          className="hinest-onb-kbd flex items-center gap-2 text-[10.5px] font-mono tracking-wide"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          <kbd className="hinest-kbd">←</kbd>
          <kbd className="hinest-kbd">→</kbd>
          <span>이동</span>
          <span className="mx-1.5" style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
          <kbd className="hinest-kbd">Enter</kbd>
          <span>{isLast ? "시작" : "다음"}</span>
        </div>
      </div>

      {/* === 스타일 === */}
      <style>{`
        /* 오버레이 진입 — 페이드 + 블러 */
        .hinest-onb-overlay {
          background: rgba(6, 10, 22, 0);
          backdrop-filter: blur(0px);
          -webkit-backdrop-filter: blur(0px);
          animation: hinest-onb-overlay-in 0.5s ease-out forwards;
        }
        @keyframes hinest-onb-overlay-in {
          to {
            background: rgba(6, 10, 22, 0.68);
            backdrop-filter: blur(22px) saturate(140%);
            -webkit-backdrop-filter: blur(22px) saturate(140%);
          }
        }

        /* 배경 블롭 */
        .hinest-onb-aura {
          position: absolute; inset: 0; pointer-events: none;
          opacity: 0; animation: hinest-onb-fade 1s ease-out 0.1s forwards;
        }
        .hinest-onb-blob {
          position: absolute; border-radius: 999px; filter: blur(60px);
          mix-blend-mode: screen; opacity: 0.55;
        }
        .blob-1 { width: 540px; height: 540px; top: -120px; left: -120px; animation: hinest-onb-float-1 18s ease-in-out infinite; }
        .blob-2 { width: 480px; height: 480px; bottom: -100px; right: -100px; animation: hinest-onb-float-2 22s ease-in-out infinite; }
        .blob-3 { width: 380px; height: 380px; top: 40%; left: 55%; animation: hinest-onb-float-3 26s ease-in-out infinite; }
        @keyframes hinest-onb-float-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(80px, 60px) scale(1.08); }
        }
        @keyframes hinest-onb-float-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-60px, -40px) scale(1.12); }
        }
        @keyframes hinest-onb-float-3 {
          0%, 100% { transform: translate(0, 0) scale(0.95); }
          50%      { transform: translate(-100px, 50px) scale(1.05); }
        }

        /* 노이즈 그레인 */
        .hinest-onb-noise {
          position: absolute; inset: 0; pointer-events: none;
          opacity: 0.04; mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
        }

        /* 상단 바 */
        .hinest-onb-topbar { animation: hinest-onb-fade 0.5s ease-out 0.35s both; }

        /* 콘텐츠 카드 — 슬라이드 + 페이드 + 언블러 */
        .hinest-onb-card {
          animation: hinest-onb-card-in 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
          animation-delay: 0.18s;
          will-change: transform, opacity, filter;
        }
        @keyframes hinest-onb-card-in {
          from { opacity: 0; transform: translateX(var(--slide-from, 0)) translateY(8px); filter: blur(4px); }
          to   { opacity: 1; transform: translateX(0) translateY(0); filter: blur(0); }
        }

        .hinest-onb-kicker {
          animation: hinest-onb-fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both;
        }

        .hinest-onb-emoji-wrap {
          animation: hinest-onb-fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both;
        }
        .hinest-onb-ring {
          position: absolute; width: 220px; height: 220px; border-radius: 999px;
          filter: blur(40px); opacity: 0.7;
          animation: hinest-onb-pulse 4s ease-in-out infinite;
        }
        @keyframes hinest-onb-pulse {
          0%, 100% { transform: scale(0.92); opacity: 0.5; }
          50%      { transform: scale(1.08); opacity: 0.85; }
        }
        .hinest-onb-emoji {
          display: inline-block;
          animation: hinest-onb-emoji-pop 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) 0.35s both,
                     hinest-onb-emoji-bob 5s ease-in-out 1.2s infinite;
          filter: drop-shadow(0 8px 24px rgba(0,0,0,0.4));
        }
        @keyframes hinest-onb-emoji-pop {
          0%   { opacity: 0; transform: scale(0.4) rotate(-12deg); }
          60%  { opacity: 1; transform: scale(1.1) rotate(4deg); }
          100% { opacity: 1; transform: scale(1) rotate(0); }
        }
        @keyframes hinest-onb-emoji-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }

        .hinest-onb-title {
          animation: hinest-onb-fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both;
        }
        .hinest-onb-body {
          animation: hinest-onb-fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both;
        }
        .hinest-onb-bullets > li {
          animation: hinest-onb-fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
          /* animation-delay 은 inline 으로 i 기반 */
        }
        @keyframes hinest-onb-fade-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* 하단 영역 */
        .hinest-onb-bottom { animation: hinest-onb-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.55s both; }

        /* 건너뛰기 / 이전 / 다음 hover */
        .hinest-onb-skip:hover { background: rgba(255,255,255,0.14) !important; color: #fff !important; }
        .hinest-onb-btn-ghost:hover { background: rgba(255,255,255,0.14) !important; transform: translateY(-1px); }
        .hinest-onb-btn-primary { transform: translateZ(0); }
        .hinest-onb-btn-primary:hover { transform: translateY(-1px) scale(1.02); }
        .hinest-onb-btn-primary::before {
          content: ""; position: absolute; inset: 0;
          background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.6) 50%, transparent 70%);
          transform: translateX(-100%); transition: transform 0.6s;
        }
        .hinest-onb-btn-primary:hover::before { transform: translateX(100%); }

        /* 키보드 키 캡 */
        .hinest-kbd {
          display: inline-flex; align-items: center; justify-content: center;
          min-width: 20px; height: 20px; padding: 0 5px;
          border-radius: 5px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.7);
          font-size: 10.5px; line-height: 1;
        }

        @keyframes hinest-onb-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }

        /* 모션 줄이기 */
        @media (prefers-reduced-motion: reduce) {
          .hinest-onb-overlay,
          .hinest-onb-card,
          .hinest-onb-emoji,
          .hinest-onb-emoji-wrap,
          .hinest-onb-ring,
          .hinest-onb-title,
          .hinest-onb-body,
          .hinest-onb-bullets > li,
          .hinest-onb-kicker,
          .hinest-onb-topbar,
          .hinest-onb-bottom,
          .hinest-onb-aura,
          .hinest-onb-blob {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
            filter: none !important;
          }
          .hinest-onb-overlay {
            background: rgba(6, 10, 22, 0.68);
            backdrop-filter: blur(22px) saturate(140%);
            -webkit-backdrop-filter: blur(22px) saturate(140%);
          }
        }
      `}</style>
    </div>
  );
}
