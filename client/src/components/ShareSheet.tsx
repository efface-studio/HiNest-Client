/**
 * 게시물 공유 바텀시트 — 공지/메모/회의록 등을 채팅으로 공유.
 *
 * 인스타그램 게시물 공유 패턴: 하단에서 시트가 올라오고, 동료(1:1)+그룹방 목록에서
 * 다중 선택 후 "보내기" 누르면 각 대상의 채팅방으로 카드 메시지 1건씩 전송.
 *
 * 검색은 이름·방 이름 모두 부분 일치. 선택은 상단 칩으로 표시 → 다시 누르면 해제.
 * 모바일: 풀폭 바텀시트. 데스크톱: 가운데 중형 모달.
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

export type ShareKind = "ANNOUNCEMENT" | "MEMO" | "MEETING" | "DOCUMENT" | "JOURNAL";

export type SharePayload = {
  kind: ShareKind;
  title: string;
  snippet?: string;
  /** 앱 내 라우트 경로 — 카드 클릭 시 이동 (예: "/notice/abc123") */
  href: string;
};

type DirectoryUser = {
  id: string;
  name: string;
  team?: string | null;
  position?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string | null;
};

type Room = {
  id: string;
  name: string;
  type: "DIRECT" | "GROUP" | "TEAM" | string;
  members?: { user: { id: string; name: string; avatarColor?: string | null } }[];
};

const KIND_LABEL: Record<ShareKind, string> = {
  ANNOUNCEMENT: "공지",
  MEMO: "메모",
  MEETING: "회의록",
  DOCUMENT: "문서",
  JOURNAL: "업무일지",
};

export default function ShareSheet({
  open,
  onClose,
  payload,
  meId,
}: {
  open: boolean;
  onClose: () => void;
  payload: SharePayload | null;
  /** 본인 id — 동료 목록에서 본인 제외용. 없으면 응답을 신뢰. */
  meId?: string | null;
}) {
  const [q, setQ] = useState("");
  const [pickedUsers, setPickedUsers] = useState<Set<string>>(new Set());
  const [pickedRooms, setPickedRooms] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // 시트 열릴 때마다 선택 초기화 — 이전 공유의 잔상이 남지 않게.
  useEffect(() => {
    if (open) {
      setQ("");
      setPickedUsers(new Set());
      setPickedRooms(new Set());
    }
  }, [open]);

  // 시트 열릴 때만 fetch — 닫힌 동안 네트워크 트래픽 0.
  const [usersData, setUsersData] = useState<{ users: DirectoryUser[] } | null>(null);
  const [roomsData, setRoomsData] = useState<{ rooms: Room[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api<{ users: DirectoryUser[] }>("/api/users").then((d) => {
      if (!cancelled) setUsersData(d);
    }).catch(() => {});
    void api<{ rooms: Room[] }>("/api/chat/rooms").then((d) => {
      if (!cancelled) setRoomsData(d);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  const users: DirectoryUser[] = useMemo(() => {
    const list = usersData?.users ?? [];
    return list.filter((u: DirectoryUser) => (meId ? u.id !== meId : true));
  }, [usersData, meId]);

  // GROUP/TEAM 만 표시 — DIRECT 는 동료 목록에서 골라 보낸다(중복 방지).
  const rooms: Room[] = useMemo(() => {
    return (roomsData?.rooms ?? []).filter((r: Room) => r.type !== "DIRECT");
  }, [roomsData]);

  const filteredUsers = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return users;
    return users.filter((u) => u.name.toLowerCase().includes(k));
  }, [users, q]);

  const filteredRooms = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return rooms;
    return rooms.filter((r) => r.name.toLowerCase().includes(k));
  }, [rooms, q]);

  function toggleUser(id: string) {
    setPickedUsers((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleRoom(id: string) {
    setPickedRooms((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const total = pickedUsers.size + pickedRooms.size;

  async function send() {
    if (!payload || !total || sending) return;
    setSending(true);
    try {
      const r = await api<{ ok: boolean; count: number }>("/api/chat/share", {
        method: "POST",
        json: {
          kind: payload.kind,
          title: payload.title,
          snippet: payload.snippet,
          href: payload.href,
          userIds: [...pickedUsers],
          roomIds: [...pickedRooms],
        },
      });
      if (r?.ok) {
        // 가벼운 토스트 대신 시트 자체 닫음 — 이후 알림센터/채팅 갱신은 SSE 가 처리.
        onClose();
      }
    } catch (e: any) {
      window.alert(e?.message ?? "공유에 실패했어요");
    } finally {
      setSending(false);
    }
  }

  if (!open || !payload) return null;
  const label = KIND_LABEL[payload.kind] ?? "공유";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 공유`}
      className="modal-safe fixed inset-0 z-[1000] flex items-end md:items-center justify-center"
      style={{ background: "rgba(15,18,28,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-md bg-white rounded-t-[20px] md:rounded-[18px] shadow-2xl flex flex-col"
        style={{ maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 핸들바 — 모바일 시트 표시 */}
        <div className="flex justify-center pt-2 md:hidden">
          <div className="w-10 h-1.5 rounded-full bg-ink-200" />
        </div>

        {/* 헤더 */}
        <div className="px-5 pt-3 pb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink-900">공유</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-ink-400 hover:text-ink-700 text-[20px] leading-none"
          >
            ×
          </button>
        </div>

        {/* 공유 카드 미리보기 */}
        <div className="mx-5 mb-2 p-3 rounded-[12px] border border-ink-150 bg-ink-50/60">
          <div className="text-[10px] font-bold text-brand-500 mb-0.5">📌 {label}</div>
          <div className="text-[13px] font-bold text-ink-900 line-clamp-1">{payload.title}</div>
          {payload.snippet && (
            <div className="text-[11px] text-ink-500 line-clamp-2 mt-0.5">{payload.snippet}</div>
          )}
        </div>

        {/* 검색 */}
        <div className="px-5 pb-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 또는 대화방 검색"
            className="w-full h-9 px-3 text-[13px] rounded-[10px] border border-ink-150 bg-white outline-none focus:border-brand-400"
          />
        </div>

        {/* 선택된 칩 */}
        {total > 0 && (
          <div
            className="hinest-x-scroll px-5 pb-2 flex gap-2 overflow-x-auto"
            style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
          >
            {[...pickedUsers].map((id) => {
              const u = users.find((x) => x.id === id);
              if (!u) return null;
              return (
                <button
                  key={`u:${id}`}
                  onClick={() => toggleUser(id)}
                  className="inline-flex items-center gap-1.5 px-2 h-7 rounded-full bg-brand-50 border border-brand-100 text-[12px] font-bold text-brand-700 whitespace-nowrap"
                >
                  {u.name}
                  <span className="text-brand-400">×</span>
                </button>
              );
            })}
            {[...pickedRooms].map((id) => {
              const r = rooms.find((x) => x.id === id);
              if (!r) return null;
              return (
                <button
                  key={`r:${id}`}
                  onClick={() => toggleRoom(id)}
                  className="inline-flex items-center gap-1.5 px-2 h-7 rounded-full bg-brand-50 border border-brand-100 text-[12px] font-bold text-brand-700 whitespace-nowrap"
                >
                  #{r.name}
                  <span className="text-brand-400">×</span>
                </button>
              );
            })}
          </div>
        )}

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filteredRooms.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                대화방
              </div>
              {filteredRooms.map((r) => {
                const picked = pickedRooms.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => toggleRoom(r.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-left ${
                      picked ? "bg-brand-50" : "hover:bg-ink-50"
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                      style={{ background: "#4E5968" /* 그룹방 색 — 회의록 표준 슬레이트 */ }}
                    >
                      #{r.name.slice(0, 1)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-ink-900 line-clamp-1">{r.name}</div>
                      <div className="text-[11px] text-ink-500">{r.type === "TEAM" ? "팀방" : "그룹방"}</div>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        picked ? "bg-brand-500 border-brand-500" : "border-ink-200"
                      }`}
                    >
                      {picked && <span className="text-white text-[12px] leading-none">✓</span>}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {filteredUsers.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-ink-400 uppercase tracking-wider">
                동료
              </div>
              {filteredUsers.map((u) => {
                const picked = pickedUsers.has(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-left ${
                      picked ? "bg-brand-50" : "hover:bg-ink-50"
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white overflow-hidden flex-shrink-0"
                      style={{ background: u.avatarUrl ? "transparent" : u.avatarColor ?? "#3D54C4" }}
                    >
                      {u.avatarUrl ? (
                        <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                      ) : (
                        u.name.slice(0, 1)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-bold text-ink-900 line-clamp-1">{u.name}</div>
                      {(u.team || u.position) && (
                        <div className="text-[11px] text-ink-500 line-clamp-1">
                          {[u.team, u.position].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        picked ? "bg-brand-500 border-brand-500" : "border-ink-200"
                      }`}
                    >
                      {picked && <span className="text-white text-[12px] leading-none">✓</span>}
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {!filteredRooms.length && !filteredUsers.length && (
            <div className="text-center py-10 text-[12px] text-ink-400">검색 결과가 없어요</div>
          )}
        </div>

        {/* 보내기 버튼 — safe-area inset bottom 흡수 */}
        <div
          className="px-5 pt-2 pb-3 border-t border-ink-100 bg-white rounded-b-[20px] md:rounded-b-[18px]"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <button
            onClick={send}
            disabled={!total || sending}
            className="w-full h-11 rounded-[12px] bg-brand-500 text-white font-bold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]"
          >
            {sending ? "보내는 중…" : total ? `${total}명에게 공유` : "받을 사람을 선택해 주세요"}
          </button>
        </div>
      </div>
    </div>
  );
}
