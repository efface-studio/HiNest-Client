import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { markdownToHtml, looksLikeMarkdown } from "../lib/markdownToHtml";
import { useEffect, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import Select, { type SelectOption } from "./Select";
import "./MeetingEditor.css";
import { promptAsync } from "./ConfirmHost";
import MentionList, { type MentionUser } from "./MentionList";
import { parseCodeSegments } from "../lib/codeDetect";
import { EditorImage, FileAttachment, uploadEditorFile, uploadAndInsertAt } from "./editorMedia";
import { SlashCommands } from "./editorSlash";

/** 페이스트된 평문이 코드처럼 보이는지 — codeDetect 의 휴리스틱 재사용.
 *  parseCodeSegments 가 반환하는 segment 중 코드(펜스/휴리스틱)가 본문 대부분을 차지하면 true. */
function looksLikeCodeForEditor(text: string): boolean {
  if (text.length < 10) return false;
  const segs = parseCodeSegments(text);
  // 모든 segment 가 code 거나, 단일 code segment 면 명백히 코드.
  if (segs.length === 1 && segs[0].kind === "code") return true;
  const codeChars = segs
    .filter((s) => s.kind === "code")
    .reduce((sum, s) => sum + (s.kind === "code" ? s.code.length : 0), 0);
  // 본문의 60% 이상이 코드 영역이면 통째로 코드 취급.
  return codeChars >= text.length * 0.6;
}

/** 노션식 글씨 크기(픽셀) — textStyle 의 `data-font-size` 속성으로 직렬화. */
const FONT_SIZES = [
  { label: "기본", value: "" },
  { label: "작게", value: "12px" },
  { label: "보통", value: "14px" },
  { label: "크게", value: "18px" },
  { label: "제목", value: "24px" },
  { label: "대제목", value: "32px" },
];

const fontSizeOptions: SelectOption[] = FONT_SIZES.map((f) => ({ value: f.value, label: f.label }));

const TEXT_COLORS = [
  { label: "기본", value: "" },
  { label: "회색", value: "#6B7280" },
  { label: "빨강", value: "#EF4444" },
  { label: "주황", value: "#F59E0B" },
  { label: "노랑", value: "#EAB308" },
  { label: "초록", value: "#16A34A" },
  { label: "파랑", value: "#2563EB" },
  { label: "보라", value: "#7C3AED" },
  { label: "분홍", value: "#DB2777" },
];

const HIGHLIGHT_COLORS = [
  { label: "형광없음", value: "" },
  { label: "노랑", value: "#FEF08A" },
  { label: "초록", value: "#BBF7D0" },
  { label: "파랑", value: "#BFDBFE" },
  { label: "분홍", value: "#FBCFE8" },
  { label: "회색", value: "#E5E7EB" },
];

/**
 * TextStyle 에 font-size 속성을 얹어주는 커스텀 확장.
 * @tiptap 공식 FontSize 확장은 아직 별도 패키지가 없어서 직접 구현.
 */
const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: any) => {
          if (!size) return chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run();
          return chain().setMark("textStyle", { fontSize: size }).run();
        },
    } as any;
  },
});

type Props = {
  value?: any; // TipTap JSON doc
  onChange?: (json: any) => void;
  editable?: boolean;
  placeholder?: string;
  /**
   * "@" 를 치면 호출됨. 최근 query 에 맞는 멘션 대상 후보 반환.
   * 권한 체크는 서버 /api/meeting/mentionable 이 담당.
   */
  mentionFetcher?: (query: string) => Promise<MentionUser[]>;
};

export default function MeetingEditor({ value, onChange, editable = true, placeholder, mentionFetcher }: Props) {
  // 멘션 suggestion 렌더러 — createRoot 기반 팝업. 에디터 인스턴스당 1개.
  const mentionSuggestion = useMemo(
    () => buildMentionSuggestion(mentionFetcher),
    // mentionFetcher 는 부모에서 useCallback 으로 고정해야 함.
    [mentionFetcher],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TextStyle,
      FontSize,
      Color,
      Underline,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      Placeholder.configure({ placeholder: placeholder ?? "여기에 회의록을 작성하세요..." }),
      TaskList,
      TaskItem.configure({ nested: true }),
      EditorImage,
      FileAttachment,
      SlashCommands,
      ...(mentionFetcher
        ? [
            Mention.configure({
              HTMLAttributes: { class: "mention" },
              suggestion: mentionSuggestion,
              renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
            }),
          ]
        : []),
    ],
    // 평문 붙여넣기를 가로채서 코드처럼 보이면 codeBlock 으로 변환.
    // - HTML 페이스트(워드/노션 등 서식 있는 출처)는 건드리지 않음
    // - 휴리스틱은 lib/codeDetect.ts 와 동일 규칙 (한글 비율·코드 토큰 비율)
    editorProps: {
      // 파일 드래그&드롭 → 업로드 후 드롭 위치(노션식)에 이미지/파일 노드 삽입.
      handleDrop: (view, event) => {
        const dragEvent = event as DragEvent;
        const files = Array.from(dragEvent.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: dragEvent.clientX, top: dragEvent.clientY });
        const pos = at?.pos ?? view.state.selection.from;
        for (const f of files) void uploadAndInsertAt(view, pos, f);
        return true;
      },
      handlePaste: (view, event) => {
        // 0) 이미지 파일 붙여넣기(스크린샷 등) → 업로드 후 커서 위치에 삽입.
        const imgFiles = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (imgFiles.length > 0) {
          event.preventDefault();
          const pos = view.state.selection.from;
          for (const f of imgFiles) void uploadAndInsertAt(view, pos, f);
          return true;
        }
        const html = event.clipboardData?.getData("text/html");
        if (html) return false; // 리치 HTML 페이스트(워드·웹 등)는 기본 동작 유지
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;

        // 1) 순수 코드 → codeBlock (기존 동작)
        if (looksLikeCodeForEditor(text)) {
          event.preventDefault();
          const { schema } = view.state;
          const codeBlock = schema.nodes.codeBlock;
          if (!codeBlock) return false;
          const node = codeBlock.create({}, schema.text(text));
          const tr = view.state.tr.replaceSelectionWith(node);
          view.dispatch(tr);
          return true;
        }

        // 2) 마크다운 → HTML 변환 후 ProseMirror 슬라이스로 삽입(서식 살림)
        if (looksLikeMarkdown(text)) {
          try {
            const htmlStr = markdownToHtml(text);
            const dom = new window.DOMParser().parseFromString(htmlStr, "text/html");
            const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(dom.body);
            const tr = view.state.tr.replaceSelection(slice);
            view.dispatch(tr);
            event.preventDefault();
            return true;
          } catch {
            return false; // 변환 실패 시 기본(평문) 동작으로 폴백
          }
        }

        // 3) 그 외 → 기본 평문 페이스트
        return false;
      },
    },
    content: value ?? "",
    editable,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
    },
  });

  // 외부에서 value 가 바뀌면 에디터 갱신 (다른 회의록으로 네비 시)
  useEffect(() => {
    if (!editor) return;
    const current = JSON.stringify(editor.getJSON());
    const incoming = JSON.stringify(value ?? "");
    if (current !== incoming) {
      editor.commands.setContent(value ?? "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  return (
    <div
      className={`meeting-editor ${editable ? "" : "is-readonly"}`}
      // 에디터 컨테이너 전체를 파일 드롭존으로 확장 — 글쓰기 영역(.ProseMirror)이 작은 빈 메모에서도
      // 근처에 떨어뜨리면 삽입되게. 텍스트 위에 정확히 떨어지면 ProseMirror 의 handleDrop 이 처리하고
      // (드롭 위치 삽입) e.defaultPrevented 가 켜지므로, 여기선 그 바깥(여백·툴바 등)에 떨어진
      // 파일만 문서 끝에 삽입한다(중복 방지). 빈 영역에 떨궈도 안 먹던 기존 문제 해결.
      onDragOver={editable ? (e) => { if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault(); } : undefined}
      onDrop={editable ? (e) => {
        if (e.defaultPrevented) return; // ProseMirror 가 이미 처리(텍스트 위 드롭)
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        const pos = editor.state.doc.content.size; // 문서 끝
        for (const f of files) void uploadAndInsertAt(editor.view, pos, f);
      } : undefined}
    >
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="meeting-editor-content" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const fileRef = useRef<HTMLInputElement>(null);

  // 툴바 첨부 버튼 — 고른 파일들을 업로드해 커서 위치에 이미지/파일로 삽입.
  async function onPickFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    for (const f of files) {
      const r = await uploadEditorFile(f);
      if (!r) continue;
      if (r.kind === "IMAGE") {
        editor.chain().focus().insertContent({ type: "image", attrs: { src: r.url, alt: r.name } }).run();
      } else {
        editor.chain().focus().insertContent({ type: "fileAttachment", attrs: { href: r.url, name: r.name, size: r.size, mime: r.type } }).run();
      }
    }
  }

  return (
    <div className="meeting-toolbar">
      {/* 글씨 크기 */}
      <Select
        className="meeting-toolbar-select"
        value={editor.getAttributes("textStyle").fontSize ?? ""}
        onChange={(v) => (editor.chain().focus() as any).setFontSize(v).run()}
        ariaLabel="글씨 크기"
        options={fontSizeOptions}
      />

      {/* 제목 레벨 */}
      <Select
        className="meeting-toolbar-select"
        value={
          editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "p"
        }
        onChange={(v) => {
          if (v === "p") editor.chain().focus().setParagraph().run();
          else editor.chain().focus().toggleHeading({ level: (parseInt(v.slice(1)) as 1 | 2 | 3) }).run();
        }}
        ariaLabel="단락/제목"
        options={[
          { value: "p", label: "본문" },
          { value: "h1", label: "제목 1" },
          { value: "h2", label: "제목 2" },
          { value: "h3", label: "제목 3" },
        ]}
      />

      <Divider />

      <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="굵게 (⌘B)">
        <b>B</b>
      </ToolBtn>
      <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="기울임 (⌘I)">
        <i>I</i>
      </ToolBtn>
      <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="밑줄 (⌘U)">
        <u>U</u>
      </ToolBtn>
      <ToolBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="취소선">
        <s>S</s>
      </ToolBtn>
      <ToolBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="인라인 코드">
        {"<>"}
      </ToolBtn>

      <Divider />

      {/* 글씨 색 */}
      <ColorPicker
        label="글씨색"
        colors={TEXT_COLORS}
        current={editor.getAttributes("textStyle").color ?? ""}
        onPick={(v) => {
          if (!v) editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(v).run();
        }}
        swatchSymbol="A"
      />

      {/* 형광펜 */}
      <ColorPicker
        label="형광펜"
        colors={HIGHLIGHT_COLORS}
        current={editor.getAttributes("highlight").color ?? ""}
        onPick={(v) => {
          if (!v) editor.chain().focus().unsetHighlight().run();
          else editor.chain().focus().toggleHighlight({ color: v }).run();
        }}
        swatchSymbol="🖍"
      />

      <Divider />

      <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="글머리 기호">
        •
      </ToolBtn>
      <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="번호 매기기">
        1.
      </ToolBtn>
      <ToolBtn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} title="체크박스">
        ☐
      </ToolBtn>
      <ToolBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="인용">
        ❝
      </ToolBtn>
      <ToolBtn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="코드 블록">
        {"{}"}
      </ToolBtn>

      <Divider />

      {/* 정렬 */}
      <ToolBtn active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="좌측 정렬">
        <AlignIcon d="M4 6h16M4 10h10M4 14h16M4 18h10" />
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="가운데 정렬">
        <AlignIcon d="M4 6h16M7 10h10M4 14h16M7 18h10" />
      </ToolBtn>
      <ToolBtn active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="우측 정렬">
        <AlignIcon d="M4 6h16M10 10h10M4 14h16M10 18h10" />
      </ToolBtn>

      <Divider />

      <ToolBtn
        active={editor.isActive("link")}
        onClick={async () => {
          const prev = editor.getAttributes("link").href ?? "";
          const url = await promptAsync({
            title: "링크 URL",
            placeholder: "https://",
            defaultValue: prev,
            confirmLabel: "적용",
          });
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        title="링크"
      >
        🔗
      </ToolBtn>

      <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="구분선">
        ―
      </ToolBtn>

      <ToolBtn onClick={() => fileRef.current?.click()} title="이미지·파일 첨부">
        📎
      </ToolBtn>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,*/*"
        style={{ display: "none" }}
        onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ""; }}
      />

      <Divider />

      <ToolBtn onClick={() => editor.chain().focus().undo().run()} title="되돌리기">
        ↶
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} title="다시 실행">
        ↷
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`meeting-toolbar-btn ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="meeting-toolbar-divider" />;
}

/**
 * TipTap Mention suggestion 설정 빌더.
 * tippy 없이 document.body 에 직접 띄운 div + React root 로 팝업을 구현한다.
 * (새 의존성 줄이고 z-index/CSP 충돌 줄이는 목적)
 */
function buildMentionSuggestion(fetcher: ((q: string) => Promise<MentionUser[]>) | undefined) {
  return {
    char: "@",
    // 다른 Mention extension 과 충돌하지 않도록 별도 키 — 회의록 전용.
    pluginKey: new PluginKey("meetingMention"),
    items: async ({ query }: { query: string }) => {
      if (!fetcher) return [];
      try {
        const list = await fetcher(query);
        return list.slice(0, 20);
      } catch {
        return [];
      }
    },
    render: () => {
      let root: Root | null = null;
      let container: HTMLDivElement | null = null;
      let listRef: { onKeyDown: (e: { event: KeyboardEvent }) => boolean } | null = null;

      function position(rect: DOMRect | null | (() => DOMRect | null)) {
        const r = typeof rect === "function" ? rect() : rect;
        if (!r || !container) return;
        // 커서 아래 4px, 화면 하단 넘치면 위로 플립
        const popupH = container.offsetHeight || 240;
        const below = r.bottom + 4;
        const flip = below + popupH > window.innerHeight;
        container.style.left = `${Math.min(r.left, window.innerWidth - 280)}px`;
        container.style.top = `${flip ? r.top - popupH - 4 : below}px`;
      }

      return {
        onStart: (props: any) => {
          container = document.createElement("div");
          container.className = "mention-popup-host";
          container.style.position = "fixed";
          container.style.zIndex = "9999";
          document.body.appendChild(container);
          root = createRoot(container);
          root.render(
            <MentionList
              ref={(r) => {
                listRef = r;
              }}
              items={props.items}
              command={props.command}
            />,
          );
          position(props.clientRect);
        },
        onUpdate: (props: any) => {
          if (!root) return;
          root.render(
            <MentionList
              ref={(r) => {
                listRef = r;
              }}
              items={props.items}
              command={props.command}
            />,
          );
          position(props.clientRect);
        },
        onKeyDown: (props: any) => {
          if (props.event.key === "Escape") {
            return true;
          }
          return listRef?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          // React root unmount 는 다음 tick 으로 미뤄야 `flushSync` 경고가 안 뜬다.
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
  };
}

function AlignIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={d} />
    </svg>
  );
}

function ColorPicker({
  label,
  colors,
  current,
  onPick,
  swatchSymbol,
}: {
  label: string;
  colors: { label: string; value: string }[];
  current: string;
  onPick: (v: string) => void;
  swatchSymbol: string;
}) {
  return (
    <div className="meeting-toolbar-dropdown" tabIndex={0}>
      <button type="button" className="meeting-toolbar-btn" title={label}>
        <span style={{ color: current || undefined }}>{swatchSymbol}</span>
        <span className="meeting-toolbar-caret">▾</span>
      </button>
      <div className="meeting-toolbar-menu">
        {colors.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`meeting-toolbar-menu-item ${current === c.value ? "is-active" : ""}`}
            onClick={() => onPick(c.value)}
          >
            <span
              className="meeting-toolbar-swatch"
              style={{ background: c.value || "transparent", border: c.value ? "none" : "1px dashed #CBD5E1" }}
            />
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
