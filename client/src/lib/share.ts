/**
 * 공유 트리거 — iOS/iPadOS 에서는 애플 기본 바텀시트(네이티브 UISheetPresentationController)로,
 * 그 외(웹/데스크톱/안드로이드)는 웹 ShareSheet 로 폴백한다.
 *
 * presentShareNative() 가 true 를 반환하면 네이티브 시트가 떴다는 뜻 → 호출부는 웹 시트를 안 연다.
 * false(미지원·실패)면 호출부가 웹 ShareSheet 를 연다.
 */
import { nativePlatform } from "./platform";
import { getAuthToken } from "./authToken";
import { API_BASE } from "../api";
import type { SharePayload } from "../components/ShareSheet";

export async function presentShareNative(payload: SharePayload): Promise<boolean> {
  if (nativePlatform() !== "ios") return false;
  try {
    const { LiquidGlassTabBar } = await import("./liquidGlassTabBar");
    const apiBase = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const res = await LiquidGlassTabBar.presentShareSheet({
      kind: payload.kind,
      title: payload.title,
      snippet: payload.snippet,
      href: payload.href,
      token: getAuthToken() ?? "",
      apiBase,
    });
    return !!res?.presented;
  } catch {
    return false; // 플러그인 미지원/오류 → 웹 폴백
  }
}
