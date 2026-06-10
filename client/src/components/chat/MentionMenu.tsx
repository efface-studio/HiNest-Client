import { useEffect, useMemo, useState } from "react";
import { Avatar } from "./theme";

/**
 * 그룹 채팅 입력창의 @멘션 자동완성 — 이름으로 태그.
 *
 * 사용법(SnippetSlashMenu 와 동일 규약): 부모가 textareaRef·value·members 를 넘기면
 *   - 커서 직전 토큰이 @\w* 면 이름으로 멤버 필터 메뉴 노출
 *   - 화살표/Enter/Esc 처리(onKeyDown 가드 handleKey 노출 — true 면 부모는 send 중단)
 *   - 선택 시 @토큰 을 `@이름 ` 으로 치환
 * 멘션 대상 userId 는 전송 시 본문에서 `@이름` 을 멤버명과 매칭해 파생한다(부모 send).
 */

export type MentionMember = { id: string; name: string; avatarColor?: string; avatarUrl?: string | null };

export type MentionHandle = {
  handleKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

/** 커서 직전이 @ 로 시작하는 토큰인지. 공백 전까지 수집, @ 뒤엔 이름 글자만. */
function detectAtToken(value: string, cursor: number): { start: number; end: number; query: string } | null {
  let s = cursor;
  while (s > 0 && !/\s/.test(value[s - 1])) s--;
  const token = value.slice(s, cursor);
  if (!token.startsWith("@")) return null;
  if (!/^@[\w\-가-힣.]*$/.test(token)) return null;
  return { start: s, end: cursor, query: token.slice(1) };
}

export function MentionMenu({
  textareaRef,
  value,
  members,
  onReplace,
  innerRef,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  members: MentionMember[];
  /** start..end 구간을 replacement 로 치환. */
  onReplace: (start: number, end: number, replacement: string) => void;
  innerRef: React.MutableRefObject<MentionHandle | null>;
}) {
  const [token, setToken] = useState<{ start: number; end: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  // 커서/value 변경 시 토큰 재계산.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const update = () => {
      const t = textareaRef.current;
      if (!t) return;
      setToken(detectAtToken(value, t.selectionStart ?? 0));
    };
    update();
    ta.addEventListener("keyup", update);
    ta.addEventListener("click", update);
    return () => {
      ta.removeEventListener("keyup", update);
      ta.removeEventListener("click", update);
    };
  }, [textareaRef, value]);

  const filtered = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 8);
  }, [token?.query, members]);

  useEffect(() => { setActive(0); }, [token?.query]);

  function select(m: MentionMember) {
    if (!token) return;
    onReplace(token.start, token.end, `@${m.name} `);
    setToken(null);
  }

  innerRef.current = {
    handleKey: (e) => {
      if (!token || filtered.length === 0) return false;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % filtered.length); return true; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + filtered.length) % filtered.length); return true; }
      if (e.key === "Escape") { e.preventDefault(); setToken(null); return true; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); select(filtered[active]); return true; }
      return false;
    },
  };

  if (!token || filtered.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute", left: 12, right: 12, bottom: "100%", marginBottom: 6,
        background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 240, overflowY: "auto", zIndex: 10,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div style={{ padding: "6px 10px", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--c-text-3)", borderBottom: "1px solid var(--c-border)" }}>
        멤버 멘션{token.query ? ` · @${token.query}` : ""}
      </div>
      {filtered.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => select(m)}
          onMouseEnter={() => setActive(i)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px",
            background: i === active ? "var(--c-surface-2)" : "transparent",
            border: "none", cursor: "pointer", textAlign: "left",
          }}
        >
          <Avatar name={m.name} color={m.avatarColor ?? "#3182F6"} imageUrl={m.avatarUrl ?? null} size={24} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: 600, color: "var(--c-text)" }}>
            {m.name}
          </span>
        </button>
      ))}
    </div>
  );
}
