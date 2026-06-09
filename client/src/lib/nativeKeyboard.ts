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
  // + 키보드 표시/숨김에 따라 html 에 `hinest-keyboard-open` 클래스 + CSS 변수
  //   `--hinest-keyboard-h` 를 노출해, 하단 네비바를 숨기거나 로그인 폼을 키보드 위로
  //   끌어올리는 등 네이티브 같은 동작이 CSS 만으로 가능하게 한다.
  const removeKbListeners: Array<() => void> = [];
  const setKbOpen = (h: number) => {
    document.documentElement.classList.add("hinest-keyboard-open");
    document.documentElement.style.setProperty("--hinest-keyboard-h", `${Math.max(0, Math.round(h))}px`);
  };
  const setKbClosed = () => {
    document.documentElement.classList.remove("hinest-keyboard-open");
    document.documentElement.style.setProperty("--hinest-keyboard-h", "0px");
  };
  setKbClosed();
  void import("@capacitor/keyboard")
    .then(({ Keyboard }) => {
      const reg = (ev: string, fn: (info?: { keyboardHeight: number }) => void) => {
        Keyboard.addListener(ev as never, fn as never).then((h) => {
          removeKbListeners.push(() => { try { void h.remove(); } catch {} });
        });
      };
      // willShow 가 더 빠름(애니메이션 시작 직전) — 네비바 숨김·인셋 적용을 미리 시작해
      // 키보드가 올라오는 동안 jank 가 없다. didShow 에선 정확한 높이로 확정.
      reg("keyboardWillShow", (info) => setKbOpen(info?.keyboardHeight ?? 0));
      reg("keyboardDidShow", (info) => { setKbOpen(info?.keyboardHeight ?? 0); scrollFocusedIntoView(); });
      reg("keyboardWillHide", () => setKbClosed());
      reg("keyboardDidHide", () => setKbClosed());
    })
    .catch(() => {});

  document.addEventListener("focusin", onFocusIn, { passive: true });

  return () => {
    document.removeEventListener("focusin", onFocusIn);
    if (pendingTimer) clearTimeout(pendingTimer);
    removeKbListeners.forEach((fn) => fn());
    setKbClosed();
  };
}
