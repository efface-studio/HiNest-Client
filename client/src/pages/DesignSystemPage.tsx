import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Skeleton, SkeletonText, SkeletonCard, SkeletonList, SkeletonStatGrid } from "../components/Skeleton";
import DatePicker from "../components/DatePicker";
import TimePicker from "../components/TimePicker";
import DateTimePicker from "../components/DateTimePicker";
import MonthPicker from "../components/MonthPicker";
import Select from "../components/Select";
import BottomSheet from "../components/BottomSheet";
import BrandLockup from "../components/BrandLockup";
import AdminLockup from "../components/AdminLockup";
import { DevBadge } from "../lib/devBadge";
import { alertAsync, confirmAsync } from "../components/ConfirmHost";
import { PRESENCE_CHOICES } from "../lib/presence";

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
      <AvatarSection />
      <PresenceSection />
      <TypographySection />
      <ButtonsSection />
      <ChipsSection />
      <FormSection />
      <InputsSection />
      <TabsSection />
      <PanelsSection />
      <RadiusShadowSection />
      <BadgesSection />
      <ModalsSection />
      <NativeDialogsSection />
      <BannerSection />
      <EmptyStateSection />
      <MessageBubbleSection />
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
  const [month, setMonth] = useState("");

  return (
    <Section title="입력 / Picker" desc=".input · 커스텀 Select · Date/Time/DateTime/MonthPicker (z-2000 — 모달 위에서도 정상 표시).">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">.input — 텍스트</div>
          <input className="input" placeholder="여기에 입력" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">.input — 숫자 (.tabular)</div>
          <input type="number" className="input tabular" value={num} onChange={(e) => setNum(Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">.input — textarea</div>
          <textarea className="input" rows={2} placeholder="여러 줄" />
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
        <div className="space-y-1.5">
          <div className="text-[11.5px] font-bold text-[color:var(--c-text-muted)]">MonthPicker (YYYY-MM)</div>
          <MonthPicker value={month} onChange={setMonth} />
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

/* ============ Avatar ============ */

// 가입 시 자동 할당되는 10색 팔레트 — previewMock 의 AVATAR_PALETTE 와 동일.
const AVATAR_PALETTE = ["#3D54C4", "#16A34A", "#7C3AED", "#DB2777", "#F59E0B", "#0EA5E9", "#EF4444", "#0891B2", "#84CC16", "#F97316"];
const AVATAR_NAMES = ["김하나", "이앨리스", "한이브", "박그레이스", "최마틴", "강레오", "윤소피아", "임도훈", "조에", "민준"];

function AvatarSection() {
  return (
    <Section title="Avatar" desc="가입 시 자동 할당되는 10색 팔레트. 이니셜 = 이름 마지막 2글자. 사진 있으면 background 대신 img.">
      <div className="space-y-4">
        <div>
          <Label>10색 팔레트 — 클릭해서 hex 복사</Label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_PALETTE.map((c, i) => (
              <CopyChip key={c} value={c} className="flex flex-col items-center gap-1">
                <div className="w-12 h-12 rounded-full grid place-items-center text-white text-[13px] font-bold shadow-sm" style={{ background: c }}>
                  {AVATAR_NAMES[i].slice(-2)}
                </div>
                <span className="text-[10px] text-[color:var(--c-text-muted)] font-mono">{c}</span>
              </CopyChip>
            ))}
          </div>
        </div>
        <div>
          <Label>크기 변형</Label>
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full grid place-items-center text-white text-[9px] font-bold" style={{ background: AVATAR_PALETTE[0] }}>나</div>
            <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold" style={{ background: AVATAR_PALETTE[1] }}>리스</div>
            <div className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-bold" style={{ background: AVATAR_PALETTE[2] }}>이브</div>
            <div className="w-12 h-12 rounded-full grid place-items-center text-white text-[14px] font-bold" style={{ background: AVATAR_PALETTE[3] }}>이스</div>
            <div className="w-16 h-16 rounded-full grid place-items-center text-white text-[18px] font-bold" style={{ background: AVATAR_PALETTE[4] }}>마틴</div>
          </div>
        </div>
        <div>
          <Label>겹친 그룹 (최근 N명)</Label>
          <div className="flex -space-x-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-bold border-2 border-[color:var(--c-surface)]" style={{ background: AVATAR_PALETTE[i] }}>
                {AVATAR_NAMES[i].slice(-2)}
              </div>
            ))}
            <div className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold border-2 border-[color:var(--c-surface)] bg-[color:var(--c-surface-3)] text-[color:var(--c-text-muted)]">+5</div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ============ Presence Status ============ */

const PRESENCE_FALLBACKS: Record<string, { color: string; label: string; emoji: string }> = {
  AVAILABLE: { color: "#22c55e", label: "근무중", emoji: "🟢" },
  OFFLINE:   { color: "#94a3b8", label: "오프라인", emoji: "⚪" },
};

function PresenceSection() {
  const all = [
    ...PRESENCE_CHOICES.filter((c) => c.value),
    { value: "AVAILABLE", label: PRESENCE_FALLBACKS.AVAILABLE.label, emoji: PRESENCE_FALLBACKS.AVAILABLE.emoji },
    { value: "OFFLINE",   label: PRESENCE_FALLBACKS.OFFLINE.label,   emoji: PRESENCE_FALLBACKS.OFFLINE.emoji },
  ];
  return (
    <Section title="Presence Status" desc="사용자 현재 상태 — 6가지. AVAILABLE/OFFLINE 은 출퇴근 기준 자동, 그 외는 수동 설정.">
      <div className="flex gap-2 flex-wrap">
        {all.map((p) => (
          <div key={String(p.value)} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[color:var(--c-surface-2)] border border-[color:var(--c-border)]">
            <span className="text-[14px]">{p.emoji}</span>
            <span className="text-[12px] font-semibold text-[color:var(--c-text)]">{p.label}</span>
            <code className="text-[10.5px] text-[color:var(--c-text-muted)] font-mono">{p.value}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ============ Chips ============ */

function ChipsSection() {
  return (
    <Section title="Chip" desc=".chip / .chip-brand / .chip-green / 색별 변형. 작은 라벨·태그·필터에 사용.">
      <div className="flex gap-2 flex-wrap">
        <span className="chip">기본 chip</span>
        <span className="chip chip-brand">브랜드</span>
        <span className="chip chip-green">초록</span>
        <span className="chip" style={{ background: "rgba(220,38,38,.10)", color: "#B91C1C" }}>위험</span>
        <span className="chip" style={{ background: "rgba(217,119,6,.10)", color: "#B45309" }}>주의</span>
        <span className="chip" style={{ background: "rgba(14,165,233,.10)", color: "#0369A1" }}>정보</span>
        <span className="chip">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          dot 포함
        </span>
        <span className="chip" style={{ paddingRight: 4 }}>
          삭제 가능
          <button type="button" className="ml-1 w-4 h-4 grid place-items-center rounded-full hover:bg-[color:var(--c-surface-3)]" aria-label="제거">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </span>
      </div>
    </Section>
  );
}

/* ============ Form: Switch / Checkbox / Radio ============ */

function FormSection() {
  const [sw1, setSw1] = useState(true);
  const [sw2, setSw2] = useState(false);
  const [chk, setChk] = useState(true);
  const [radio, setRadio] = useState("a");
  return (
    <Section title="Switch / Checkbox / Radio" desc="role='switch' 슬라이드 토글 · accent-brand-500 체크박스 / 라디오 — 기본 OS UI.">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Switch (role='switch')</Label>
          <div className="flex flex-col gap-2">
            <SwitchRow label="알림 켜기" checked={sw1} onChange={setSw1} />
            <SwitchRow label="다크모드" checked={sw2} onChange={setSw2} />
            <SwitchRow label="비활성 (disabled)" checked={false} onChange={() => {}} disabled />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Checkbox</Label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="accent-brand-500 w-5 h-5" checked={chk} onChange={(e) => setChk(e.target.checked)} />
            <span className="text-[13px] text-[color:var(--c-text)]">동의합니다</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer opacity-50">
            <input type="checkbox" className="accent-brand-500 w-5 h-5" checked disabled />
            <span className="text-[13px] text-[color:var(--c-text)]">잠긴 항목 (disabled)</span>
          </label>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Radio</Label>
          <div className="flex gap-4">
            {[
              { v: "a", l: "선택 A" },
              { v: "b", l: "선택 B" },
              { v: "c", l: "선택 C" },
            ].map((o) => (
              <label key={o.v} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="ds-radio" className="accent-brand-500 w-4 h-4" checked={radio === o.v} onChange={() => setRadio(o.v)} />
                <span className="text-[13px] text-[color:var(--c-text)]">{o.l}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

function SwitchRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between gap-3 py-1 disabled:opacity-50 ${disabled ? "cursor-not-allowed" : ""}`}
    >
      <span className="text-[13px] text-[color:var(--c-text)]">{label}</span>
      {/* container 크기는 명시 px 로 강제 — Tailwind w-10 h-6 가 rem 기반이라 14px base
          환경에서 35×21 로 줄어 비례가 깨졌었음. 명시 px 로 OS·테마 무관 일관 비율. */}
      <span
        className="rounded-full transition relative"
        style={{
          width: 40,
          height: 24,
          background: checked ? "var(--c-brand)" : "var(--c-surface-3, #D8DCE3)",
        }}
      >
        {/* knob 18×18, 양쪽 padding 3px — ON(brand×흰 knob 대비) 시 끝에 붙어보이던 거 수정. */}
        <span
          className="absolute rounded-full bg-white shadow-sm transition"
          style={{
            top: 3,
            width: 18,
            height: 18,
            left: checked ? 19 : 3,
          }}
        />
      </span>
    </button>
  );
}

/* ============ Tabs ============ */

const TAB_ITEMS = ["개요", "구성원", "근태", "출근 IP", "사용 시간"];

function TabsSection() {
  const [active, setActive] = useState(0);
  return (
    <Section title="Tabs" desc="가로 스크롤 탭 — 활성 탭 아래에 brand 라인. 모바일에서도 잘리지 않게 overflow-x scroll.">
      <div className="overflow-x-auto -mx-4 px-4">
        <div className="flex gap-1 border-b border-[color:var(--c-border)] min-w-max">
          {TAB_ITEMS.map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setActive(i)}
              className={`px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
                active === i
                  ? "border-brand-500 text-[color:var(--c-brand)]"
                  : "border-transparent text-[color:var(--c-text-muted)] hover:text-[color:var(--c-text)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 text-[12.5px] text-[color:var(--c-text-muted)]">현재 탭: <b className="text-[color:var(--c-text)]">{TAB_ITEMS[active]}</b></div>
    </Section>
  );
}

/* ============ Radius / Shadow ============ */

const RADIUS_SCALE: { label: string; value: string }[] = [
  { label: "xs", value: "6px" },
  { label: "sm", value: "8px" },
  { label: "md", value: "10px" },
  { label: "lg", value: "12px" },
  { label: "xl", value: "14px" },
  { label: "2xl", value: "18px" },
  { label: "sheet", value: "22px" },
  { label: "full", value: "9999px" },
];

const SHADOW_SCALE: { label: string; css: string }[] = [
  { label: "panel", css: "0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.04)" },
  { label: "panel-dark", css: "0 1px 2px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25)" },
  { label: "lg", css: "0 8px 24px rgba(15,18,28,0.10)" },
  { label: "xl", css: "0 16px 40px rgba(15,18,28,0.14)" },
];

function RadiusShadowSection() {
  return (
    <Section title="Radius / Shadow / Spacing" desc="둥글기·그림자·간격 스케일. 컴포넌트 만들 때 이 값들 중에서 선택.">
      <div className="space-y-5">
        <div>
          <Label>Border Radius</Label>
          <div className="flex flex-wrap gap-3">
            {RADIUS_SCALE.map((r) => (
              <CopyChip key={r.label} value={r.value} className="flex flex-col items-center gap-1">
                <div className="w-14 h-14 bg-[color:var(--c-brand-soft)] border border-[color:var(--c-border)]" style={{ borderRadius: r.value }} />
                <div className="text-[11px] font-bold text-[color:var(--c-text)] font-mono">{r.label}</div>
                <div className="text-[10px] text-[color:var(--c-text-muted)] font-mono">{r.value}</div>
              </CopyChip>
            ))}
          </div>
        </div>

        <div>
          <Label>Shadow</Label>
          <div className="flex flex-wrap gap-4">
            {SHADOW_SCALE.map((s) => (
              <CopyChip key={s.label} value={s.css} className="flex flex-col items-center gap-1">
                <div className="w-24 h-16 rounded-xl bg-[color:var(--c-surface)] border border-[color:var(--c-border)]" style={{ boxShadow: s.css }} />
                <div className="text-[11px] font-bold text-[color:var(--c-text)] font-mono">{s.label}</div>
              </CopyChip>
            ))}
          </div>
        </div>

        <div>
          <Label>Spacing 스케일 (4의 배수)</Label>
          <div className="flex items-end gap-2">
            {[4, 8, 12, 16, 20, 24, 32, 40, 48].map((px) => (
              <CopyChip key={px} value={`${px}px`} className="flex flex-col items-center gap-1">
                <div className="bg-[color:var(--c-brand)] rounded" style={{ width: 24, height: px }} />
                <div className="text-[10px] text-[color:var(--c-text-muted)] font-mono">{px}</div>
              </CopyChip>
            ))}
          </div>
        </div>

        <div>
          <Label>Glass 표면 (--c-glass, backdrop-filter blur)</Label>
          <div className="rounded-xl p-4 relative overflow-hidden" style={{ background: "linear-gradient(135deg, var(--c-brand) 0%, #7C3AED 100%)" }}>
            <div className="rounded-xl p-4 backdrop-blur-md text-white text-[13px] font-semibold border" style={{ background: "var(--c-glass)", borderColor: "var(--c-glass-border)" }}>
              유리 효과 카드 — 채팅 입력바·상단바·iOS 알림 등에서 사용
            </div>
          </div>
        </div>

        <div>
          <Label>Gradient (브랜드 그라데이션)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-16 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 grid place-items-center text-white text-[12px] font-bold">brand 500 → 700</div>
            <div className="h-16 rounded-xl bg-gradient-to-br from-brand-400 to-fuchsia-500 grid place-items-center text-white text-[12px] font-bold">brand 400 → fuchsia 500</div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ============ Native Dialogs ============ */

function NativeDialogsSection() {
  return (
    <Section title="네이티브 알럿 / 확인 / 입력" desc="alertAsync · confirmAsync · promptAsync — iOS/iPadOS 에선 진짜 네이티브 시트, 데스크탑/웹은 동일 디자인 모달.">
      <div className="flex gap-2 flex-wrap">
        <button className="btn-primary btn-xs" onClick={() => alertAsync({ title: "알림", description: "디자인 시스템 카탈로그에서 띄운 alertAsync 예시." })}>alertAsync</button>
        <button className="btn-ghost btn-xs" onClick={async () => {
          const ok = await confirmAsync({ title: "확인 필요", description: "정말 진행할까요?", confirmLabel: "진행", tone: "primary" });
          alertAsync({ title: "결과", description: `사용자가 ${ok === true ? "확인" : "취소"} 선택` });
        }}>confirmAsync</button>
        <button className="btn-danger btn-xs" onClick={async () => {
          const ok = await confirmAsync({ title: "삭제", description: "되돌릴 수 없어요.", confirmLabel: "삭제", tone: "danger" });
          alertAsync({ title: "결과", description: `사용자가 ${ok === true ? "삭제" : "취소"} 선택` });
        }}>confirmAsync · danger</button>
      </div>
    </Section>
  );
}

/* ============ Banner ============ */

function BannerSection() {
  return (
    <Section title="Banner" desc="화면 상단에 띄우는 상태 안내. UpdateBanner · ImpersonationBanner · PreviewBanner 패턴.">
      <div className="space-y-2">
        <div className="rounded-xl px-3 py-2 flex items-center gap-2 bg-brand-50 text-brand-700 border border-brand-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          <span className="text-[12.5px] font-semibold">새 버전이 준비됐어요</span>
          <button className="ml-auto text-[11px] font-bold underline">새로고침</button>
        </div>
        <div className="rounded-xl px-3 py-2 flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span className="text-[12.5px] font-semibold">다른 사용자로 보는 중 (impersonation)</span>
          <button className="ml-auto text-[11px] font-bold underline">해제</button>
        </div>
        <div className="rounded-xl px-3 py-2 flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
          <span className="text-[12.5px] font-semibold">저장됐어요</span>
        </div>
        <div className="rounded-xl px-3 py-2 flex items-center gap-2 bg-rose-50 text-rose-700 border border-rose-200">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
          <span className="text-[12.5px] font-semibold">네트워크가 끊겼어요</span>
        </div>
      </div>
    </Section>
  );
}

/* ============ Empty State ============ */

function EmptyStateSection() {
  return (
    <Section title="Empty State" desc="데이터 0건 — 아이콘 + 안내 + (선택) 액션 버튼. loaded 플래그로 로딩 vs 0건 구분.">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="panel p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[color:var(--c-surface-2)] grid place-items-center mx-auto mb-3 text-[color:var(--c-text-muted)]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
          </div>
          <div className="text-[13.5px] font-bold text-[color:var(--c-text)]">아직 문서가 없어요</div>
          <div className="text-[12px] text-[color:var(--c-text-muted)] mt-1">첫 문서를 등록해 보세요</div>
          <button className="btn-primary btn-xs mt-3">+ 문서 등록</button>
        </div>
        <div className="panel p-8 text-center">
          <div className="text-[28px] mb-2">📭</div>
          <div className="text-[13.5px] font-bold text-[color:var(--c-text)]">알림이 없어요</div>
          <div className="text-[12px] text-[color:var(--c-text-muted)] mt-1">모든 알림을 다 확인했어요</div>
        </div>
      </div>
    </Section>
  );
}

/* ============ Message Bubble (Chat) ============ */

function MessageBubbleSection() {
  return (
    <Section title="Message Bubble (채팅)" desc="발신자: 우측 brand. 수신자: 좌측 surface. 메타(시각·읽음)는 버블 옆 세로 스택.">
      <div className="space-y-2 max-w-md">
        <div className="flex justify-start items-end gap-2">
          <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: AVATAR_PALETTE[1] }}>리스</div>
          <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-[color:var(--c-chat-bubble-other)] text-[13px] text-[color:var(--c-text)] max-w-[70%]">
            안녕하세요! 디자인 시스템 보고 있어요 :)
          </div>
          <span className="text-[10px] text-[color:var(--c-text-muted)] mb-0.5">오전 10:24</span>
        </div>
        <div className="flex justify-end items-end gap-2">
          <div className="flex flex-col items-end mb-0.5">
            <span className="text-[10px] font-bold text-brand-500">1</span>
            <span className="text-[10px] text-[color:var(--c-text-muted)]">오전 10:25</span>
          </div>
          <div className="px-3 py-2 rounded-2xl rounded-br-md bg-brand-500 text-white text-[13px] max-w-[70%]">
            네 좋아요! 카탈로그 잘 정리됐네요.
          </div>
        </div>
        <div className="flex justify-start items-end gap-2">
          <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0" style={{ background: AVATAR_PALETTE[1] }}>리스</div>
          <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-[color:var(--c-chat-bubble-other)] text-[13px] text-[color:var(--c-text)] max-w-[70%] italic text-[color:var(--c-text-muted)]">
            (삭제된 메시지)
          </div>
        </div>
      </div>
    </Section>
  );
}
