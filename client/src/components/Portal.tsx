import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 자식을 document.body 바로 아래로 포털 렌더한다.
 *
 * 왜 필요한가 — 모바일 본문 스크롤러(<main>)는 overflow-y:auto + -webkit-overflow-scrolling:touch
 * 인데, iOS WebKit 은 이런 스크롤 컨테이너 안의 position:fixed 를 "뷰포트"가 아니라 그 스크롤
 * 컨테이너 기준으로 잡는 버그가 있다. 그래서 페이지 안에서 렌더된 모달(fixed inset-0)이 상단바
 * 아래에만 갇히고, max-height:100% 도 엉뚱하게 계산돼 헤더/풋터가 잘려 나간다.
 * 모달 오버레이를 body 로 포털하면 스크롤 컨테이너를 벗어나 진짜 뷰포트 기준 fixed 가 된다.
 *
 * .modal-safe 관찰자(네이티브 탭바 숨김)와 html:has(.modal-safe) 규칙은 body 하위를 보므로
 * 포털해도 그대로 동작한다.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [host] = useState(() => document.createElement("div"));
  useEffect(() => {
    document.body.appendChild(host);
    return () => {
      try { document.body.removeChild(host); } catch { /* 이미 제거됨 */ }
    };
  }, [host]);
  return createPortal(children, host);
}
