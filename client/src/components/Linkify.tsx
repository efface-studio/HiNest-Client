import React from "react";
import { openExternal } from "../lib/openExternal";

/**
 * 텍스트 안의 URL을 자동으로 <a>로 변환.
 * - http(s)://, www.  로 시작하는 링크 감지
 * - 이메일 감지
 * - 줄바꿈 보존
 */
const URL_RE = /(\bhttps?:\/\/[^\s<>]+[^\s<>.,!?)\]}'"'])|(\bwww\.[^\s<>]+[^\s<>.,!?)\]}'"'])|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export default function Linkify({
  text,
  className,
  linkClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  if (!text) return null;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(URL_RE);

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const matched = m[0];
    if (start > last) parts.push(text.slice(last, start));

    let href = matched;
    const label = matched;
    if (m[3]) {
      // email
      href = `mailto:${matched}`;
    } else if (!matched.startsWith("http")) {
      href = `https://${matched}`;
    }

    parts.push(
      <a
        key={`${start}-${matched}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName ?? "underline underline-offset-2 hover:opacity-80 break-all"}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); openExternal(href); }}
      >
        {label}
      </a>
    );
    last = start + matched.length;
  }
  if (last < text.length) parts.push(text.slice(last));

  return <span className={className}>{parts}</span>;
}
