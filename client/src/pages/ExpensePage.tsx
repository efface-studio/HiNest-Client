import { useEffect, useRef, useState } from "react";
import { useRefresh } from "../lib/useRefresh";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import Select, { type SelectOption } from "../components/Select";
import { Skeleton } from "../components/Skeleton";
import Portal from "../components/Portal";
import MonthPicker from "../components/MonthPicker";
import DateTimePicker from "../components/DateTimePicker";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import { useModalDismiss } from "../lib/useModalDismiss";

type Expense = {
  id: string;
  userId: string;
  usedAt: string;
  merchant: string;
  category: string;
  amount: number;
  memo?: string;
  receiptUrl?: string;
  status: string;
  user?: { name: string; team?: string };
};

const CATEGORIES = ["식비", "교통", "업무", "접대", "비품", "기타"];
const CATEGORY_OPTIONS: SelectOption[] = CATEGORIES.map((c) => ({ value: c, label: c }));
const SCOPE_OPTIONS: SelectOption[] = [
  { value: "mine", label: "내 사용내역" },
  { value: "all", label: "전체" },
];

function ymNow() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function todayDT() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExpensePage() {
  const { user } = useAuth();
  const isReviewer = user?.role === "ADMIN" || user?.role === "MANAGER";
  // 새로고침해도 현재 탭 유지.
  const [sp, setSp] = useSearchParams();
  const scope = (sp.get("scope") === "all" ? "all" : "mine") as "mine" | "all";
  const setScope = (s: "mine" | "all") => {
    const next = new URLSearchParams(sp);
    if (s === "mine") next.delete("scope");
    else next.set("scope", s);
    setSp(next, { replace: true });
  };
  const [month, setMonth] = useState(ymNow());
  const [list, setList] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const { refreshing, refresh } = useRefresh(() => load());
  const [open, setOpen] = useState(false);
  const emptyForm = () => ({
    usedAt: todayDT(),
    merchant: "",
    category: "식비",
    amount: 0,
    memo: "",
    receiptUrl: "",
  });
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  // 모달 열 때마다 폼 초기화 — 취소/닫기로 빠져나간 뒤 다시 열면 이전 입력 잔존하던 것 방지.
  useEffect(() => { if (open) setForm(emptyForm()); }, [open]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 모달들: Esc 로 닫기 + 배경 스크롤 잠금.
  // 저장 중엔 실수로 닫히지 않도록 saving 체크.
  useModalDismiss(open && !saving, () => setOpen(false));
  useModalDismiss(preview !== null, () => setPreview(null));

  async function load(aliveRef?: { current: boolean }) {
    const q = new URLSearchParams();
    if (scope === "all") q.set("all", "1");
    q.set("month", month);
    const res = await api<{ expenses: Expense[]; totalAmount: number }>(`/api/expense?${q.toString()}`);
    if (aliveRef && !aliveRef.current) return;
    setList(res.expenses);
    setTotal(res.totalAmount);
    setLoaded(true);
  }


  useEffect(() => {
    const aliveRef = { current: true };
    load(aliveRef);
    return () => { aliveRef.current = false; };
  }, [scope, month]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // base64 로 인코딩하면 원본의 ~33% 오버헤드 → 서버 express.json limit 2MB 에 맞추려면
    // 원본을 1.3MB 이하로 제한. 초과하면 서버가 413 을 내던지고 사용자는 무엇이 틀렸는지 모름.
    if (f.size > 1024 * 1024 * 1.3) {
      alertAsync({
        title: "파일 크기 초과",
        description: "영수증은 1.3MB 이하 이미지만 업로드 가능합니다.\n(고화질 사진은 미리 크기를 줄여 주세요)",
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (!f.type.startsWith("image/")) {
      alertAsync({ title: "파일 형식 오류", description: "영수증은 이미지 파일만 업로드 가능합니다" });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setForm((p) => ({ ...p, receiptUrl: url }));
    };
    reader.readAsDataURL(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.merchant.trim()) {
      await alertAsync({ title: "입력 확인", description: "가맹점 명을 입력해주세요" });
      return;
    }
    if (!form.amount || form.amount <= 0) {
      await alertAsync({ title: "입력 확인", description: "금액을 입력해주세요" });
      return;
    }
    setSaving(true);
    try {
      await api("/api/expense", {
        method: "POST",
        json: {
          ...form,
          usedAt: new Date(form.usedAt).toISOString(),
          amount: Number(form.amount),
        },
      });
      setOpen(false);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err: any) {
      alertAsync({ title: "등록 실패", description: err?.message ?? "사용내역 등록에 실패했어요" });
    } finally {
      setSaving(false);
    }
  }

  async function review(id: string, status: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      await api(`/api/expense/${id}`, { method: "PATCH", json: { status } });
      await load();
    } catch (err: any) {
      alertAsync({ title: "처리 실패", description: err?.message ?? "승인·반려에 실패했어요" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (busyId) return;
    const ok = await confirmAsync({
      title: "사용내역 삭제",
      description: "이 사용내역을 삭제할까요? 되돌릴 수 없어요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setBusyId(id);
    // 낙관적 제거 — total 도 함께 감소.
    const prev = list;
    const prevTotal = total;
    const target = list.find((x) => x.id === id);
    setList((xs) => xs.filter((x) => x.id !== id));
    if (target) setTotal((t) => t - target.amount);
    try {
      await api(`/api/expense/${id}`, { method: "DELETE" });
    } catch (err: any) {
      setList(prev);
      setTotal(prevTotal);
      alertAsync({ title: "삭제 실패", description: err?.message ?? "삭제에 실패했어요" });
    } finally {
      setBusyId(null);
    }
  }

  const summary = list.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + e.amount;
    return acc;
  }, {});

  return (
    <div>
      <PageHeader
        title="법인카드 사용내역"
        description="법인카드 사용건을 등록하고 영수증을 첨부합니다."
        onRefresh={refresh}
        refreshing={refreshing}
        right={
          <div className="flex gap-2 items-center flex-wrap">
            <MonthPicker value={month} onChange={setMonth} />
            {isReviewer && (
              // w-auto: .input { width:100% } 기본값 때문에 flex-wrap 컨테이너 안에서
              // select 가 100% 를 차지하며 홀로 줄을 먹어 MonthPicker/버튼이 세로로 쌓이던 문제.
              <Select className="input w-auto" value={scope} onChange={(v) => setScope(v as "mine" | "all")} options={SCOPE_OPTIONS} ariaLabel="범위" />
            )}
            <button className="btn-primary" onClick={() => setOpen(true)}>
              + 사용내역 등록
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* 월 합계: 브랜드 컬러 강조 카드 */}
        <div
          className="panel p-5 text-white relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, var(--c-brand) 0%, var(--c-brand-hover) 100%)",
            borderColor: "transparent",
          }}
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] opacity-90">
            {month} 합계
          </div>
          <div className="text-[24px] font-extrabold mt-2 tabular" style={{ letterSpacing: "-0.02em" }}>
            {total.toLocaleString()}<span className="text-[15px] font-bold opacity-90 ml-0.5">원</span>
          </div>
          <div className="text-[11.5px] opacity-90 mt-1">
            {list.length > 0 ? `총 ${list.length}건 사용` : "사용 내역 없음"}
          </div>
        </div>
        {CATEGORIES.slice(0, 3).map((c) => {
          const amount = summary[c] ?? 0;
          return (
            <div key={c} className="panel p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-500">{c}</div>
              <div className="text-[20px] font-extrabold text-ink-900 mt-2 tabular" style={{ letterSpacing: "-0.02em" }}>
                {amount.toLocaleString()}<span className="text-[13px] font-bold text-ink-500 ml-0.5">원</span>
              </div>
              <div className="text-[11.5px] text-ink-500 mt-1">
                {amount > 0 ? "이번 달 집계" : "내역 없음"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card p-0 overflow-hidden overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="pro-cards w-full text-sm min-w-[720px]">
          <thead className="bg-[color:var(--c-surface-2)] text-[color:var(--c-text-3)] text-xs">
            <tr>
              <th className="text-left px-4 py-3">사용일시</th>
              {scope === "all" && <th className="text-left px-4 py-3">사용자</th>}
              <th className="text-left px-4 py-3">사용처</th>
              <th className="text-left px-4 py-3">분류</th>
              <th className="text-right px-4 py-3">금액</th>
              <th className="text-left px-4 py-3">메모</th>
              <th className="text-center px-4 py-3">영수증</th>
              <th className="text-center px-4 py-3">상태</th>
              <th className="text-right px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {!loaded && list.length === 0
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-[color:var(--c-border)]">
                    <td className="px-4 py-3"><Skeleton w={100} h={12} /></td>
                    {scope === "all" && <td className="px-4 py-3"><Skeleton w={56} h={12} /></td>}
                    <td className="px-4 py-3"><Skeleton w="70%" h={12} /></td>
                    <td className="px-4 py-3"><Skeleton w={44} h={18} radius={999} /></td>
                    <td className="px-4 py-3 text-right"><Skeleton w={72} h={12} /></td>
                    <td className="px-4 py-3"><Skeleton w="60%" h={12} /></td>
                    <td className="px-4 py-3 text-center"><Skeleton w={28} h={12} /></td>
                    <td className="px-4 py-3 text-center"><Skeleton w={36} h={18} radius={999} /></td>
                    <td className="px-4 py-3" />
                  </tr>
                ))
              : list.length === 0 && (
                  <tr>
                    <td colSpan={9} className="cell-full px-4 py-10 text-center text-ink-400">
                      등록된 사용내역이 없습니다.
                    </td>
                  </tr>
                )}
            {list.map((e) => (
              <tr key={e.id} className="border-t border-[color:var(--c-border)] hover:bg-[color:var(--c-surface-2)]">
                <td data-label="사용일시" className="px-4 py-3">
                  {new Date(e.usedAt).toLocaleString("ko-KR", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                {scope === "all" && <td data-label="사용자" className="px-4 py-3">{e.user?.name}</td>}
                <td className="cell-primary px-4 py-3 font-medium">{e.merchant}</td>
                <td data-label="분류" className="px-4 py-3">
                  <span className="chip chip-gray">{e.category}</span>
                </td>
                <td data-label="금액" className="px-4 py-3 text-right font-semibold">{e.amount.toLocaleString()}원</td>
                <td data-label="메모" className="px-4 py-3 text-ink-500">
                  <span className="block truncate max-w-[160px] md:max-w-[200px]">{e.memo || "-"}</span>
                </td>
                <td data-label="영수증" className="px-4 py-3 text-center">
                  {e.receiptUrl ? (
                    <button className="text-brand-600 text-xs underline" onClick={() => setPreview(e.receiptUrl!)}>
                      보기
                    </button>
                  ) : (
                    <span className="text-ink-300 text-xs">-</span>
                  )}
                </td>
                <td data-label="상태" className="px-4 py-3 text-center">
                  <StatusChip status={e.status} />
                </td>
                <td
                  className={`px-4 py-3 text-right ${
                    (isReviewer && e.status === "PENDING" && scope === "all") || (e.userId === user?.id && e.status === "PENDING")
                      ? "cell-actions"
                      : "cell-hide-m"
                  }`}
                >
                  {isReviewer && e.status === "PENDING" && scope === "all" && (
                    <div className="inline-flex gap-1">
                      <button
                        className="text-xs px-2 py-1 rounded-lg bg-brand-400 text-white disabled:opacity-60"
                        onClick={() => review(e.id, "APPROVED")}
                        disabled={busyId === e.id}
                      >
                        {busyId === e.id ? "…" : "승인"}
                      </button>
                      <button
                        className="text-xs px-2 py-1 rounded-lg bg-rose-500 text-white disabled:opacity-60"
                        onClick={() => review(e.id, "REJECTED")}
                        disabled={busyId === e.id}
                      >
                        반려
                      </button>
                    </div>
                  )}
                  {e.userId === user?.id && e.status === "PENDING" && (
                    <button
                      className="text-xs text-rose-500 ml-2 disabled:opacity-60"
                      onClick={() => remove(e.id)}
                      disabled={busyId === e.id}
                    >
                      {busyId === e.id ? "삭제 중…" : "삭제"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <Portal>
        <div className="fixed inset-0 bg-slate-900/40 grid place-items-center modal-safe z-50" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">법인카드 사용내역 등록</h3>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">사용일시</label>
                  <DateTimePicker value={form.usedAt} onChange={(v) => setForm({ ...form, usedAt: v })} />
                </div>
                <div>
                  <label className="label">금액 (원)</label>
                  <input type="number" className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} required min={0} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">사용처</label>
                  <input
                    className="input"
                    value={form.merchant}
                    onChange={(e) => setForm({ ...form, merchant: e.target.value })}
                    required
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="label">분류</label>
                  <Select className="input" value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORY_OPTIONS} ariaLabel="분류" />
                </div>
              </div>
              <div>
                <label className="label">메모</label>
                <textarea
                  className="input"
                  rows={2}
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  maxLength={2_000}
                />
              </div>
              <div>
                <label className="label">영수증 (이미지, 1.3MB 이하)</label>
                <input ref={fileRef} type="file" accept="image/*" onChange={onFile} className="hidden" />
                {form.receiptUrl ? (
                  <div className="relative inline-flex mt-1">
                    <img
                      src={form.receiptUrl}
                      alt="receipt"
                      loading="lazy"
                      decoding="async"
                      className="max-h-[50vh] sm:max-h-36 rounded-xl border border-ink-150 shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => { setForm((p) => ({ ...p, receiptUrl: "" })); if (fileRef.current) fileRef.current.value = ""; }}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink-800 text-white text-[10px] font-bold grid place-items-center shadow hover:bg-rose-600 transition"
                      title="영수증 제거"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <label
                    className="mt-1 flex flex-col items-center gap-2 border-2 border-dashed border-ink-200 rounded-xl p-5 cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition group"
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-brand-400", "bg-brand-50/40"); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove("border-brand-400", "bg-brand-50/40"); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove("border-brand-400", "bg-brand-50/40");
                      const f = e.dataTransfer.files?.[0];
                      if (!f) return;
                      const fakeEvt = { target: { files: e.dataTransfer.files } } as unknown as React.ChangeEvent<HTMLInputElement>;
                      onFile(fakeEvt);
                    }}
                  >
                    <div className="w-9 h-9 rounded-xl bg-ink-100 group-hover:bg-brand-100 grid place-items-center transition">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-500 group-hover:text-brand-600">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-5-5L5 21" />
                      </svg>
                    </div>
                    <span className="text-[12px] font-semibold text-ink-600 group-hover:text-brand-700">클릭 또는 이미지를 여기에 끌어다 놓기</span>
                    <span className="text-[11px] text-ink-400">JPG · PNG · GIF · WEBP · 1.3MB 이하</span>
                  </label>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={saving}>
                  취소
                </button>
                <button className="btn-primary" disabled={saving}>{saving ? "등록 중…" : "등록"}</button>
              </div>
            </form>
          </div>
        </div>
        </Portal>
      )}

      {preview && (
        <Portal>
        <div className="fixed inset-0 bg-slate-900/70 grid place-items-center modal-safe z-50" onClick={() => setPreview(null)}>
          <img src={preview} alt="receipt" decoding="async" className="max-h-[90vh] max-w-[90vw] rounded-xl" loading="lazy"/>
        </div>
        </Portal>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-700",
    APPROVED: "bg-brand-100 text-brand-700",
    REJECTED: "bg-rose-100 text-rose-700",
  };
  const label: Record<string, string> = {
    PENDING: "대기",
    APPROVED: "승인",
    REJECTED: "반려",
  };
  return <span className={`chip ${map[status] ?? ""}`}>{label[status] ?? status}</span>;
}
