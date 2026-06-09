import { useEffect, useState } from "react";
import { api , imgSrc} from "../api";
import { confirmAsync, alertAsync } from "./ConfirmHost";
import { fmtSize } from "../lib/fmt";
import Portal from "./Portal";
import { SkeletonList } from "./Skeleton";

/**
 * 문서/회의록 공용 히스토리 모달. API 경로만 prefix 로 갈아끼우면 됨.
 * document → /api/document/:id/revisions, meeting → /api/meeting/:id/revisions.
 */
type Rev = {
  id: string;
  createdAt: string;
  editor?: { id: string; name: string; avatarColor: string; avatarUrl?: string | null };
  // document
  title?: string;
  description?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  // meeting
  content?: any;
};

export default function RevisionHistoryModal({
  kind,
  targetId,
  title,
  onClose,
  onRestored,
}: {
  kind: "document" | "meeting";
  targetId: string;
  title: string;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);
  const base = kind === "document" ? `/api/document/${targetId}` : `/api/meeting/${targetId}`;

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ revisions: Rev[] }>(`${base}/revisions`);
      setRevs(r.revisions);
    } catch {
      setRevs([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [targetId, kind]);

  async function restore(rev: Rev) {
    const ok = await confirmAsync({
      title: "이 버전으로 되돌리기",
      description: "현재 내용은 새 히스토리로 저장된 뒤 교체돼요. 계속할까요?",
    });
    if (!ok) return;
    setRestoring(rev.id);
    try {
      await api(`${base}/revisions/${rev.id}/restore`, { method: "POST" });
      onRestored?.();
      await load();
    } catch (e: any) {
      alertAsync({ title: "복구 실패", description: e?.message ?? "다시 시도해주세요" });
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={onClose}>
      <div className="panel w-full max-w-lg shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="section-head">
          <div className="title">버전 히스토리 · {title}</div>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-5 max-h-[70vh] overflow-auto">
          {loading ? (
            <div className="py-2"><SkeletonList rows={4} /></div>
          ) : revs.length === 0 ? (
            <div className="text-[12px] text-ink-400 py-6 text-center">아직 기록이 없어요. 내용이 변경되면 자동으로 저장됩니다.</div>
          ) : (
            <div className="space-y-2">
              {revs.map((r) => (
                <div key={r.id} className="panel p-3 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full grid place-items-center text-white text-[11px] font-bold flex-shrink-0 overflow-hidden" style={{ background: r.editor?.avatarUrl ? "transparent" : (r.editor?.avatarColor ?? "#6B7280") }}>
                    {r.editor?.avatarUrl ? <img src={imgSrc(r.editor.avatarUrl)} alt={r.editor.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/> : (r.editor?.name[0] ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold text-ink-900">
                      {r.editor?.name ?? "알 수 없음"}
                      <span className="text-ink-400 font-normal tabular ml-1.5">
                        · {new Date(r.createdAt).toLocaleString("ko-KR")}
                      </span>
                    </div>
                    <div className="text-[12px] text-ink-700 mt-0.5 truncate">{r.title ?? "(제목 없음)"}</div>
                    {kind === "document" && r.fileName && (
                      <div className="text-[11px] text-ink-500 tabular mt-0.5">{r.fileName}{typeof r.fileSize === "number" ? ` · ${fmtSize(r.fileSize)}` : ""}</div>
                    )}
                    {kind === "meeting" && r.content && (
                      <div className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">
                        {extractPreview(r.content)}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn-ghost !px-3"
                    disabled={restoring === r.id}
                    onClick={() => restore(r)}
                  >
                    {restoring === r.id ? "..." : "복구"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

// fmtSize: src/lib/fmt.ts 로 이동

function extractPreview(doc: any): string {
  if (!doc) return "";
  const parts: string[] = [];
  function walk(n: any) {
    if (!n || parts.join("").length > 200) return;
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(doc);
  return parts.join(" ").slice(0, 200);
}
