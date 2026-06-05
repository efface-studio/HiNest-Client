import { useEffect, useState } from "react";
import { api } from "../api";
import { alertAsync } from "./ConfirmHost";
import DateTimePicker from "./DateTimePicker";
import Portal from "./Portal";

/**
 * 외부 공유 링크 관리 모달.
 * - documentId 를 주면 문서 1건 파일 공유 (/api/share-links)
 * - folderId 를 주면 폴더 ZIP 공유 (/api/folder-share-links)
 */
type ShareLink = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloads: number;
  hasPassword: boolean;
  revokedAt: string | null;
};

type Props =
  | { documentId: string; folderId?: never; documentTitle: string; onClose: () => void }
  | { folderId: string; documentId?: never; documentTitle: string; onClose: () => void };

export default function ShareLinkModal({ documentId, folderId, documentTitle, onClose }: Props) {
  const isFolder = !!folderId;
  const apiBase = isFolder ? "/api/folder-share-links" : "/api/share-links";
  const entityParam = isFolder ? `folderId=${encodeURIComponent(folderId!)}` : `documentId=${encodeURIComponent(documentId!)}`;

  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ expiresAt: string; maxDownloads: string; password: string }>({
    expiresAt: "",
    maxDownloads: "",
    password: "",
  });

  async function load() {
    setLoading(true);
    try {
      const r = await api<{ links: ShareLink[] }>(`${apiBase}?${entityParam}`);
      setLinks(r.links);
    } catch {
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [documentId, folderId]);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const payload: any = isFolder ? { folderId } : { documentId };
      if (form.expiresAt) payload.expiresAt = new Date(form.expiresAt).toISOString();
      if (form.maxDownloads) payload.maxDownloads = Math.max(1, parseInt(form.maxDownloads, 10));
      if (form.password) payload.password = form.password;
      await api(apiBase, { method: "POST", json: payload });
      setForm({ expiresAt: "", maxDownloads: "", password: "" });
      await load();
    } catch (e: any) {
      alertAsync({ title: "생성 실패", description: e?.message ?? "다시 시도해주세요" });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api(`${apiBase}/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      alertAsync({ title: "해지 실패", description: e?.message ?? "다시 시도해주세요" });
    }
  }

  function linkUrl(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(linkUrl(token));
      alertAsync({ title: "복사됨", description: "링크가 클립보드에 복사됐어요." });
    } catch {
      window.prompt("링크를 복사하세요", linkUrl(token));
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-ink-900/40 grid place-items-center modal-safe z-50" onClick={onClose}>
      <div className="panel w-full max-w-lg shadow-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="공유 링크 관리">
        <div className="section-head">
          <div className="title">
            {isFolder ? "📁 폴더 공유 링크" : "외부 공유 링크"} · {documentTitle}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[72vh] overflow-auto">
          {isFolder && (
            <div className="text-[12px] text-ink-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              폴더 내 파일 전체를 ZIP으로 묶어 공유합니다. 로그인 없이 다운로드 가능해요.
            </div>
          )}

          <div className="panel p-3 bg-ink-25 space-y-2">
            <div className="text-[12px] font-bold text-ink-700">새 링크 만들기</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-500">만료 (선택)</span>
                <DateTimePicker
                  mode="datetime"
                  value={form.expiresAt}
                  onChange={(v) => setForm({ ...form, expiresAt: v })}
                  placeholder="만료일 없음"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-ink-500">다운로드 횟수 제한 (선택)</span>
                <input type="number" className="input tabular" value={form.maxDownloads} min={1}
                  onChange={(e) => setForm({ ...form, maxDownloads: e.target.value })} placeholder="무제한" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold text-ink-500">비밀번호 (선택)</span>
              <input type="password" className="input" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="빈 칸이면 미사용" />
            </label>
            <div className="flex justify-end">
              <button className="btn-primary" disabled={creating} onClick={create}>
                {creating ? "만드는 중…" : "공유 링크 만들기"}
              </button>
            </div>
          </div>

          <div>
            <div className="text-[12px] font-bold text-ink-700 mb-2">발급된 링크</div>
            {loading ? (
              <div className="text-[12px] text-ink-400 py-6 text-center">불러오는 중…</div>
            ) : links.length === 0 ? (
              <div className="text-[12px] text-ink-400 py-6 text-center">아직 없어요.</div>
            ) : (
              <div className="space-y-2">
                {links.map((l) => {
                  const expired = l.expiresAt && new Date(l.expiresAt).getTime() < Date.now();
                  const capped = l.maxDownloads !== null && l.downloads >= l.maxDownloads;
                  const dead = !!l.revokedAt || expired || capped;
                  return (
                    <div key={l.id} className={`panel p-3 ${dead ? "opacity-60" : ""}`}>
                      <div className="flex items-start gap-2">
                        <input
                          className="input text-[11px] tabular flex-1"
                          readOnly
                          value={linkUrl(l.token)}
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                        />
                        <button className="btn-ghost !px-2" onClick={() => copyLink(l.token)} title="복사">복사</button>
                        {!l.revokedAt && (
                          <button className="btn-ghost !px-2 text-danger" onClick={() => revoke(l.id)} title="해지">해지</button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1.5 text-[11px] text-ink-500 tabular">
                        <span>다운로드 {l.downloads}{l.maxDownloads !== null ? `/${l.maxDownloads}` : ""}</span>
                        {l.expiresAt && <span>· 만료 {new Date(l.expiresAt).toLocaleString("ko-KR")}</span>}
                        {l.hasPassword && <span>· 비밀번호 보호</span>}
                        {l.revokedAt && <span className="text-danger">· 해지됨</span>}
                        {!l.revokedAt && expired && <span className="text-danger">· 만료</span>}
                        {!l.revokedAt && !expired && capped && <span className="text-danger">· 한도 초과</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </Portal>
  );
}
