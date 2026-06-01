import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import { useModalDismiss } from "../lib/useModalDismiss";
import { copyToClipboard } from "../lib/clipboard";
import { highlightCode } from "../lib/syntaxHighlight";
import { LangIcon } from "../lib/langIcon";

/**
 * 스니펫 라이브러리 — 자주 쓰는 명령/쿼리/코드 조각을 저장 + 채팅 입력창의 슬래시
 * 자동완성으로 호출.
 *
 * 정렬: 최근 수정 순. 검색은 trigger / title / body 부분 매치.
 * scope: PRIVATE(나만) / ALL(전사). 수정·삭제는 본인만.
 */

type Snippet = {
  id: string;
  ownerId: string;
  trigger: string;
  title: string;
  body: string;
  lang: string;
  scope: "PRIVATE" | "ALL";
  uses: number;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
};

type FormState = {
  trigger: string;
  title: string;
  body: string;
  lang: string;
  scope: "PRIVATE" | "ALL";
};

const EMPTY_FORM: FormState = { trigger: "", title: "", body: "", lang: "", scope: "PRIVATE" };

export default function SnippetsPage() {
  const { user } = useAuth();
  const [list, setList] = useState<Snippet[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [creating, setCreating] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ snippets: Snippet[] }>(`/api/snippet?q=${encodeURIComponent(q)}`);
      if (!aliveRef.current) return;
      setList(r.snippets);
    } catch {
      // 무음
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }

  // 검색어 디바운스 — 빠르게 타이핑할 때 매 키마다 GET 안 치도록.
  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const mineCount = useMemo(() => list.filter((s) => s.ownerId === user?.id).length, [list, user?.id]);
  const sharedCount = list.length - mineCount;

  return (
    <div>
      <PageHeader
        eyebrow="라이브러리"
        title="스니펫"
        description="자주 쓰는 명령·쿼리·코드 조각을 저장하고 채팅에서 / 로 호출하세요."
        right={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + 새 스니펫
          </button>
        }
      />

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="trigger / 제목 / 본문 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="text-[12px] text-ink-500">
          내 것 <b className="text-ink-800">{mineCount}</b> · 전사 공유 <b className="text-ink-800">{sharedCount}</b>
        </div>
      </div>

      {loading && list.length === 0 ? (
        <div className="panel p-8 text-center text-ink-500 text-[13px]">불러오는 중…</div>
      ) : list.length === 0 ? (
        <div className="panel p-12 text-center text-ink-500">
          <div className="text-[14px] font-semibold">{q ? "검색 결과가 없어요" : "아직 스니펫이 없어요"}</div>
          <div className="text-[12px] mt-1">"+ 새 스니펫" 으로 자주 쓰는 조각을 등록해 보세요.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((s) => (
            <SnippetCard
              key={s.id}
              s={s}
              isMine={s.ownerId === user?.id}
              onEdit={() => setEditing(s)}
              onDelete={async () => {
                const ok = await confirmAsync({
                  title: "스니펫 삭제",
                  description: `"${s.title}" 을 삭제할까요? 되돌릴 수 없어요.`,
                  tone: "danger",
                });
                if (!ok) return;
                try {
                  await api(`/api/snippet/${s.id}`, { method: "DELETE" });
                  if (aliveRef.current) setList((arr) => arr.filter((x) => x.id !== s.id));
                } catch (e: any) {
                  alertAsync({ title: "삭제 실패", description: e?.message ?? "다시 시도해 주세요" });
                }
              }}
            />
          ))}
        </div>
      )}

      {(creating || editing) && (
        <SnippetEditor
          initial={editing ?? EMPTY_FORM}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={(saved) => {
            if (!aliveRef.current) return;
            if (editing) {
              setList((arr) => arr.map((x) => (x.id === saved.id ? saved : x)));
            } else {
              setList((arr) => [saved, ...arr]);
            }
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function SnippetCard({ s, isMine, onEdit, onDelete }: { s: Snippet; isMine: boolean; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = s.body.length > 200 || s.body.split("\n").length > 6;
  const html = highlightCode(s.body, s.lang || undefined);
  return (
    <div className="panel p-4 flex flex-col gap-2.5">
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="font-mono text-[11.5px] font-bold px-2 py-0.5 rounded-md"
              style={{ background: "var(--c-surface-3)", color: "var(--c-text)" }}
            >
              /{s.trigger}
            </span>
            {s.lang && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-500">
                <LangIcon lang={s.lang} size={11} />
                {s.lang}
              </span>
            )}
            {s.scope === "ALL" ? (
              <span className="chip chip-blue">전사</span>
            ) : (
              <span className="chip chip-gray">개인</span>
            )}
            <span className="text-[10.5px] text-ink-400 ml-auto">사용 {s.uses}회</span>
          </div>
          <div className="font-bold text-[14px] text-ink-900 mt-1.5 break-words">{s.title}</div>
        </div>
      </div>
      <div
        className="code-block"
        style={{
          borderRadius: 8,
          background: "#1B1F27",
          border: "1px solid rgba(255,255,255,0.10)",
          overflow: "hidden",
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: expanded ? "60vh" : 140,
            overflowY: "auto",
          }}
        >
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            style={{
              width: "100%",
              padding: "5px 8px",
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.85)",
              background: "transparent",
              border: "none",
              borderTop: "1px solid rgba(255,255,255,0.10)",
              cursor: "pointer",
            }}
          >
            {expanded ? "접기" : "펼치기"}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          className="btn-ghost btn-xs"
          onClick={() =>
            copyToClipboard(s.body, { title: "복사됨", description: "본문을 클립보드에 복사했어요." })
          }
        >
          복사
        </button>
        {isMine && (
          <>
            <button className="btn-ghost btn-xs" onClick={onEdit}>수정</button>
            <button className="btn-ghost btn-xs text-red-600" onClick={onDelete}>삭제</button>
          </>
        )}
        <span className="ml-auto text-[10.5px] text-ink-400">
          {s.owner?.name ?? "—"} · {new Date(s.updatedAt).toLocaleDateString("ko-KR")}
        </span>
      </div>
    </div>
  );
}

function SnippetEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Snippet | FormState;
  onClose: () => void;
  onSaved: (s: Snippet) => void;
}) {
  const isEdit = "id" in initial;
  const [form, setForm] = useState<FormState>({
    trigger: initial.trigger,
    title: initial.title,
    body: initial.body,
    lang: initial.lang,
    scope: initial.scope,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useModalDismiss(true, () => { if (!saving) onClose(); });

  async function save() {
    if (saving) return;
    setSaving(true);
    setErr("");
    try {
      const url = isEdit ? `/api/snippet/${(initial as Snippet).id}` : "/api/snippet";
      const r = await api<{ snippet: Snippet }>(url, {
        method: isEdit ? "PATCH" : "POST",
        json: form,
      });
      onSaved(r.snippet);
    } catch (e: any) {
      setErr(e?.message ?? "저장에 실패했어요");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => { if (!saving) onClose(); }}
    >
      <div
        className="panel p-5 w-full max-w-[640px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-bold mb-3">{isEdit ? "스니펫 수정" : "새 스니펫"}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="field-label">trigger (단축 호출 키)</label>
            <input
              className="input"
              value={form.trigger}
              onChange={(e) => setForm({ ...form, trigger: e.target.value })}
              placeholder="예: tail-log"
              maxLength={40}
              required
            />
            <div className="text-[11px] text-ink-500 mt-1">채팅에서 / + 이 값 으로 자동완성에서 호출</div>
          </div>
          <div>
            <label className="field-label">언어 (선택)</label>
            <input
              className="input"
              value={form.lang}
              onChange={(e) => setForm({ ...form, lang: e.target.value })}
              placeholder="예: bash, sql, swift"
              maxLength={40}
            />
          </div>
        </div>
        <div className="mb-3">
          <label className="field-label">제목</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            maxLength={200}
            required
          />
        </div>
        <div className="mb-3">
          <label className="field-label">본문</label>
          <textarea
            className="input font-mono"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={10}
            maxLength={20_000}
            placeholder="자주 쓰는 명령/쿼리/코드 조각을 입력"
            required
          />
        </div>
        <div className="mb-4">
          <label className="field-label">공개 범위</label>
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn-ghost ${form.scope === "PRIVATE" ? "!bg-brand-50 !text-brand-700" : ""}`}
              onClick={() => setForm({ ...form, scope: "PRIVATE" })}
            >
              개인
            </button>
            <button
              type="button"
              className={`btn-ghost ${form.scope === "ALL" ? "!bg-brand-50 !text-brand-700" : ""}`}
              onClick={() => setForm({ ...form, scope: "ALL" })}
            >
              전사 공유
            </button>
          </div>
        </div>
        {err && <div className="text-[12px] font-semibold text-red-600 mb-2">{err}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
