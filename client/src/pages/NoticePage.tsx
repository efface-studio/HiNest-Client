import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiSWR, invalidateCache } from "../api";
import { useAuth } from "../auth";
import { useNotifications } from "../notifications";
import PageHeader from "../components/PageHeader";
import { confirmAsync, alertAsync } from "../components/ConfirmHost";
import PinButton from "../components/PinButton";
import { copyToClipboard, absoluteUrl } from "../lib/clipboard";
import { isDevAccount, DevBadge } from "../lib/devBadge";

type ReactionAgg = { emoji: string; count: number; reactedByMe: boolean };
type Notice = {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  author: { name: string };
  reactions?: ReactionAgg[];
};

/** 공지 반응용 자주 쓰이는 기본 이모지 팔레트. */
const NOTICE_REACTION_EMOJI = ["👍", "❤️", "🎉", "🙏", "👀", "😂"];

export default function NoticePage() {
  const { user } = useAuth();
  const { bellItems, markRead } = useNotifications();
  const [list, setList] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Notice | null>(null);
  const [form, setForm] = useState({ title: "", content: "", pinned: false });
  const [params, setParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactingEmoji, setReactingEmoji] = useState<string | null>(null);

  const canPost = user?.role === "ADMIN" || user?.role === "MANAGER";

  // 벨 알림 중 "공지" 타입의 미읽음을 noticeId -> notificationId 맵으로 인덱싱
  const unreadByNoticeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of bellItems) {
      if (n.type !== "NOTICE" || n.readAt) continue;
      const match = n.linkUrl?.match(/id=([^&]+)/);
      if (match) m.set(match[1], n.id);
    }
    return m;
  }, [bellItems]);

  async function load() {
    const res = await api<{ notices: Notice[] }>("/api/notice");
    setList(res.notices);
  }

  // 첫 진입은 SWR — 이전 캐시가 있으면 즉시 렌더하고, 네트워크로 최신값 병합.
  useEffect(() => {
    // 다른 SWR 페이지들과 동일하게 alive 가드 — 네트워크 응답이 언마운트 뒤 도착해
    // setList 가 dead component 에 꽂히는 것 방지 (React 18 이 warn 을 삼키긴 해도
    // 일관성 유지·메모리 참조 즉시 해제).
    let alive = true;
    apiSWR<{ notices: Notice[] }>("/api/notice", {
      onCached: (d) => { if (alive) setList(d.notices); },
      onFresh: (d) => { if (alive) setList(d.notices); },
    });
    return () => { alive = false; };
  }, []);

  // 알림 등에서 ?id=... 로 들어왔을 때 자동 선택
  useEffect(() => {
    const id = params.get("id");
    if (!id || list.length === 0) return;
    const found = list.find((n) => n.id === id);
    if (found) {
      setSelected(found);
      const notifId = unreadByNoticeId.get(found.id);
      if (notifId) markRead([notifId]);
    }
  }, [params, list, unreadByNoticeId, markRead]);

  // 공지 페이지에 머무는 동안엔 미읽음 NOTICE 알림을 즉시 read 처리.
  // - 페이지 진입(사이드바 배지 클릭 포함) 시 한 번 → 빨간 카운트 즉시 사라짐
  // - 머무는 동안 SSE 로 새 공지 알림 도착 → 즉시 read 처리 (사용자가 어차피 보는 화면이라 안전)
  // markRead 호출이 optimistic 으로 readAt 을 채워주므로 무한 루프 X (다음 번엔 unreadNoticeIds === 0).
  useEffect(() => {
    const unreadNoticeIds = bellItems
      .filter((n) => n.type === "NOTICE" && !n.readAt)
      .map((n) => n.id);
    if (unreadNoticeIds.length > 0) {
      markRead(unreadNoticeIds);
    }
  }, [bellItems, markRead]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await api("/api/notice", { method: "POST", json: form });
      invalidateCache("/api/notice");
      // 낙관적 삽입 — 서버가 방금 생성한 공지를 곧 반환하겠지만, 목록 맨 위(또는 고정이면 맨 위)에 즉시 반영.
      setOpen(false);
      setForm({ title: "", content: "", pinned: false });
      await load();
    } catch (e: any) {
      setSaveErr(e?.message ?? "공지 등록에 실패했어요");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    const ok = await confirmAsync({
      title: "공지 삭제",
      description: "이 공지를 삭제할까요? 되돌릴 수 없어요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    setRemovingId(id);
    // 낙관적 업데이트 — 목록에서 즉시 제거.
    const prev = list;
    setList((xs) => xs.filter((n) => n.id !== id));
    setSelected(null);
    try {
      await api(`/api/notice/${id}`, { method: "DELETE" });
      invalidateCache("/api/notice");
    } catch (e: any) {
      // 실패 시 복구.
      setList(prev);
      alertAsync({ title: "삭제 실패", description: e?.message ?? "삭제에 실패했어요" });
    } finally {
      setRemovingId(null);
    }
  }

  async function toggleReaction(notice: Notice, emoji: string) {
    if (reactingEmoji) return;
    const existing = notice.reactions?.find((r) => r.emoji === emoji);
    const mine = !!existing?.reactedByMe;
    // 낙관적 업데이트 — 내 반응 토글 후 count 조정.
    const nextReactions = (() => {
      const cur = notice.reactions ? [...notice.reactions] : [];
      const idx = cur.findIndex((r) => r.emoji === emoji);
      if (idx === -1) {
        cur.push({ emoji, count: 1, reactedByMe: true });
      } else {
        const it = cur[idx];
        if (mine) {
          const nc = it.count - 1;
          if (nc <= 0) cur.splice(idx, 1);
          else cur[idx] = { ...it, count: nc, reactedByMe: false };
        } else {
          cur[idx] = { ...it, count: it.count + 1, reactedByMe: true };
        }
      }
      return cur;
    })();
    const applyNext = (reactions: ReactionAgg[]) => {
      setList((xs) => xs.map((n) => (n.id === notice.id ? { ...n, reactions } : n)));
      setSelected((s) => (s && s.id === notice.id ? { ...s, reactions } : s));
    };
    const prevReactions = notice.reactions ?? [];
    applyNext(nextReactions);
    setReactingEmoji(emoji);
    setPickerOpen(false);
    try {
      if (mine) {
        await api(`/api/notice/${notice.id}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" });
      } else {
        await api(`/api/notice/${notice.id}/reactions`, { method: "POST", json: { emoji } });
      }
      invalidateCache("/api/notice");
    } catch (e: any) {
      // 실패 시 롤백.
      applyNext(prevReactions);
      alertAsync({ title: "반응 처리 실패", description: e?.message ?? "잠시 후 다시 시도해주세요" });
    } finally {
      setReactingEmoji(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="사내공지"
        description="회사 전체 공지사항입니다."
        right={canPost && <button className="btn-primary" onClick={() => setOpen(true)}>+ 공지 작성</button>}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-0 overflow-hidden">
          <div className="p-4 border-b border-slate-100 text-sm font-bold">공지 목록 ({list.length})</div>
          <div className="divide-y divide-slate-100 max-h-[70vh] overflow-auto">
            {list.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setSelected(n);
                  // URL 동기화 — 새로고침/공유 시에도 같은 공지 유지
                  const next = new URLSearchParams(params);
                  next.set("id", n.id);
                  setParams(next, { replace: true });
                  // 해당 공지에 대한 미읽음 알림이 있으면 읽음 처리
                  const notifId = unreadByNoticeId.get(n.id);
                  if (notifId) markRead([notifId]);
                }}
                className={`relative w-full text-left px-4 py-3 hover:bg-slate-50 ${selected?.id === n.id ? "bg-brand-50" : ""}`}
              >
                {unreadByNoticeId.has(n.id) && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-500" />
                )}
                <div className="flex items-center gap-2">
                  {n.pinned && (
                    <span className="chip chip-amber inline-flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M14 2l-1.5 1.5L15 6l-5 5H6l4 4-5 5 1 1 5-5 4 4v-4l5-5 2.5 2.5L22 12 14 2z" />
                      </svg>
                      고정
                    </span>
                  )}
                  <div className="font-semibold text-ink-900 truncate">{n.title}</div>
                </div>
                <div className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
                  <span>{n.author?.name}</span>
                  {isDevAccount(n.author) && <DevBadge />}
                  <span>· {new Date(n.createdAt).toLocaleDateString("ko-KR")}</span>
                </div>
              </button>
            ))}
            {list.length === 0 && <div className="px-4 py-10 text-center text-sm text-slate-400">공지가 없습니다.</div>}
          </div>
        </div>

        <div className="lg:col-span-2 card">
          {selected ? (
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {selected.pinned && (
                      <span className="chip chip-amber inline-flex items-center gap-1">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <path d="M14 2l-1.5 1.5L15 6l-5 5H6l4 4-5 5 1 1 5-5 4 4v-4l5-5 2.5 2.5L22 12 14 2z" />
                        </svg>
                        고정
                      </span>
                    )}
                    <span>{selected.author?.name}</span>
                    {isDevAccount(selected.author) && <DevBadge />}
                    <span>·</span>
                    <span>{new Date(selected.createdAt).toLocaleString("ko-KR")}</span>
                  </div>
                  <h2 className="text-xl font-bold mt-2">{selected.title}</h2>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost inline-flex items-center gap-1"
                    title="이 공지로 연결되는 링크를 복사"
                    onClick={() =>
                      copyToClipboard(absoluteUrl(`/notice?id=${selected.id}`), {
                        title: "링크 복사됨",
                        description: "사내톡에 붙여넣으면 이 공지로 바로 이동돼요.",
                      })
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72" />
                    </svg>
                    링크 복사
                  </button>
                  <PinButton type="NOTICE" id={selected.id} label={selected.title} />
                  {canPost && (
                    <button
                      className="btn-ghost"
                      onClick={() => remove(selected.id)}
                      disabled={removingId === selected.id}
                    >
                      {removingId === selected.id ? "삭제 중…" : "삭제"}
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-6 whitespace-pre-wrap text-slate-700 leading-relaxed">{selected.content}</div>

              {/* 이모지 반응 — 이미 달린 반응을 먼저 보여주고 맨 끝에 + 버튼으로 추가 팔레트 열기. */}
              <div className="mt-6 pt-4 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-2">
                  {(selected.reactions ?? []).map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      onClick={() => toggleReaction(selected, r.emoji)}
                      disabled={reactingEmoji === r.emoji}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-sm transition ${
                        r.reactedByMe
                          ? "bg-brand-50 border-brand-300 text-brand-700"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      } ${reactingEmoji === r.emoji ? "opacity-60" : ""}`}
                      aria-pressed={r.reactedByMe}
                    >
                      <span>{r.emoji}</span>
                      <span className="text-xs font-semibold tabular-nums">{r.count}</span>
                    </button>
                  ))}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setPickerOpen((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 text-sm"
                      aria-label="이모지 반응 추가"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                        <line x1="9" y1="9" x2="9.01" y2="9" />
                        <line x1="15" y1="9" x2="15.01" y2="9" />
                      </svg>
                      <span className="text-xs">추가</span>
                    </button>
                    {pickerOpen && (
                      <div
                        className="absolute z-10 mt-2 left-0 bg-white border border-slate-200 shadow-lg rounded-lg p-1 flex gap-1"
                        onMouseLeave={() => setPickerOpen(false)}
                      >
                        {NOTICE_REACTION_EMOJI.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => toggleReaction(selected, e)}
                            className="w-8 h-8 grid place-items-center rounded hover:bg-slate-100 text-lg"
                            disabled={reactingEmoji === e}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-400 py-20">좌측에서 공지를 선택해주세요.</div>
          )}
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 bg-slate-900/40 grid place-items-center modal-safe" onClick={() => setOpen(false)}>
          <div className="card w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">공지 작성</h3>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">제목</label>
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                  maxLength={200}
                />
              </div>
              <div>
                <label className="label">내용</label>
                <textarea
                  className="input"
                  rows={8}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  required
                  maxLength={20_000}
                />
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
                상단 고정
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>취소</button>
                <button className="btn-primary">작성</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
