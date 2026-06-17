import { Extension } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { createRoot, type Root } from "react-dom/client";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { pickFilesAndInsert } from "./editorMedia";

/**
 * 노션식 슬래시(/) 명령 메뉴 — 빈 줄/공백 뒤에서 "/" 입력 시 블록 삽입 메뉴.
 * 멘션과 동일하게 @tiptap/suggestion + createRoot 팝업으로 구현(새 의존성 없음).
 * 메모·회의록 공용 MeetingEditor 에 얹어 둘 다 동일 동작.
 */

type SlashItem = {
  title: string;
  hint: string;
  keywords: string;
  icon: string;
  run: (editor: Editor, range: Range) => void;
};

const SLASH_ITEMS: SlashItem[] = [
  { title: "제목 1", hint: "큰 제목", keywords: "h1 제목 heading title 큰", icon: "H1", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run() },
  { title: "제목 2", hint: "중간 제목", keywords: "h2 제목 heading", icon: "H2", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run() },
  { title: "제목 3", hint: "작은 제목", keywords: "h3 제목 heading", icon: "H3", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run() },
  { title: "글머리 목록", hint: "• 불릿 리스트", keywords: "bullet list 목록 리스트 불릿 글머리", icon: "•", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "번호 목록", hint: "1. 순서 있는 목록", keywords: "ordered number list 번호 목록 순서", icon: "1.", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "체크박스", hint: "할 일 목록", keywords: "todo task check 체크 할일 체크박스", icon: "☑", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: "인용", hint: "인용구", keywords: "quote blockquote 인용", icon: "❝", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: "코드 블록", hint: "코드 블록", keywords: "code 코드 codeblock", icon: "</>", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: "구분선", hint: "가로 구분선", keywords: "divider hr rule 구분선 라인", icon: "―", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { title: "이미지", hint: "사진 업로드", keywords: "image photo 이미지 사진 그림", icon: "🖼", run: (e, r) => { e.chain().focus().deleteRange(r).run(); pickFilesAndInsert(e, "image/*"); } },
  { title: "파일", hint: "파일 첨부", keywords: "file attach 파일 첨부 첨부파일", icon: "📎", run: (e, r) => { e.chain().focus().deleteRange(r).run(); pickFilesAndInsert(e, "*/*"); } },
];

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q));
}

type SlashListProps = { items: SlashItem[]; command: (item: SlashItem) => void };

const SlashList = forwardRef<{ onKeyDown: (e: { event: KeyboardEvent }) => boolean }, SlashListProps>(
  ({ items, command }, ref) => {
    const [active, setActive] = useState(0);
    useEffect(() => setActive(0), [items]);

    const select = (i: number) => {
      const it = items[i];
      if (it) command(it);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowUp") { setActive((a) => (a + items.length - 1) % items.length); return true; }
        if (event.key === "ArrowDown") { setActive((a) => (a + 1) % items.length); return true; }
        if (event.key === "Enter") { select(active); return true; }
        return false;
      },
    }));

    if (items.length === 0) return <div className="slash-empty">결과 없음</div>;
    return (
      <div className="slash-menu">
        {items.map((it, i) => (
          <button
            key={it.title}
            type="button"
            className={`slash-item ${i === active ? "is-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => { e.preventDefault(); select(i); }}
          >
            <span className="slash-ic">{it.icon}</span>
            <span className="slash-body">
              <span className="slash-title">{it.title}</span>
              <span className="slash-hint">{it.hint}</span>
            </span>
          </button>
        ))}
      </div>
    );
  },
);
SlashList.displayName = "SlashList";

export const SlashCommands = Extension.create({
  name: "slashCommands",
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        pluginKey: new PluginKey("meetingSlash"),
        // 줄 시작 또는 공백 뒤의 "/" 에서만 발동 (URL·코드 중간 "/" 무시)
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          if (!$from.parent.isTextblock) return false;
          if ($from.parentOffset === 0) return true;
          const charBefore = state.doc.textBetween(range.from - 1, range.from);
          return /\s/.test(charBefore);
        },
        command: ({ editor, range, props }) => {
          props.run(editor, range);
        },
        items: ({ query }) => filterItems(query).slice(0, 10),
        render: () => {
          let root: Root | null = null;
          let container: HTMLDivElement | null = null;
          let listRef: { onKeyDown: (e: { event: KeyboardEvent }) => boolean } | null = null;

          function position(rect: DOMRect | null | (() => DOMRect | null)) {
            const r = typeof rect === "function" ? rect() : rect;
            if (!r || !container) return;
            const popupH = container.offsetHeight || 280;
            const below = r.bottom + 4;
            const flip = below + popupH > window.innerHeight;
            container.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
            container.style.top = `${flip ? r.top - popupH - 4 : below}px`;
          }

          return {
            onStart: (props: any) => {
              container = document.createElement("div");
              container.className = "slash-popup-host";
              container.style.position = "fixed";
              container.style.zIndex = "9999";
              document.body.appendChild(container);
              root = createRoot(container);
              root.render(<SlashList ref={(r) => { listRef = r; }} items={props.items} command={props.command} />);
              position(props.clientRect);
            },
            onUpdate: (props: any) => {
              if (!root) return;
              root.render(<SlashList ref={(r) => { listRef = r; }} items={props.items} command={props.command} />);
              position(props.clientRect);
            },
            onKeyDown: (props: any) => {
              if (props.event.key === "Escape") return true;
              return listRef?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              const r = root;
              const c = container;
              queueMicrotask(() => {
                r?.unmount();
                c?.remove();
              });
              root = null;
              container = null;
              listRef = null;
            },
          };
        },
      }),
    ];
  },
});
