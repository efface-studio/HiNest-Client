import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Skeleton, SkeletonText, SkeletonCard, SkeletonList, SkeletonStatGrid } from "../components/Skeleton";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";
import DateTimePicker from "../components/DateTimePicker";
import Select from "../components/Select";
import BottomSheet from "../components/BottomSheet";
import BrandLockup from "../components/BrandLockup";
import AdminLockup from "../components/AdminLockup";
import { DevBadge } from "../lib/devBadge";

/**
 * /design-system — HiVits 직원 전용 디자인 시스템 카탈로그.
 * 컬러 토큰·타이포그래피·버튼·입력·패널·뱃지·모달·스켈레톤·아이콘을 한 페이지에서 확인.
 * 회사 가드: user.isDeveloper === true(HiVits 직원) 만 통과, 그 외는 / 로 리다이렉트.
 */
export default function DesignSystemPage() {
  const { user } = useAuth();
  if (!user?.isDeveloper) return <Navigate to="/" replace />;

  return (
    <div className="space-y-10 pb-12">
      <Header />
      <ColorsSection />
      <TypographySection />
      <ButtonsSection />
      <InputsSection />
      <PanelsSection />
      <BadgesSection />
      <ModalsSection />
      <SkeletonsSection />
      <IconsSection />
      <BrandingSection />
    </div>
  );
}

/* ============ 공용 보조 ============ */

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-[18px] font-bold text-[color:var(--c-text)]">{title}</h2>
        {desc && <p className="text-[12.5px] text-[color:var(--c-text-muted)] mt-1">{desc}</p>}
      </div>
      <div className="panel p-4">{children}</div>
    </section>
  );
}

/** 클릭 = 클립보드 복사. 토스트 대신 잠깐 라벨이 "복사됨" 으로 바뀜. */
function CopyChip({ value, children, className = "" }: { value: string; children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1100);
        }).catch(() => {});
      }}
      className={`text-left ${className}`}
      title={`클릭해서 복사: ${value}`}
    >
      {copied ? <span className="text-[10.5px] font-bold text-emerald-500">복사됨</span> : children}
    </button>
  );
}

/* ============ Header ============ */

function Header() {
  return (
    <div className="rounded-2xl p-5 bg-gradient-to-br from-brand-500 to-brand-700 text-white">
      <div className="text-[11px] font-bold uppercase tracking-widest opacity-80">HiNest · Design System</div>
      <h1 className="text-[24px] font-extrabold mt-1">디자인 시스템</h1>
      <p className="text-[13px] opacity-90 mt-2 leading-relaxed">
        HiNest 서비스에 쓰이는 모든 색·타이포·컴포넌트·아이콘·로고 카탈로그.
        값을 클릭하면 클립보드에 복사돼요. 다크/라이트 모드는 사이드바 토글로 전환.
      </p>
    </div>
  );
}

/* ============ Colors ============ */

const COLOR_TOKENS: { group: string; vars: string[] }[] = [
  { group: "배경/표면", vars: ["--c-bg", "--c-surface", "--c-border", "--c-border-strong"] },
  { group: "텍스트", vars: ["--c-text", "--c-text-muted", "--c-text-inverse"] },
  { group: "브랜드", vars: ["--c-brand", "--c-brand-hover", "--c-brand-soft", "--c-brand-soft-fg", "--c-brand-fg"] },
  { group: "상태", vars: ["--c-danger", "--c-success", "--c-warning"] },
  { group: "글래스/채팅", vars: ["--c-glass", "--c-glass-border", "--c-chat-bubble-other"] },
];

function readCssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ColorsSection() {
  // 다크/라이트 토글 시 다시 읽도록 small tick 사용
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const obs = new MutationObserver(() => setTick((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => obs.disconnect();
  }, []);
  void tick;

  return (
    <Section title="컬러 토큰" desc="CSS 변수(--c-*). 다크/라이트 모드에 따라 자동 전환. 클릭해서 복사.">
      <div className="space-y-4">
        {COLOR_TOKENS.map((g) => (
          <div key={g.group}>
            <div className="text-[11px] font-bold text-[color:var(--c-text-muted)] uppercase tracking-wider mb-2">{g.group}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {g.vars.map((v) => {
                const value = readCssVar(v);
                return (
                  <CopyChip key={v} value={`var(${v})`} className="block rounded-xl border border-[color:var(--c-border)] overflow-hidden hover:border-[color:var(--c-border-strong)] transition">
                    <div className="h-14" style={{ background: `var(${v})` }} />
                    <div className="p-2 bg-[color:var(--c-surface)]">
                      <div className="text-[12px] font-bold text-[color:var(--c-text)] font-mono">{v}</div>
                      <div className="text-[10.5px] text-[color:var(--c-text-muted)] font-mono mt-0.5">{value || "—"}</div>
                    </div>
                  </CopyChip>
                );
              })}
            </div>
          </div>
        ))}

        <div>
          <div className="text-[11px] font-bold text-[color:var(--c-text-muted)] uppercase tracking-wider mb-2">팔레트 (Tailwind)</div>
          <PaletteRow name="brand" shades={[50, 100, 200, 300, 400, 500, 600, 700, 800]} />
          <PaletteRow name="ink" shades={[100, 200, 300, 400, 500, 600, 700, 800, 900]} />
          <PaletteRow name="rose" shades={[400, 500, 600]} />
          <PaletteRow name="accent" shades={[400, 500, 600]} />
          <PaletteRow name="amber" shades={[400, 500, 600]} />
        </div>
      </div>
    </Section>
  );
}

function PaletteRow({ name, shades }: { name: string; shades: number[] }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[11.5px] font-bold text-[color:var(--c-text)] mb-1 font-mono">{name}</div>
      <div className="flex gap-1 flex-wrap">
        {shades.map((s) => {
          const cls = `bg-${name}-${s}`;
          return (
            <CopyChip key={s} value={cls} className="w-14">
              <div className={`${cls} h-10 rounded-md border border-[color:var(--c-border)]`} />
              <div className="text-[10px] text-[color:var(--c-text-muted)] font-mono text-center mt-1">{s}</div>
            </CopyChip>
          );
        })}
      </div>
    </div>
  );
}

/* ============ Typography ============ */

const TYPE_SAMPLES = [
  { cls: "text-[24px] font-extrabold", label: "Heading XL · 24/800" },
  { cls: "text-[20px] font-bold", label: "Heading L · 20/700" },
  { cls: "text-[16px] font-bold", label: "Heading M · 16/700" },
  { cls: "text-[14px] font-semibold", label: "Subhead · 14/600" },
  { cls: "text-[13px]", label: "Body · 13/400" },
  { cls: "text-[12.5px] text-[color:var(--c-text-muted)]", label: "Caption muted · 12.5/400" },
  { cls: "text-[11px] font-bold uppercase tracking-wider text-[color:var(--c-text-muted)]", label: "Overline · 11/700 UP" },
];

function TypographySection() {
  return (
    <Section title="타이포그래피" desc="기본 글꼴은 Pretendard. tabular 숫자는 .tabular 클래스.">
      <div className="space-y-3">
        {TYPE_SAMPLES.map((t) => (
          <div key={t.label} className="border-b border-[color:var(--c-border)] pb-2 last:border-0">
            <div className={t.cls + " text-[color:var(--c-text)]"}>다람쥐 헌 쳇바퀴에 타고파</div>
            <div className="text-[10.5px] text-[color:var(--c-text-muted)] font-mono mt-1">{t.label}</div>
          </div>
        ))}
        <div className="pt-1">
          <div className="text-[13px] tabular">0123456789 (.tabular)</div>
          <div className="text-[10.5px] text-[color:var(--c-text-muted)] font-mono">고정폭 숫자 — 시각·금액 등 정렬용</div>
        </div>
      </div>
    </Section>
  );
}

/* ============ Buttons ============ */

function ButtonsSection() {
  return (
    <Section title="버튼" desc="primary / ghost / icon / xs. disabled 패턴 포함.">
      <div className="grid gap-3">
        <Row label=".btn-primary">
          <button className="btn-primary">기본</button>
          <button className="btn-primary btn-xs">+ 작게</button>
          <button className="btn-primary" disabled>비활성</button>
        </Row>
        <Row label=".btn-ghost">
          <button className="btn-ghost">고스트</button>
          <button className="btn-ghost btn-xs">취소</button>
          <button className="btn-ghost" disabled>비활성</button>
        </Row>
        <Row label=".btn-icon">
          <button className="btn-icon" aria-label="설정">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          </button>
          <button className="btn-icon" aria-label="삭제">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /></svg>
          </button>
        </Row>
      </div>
    </Section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <code className="text-[11px] text-[color:var(--c-text-muted)] font-mono min-w-[110px]">{label}</code>
      <div className="flex items-center gap-2 flex-wrap">{children}</div>
    </div>
  );
}

/* ============ Inputs / Pickers ============ */

const SELECT_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "mine", label: "내 것만" },
  { value: "team", label: "팀" },
];

function InputsSection() {
  const [text, setText] = useState("");
  const [num, setNum] = useState(0);
  const [sel, setSel] = useState("all");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [dt, setDt] = useState("");

  return (
    <Section title="입력 / Picker" desc=".input · 커스텀 Select · DatePicker · TimePicker · DateTimePicker (z-2000 — 모달 위에서도 정상 표시).">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">.input — 텍스트</div>
          <input className="input" placeholder="여기에 입력" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">.input — 숫자</div>
          <input type="number" className="input tabular" value={num} onChange={(e) => setNum(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">Select (커스텀)</div>
          <Select className="input" value={sel} onChange={setSel} options={SELECT_OPTIONS} ariaLabel="필터" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">DatePicker</div>
          <DatePicker value={date} onChange={setDate} variant="input" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">TimePicker</div>
          <TimePicker value={time} onChange={setTime} minuteStep={5} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">DateTimePicker</div>
          <DateTimePicker value={dt} onChange={setDt} mode="datetime" />
        </div>
      </div>
    </Section>
  );
}

/* ============ Panels ============ */

function PanelsSection() {
  return (
    <Section title="패널 / 카드" desc=".panel — 기본 박스. 모서리 14px · var(--c-surface) · 1px var(--c-border).">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="text-[12px] font-bold text-[color:var(--c-text-muted)] mb-1">기본 패널</div>
          <div className="text-[14px] text-[color:var(--c-text)]">내용 영역. var(--c-surface) 배경 + 경계.</div>
        </div>
        <div className="panel p-4 ring-1 ring-brand-300">
          <div className="text-[12px] font-bold text-brand-700 mb-1">강조 (ring)</div>
          <div className="text-[14px] text-[color:var(--c-text)]">brand-300 ring 으로 강조한 패턴.</div>
        </div>
      </div>
    </Section>
  );
}

/* ============ Badges ============ */

function BadgesSection() {
  return (
    <Section title="뱃지 / 알약 / Pill" desc="DevBadge · 안읽음 카운트 · presence dot · 상태 pill.">
      <div className="flex items-center gap-4 flex-wrap">
        <DevBadge />
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-[color:var(--c-text-muted)]">안읽음:</span>
          <span className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-brand-500 text-white text-[11px] font-bold flex items-center justify-center">3</span>
          <span className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-brand-500 text-white text-[11px] font-bold flex items-center justify-center">99+</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-[color:var(--c-text-muted)]">접속:</span>
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="온라인" />
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" title="자리비움" />
          <span className="w-2.5 h-2.5 rounded-full bg-ink-300" title="오프라인" />
        </div>
        <div className="flex items-center gap-1.5">
          <PillBadge color="emerald" label="출근" />
          <PillBadge color="amber" label="외근" />
          <PillBadge color="rose" label="결근" />
          <PillBadge color="ink" label="미출근" />
        </div>
      </div>
    </Section>
  );
}

function PillBadge({ color, label }: { color: "emerald" | "amber" | "rose" | "ink" | "brand"; label: string }) {
  const map: Record<string, string> = {
    emerald: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    ink: "bg-ink-100 text-ink-700",
    brand: "bg-brand-100 text-brand-700",
  };
  return <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${map[color]}`}>{label}</span>;
}

/* ============ Modals / Sheet ============ */

function ModalsSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="모달 / 바텀시트" desc="BottomSheet — iOS=네이티브식 시트, 데스크탑=가운데 모달 자동 전환. z-index 1000.">
      <button className="btn-primary" onClick={() => setOpen(true)}>BottomSheet 열기</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="샘플 시트">
        <div className="p-4 space-y-2">
          <div className="text-[14px] font-bold text-[color:var(--c-text)]">디자인 시스템 예시</div>
          <div className="text-[12.5px] text-[color:var(--c-text-muted)]">바텀시트 내부에서도 Picker 가 정상 표시되는지 테스트해 보세요(z-2000).</div>
          <div className="pt-2"><DatePicker value="" onChange={() => {}} variant="input" /></div>
        </div>
      </BottomSheet>
    </Section>
  );
}

/* ============ Skeletons ============ */

function SkeletonsSection() {
  return (
    <Section title="스켈레톤" desc="로딩 동안 시머 wave 로 placeholder 표시. loaded 플래그로 0건 vs 로딩 구분.">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <Label>Skeleton</Label>
          <Skeleton w={160} h={20} />
        </div>
        <div>
          <Label>SkeletonText (lines=3)</Label>
          <SkeletonText lines={3} />
        </div>
        <div>
          <Label>SkeletonCard</Label>
          <SkeletonCard />
        </div>
        <div>
          <Label>SkeletonList (rows=3)</Label>
          <SkeletonList rows={3} />
        </div>
        <div className="md:col-span-2">
          <Label>SkeletonStatGrid (count=4)</Label>
          <SkeletonStatGrid count={4} />
        </div>
      </div>
    </Section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)] mb-2">{children}</div>;
}

/* ============ Icons ============ */

const COMMON_ICONS: { name: string; svg: JSX.Element }[] = [
  { name: "search", svg: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></> },
  { name: "plus", svg: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></> },
  { name: "x", svg: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> },
  { name: "check", svg: <polyline points="20 6 9 17 4 12" /> },
  { name: "chevron-down", svg: <polyline points="6 9 12 15 18 9" /> },
  { name: "chevron-right", svg: <polyline points="9 6 15 12 9 18" /> },
  { name: "bell", svg: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></> },
  { name: "user", svg: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
  { name: "settings", svg: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></> },
  { name: "calendar", svg: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></> },
  { name: "trash", svg: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" /></> },
  { name: "edit", svg: <><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></> },
  { name: "download", svg: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></> },
  { name: "send", svg: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></> },
  { name: "lock", svg: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></> },
  { name: "shield", svg: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
];

function IconsSection() {
  return (
    <Section title="아이콘" desc="Lucide 스타일 stroke=2 inline SVG. 클릭 = name 복사.">
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {COMMON_ICONS.map((i) => (
          <CopyChip key={i.name} value={i.name} className="panel p-3 flex flex-col items-center gap-1 hover:border-brand-300 transition">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[color:var(--c-text)]">
              {i.svg}
            </svg>
            <span className="text-[10.5px] text-[color:var(--c-text-muted)] font-mono">{i.name}</span>
          </CopyChip>
        ))}
      </div>
    </Section>
  );
}

/* ============ Branding (로고/락업) ============ */

function BrandingSection() {
  return (
    <Section title="로고 / 락업" desc="BrandLockup (HiNest 워드마크) · AdminLockup (관리자 마크).">
      <div className="flex items-center gap-6 flex-wrap">
        <div className="space-y-2">
          <Label>BrandLockup</Label>
          <div className="panel p-4 bg-[color:var(--c-bg)]"><BrandLockup /></div>
        </div>
        <div className="space-y-2">
          <Label>AdminLockup</Label>
          <div className="panel p-4 bg-[color:var(--c-bg)]"><AdminLockup /></div>
        </div>
      </div>
    </Section>
  );
}
