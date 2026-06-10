package com.hivits.hinest;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 고중요도 알림 채널 id. 구 "default" 채널의 굳은 설정을 피하려 새 id 사용. */
    static final String CHANNEL_ID = "hinest_alerts";

    /**
     * 앱이 현재 포그라운드(Activity resumed)인지 — HiNestMessagingService 가 채팅 푸시를 띄울지
     * 판단할 때 참조한다. 포그라운드면 사용자가 앱에서 SSE 로 메시지를 즉시 보므로 시스템 알림을
     * 띄우지 않는다(중복·방해 방지). iOS 가 willPresent 로 포그라운드 푸시 배너를 억제하는 것과 동일.
     * onPause(잠금·홈·백그라운드) 에서 false 가 되어, 백그라운드/잠금 알림은 정상 표시된다.
     */
    static volatile boolean appForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 플러그인은 반드시 super.onCreate(=Bridge 초기화) 이전에 등록.
        registerPlugin(HiNestNativePlugin.class);
        super.onCreate(savedInstanceState);
        createAlertsNotificationChannel();
        setupSafeAreaInsets();
    }

    /**
     * 안드로이드 edge-to-edge(targetSdk 35+ 강제)에서 시스템바(상태바·내비게이션바)·디스플레이
     * 컷아웃 인셋을 WebView 의 CSS 변수(--sa-top/right/bottom/left)로 주입한다.
     *
     * 왜: 안드로이드 WebView 는 시스템바 인셋을 env(safe-area-inset-*) 로 안정적으로 보고하지 않아,
     * edge-to-edge 에선 콘텐츠가 상태바(시계·배터리)·하단 내비바와 겹친다. 웹 CSS 는
     * var(--sa-*, env(safe-area-inset-*)) 로 쓰므로 → 안드로이드는 여기서 주입한 실제값, iOS/웹은
     * env() 폴백을 사용한다(플랫폼별 분기 없이 동일 CSS).
     */
    private void setupSafeAreaInsets() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false); // 콘텐츠를 시스템바 뒤로(immersive)
        final View root = getWindow().getDecorView();
        applyBarIconAppearance(root); // 시작 시 1회(첫 페인트 전 상태바 아이콘 색 보정)
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            float density = getResources().getDisplayMetrics().density;
            int top = Math.round(bars.top / density);       // px → CSS px(dp)
            // 키보드(IME)가 떠 있으면 하단 내비바를 키보드가 가리므로 --sa-bottom 을 0 으로 둔다.
            // 안 그러면 채팅 입력창이 죽은 내비바 인셋(예: 48dp)만큼 키보드 위로 떠 큰 간격이 생긴다.
            boolean imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int bottom = imeVisible ? 0 : Math.round(bars.bottom / density);
            int left = Math.round(bars.left / density);
            int right = Math.round(bars.right / density);
            final String js = "(function(){try{var s=document.documentElement.style;"
                + "s.setProperty('--sa-top','" + top + "px');"
                + "s.setProperty('--sa-bottom','" + bottom + "px');"
                + "s.setProperty('--sa-left','" + left + "px');"
                + "s.setProperty('--sa-right','" + right + "px');}catch(e){}})();";
            final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv != null) wv.post(() -> wv.evaluateJavascript(js, null));
            applyBarIconAppearance(root); // 인셋·테마 변경 때마다 재적용(OEM 리셋 방어)
            return insets; // 인셋 미소비 — 시스템바 투명 유지(콘텐츠가 뒤까지 채우는 immersive)
        });
        ViewCompat.requestApplyInsets(root);
    }

    /**
     * 상태바·내비바 아이콘 색을 배경 밝기에 맞춘다 — edge-to-edge 에선 시스템바가 투명이라
     * 앱 배경(라이트=흰색) 위에 아이콘이 그려지는데, 기본이 밝은 아이콘이면 흰 배경에서 시계·배터리가
     * 안 보인다. 시스템 다크모드면 밝은 아이콘, 라이트모드면 어두운 아이콘으로 강제한다.
     * (@capacitor/status-bar setStyle 이 이 구성에서 시각적으로 안 먹어 네이티브로 직접 설정.)
     */
    private void applyBarIconAppearance(View root) {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
        c.setAppearanceLightStatusBars(!night);     // 라이트(밝은 배경) → 어두운 아이콘
        c.setAppearanceLightNavigationBars(!night);
    }

    @Override
    public void onResume() {
        super.onResume();
        appForeground = true; // 포그라운드 진입 — 채팅 푸시는 인앱에서 보이므로 시스템 알림 억제 대상.
        // OTA reload 등으로 document 가 새로 생기면 주입한 변수가 사라질 수 있어 인셋 재적용을 유도.
        try {
            ViewCompat.requestApplyInsets(getWindow().getDecorView());
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        appForeground = false; // 백그라운드/잠금 — 채팅 푸시를 시스템 알림으로 정상 표시.
    }

    /**
     * 고중요도 알림 채널(헤드업 배너 + 사운드 + 앱아이콘 배지 + 잠금화면 표시) 생성.
     * 구 "default" 채널은 굳은 설정 정리 위해 삭제(자세한 배경은 PR #946).
     */
    private void createAlertsNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // 채널 개념은 O(API 26)+
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        nm.deleteNotificationChannel("default"); // 굳어버린 옛 채널 정리(없으면 무시)
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "기본 알림", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("새 메시지·결재·공지 등 실시간 알림");
        channel.enableVibration(true);
        channel.enableLights(true);
        channel.setShowBadge(true); // 앱 아이콘 배지
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC); // 잠금화면 내용 표시
        nm.createNotificationChannel(channel);
    }
}
