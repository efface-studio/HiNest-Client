import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiUrl } from "../api";
import { fmtSize } from "../lib/fmt";
import { downloadBlob } from "../lib/download";

/**
 * 외부 공유 링크 수신 페이지 — 로그인 없이 접근. 토큰을 URL 세그먼트로 받아
 * 메타를 먼저 조회하고, 비밀번호가 걸려 있으면 입력 받은 뒤 다운로드를 트리거.
 */
type Meta = {
  // 비밀번호 보호 링크는 인증 전에 document 가 null — 제목·파일명 노출 차단.
  document: { title: string; fileName: string | null; fileType: string | null; fileSize: number | null } | null;
  kind?: "document" | "folder";
  expiresAt: string | null;
  maxDownloads: number | null;
  downloads: number;
  hasPassword: boolean;
};

export default function PublicSharePage() {
  const { token = "" } = useParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(apiUrl(`/api/public-share/${encodeURIComponent(token)}`))
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          const j = await r.json().catch(() => ({ error: `오류 (${r.status})` }));
          setError(j.error ?? `오류 (${r.status})`);
          return;
        }
        setMeta(await r.json());
      })
      .catch(() => alive && setError("서버에 연결할 수 없어요"));
    return () => { alive = false; };
  }, [token]);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/public-share/${encodeURIComponent(token)}/download`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `오류 (${res.status})` }));
        setError(j.error ?? `오류 (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const defaultName = meta?.kind === "folder"
        ? `${meta.document?.title ?? "folder"}.zip`
        : (meta?.document?.fileName ?? meta?.document?.title ?? "download");
      downloadBlob(blob, defaultName);
      // 다운로드 카운트가 올라갔을 테니 메타 새로 가져옴.
      const r2 = await fetch(apiUrl(`/api/public-share/${encodeURIComponent(token)}`));
      if (r2.ok) setMeta(await r2.json());
    } catch (e: any) {
      setError(e?.message ?? "다운로드에 실패했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-25 grid place-items-center p-6">
      <div className="panel w-full max-w-md p-6 shadow-pop">
        <div className="text-[11px] font-extrabold text-ink-500 uppercase tracking-[0.08em]">외부 공유 링크</div>
        {!meta && !error && <div className="text-[12px] text-ink-400 mt-3">불러오는 중…</div>}
        {error && (
          <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-[13px] text-rose-700">{error}</div>
        )}
        {meta && (
          <>
            <div className="flex items-center gap-2 mt-1 mb-1">
              {meta.kind === "folder" ? (
                <span className="text-2xl">📁</span>
              ) : (
                <span className="text-2xl">📄</span>
              )}
              <div className="text-lg font-bold text-ink-900 min-w-0 break-words">
                {meta.document?.title ?? (meta.hasPassword ? "🔒 비밀번호로 보호된 파일" : "파일")}
              </div>
            </div>
            {meta.document && (
              <div className="text-[12px] text-ink-500 tabular">
                {meta.kind === "folder" ? "폴더 전체 (ZIP)" : (meta.document.fileName ?? "파일")}
                {typeof meta.document.fileSize === "number" ? ` · ${fmtSize(meta.document.fileSize)}` : ""}
              </div>
            )}
            <div className="text-[11px] text-ink-500 tabular mt-2 space-y-0.5">
              <div>다운로드 {meta.downloads}{meta.maxDownloads !== null ? `/${meta.maxDownloads}` : ""}</div>
              {meta.expiresAt && <div>만료 {new Date(meta.expiresAt).toLocaleString("ko-KR")}</div>}
            </div>
            {meta.hasPassword && (
              <label className="flex flex-col gap-1 mt-4">
                <span className="text-[11px] font-bold text-ink-500">비밀번호</span>
                <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
            )}
            <button className="btn-primary w-full mt-4" disabled={busy} onClick={download}>
              {busy ? "다운로드 중…" : "다운로드"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// fmtSize: src/lib/fmt.ts 로 이동
