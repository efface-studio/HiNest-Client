import { useRef, useState } from "react";
import { api, apiFetch, imgSrc } from "../api";
import { useAuth } from "../auth";
import { confirmAsync, alertAsync } from "./ConfirmHost";
import { safeAttachmentUrl } from "../lib/safeUrl";
import { isCapacitorNative } from "../lib/platform";
import { openExternal } from "../lib/openExternal";
import { Browser } from "@capacitor/browser";

/**
 * 회의록 본문 아래에 떠있는 첨부 섹션 — 파일(이미지/영상/문서) + 외부 링크 모두 한 곳에서 관리.
 * - 업로드: /api/upload (멀티파트) → 응답 메타로 /api/meeting/:id/attachment POST
 * - 링크: /api/meeting/:id/attachment/link 로 url + name 전송 (업로드 단계 없음)
 * - 삭제: 업로더 본인 / 회의록 작성자 / ADMIN 만 가능 — 서버에서 한 번 더 가드, 클라는 표시용만 토글
 */

export type MeetingAttachmentUploader = {
  id: string;
  name: string;
  avatarColor?: string;
  avatarUrl?: string | null;
};

export type MeetingAttachment = {
  id: string;
  kind: "FILE" | "IMAGE" | "VIDEO" | "LINK";
  url: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt: string;
  uploadedBy: MeetingAttachmentUploader;
};

function fmtBytes(b?: number | null) {
  if (b == null) return "";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function kindIcon(kind: MeetingAttachment["kind"], mimeType?: string | null) {
  if (kind === "LINK") return "🔗";
  if (kind === "IMAGE") return "🖼";
  if (kind === "VIDEO") return "🎞";
  // 세부 MIME 별 작은 변주
  if (mimeType?.startsWith("application/pdf")) return "📕";
  if (mimeType?.includes("zip") || mimeType?.includes("compressed")) return "🗜";
  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) return "📊";
  if (mimeType?.includes("presentation") || mimeType?.includes("powerpoint")) return "📽";
  if (mimeType?.includes("word") || mimeType?.includes("document")) return "📄";
  return "📎";
}

export default function MeetingAttachments({
  meetingId,
  authorId,
  attachments,
  onChange,
  readOnly,
}: {
  meetingId: string;
  authorId: string;
  attachments: MeetingAttachment[];
  /** 추가/삭제 후 상위에 알려서 meeting 다시 로드하거나 state 갱신. */
  onChange: (next: MeetingAttachment[]) => void;
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === "ADMIN";
  const isAuthor = user?.id === authorId;

  function canDelete(att: MeetingAttachment) {
    return att.uploadedBy.id === user?.id || isAuthor || isAdmin;
  }

  async function handlePickFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const added: MeetingAttachment[] = [];
    try {
      for (const file of Array.from(files)) {
        // 1) /api/upload 로 파일 자체 전송 — 응답에 url/name/type/size/kind
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await apiFetch("/api/upload", { method: "POST", body: fd });
        if (!upRes.ok) {
          const txt = await upRes.text();
          throw new Error(`업로드 실패 (${upRes.status}): ${txt.slice(0, 120)}`);
        }
        const up = (await upRes.json()) as { url: string; name: string; type: string; size: number; kind: "IMAGE" | "VIDEO" | "FILE" };
        // 2) 회의록 첨부 메타 저장
        const r = await api<{ attachment: MeetingAttachment }>(`/api/meeting/${meetingId}/attachment`, {
          method: "POST",
          json: {
            kind: up.kind,
            url: up.url,
            name: up.name,
            mimeType: up.type,
            sizeBytes: up.size,
          },
        });
        added.push(r.attachment);
      }
      onChange([...attachments, ...added]);
    } catch (e: any) {
      alertAsync({ title: "첨부 실패", description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const url = linkUrl.trim();
    const name = linkName.trim() || url;
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      alertAsync({ title: "URL 형식 오류", description: "http:// 또는 https:// 로 시작해야 해요." });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ attachment: MeetingAttachment }>(`/api/meeting/${meetingId}/attachment/link`, {
        method: "POST",
        json: { url, name },
      });
      onChange([...attachments, r.attachment]);
      setLinkUrl("");
      setLinkName("");
      setLinkOpen(false);
    } catch (e: any) {
      alertAsync({ title: "링크 추가 실패", description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(att: MeetingAttachment) {
    const ok = await confirmAsync({
      title: "첨부 삭제",
      description: `"${att.name}" 을(를) 삭제할까요? 되돌릴 수 없어요.`,
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/meeting/${meetingId}/attachment/${att.id}`, { method: "DELETE" });
      onChange(attachments.filter((a) => a.id !== att.id));
    } catch (e: any) {
      alertAsync({ title: "삭제 실패", description: e?.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 panel p-0 overflow-hidden">
      <div className="section-head">
        <div className="title flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
          첨부 <span className="text-ink-400 font-medium tabular ml-0.5">{attachments.length}</span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-xs inline-flex items-center gap-1.5"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              title="컴퓨터에서 파일 선택"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              파일
            </button>
            <button
              type="button"
              className="btn-ghost btn-xs inline-flex items-center gap-1.5"
              disabled={busy}
              onClick={() => setLinkOpen((v) => !v)}
              title="외부 URL 추가"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              링크
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => handlePickFiles(e.target.files)}
            />
          </div>
        )}
      </div>

      {/* 링크 입력 폼 — 토글로 펼침 */}
      {linkOpen && !readOnly && (
        <form onSubmit={submitLink} className="px-4 py-3 border-b border-ink-100 bg-ink-25 flex flex-wrap items-center gap-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            required
            maxLength={2000}
            className="input text-[13px] flex-1 min-w-[200px]"
            autoFocus
          />
          <input
            type="text"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            placeholder="표시 이름 (선택)"
            maxLength={200}
            className="input text-[13px] flex-1 min-w-[160px]"
          />
          <button type="submit" disabled={busy || !linkUrl.trim()} className="btn-primary btn-xs">
            {busy ? "추가 중…" : "추가"}
          </button>
          <button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); setLinkName(""); }} className="btn-ghost btn-xs">
            취소
          </button>
        </form>
      )}

      {attachments.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12px] text-ink-400">
          {readOnly ? "첨부된 자료가 없어요." : "위 \"파일\" 또는 \"링크\" 버튼으로 자료를 추가해보세요."}
        </div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {attachments.map((att) => {
            const isLink = att.kind === "LINK";
            const display = isLink ? att.name : att.name;
            // 과거 데이터/혹시 모를 새 입력에 대비해 한 번 더 검증.
            // 검증 실패 시 링크 없이 텍스트만 렌더(클릭 불가).
            const safeHref = safeAttachmentUrl(att.url, att.kind);
            return (
              <li key={att.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-ink-25 transition group">
                <span className="text-[18px] flex-shrink-0 grid place-items-center w-8 h-8 rounded-md" style={{ background: "var(--c-surface-3)" }}>
                  {kindIcon(att.kind, att.mimeType)}
                </span>
                <div className="flex-1 min-w-0">
                  {safeHref ? (
                    <a
                      href={safeHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      {...(isLink ? {} : { download: att.name })}
                      onClick={(e) => {
                        if (!isCapacitorNative()) return;
                        e.preventDefault();
                        if (isLink) { openExternal(safeHref); return; }
                        const u = imgSrc(safeHref);
                        if (u) void Browser.open({ url: u });
                      }}
                      className="text-[13px] font-semibold text-ink-900 hover:text-brand-600 truncate block"
                      title={isLink ? safeHref : att.name}
                    >
                      {display}
                    </a>
                  ) : (
                    <span
                      className="text-[13px] font-semibold text-ink-400 truncate block"
                      title="유효하지 않은 첨부 URL"
                    >
                      {display}
                    </span>
                  )}
                  <div className="text-[11px] text-ink-500 truncate">
                    {isLink ? (
                      <span className="text-ink-500" title={att.url}>{att.url}</span>
                    ) : (
                      <>
                        {fmtBytes(att.sizeBytes)}
                        {att.mimeType && <> · {att.mimeType}</>}
                      </>
                    )}
                    <> · {att.uploadedBy.name} · {new Date(att.createdAt).toLocaleDateString("ko-KR")}</>
                  </div>
                </div>
                {!readOnly && canDelete(att) && (
                  <button
                    type="button"
                    onClick={() => remove(att)}
                    disabled={busy}
                    className="btn-icon opacity-0 group-hover:opacity-100 transition flex-shrink-0"
                    title="삭제"
                    aria-label={`${att.name} 삭제`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
