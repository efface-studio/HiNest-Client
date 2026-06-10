package com.hivits.hinest;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 고중요도 알림 채널 id. 구 "default" 채널의 굳은 설정을 피하려 새 id 사용(아래 주석 참고). */
    static final String CHANNEL_ID = "hinest_alerts";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 플러그인은 반드시 super.onCreate(=Bridge 초기화) 이전에 등록.
        // HiNestNative: 세션 토큰을 SharedPreferences 에 보관 → 채팅 아바타 알림이 /uploads 인증에 사용.
        registerPlugin(HiNestNativePlugin.class);
        super.onCreate(savedInstanceState);
        createAlertsNotificationChannel();
    }

    /**
     * 고중요도 알림 채널을 앱 시작 시 만든다 — 헤드업 배너 + 사운드 + 앱아이콘 배지 + 잠금화면 표시.
     *
     * 왜 새 id("hinest_alerts")인가: 안드로이드는 한 번 만든 채널의 importance·배지·잠금화면 설정을
     * 앱이 바꿀 수 없다(사용자 우회 방지 정책 — 같은 id 로 지워도 옛 설정이 복원됨). 구 "default"
     * 채널이 낮은 importance 로 굳어 있으면 헤드업/배지/잠금화면이 모두 막힌다. 그래서 전 속성을
     * 올바로 가진 새 채널을 만들고, 구 "default" 채널은 정리 삭제한다.
     *
     * IMPORTANCE_HIGH = 즉시 헤드업 배너 + 기본 사운드(= iOS 항상-배너와 동등),
     * setShowBadge = 앱 아이콘 배지, VISIBILITY_PUBLIC = 잠금화면에 내용 표시.
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
        // 사운드는 미지정 시 시스템 기본 알림음 사용(IMPORTANCE_HIGH 기본 동작).
        nm.createNotificationChannel(channel);
    }
}
