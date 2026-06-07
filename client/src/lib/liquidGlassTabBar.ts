import { registerPlugin } from "@capacitor/core";
import { isCapacitorNative } from "./platform";

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
  /** iOS 에셋 카탈로그 이미지 이름(앱 기존 아이콘, template 렌더링). 예: "tab-home". */
  icon: string;
}

export interface LiquidGlassTabBarPlugin {
  /** selected: 초기 선택 탭 key(현재 경로). 새로고침 시 개요가 깜빡였다 점프하는 것 방지. */
  configure(options: { tabs: LiquidGlassTab[]; selected?: string }): Promise<{ active: boolean }>;
  setSelected(options: { key: string }): Promise<void>;
  setBadge(options: { key: string; count: number }): Promise<void>;
  setVisible(options: { visible: boolean }): Promise<void>;
  /** 세션 토큰을 공유 App Group 에 기록 — NSE(채팅 아바타)의 /uploads 인증용. token="" 이면 제거. */
  setSharedToken(options: { token: string; group?: string }): Promise<void>;
  /** 앱 테마를 네이티브 윈도우/탭바에 반영. light/dark/system. 저장돼 다음 실행 첫 페인트에도 적용. */
  setInterfaceStyle(options: { style: "light" | "dark" | "system" }): Promise<void>;
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

/* ===========================================================================
 * 네이티브 탭 바 가시성 관리.
 * 탭 바는 웹뷰 위에 떠 있는 네이티브 오버레이라, 풀스크린 웹 화면(채팅·알림·모달)에선
 * 가려야 한다. 여러 곳에서 "이유(reason)" 별로 숨김을 요청할 수 있고, 하나라도 숨김이면 숨긴다.
 * iOS 네이티브에서만 동작(그 외엔 no-op).
 * ======================================================================== */
const hideReasons = new Set<string>();
let lastVisible: boolean | null = null;

function applyVisibility() {
  if (!isCapacitorNative()) return;
  const visible = hideReasons.size === 0;
  if (visible === lastVisible) return;
  lastVisible = visible;
  LiquidGlassTabBar.setVisible({ visible }).catch(() => {});
}

/** 사유별 숨김 토글. (예: "chat", "modal", "route") */
export function setNativeTabBarHidden(reason: string, hidden: boolean) {
  if (hidden) hideReasons.add(reason);
  else hideReasons.delete(reason);
  applyVisibility();
}

/** 바를 (재)생성한 직후 현재 사유 집합 기준으로 가시성 재적용. */
export function syncNativeTabBarVisibility() {
  lastVisible = null;
  applyVisibility();
}
