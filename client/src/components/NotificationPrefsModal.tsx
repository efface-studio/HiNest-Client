import { useEffect, useState } from "react";
import { api } from "../api";
import { alertAsync } from "./ConfirmHost";
import Portal from "./Portal";

type Prefs = Record<string, boolean>;
type Loaded = { prefs: Prefs; dndStart: string | null; dndEnd: string | null; emailOn: boolean };

/**
 * 알림 환경설정 모달 — 타입별 on/off, 방해금지(DND) 시간대, 이메일 중계.
 * 저장은 전체 값을 한 번에 PUT — 단순하게.
 */
const TYPES: { key: string; label: string; desc: string }[] = [
  { key: "NOTICE", label: "사내 공지", desc: "전사 공지 등록 시 알림" },
  { key: "DM", label: "개인 메시지", desc: "새 DM / 멘션" },
  { key: "MENTION", label: "회의록·문서 멘션", desc: "@로 나를 태그한 경우" },
  { key: "APPROVAL_REQUEST", label: "결재 요청", desc: "내 결재 차례일 때" },
  { key: "APPROVAL_REVIEW", label: "결재 결과", desc: "내 기안이 승인/반려됐을 때" },
  { key: "SYSTEM", label: "시스템 알림", desc: "공지/이벤트/유지보수" },
];

export default function NotificationPrefsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api<Loaded>("/api/notification/prefs")
      .then((r) => { if (alive) setData(r); })
      .catch(() => { if (alive) setData({ prefs: {}, dndStart: null, dndEnd: null, emailOn: false }); });
    return () => { alive = false; };
  }, [open]);

  if (!open) return null;

  const setType = (key: string, on: boolean) => {
    if (!data) return;
    setData({ ...data, prefs: { ...data.prefs, [key]: on } });
  };

  async function save() {
    if (!data || saving) return;
    setSaving(true);
    try {
      await api("/api/notification/prefs", {
        method: "PUT",
        json: {
          prefs: data.prefs,
          dndStart: data.dndStart || null,
          dndEnd: data.dndEnd || null,
          emailOn: data.emailOn,
        },
      });
      onClose();
    } catch (e: any) {
      alertAsync({ title: "저장 실패", description: e?.message ?? "다시 시도해주세요" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
    <div className="fixed inset-0 bg-slate-900/40 grid place-items-center modal-safe z-[70]" onClick={onClose}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">알림 설정</h3>
        <p className="text-[12px] text-ink-500 mb-4">타입별 수신·방해금지·이메일 중계를 설정할 수 있어요.</p>
        {!data ? (
          <div className="py-10 text-center text-sm text-slate-400">불러오는 중…</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              {TYPES.map((t) => {
                const on = data.prefs[t.key] !== false; // 기본 on
                return (
                  <label key={t.key} className="flex items-center gap-3 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-ink-900">{t.label}</div>
                      <div className="text-[11px] text-ink-500">{t.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setType(t.key, e.target.checked)}
                      className="w-4 h-4"
                    />
                  </label>
                );
              })}
            </div>

            <div className="border-t border-ink-150 pt-3">
              <div className="text-[12px] font-bold text-ink-800 mb-2">방해금지 시간</div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={data.dndStart ?? ""}
                  onChange={(e) => setData({ ...data, dndStart: e.target.value || null })}
                  className="input w-[120px]"
                />
                <span className="text-[12px] text-ink-500">부터</span>
                <input
                  type="time"
                  value={data.dndEnd ?? ""}
                  onChange={(e) => setData({ ...data, dndEnd: e.target.value || null })}
                  className="input w-[120px]"
                />
                <span className="text-[12px] text-ink-500">까지</span>
              </div>
              <div className="text-[11px] text-ink-500 mt-1.5">이 시간엔 알림 기록은 남고 팝업/사운드만 끕니다.</div>
            </div>

            <div className="border-t border-ink-150 pt-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={data.emailOn}
                  onChange={(e) => setData({ ...data, emailOn: e.target.checked })}
                  className="w-4 h-4"
                />
                <div>
                  <div className="text-[13px] font-bold text-ink-900">중요 알림을 이메일로도 받기</div>
                  <div className="text-[11px] text-ink-500">자리 비움 중에도 놓치지 않도록</div>
                </div>
              </label>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose}>취소</button>
          <button className="btn-primary" onClick={save} disabled={saving || !data}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
