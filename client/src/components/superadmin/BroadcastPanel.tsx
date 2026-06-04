import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { confirmAsync, alertAsync } from "../ConfirmHost";

/**
 * 알림 발송(브로드캐스트) — 전체 / 특정 회사 / 특정 사람에게 제목·설명을 넣어 즉시 알림.
 * 서버: POST /api/platform/broadcast (platformAdmin/개발자 전용). 표준 알림 경로를 타므로
 * 벨·SSE·APNs(폰 푸시)·사용자별 알림설정/DND 가 그대로 적용된다.
 */

type Company = { id: string; name: string; status: string; _count?: { users: number } };
type PickUser = { id: string; name: string; email: string; company?: { name: string } | null };
type Target = "all" | "company" | "user";

const TARGETS: { key: Target; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "company", label: "특정 회사" },
  { key: "user", label: "특정 사람" },
];

export default function BroadcastPanel() {
  const [target, setTarget] = useState<Target>("all");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickUser[]>([]);
  const [picked, setPicked] = useState<PickUser | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  // '특정 회사' 선택 시 회사 목록 로드(ACTIVE 만). 최초 1회.
  useEffect(() => {
    if (target !== "company" || companies.length) return;
    api<{ companies: Company[] }>("/api/platform/companies")
      .then((r) => setCompanies(r.companies.filter((c) => c.status === "ACTIVE")))
      .catch(() => {});
  }, [target, companies.length]);

  // '특정 사람' 검색 — 이름/이메일 부분일치, debounce 250ms.
  const tRef = useRef<number | null>(null);
  useEffect(() => {
    if (target !== "user") return;
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(async () => {
      try {
        const r = await api<{ users: PickUser[] }>(
          `/api/platform/users?q=${encodeURIComponent(q.trim())}`,
        );
        setResults(r.users);
      } catch {}
    }, 250);
    return () => {
      if (tRef.current) window.clearTimeout(tRef.current);
    };
  }, [q, target]);

  const canSend =
    title.trim().length > 0 &&
    !sending &&
    (target === "all" ||
      (target === "company" && !!companyId) ||
      (target === "user" && !!picked));

  function scopeText() {
    if (target === "all") return "전체 사용자";
    if (target === "company")
      return `회사 「${companies.find((c) => c.id === companyId)?.name ?? ""}」`;
    return `「${picked?.name ?? ""}」`;
  }

  async function send() {
    if (!canSend) return;
    const ok = await confirmAsync({
      title: "알림을 보낼까요?",
      description: `${scopeText()} 에게 보냅니다.\n제목: ${title.trim()}\n\n받는 사람의 알림 설정·방해금지(DND) 시간은 그대로 적용됩니다.`,
      tone: target === "all" ? "danger" : "primary",
    });
    if (!ok) return;
    setSending(true);
    try {
      const r = await api<{ count: number }>("/api/platform/broadcast", {
        method: "POST",
        json: {
          target,
          companyId: target === "company" ? companyId : undefined,
          userId: target === "user" ? picked?.id : undefined,
          title: title.trim(),
          body: body.trim() || undefined,
        },
      });
      await alertAsync({
        title: "발송 완료",
        description: `${r.count}명에게 알림을 보냈어요.`,
      });
      setTitle("");
      setBody("");
    } catch (e: any) {
      await alertAsync({ title: "발송 실패", description: e?.message || "알림을 보내지 못했어요." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel p-5 max-w-[640px]">
      <div className="text-[14px] font-extrabold text-ink-900">알림 발송</div>
      <div className="text-[12px] text-ink-500 mt-0.5 mb-4">
        전체 · 특정 회사 · 특정 사람에게 제목과 내용을 넣어 즉시 알림을 보냅니다. 벨·실시간·폰 푸시로 전달돼요.
      </div>

      {/* 대상 선택 */}
      <label className="field-label">받는 대상</label>
      <div className="flex gap-1 p-1 rounded-xl bg-ink-100 mb-3">
        {TARGETS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTarget(t.key)}
            className="flex-1 h-9 rounded-lg text-[13px] font-bold transition"
            style={{
              background: target === t.key ? "var(--c-surface)" : "transparent",
              color: target === t.key ? "var(--c-brand)" : "var(--c-text-3)",
              boxShadow: target === t.key ? "0 1px 3px rgba(20,22,27,0.1)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 특정 회사 */}
      {target === "company" && (
        <div className="mb-3">
          <label className="field-label">회사</label>
          <select className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">회사를 선택하세요</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c._count?.users ?? 0}명)
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 특정 사람 */}
      {target === "user" && (
        <div className="mb-3">
          <label className="field-label">받는 사람</label>
          {picked ? (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-ink-50 border border-ink-150">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-bold text-ink-900 truncate">{picked.name}</div>
                <div className="text-[11px] text-ink-500 truncate">
                  {picked.email}
                  {picked.company?.name ? ` · ${picked.company.name}` : ""}
                </div>
              </div>
              <button className="btn-ghost btn-xs" onClick={() => setPicked(null)}>
                변경
              </button>
            </div>
          ) : (
            <>
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름 또는 이메일 검색"
              />
              {results.length > 0 && (
                <div className="mt-1 border border-ink-150 rounded-lg overflow-auto" style={{ maxHeight: 220 }}>
                  {results.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => {
                        setPicked(u);
                        setResults([]);
                        setQ("");
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-ink-50 border-b border-ink-100 last:border-0"
                    >
                      <div className="text-[13px] font-semibold text-ink-900 truncate">{u.name}</div>
                      <div className="text-[11px] text-ink-500 truncate">
                        {u.email}
                        {u.company?.name ? ` · ${u.company.name}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 제목 · 내용 */}
      <div className="mb-3">
        <label className="field-label">제목</label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="알림 제목"
        />
      </div>
      <div className="mb-4">
        <label className="field-label">내용 (선택)</label>
        <textarea
          className="input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="알림 내용"
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="text-[11.5px] text-ink-500">
          대상: <b className="text-ink-700">{scopeText()}</b>
        </div>
        <button
          className="btn-primary btn-xs ml-auto"
          style={{ opacity: canSend ? 1 : 0.5 }}
          disabled={!canSend}
          onClick={send}
        >
          {sending ? "보내는 중…" : "알림 보내기"}
        </button>
      </div>
    </div>
  );
}
