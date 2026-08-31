import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { LangIcon } from "../../lib/langIcon";

/**
 * 채팅 입력창의 슬래시 자동완성.
 *
 * 사용법: 부모 컴포넌트가 textareaRef·value·setValue 를 넘기면 이 컴포넌트가
 *   - 커서 직전 토큰이 /\w* 패턴이면 메뉴 노출
 *   - 화살표/Enter/Esc 처리(onKeyDown 가드 함수 노출)
 *   - 선택 시 /토큰 을 스니펫 body 로 치환 + 사용 +1
 *
 * 부모는 textarea 의 onKeyDown 첫 줄에서 menuRef.current?.handleKey(e) 호출.
 *   handleKey 가 true 를 반환하면 부모는 Enter→send 로 진행하지 않음.
 */

type Item = {
  id: string;
  trigger: string;
  title: string;
  body: string;
  lang: string;
  scope: "PRIVATE" | "ALL";
  uses: number;
};

export type SnippetSlashHandle = {
  /** textarea onKeyDown 에서 호출. 메뉴가 키를 소비했으면 true 반환 → 부모는 send 등 후속 처리 중단. */
  handleKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
};

/** 커서 직전이 / 로 시작하는 토큰인지 검사. ` /tail` 또는 줄 시작의 `/` 만 인정. */
function detectSlashToken(value: string, cursor: number): { start: number; end: number; query: string } | null {
  // 커서 위치에서 뒤로 올라가며 공백/줄바꿈을 만날 때까지 토큰 수집.
  let s = cursor;
  while (s > 0 && !/\s/.test(value[s - 1])) s--;
  const token = value.slice(s, cursor);
  if (!token.startsWith("/")) return null;
  // / 만 있거나 / 뒤에 영문/숫자/한글/하이픈만 있을 때 매치 (공백 등 다른 문자 들어가면 즉시 종료).
  if (!/^\/[\w\-가-힣]*$/.test(token)) return null;
  return { start: s, end: cursor, query: token.slice(1) };
}

export function SnippetSlashMenu({
  textareaRef,
  value,
  onReplace,
  innerRef,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  /** start..end 구간을 replacement 로 치환. */
  onReplace: (start: number, end: number, replacement: string) => void;
  innerRef: React.MutableRefObject<SnippetSlashHandle | null>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [token, setToken] = useState<{ start: number; end: number; query: string } | null>(null);
  const fetchSeq = useRef(0);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    function update() {
      const ta = textareaRef.current;
      if (!ta) return;
      const detected = detectSlashToken(value, ta.selectionStart ?? 0);
      setToken(detected);
      if (!detected) {
        setOpen(false);
        setItems([]);
      }
    }
    update();
    ta.addEventListener("keyup", update);
    ta.addEventListener("click", update);
    return () => {
      ta.removeEventListener("keyup", update);
      ta.removeEventListener("click", update);
    };
  }, [textareaRef, value]);

  useEffect(() => {
    if (!token) return;
    const seq = ++fetchSeq.current;
    api<{ items: Item[] }>(`/api/snippet/search?q=${encodeURIComponent(token.query)}&limit=8`)
      .then((r) => {
        if (seq !== fetchSeq.current) return; // 결과 도착 전 다른 쿼리로 바뀌었으면 무시
        setItems(r.items ?? []);
        setOpen((r.items ?? []).length > 0);
        setActive(0);
      })
      .catch(() => {});
  }, [token?.query]);

  innerRef.current = {
    handleKey: (e) => {
      if (!open || items.length === 0 || !token) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        select(items[active]);
        return true;
      }
      return false;
    },
  };

  function select(it: Item) {
    if (!token) return;
    onReplace(token.start, token.end, it.body);
    setOpen(false);
    setItems([]);
    // 사용 +1 — 실패해도 무음 (인기 정렬 가중치일 뿐).
    api(`/api/snippet/${it.id}/use`, { method: "POST" }).catch(() => {});
  }

  if (!open || items.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: "100%",
        marginBottom: 6,
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        maxHeight: 240,
        overflowY: "auto",
        zIndex: 10,
      }}
      onMouseDown={(e) => e.preventDefault()} // 클릭 시 textarea 포커스 유지
    >
      <div
        style={{
          padding: "6px 10px",
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--c-text-3)",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        스니펫{token?.query ? ` · /${token.query}` : ""}
      </div>
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          onClick={() => select(it)}
          onMouseEnter={() => setActive(i)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 10px",
            background: i === active ? "var(--c-surface-2)" : "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11.5,
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: 4,
              background: "var(--c-surface-3)",
              color: "var(--c-text)",
              flexShrink: 0,
            }}
          >
            /{it.trigger}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600, color: "var(--c-text)" }}>
            {it.title}
          </span>
          {it.lang && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--c-text-3)", flexShrink: 0 }}>
              <LangIcon lang={it.lang} size={11} />
              {it.lang}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
