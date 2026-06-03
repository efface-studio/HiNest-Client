import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { safeExternalUrl } from "../../lib/safeUrl";
import { openExternal } from "../../lib/openExternal";

/**
 * 메시지 본문 안 첫 URL 의 OG/Twitter Card 메타를 가져와 카드로 표시.
 *
 * - 채팅방을 열 때마다 한 번만 fetch — 동일 URL 은 sessionStorage 에 메모.
 * - 서버 측에 30분 LRU 가 또 있어 사실상 N+1 한 번이면 끝.
 * - 메타가 비어있으면(title 없음) 카드 자체 안 그림.
 */

type Meta = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
};

const LS_PREFIX = "hinest.unfurl.";

function loadCached(url: string): Meta | null {
  try {
    const raw = sessionStorage.getItem(LS_PREFIX + url);
    if (!raw) return null;
    return JSON.parse(raw) as Meta;
  } catch {
    return null;
  }
}
function saveCached(url: string, m: Meta) {
  try {
    sessionStorage.setItem(LS_PREFIX + url, JSON.stringify(m));
  } catch {
    // 용량 초과 등 무시
  }
}

export function LinkPreview({ url, mine }: { url: string; mine: boolean }) {
  const [meta, setMeta] = useState<Meta | null>(() => loadCached(url));
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (meta) return;
    let cancelled = false;
    api<Meta>("/api/unfurl", { method: "POST", json: { url } })
      .then((m) => {
        if (cancelled || !aliveRef.current) return;
        if (m && (m.title || m.description || m.image)) {
          setMeta(m);
          saveCached(url, m);
        } else {
          // 메타가 비면 빈 카드 안 그리도록 빈 메타 캐시 — 이후 같은 URL 재요청 안 감.
          saveCached(url, { url });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // url 단위 fetch — meta 갱신은 알아서.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!meta || (!meta.title && !meta.description && !meta.image)) return null;

  // href 는 http(s) 만 허용 — unfurl 응답 url 이 비정상 스킴(javascript:/data:)이면
  // 클릭형 카드 자체를 그리지 않는다(방어적, ServiceAccountsPage 와 동일 정책).
  const safeUrl = safeExternalUrl(meta.url);
  if (!safeUrl) return null;

  const host = (() => {
    try { return new URL(safeUrl).host; } catch { return ""; }
  })();

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openExternal(safeUrl);
      }}
      style={{
        display: "flex",
        margin: "6px 0 2px",
        textDecoration: "none",
        borderRadius: 12,
        overflow: "hidden",
        background: mine ? "rgba(0,0,0,0.18)" : "var(--c-surface-2)",
        border: mine ? "1px solid rgba(255,255,255,0.14)" : "1px solid var(--c-border)",
        maxWidth: "100%",
      }}
    >
      {meta.image && (
        <div
          style={{
            width: 88,
            minHeight: 88,
            flexShrink: 0,
            backgroundImage: `url(${meta.image})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
          aria-hidden
        />
      )}
      <div style={{ flex: 1, minWidth: 0, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 11,
            fontWeight: 600,
            color: mine ? "rgba(255,255,255,0.75)" : "var(--c-text-3)",
            minWidth: 0,
          }}
        >
          {meta.favicon && (
            <img
              src={meta.favicon}
              alt=""
              width={12}
              height={12}
              loading="lazy"
              // 제3자 파비콘 호스트에 현재 페이지(Referer) 를 흘리지 않는다.
              referrerPolicy="no-referrer"
              style={{ flexShrink: 0, borderRadius: 2 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {meta.siteName || host}
          </span>
        </div>
        {meta.title && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.3,
              color: mine ? "#fff" : "var(--c-text)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {meta.title}
          </div>
        )}
        {meta.description && (
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.35,
              color: mine ? "rgba(255,255,255,0.85)" : "var(--c-text-2)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {meta.description}
          </div>
        )}
      </div>
    </a>
  );
}

/** 본문에서 첫 http(s) URL 추출 — 코드 블록 안의 URL 은 펜스 떼낸 뒤 호출하므로 잡히지 않음. */
export function extractFirstUrl(text: string): string | null {
  const m = /(https?:\/\/[^\s<>"'`]+)/i.exec(text);
  if (!m) return null;
  // 문장 끝 구두점 제거.
  return m[1].replace(/[).,!?;:]+$/, "");
}
