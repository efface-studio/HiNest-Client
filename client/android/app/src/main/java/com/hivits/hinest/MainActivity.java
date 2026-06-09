package com.hivits.hinest;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 고중요도 알림 채널을 앱 시작 시 미리 만든다.
        //
        // 왜: 서버(fcm.ts)는 channelId="default" 로 푸시를 보내는데, 앱이 그 채널을 만든 적이
        //   없으면 안드로이드가 IMPORTANCE_DEFAULT 폴백 채널을 자동 생성한다 → 헤드업 배너도
        //   사운드도 없이 트레이에만 조용히 떠서 "알림이 느리다/안 온다" 처럼 보였다.
        //   (android.priority="HIGH" 는 전송(기기 깨우기)용일 뿐, 배너 노출은 채널 importance 가
        //   결정한다.) IMPORTANCE_HIGH 채널을 직접 만들어 iOS 의 항상-배너(apns-priority 10) 와
        //   동등한 즉시 헤드업 + 사운드를 보장한다 → Instagram 급 체감 속도.
        //
        // 채널은 한 번 만들면 앱 삭제 전까지 영속한다(앱이 닫혀 있어도 시스템이 기억). Activity
        // 가 한 번이라도 떴으면 백그라운드 푸시도 이 채널로 헤드업으로 뜬다. AndroidManifest 의
        // default_notification_channel_id 메타데이터가 첫 실행 전 엣지케이스를 보강한다.
        createDefaultNotificationChannel();
    }

    private void createDefaultNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // 채널 개념은 O(API 26)+
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            "default", "기본 알림", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("새 메시지·결재·공지 등 실시간 알림");
        channel.enableVibration(true);
        channel.enableLights(true);
        nm.createNotificationChannel(channel);
    }
}
