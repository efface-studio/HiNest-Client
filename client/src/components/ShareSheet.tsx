/**
 * 게시물 공유 바텀시트 — 공지/메모/회의록 등을 채팅으로 공유.
 *
 * 인스타그램 게시물 공유 패턴: 하단에서 시트가 올라오고, 동료(1:1)+그룹방 목록에서
 * 다중 선택 후 "보내기" 누르면 각 대상의 채팅방으로 카드 메시지 1건씩 전송.
 *
 * 검색은 이름·방 이름 모두 부분 일치. 선택은 상단 칩으로 표시 → 다시 누르면 해제.
 * 모바일: 풀폭 바텀시트. 데스크톱: 가운데 중형 모달.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, apiSWR, imgSrc } from "../api";
import Portal from "./Portal";
import { alertAsync } from "./ConfirmHost";
import { setNativeTabBarHidden } from "../lib/liquidGlassTabBar";

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

/** 선택된 사람 수/방 수에 맞는 버튼 라벨. "1명에게 공유"가 방에도 쓰이던 오류 수정. */
function shareTargetLabel(users: number, rooms: number): string {
  const parts: string[] = [];
  if (users) parts.push(`${users}명`);
  if (rooms) parts.push(`${rooms}개 대화방`);
  return `${parts.join(" · ")}에 공유`;
}

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
  const [sent, setSent] = useState(false);

  // 애플 기본 시트처럼 — 모든 화면 크기에서 하단 바텀시트 + 슬라이드업 + 핸들 드래그-투-디스미스.
  const [shown, setShown] = useState(false);   // 슬라이드업 트리거(마운트 후 rAF 로 true)
  const [dragY, setDragY] = useState(0);        // 드래그 중 아래로 끌린 px
  const dragStartRef = useRef<number | null>(null);

  // 시트 열릴 때마다 선택 초기화 — 이전 공유의 잔상이 남지 않게.
  useEffect(() => {
    if (open) {
      setQ("");
      setPickedUsers(new Set());
      setPickedRooms(new Set());
      setSent(false);
      setDragY(0);
      setShown(false);
      // 다음 프레임에 shown=true → translateY(100%→0) 슬라이드업.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  // 핸들/헤더 드래그로 아래로 끌어 닫기(네이티브 시트 제스처). 100px 이상 끌면 닫힘.
  function onDragStart(clientY: number) { dragStartRef.current = clientY; }
  function onDragMove(clientY: number) {
    if (dragStartRef.current == null) return;
    setDragY(Math.max(0, clientY - dragStartRef.current));
  }
  function onDragEnd() {
    if (dragStartRef.current == null) return;
    dragStartRef.current = null;
    if (dragY > 100) {
      // 임계 초과 → 아래로 슬라이드 아웃 후 닫기(드래그 종료라 transition 활성).
      setDragY(1000);
      setTimeout(onClose, 220);
      return;
    }
    setDragY(0); // 임계 미달 → 제자리 스프링백
  }

  // 시트가 열린 동안 네이티브 탭바(웹뷰 위에 떠 있는 UITabBar)를 확실히 숨긴다.
  // 안 그러면 시트 하단의 '공유' 버튼이 네이티브 탭바에 가려 탭이 안 먹는다(=안 눌림).
  useEffect(() => {
    if (!open) return;
    setNativeTabBarHidden("share", true);
    return () => setNativeTabBarHidden("share", false);
  }, [open]);

  // 시트 열릴 때만 로드 — apiSWR 로 캐시 우선(즉시 표시) + 백그라운드 갱신.
  // 반복해서 열어도 캐시가 있으면 즉시 뜨고 서버 호출은 갱신 1회로 절감(서버비 ↓).
  const [usersData, setUsersData] = useState<{ users: DirectoryUser[] } | null>(null);
  const [roomsData, setRoomsData] = useState<{ rooms: Room[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void apiSWR<{ users: DirectoryUser[] }>("/api/users", {
      onCached: (d) => { if (!cancelled) setUsersData(d); },
      onFresh: (d) => { if (!cancelled) setUsersData(d); },
    });
    void apiSWR<{ rooms: Room[] }>("/api/chat/rooms", {
      onCached: (d) => { if (!cancelled) setRoomsData(d); },
      onFresh: (d) => { if (!cancelled) setRoomsData(d); },
    });
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
        // 성공 체크 표시 후 살짝 뒤 닫음 — 사용자가 전송됐다는 걸 인지.
        setSent(true);
        setTimeout(() => onClose(), 700);
      }
    } catch (e: any) {
      await alertAsync({ description: e?.message ?? "공유에 실패했어요" });
      setSending(false);
    }
  }

  if (!open || !payload) return null;
  const label = KIND_LABEL[payload.kind] ?? "공유";

  return (
   <Portal>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 공유`}
      className="fixed inset-0 z-[1000] flex items-end justify-center"
      style={{
        background: `rgba(15,18,28,${shown ? 0.45 : 0})`,
        transition: "background 280ms ease",
        // 시트는 화면 바닥에 딱 붙어야 자연스럽다(.modal-safe 의 좌우·하단 패딩이 적용되면
        // 좌우/아래로 떠 보여 분리감이 생기는 문제). 상단만 노치 회피로 패딩 두고, 시트
        // 자체는 가장자리까지 차게 한다. 키보드 인셋은 ShareSheet 내부가 자체 관리(보내기
        // 버튼이 safe-area-inset-bottom 흡수).
        paddingTop: "max(1rem, env(safe-area-inset-top))",
      }}
      onClick={onClose}
    >
      <div
        className="w-full md:max-w-lg bg-white shadow-2xl flex flex-col rounded-t-[22px]"
        style={{
          maxHeight: "88vh",
          // 항상 하단에서 슬라이드업(translateY 100%→0). 드래그(네이티브 터치) 중엔 손가락 추종.
          transform: `translateY(${shown ? dragY : 1000}px)`,
          transition: dragStartRef.current == null ? "transform 320ms cubic-bezier(0.32,0.72,0,1)" : "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 핸들바 — 드래그해서 닫기(아래로 끌면 시트 닫힘) */}
        <div
          className="flex justify-center pt-2.5 pb-1 touch-none cursor-grab active:cursor-grabbing"
          data-no-haptic
          onTouchStart={(e) => onDragStart(e.touches[0].clientY)}
          onTouchMove={(e) => onDragMove(e.touches[0].clientY)}
          onTouchEnd={onDragEnd}
        >
          <div className="w-10 h-1.5 rounded-full bg-ink-200" />
        </div>

        {/* 헤더 */}
        <div className="px-5 pt-2 pb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink-900">공유</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="text-ink-400 hover:text-ink-700 text-[20px] leading-none"
          >
            ×
          </button>
        </div>

        {/* 공유 카드 미리보기 — 다크/라이트 자동 대응(var 토큰), 브랜드 좌측 바 */}
        <div
          className="mx-5 mb-2 p-3 rounded-[12px] border flex gap-2.5"
          style={{ background: "color-mix(in srgb, var(--c-brand, #3B5CF0) 7%, var(--c-surface))", borderColor: "var(--c-border)" }}
        >
          <div className="w-1 rounded-full self-stretch flex-shrink-0" style={{ background: "var(--c-brand, #3B5CF0)" }} />
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-brand-500 mb-0.5">📌 {label}</div>
            <div className="text-[13px] font-bold text-ink-900 line-clamp-1">{payload.title}</div>
            {payload.snippet && (
              <div className="text-[11px] text-ink-500 line-clamp-2 mt-0.5">{payload.snippet}</div>
            )}
          </div>
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
            className="hinest-x-scroll px-5 pt-1 pb-2.5 flex items-center gap-2 overflow-x-auto"
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
                    {/* 컬러 이니셜을 바탕으로 깔고 사진을 그 위에 덮는다 — 사진 로드 실패 시 이니셜이 보임.
                        avatarUrl 은 /uploads 상대경로라 imgSrc() 로 절대 URL + 인증 토큰을 붙여야 뜬다. */}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white overflow-hidden flex-shrink-0 relative"
                      style={{ background: u.avatarColor ?? "#3D54C4" }}
                    >
                      {u.name.slice(0, 1)}
                      {imgSrc(u.avatarUrl) && (
                        <img src={imgSrc(u.avatarUrl)} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
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
          className="px-5 pt-2 pb-3 border-t border-ink-100 bg-white"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <button
            onClick={send}
            disabled={!total || sending || sent}
            className="w-full h-11 rounded-[12px] bg-brand-500 text-white font-bold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed transition active:scale-[0.98]"
          >
            {sent ? "공유했어요 ✓" : sending ? "보내는 중…" : total ? `${shareTargetLabel(pickedUsers.size, pickedRooms.size)}` : "받을 사람을 선택해 주세요"}
          </button>
        </div>
      </div>
    </div>
   </Portal>
  );
}
