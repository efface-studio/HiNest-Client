import { Node, mergeAttributes } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { apiFetch } from "../api";
import { fmtSize } from "../lib/fmt";

/**
 * 메모/회의록(MeetingEditor) 공용 — 본문 어디든(커서·드롭·붙여넣기 위치) 넣는 인라인 미디어.
 * 노션식: 이미지는 인라인 이미지로, 그 외 파일은 다운로드 카드로 문서 흐름 안에 삽입된다.
 * src/href 는 우리 업로드 경로(/uploads/...) — 업로드는 채팅과 동일한 /api/upload 사용.
 */

/** 인라인 이미지 노드(블록). 드래그로 위치 이동도 가능. */
export const EditorImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes(HTMLAttributes, { class: "me-img" })];
  },
});

/** 인라인 파일 첨부 카드(블록). 클릭 시 다운로드. */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: null },
      size: { default: null },
      mime: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: "a[data-file-attachment]" }];
  },
  renderHTML({ node }) {
    const name = String(node.attrs.name ?? "파일");
    const size = typeof node.attrs.size === "number" ? fmtSize(node.attrs.size) : "";
    return [
      "a",
      {
        "data-file-attachment": "",
        href: node.attrs.href ?? "#",
        download: name,
        target: "_blank",
        rel: "noopener noreferrer",
        class: "me-file",
        contenteditable: "false",
      },
      ["span", { class: "me-file-ic" }, "📎"],
      [
        "span",
        { class: "me-file-body" },
        ["span", { class: "me-file-name" }, name],
        ["span", { class: "me-file-size" }, size],
      ],
    ];
  },
});

export type UploadResult = { url: string; name: string; type: string; size: number; kind: string };

/** 파일 1개 업로드 → 결과(또는 실패 시 null). 채팅과 동일 엔드포인트(인증·테넌트 격리 그대로). */
export async function uploadEditorFile(file: File): Promise<UploadResult | null> {
  try {
    const form = new FormData();
    form.append("file", file);
    const r = await apiFetch("/api/upload", { method: "POST", body: form });
    if (!r.ok) return null;
    return (await r.json()) as UploadResult;
  } catch {
    return null;
  }
}

/** 업로드 결과를 이미지/파일 노드로 만들어 pos 위치에 삽입(드롭·붙여넣기 공용, view 기반). */
export async function uploadAndInsertAt(view: EditorView, pos: number, file: File): Promise<void> {
  const r = await uploadEditorFile(file);
  if (!r) return;
  const { schema } = view.state;
  const node =
    r.kind === "IMAGE" && schema.nodes.image
      ? schema.nodes.image.create({ src: r.url, alt: r.name })
      : schema.nodes.fileAttachment
        ? schema.nodes.fileAttachment.create({ href: r.url, name: r.name, size: r.size, mime: r.type })
        : null;
  if (!node) return;
  // 업로드(비동기) 동안 문서가 바뀌었을 수 있으니 현재 문서 크기로 클램프.
  const p = Math.max(0, Math.min(pos, view.state.doc.content.size));
  view.dispatch(view.state.tr.insert(p, node));
}
