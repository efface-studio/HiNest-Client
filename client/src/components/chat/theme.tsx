/**
 * 토스(Toss) 스타일 채팅 UI 테마 상수 + 범용 포맷/정렬 헬퍼.
 * ChatMiniApp 분할 과정에서 중복 유틸을 모아둠.
 */
import type { Room } from "./types";
import { imgSrc } from "../../api";

/**
 * 채팅 팔레트 — 모두 CSS 변수 매핑으로 라이트/다크 자동 전환.
 * 키 이름은 레거시 호환을 위해 유지.
 */
export const C = {
  // 브랜드
  blue: "var(--c-brand)",
  blueHover: "var(--c-brand-hover)",
  blueSoft: "var(--c-brand-soft)",
  // 텍스트
  ink: "var(--c-text)",
  gray700: "var(--c-text-2)",
  gray600: "var(--c-text-3)",
  gray500: "var(--c-text-muted)",
  // 보더/구분선
  gray300: "var(--c-border-strong)",
  gray200: "var(--c-border)",
  // 보조 표면 (배지·리액션 칩 등)
  gray100: "var(--c-surface-3)",
  // 상대 메시지 버블 전용 — surface 위에 올릴 때 확실히 구분되는 톤
  bubbleOther: "var(--c-chat-bubble-other)",
  // 상태
  red: "var(--c-danger)",
  // 표면
  surface: "var(--c-surface)",
  surfaceAlt: "var(--c-surface-2)",
  bg: "var(--c-bg)",
  // 브랜드 텍스트 대비용 (내 버블 텍스트)
  brandFg: "var(--c-brand-fg)",
} as const;

export const FONT =
  "Pretendard, 'Pretendard Variable', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', system-ui, sans-serif";

/** 방 이름 — DIRECT 는 상대방 이름, 그 외는 room.name 폴백 */
export function roomTitle(r: Room, meId: string): string {
  if (r.type === "DIRECT") {
    const other = r.members.find((m) => m.user.id !== meId)?.user;
    return other?.name ?? r.name ?? "대화";
  }
  return r.name || (r.type === "TEAM" ? "팀 채팅" : "그룹");
}

/** 방 아바타 색 — DIRECT 는 상대방 색, 그 외는 타입별 기본 */
export function roomColor(r: Room, meId: string): string {
  if (r.type === "DIRECT") {
    const other = r.members.find((m) => m.user.id !== meId)?.user;
    return other?.avatarColor ?? C.blue;
  }
  return r.type === "TEAM" ? "#00C4B4" : "#4E5968";
}

/** 방 아바타 이미지 — DIRECT 일 때만 상대방 업로드 이미지를 사용. 그룹/팀은 null.
 * DIRECT 아닌 경우 여러 명의 이미지를 썸네일로 합성할 수도 있지만 현재 단계에선 생략. */
export function roomImageUrl(r: Room, meId: string): string | null {
  if (r.type === "DIRECT") {
    const other = r.members.find((m) => m.user.id !== meId)?.user;
    return other?.avatarUrl ?? null;
  }
  return null;
}

/** 리스트 미리보기 텍스트 — 첨부는 종류 라벨, 없으면 content */
export function previewForMessage(m: {
  content?: string;
  kind?: string;
  fileName?: string | null;
}): string {
  if (m.kind === "IMAGE") return "📷 사진";
  if (m.kind === "VIDEO") return "🎬 동영상";
  if (m.kind === "FILE") return "📎 파일 첨부";
  return m.content ?? "";
}

/** 바이트 → 사람이 읽기 쉬운 크기 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** 상대 시각 — "방금", "N분 전", "N시간 전", "N일 전", 주말 넘어가면 MM/DD */
export function formatRelative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day}일 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 시:분 포맷 — "오후 3:24" */
export function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h < 12 ? "오전" : "오후";
  const hh = ((h + 11) % 12) + 1;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${period} ${hh}:${mm}`;
}

/**
 * 간결 상대 시각 — "방금 / N분 전 / N시간 전 / M/D (하루 이상)".
 * 채팅 마지막 메시지 옆에 붙일 때 사용.
 */
export function formatShort(d: Date): string {
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "방금";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 채팅 메시지 사이 날짜 구분선 라벨.
 *   - 오늘: "오늘"
 *   - 어제: "어제"
 *   - 같은 해: "4월 18일 (목)"
 *   - 다른 해: "2024년 4월 18일 (목)"
 */
export function formatDayDivider(d: Date): string {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (dayDiff === 0) return "오늘";
  if (dayDiff === 1) return "어제";
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const body = `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`;
  return sameYear ? body : `${d.getFullYear()}년 ${body}`;
}

/**
 * 상세 시각 — 같은 해/같은 날 기준으로 축약:
 *  - 오늘: "오늘 오후 3:24"
 *  - 어제: "어제 오후 3:24"
 *  - 같은 해: "4월 18일 오후 3:24"
 *  - 다른 해: "2024년 4월 18일 오후 3:24"
 */
export function formatDetailed(d: Date): string {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);

  const clock = formatClock(d);
  if (dayDiff === 0) return `오늘 ${clock}`;
  if (dayDiff === 1) return `어제 ${clock}`;
  if (sameYear) return `${d.getMonth() + 1}월 ${d.getDate()}일 ${clock}`;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${clock}`;
}

/** 이름 첫 글자 기반 원형 아바타. imageUrl 이 있으면 이미지, 없으면 색+이니셜.
 * presence 전달 시 오른쪽 아래 상태 점 표시. */
export function Avatar({
  name,
  color,
  size,
  imageUrl,
  presenceColor,
  presenceTitle,
}: {
  name: string;
  color: string;
  size: number;
  imageUrl?: string | null;
  presenceColor?: string;
  presenceTitle?: string;
}) {
  const dot = Math.max(8, Math.round(size * 0.28));
  const ring = Math.max(1, Math.round(size * 0.06));
  return (
    // 바깥 래퍼는 clip 하지 않음. 안쪽 circle 에서만 이미지를 clip 하고,
    // presence dot 은 바깥 래퍼에 얹어서 원 경계 바깥까지 자연스럽게 튀어나오게 한다.
    // 예전엔 바깥에 overflow:hidden 이 걸려 있어서 presence 점 우하단이 반달
    // 모양으로 잘려 보이던 버그가 있었음.
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: imageUrl ? "transparent" : color,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: size * 0.42,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          overflow: "hidden",
        }}
      >
        {imageUrl ? (
          <img
            src={imgSrc(imageUrl)}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} loading="lazy" decoding="async"/>
        ) : (
          name?.[0] ?? "?"
        )}
      </div>
      {presenceColor && (
        <span
          title={presenceTitle}
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: presenceColor,
            boxShadow: `0 0 0 ${ring}px var(--c-surface, #fff)`,
          }}
        />
      )}
    </div>
  );
}

/* ===== 방별 로컬 설정(별명/음소거) localStorage 저장 ===== */
const ROOM_SETTINGS_KEY = "hinest.chat.roomSettings.v1";

export function loadAllRoomSettings(): Record<string, { nickname?: string; muted?: boolean }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ROOM_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAllRoomSettings(
  map: Record<string, { nickname?: string; muted?: boolean }>
) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ROOM_SETTINGS_KEY, JSON.stringify(map));
  } catch {}
}
