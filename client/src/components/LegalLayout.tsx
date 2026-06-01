import { Link } from "react-router-dom";
import BrandLockup from "./BrandLockup";

/**
 * 약관·개인정보처리방침 등 공개 법적 문서용 단독 레이아웃.
 * 로그인 화면과 같은 상단 로고 + 읽기 좋은 한 단 본문 + 하단 상호 링크.
 * 인증 없이 접근 가능해야 하므로(스토어 심사 요건) AppLayout 을 쓰지 않는다.
 */
export default function LegalLayout({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--c-surface)" }}>
      <header className="px-6 pt-8 pb-4 flex items-center justify-between max-w-[760px] mx-auto w-full">
        <Link to="/login" aria-label="로그인으로">
          <BrandLockup height={36} />
        </Link>
        <Link to="/login" className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-900 transition">
          ← 로그인으로
        </Link>
      </header>

      <main className="flex-1 px-6 pb-16">
        <div className="max-w-[760px] mx-auto w-full">
          <h1 className="text-[26px] font-extrabold text-ink-900 tracking-tight leading-tight mt-4">
            {title}
          </h1>
          <p className="text-[12.5px] text-ink-500 mt-2">시행일: {effectiveDate}</p>

          <div className="mt-8 space-y-7 text-[13.5px] leading-[1.7] text-ink-700">
            {children}
          </div>

          <div className="mt-12 pt-6 border-t border-ink-150 flex items-center gap-4 text-[12.5px]">
            <Link to="/privacy" className="text-ink-500 hover:text-ink-900 transition font-semibold">
              개인정보처리방침
            </Link>
            <span className="text-ink-300">·</span>
            <Link to="/terms" className="text-ink-500 hover:text-ink-900 transition font-semibold">
              이용약관
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

/** 문서 내 섹션 — 번호 매긴 제목 + 본문. */
export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[16px] font-extrabold text-ink-900 tracking-tight mb-2">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
