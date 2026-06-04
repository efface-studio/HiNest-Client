import { registerPlugin } from "@capacitor/core";

/**
 * 네이티브 Liquid Glass 하단 탭 바 브리지 (iOS 26 UIGlassEffect).
 * 네이티브 구현은 ios/App/App/AppDelegate.swift 의 LiquidGlassTabBarPlugin.
 *
 * - configure: 탭 구성 + 바 생성. iOS 26 미만/실패 시 reject → 호출부가 catch 해서
 *   웹 CSS 글래스 바를 그대로 폴백으로 둔다(앱이 깨지지 않음).
 * - tabSelected 이벤트: 네이티브 탭을 누르면 발생 → 웹 라우터가 해당 경로로 이동.
 * - setSelected: 웹 경로 변화 시 네이티브 하이라이트 동기화.
 */

export interface LiquidGlassTab {
  /** 라우트 경로 (예: "/schedule"). tabSelected 시 그대로 전달된다. */
  key: string;
  /** 탭 라벨. */
  title: string;
  /** SF Symbol 이름 (예: "house.fill"). */
  sf: string;
}

export interface LiquidGlassTabBarPlugin {
  configure(options: { tabs: LiquidGlassTab[] }): Promise<{ active: boolean }>;
  setSelected(options: { key: string }): Promise<void>;
  setBadge(options: { key: string; count: number }): Promise<void>;
  setVisible(options: { visible: boolean }): Promise<void>;
  /** 애플 기본 확인 시트(action sheet). 로그아웃 등 재확인용. */
  confirm(options: {
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
  }): Promise<{ confirmed: boolean }>;
  addListener(
    eventName: "tabSelected",
    listenerFunc: (data: { key: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

export const LiquidGlassTabBar = registerPlugin<LiquidGlassTabBarPlugin>("LiquidGlassTabBar");
