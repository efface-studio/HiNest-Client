/**
 * 네이티브 키보드 동작 보정 — iOS/iPadOS 에서 입력 포커스 시 키보드가 입력칸을 가리지 않게
 * 포커스된 요소를 보이는 영역으로 스크롤한다.
 *
 * Keyboard.resize="native" 는 WebView 자체를 키보드 높이만큼 줄여주지만, 스크롤 컨테이너
 * 깊숙한 곳의 입력칸은 여전히 키보드 뒤에 남을 수 있다(특히 화면 하단 폼). 키보드가 다 올라온
 * 뒤 scrollIntoView 로 한 번 더 끌어올려 '웹처럼 입력칸이 가려지는' 문제를 없앤다.
 *
 * 웹/데스크톱/안드로이드는 no-op.
 */
import { nativePlatform } from "./platform";

function isNative(): boolean {
  return nativePlatform() === "ios";
}

export function attachNativeKeyboard(): () => void {
  if (!isNative()) return () => {};

  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // 포커스된 입력칸을 보이는 영역 가운데로. block:"center" 가 키보드 위로 충분히 띄운다.
  const scrollFocusedIntoView = () => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return;
    const tag = el.tagName;
    const editable =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    if (!editable) return;
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      el.scrollIntoView();
    }
  };

  // focusin: 입력칸에 포커스가 들어오면, 키보드 등장 애니메이션(약 300ms)이 끝난 뒤 스크롤.
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const tag = t.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT" && !t.isContentEditable) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(scrollFocusedIntoView, 320);
  };

  // 키보드 플러그인 이벤트로도 보정 — 기기/버전별 키보드 높이 확정 시점에 한 번 더.
  let removeKbListener: (() => void) | null = null;
  void import("@capacitor/keyboard")
    .then(({ Keyboard }) => {
      Keyboard.addListener("keyboardDidShow", scrollFocusedIntoView).then((h) => {
        removeKbListener = () => { try { void h.remove(); } catch {} };
      });
    })
    .catch(() => {});

  document.addEventListener("focusin", onFocusIn, { passive: true });

  return () => {
    document.removeEventListener("focusin", onFocusIn);
    if (pendingTimer) clearTimeout(pendingTimer);
    removeKbListener?.();
  };
}
