import { isCapacitorNative } from "./platform";
import { LiquidGlassTabBar } from "./liquidGlassTabBar";
import { confirmAsync } from "../components/ConfirmHost";

/**
 * 로그아웃 전 재확인.
 * - 네이티브 iOS: 애플 기본 확인 시트(UIAlertController .actionSheet) — 빨간 "로그아웃" + "취소".
 * - 웹/데스크톱(또는 네이티브 confirm 실패 시): 기존 웹 confirm(ConfirmHost) 폴백.
 * 반환 true = 로그아웃 진행.
 */
export async function confirmLogout(): Promise<boolean> {
  if (isCapacitorNative()) {
    try {
      const r = await LiquidGlassTabBar.confirm({
        title: "로그아웃",
        message: "정말 로그아웃할까요?",
        confirmText: "로그아웃",
        cancelText: "취소",
        destructive: true,
      });
      return !!r?.confirmed;
    } catch {
      // 네이티브 시트 실패 → 웹 폴백.
    }
  }
  const ok = await confirmAsync({
    title: "로그아웃",
    description: "정말 로그아웃할까요?",
    tone: "danger",
  });
  return ok === true;
}
