package com.hivits.hinest;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.text.TextUtils;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.graphics.drawable.IconCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.Map;

/**
 * 채팅 푸시를 "발신자 아바타" 알림으로 표시한다 — iOS NSE(Communication Notification) 미러.
 *
 * 서버(fcm.ts)는 채팅(senderName 있음)을 <b>data-only</b> 고우선 메시지로 보낸다. 그래서 앱이
 * 백그라운드여도 {@link #onMessageReceived} 가 깨어나 이 서비스가 직접 알림을 그린다.
 * 채팅이 아니면(공지·결재 등) plugin 기본 동작에 위임한다.
 *
 * 견고성 원칙(iOS 와 동일):
 *   · 아바타 다운로드가 실패해도 알림은 <b>무조건</b> 전달한다(절대 블록 X) — 기본 아바타(이니셜+색)로 폴백.
 *   · /uploads 는 인증 필요 → SharedPreferences 에 저장된 세션 토큰(HiNestNativePlugin)을
 *     ?token= 으로 붙여 받는다. 토큰이 없으면(로그인 전 등) 사진은 못 받지만 기본 아바타로 표시.
 *
 * @capacitor/push-notifications 의 MessagingService 를 확장하므로 토큰 등록(onNewToken)·일반
 * 알림 경로는 그대로 유지된다(super 위임). 매니페스트에서 plugin 의 서비스를 제거하고 이 서비스만 등록한다.
 */
public class HiNestMessagingService extends MessagingService {

    /** 고중요도 "기본 알림" 채널(MainActivity 가 생성) — 헤드업·배지·잠금화면 속성 포함. */
    private static final String CHANNEL_ID = MainActivity.CHANNEL_ID;
    /** = VITE_API_BASE (운영). iOS NSE 와 동일하게 하드코딩. */
    private static final String API_BASE = "https://nest.hi-vits.com";
    private static final int AVATAR_PX = 128;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String senderName = data != null ? data.get("senderName") : null;
        boolean isChat = data != null && "chat".equals(data.get("kind")) && !TextUtils.isEmpty(senderName);
        if (!isChat) {
            // 채팅이 아니면 기존 동작 — plugin 이 JS 전달/표시.
            super.onMessageReceived(remoteMessage);
            return;
        }
        try {
            showChatNotification(data);
        } catch (Throwable t) {
            // 무슨 일이 있어도 알림은 떠야 한다 → 최후의 폴백으로 plugin 기본 처리.
            try {
                super.onMessageReceived(remoteMessage);
            } catch (Throwable ignored) {
                // 폴백마저 실패 — 더는 할 수 있는 게 없다(알림 손실 < 크래시).
            }
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // 토큰 등록은 plugin 로직 그대로 유지(서버 /api/push/register 흐름).
        super.onNewToken(token);
    }

    private void showChatNotification(Map<String, String> data) {
        String senderName = data.get("senderName");
        String title = nonEmpty(data.get("title"), senderName);
        String body = nonEmpty(data.get("body"), "");
        String linkUrl = data.get("linkUrl");
        String groupId = data.get("groupId");
        String avatarPath = data.get("senderAvatarPath");
        String avatarColor = data.get("senderAvatarColor");

        // 아바타 — 다운로드 성공 시 사진(원형), 아니면 기본(이니셜+색). 항상 non-null 보장.
        Bitmap avatar = fetchAvatar(avatarPath);
        if (avatar == null) avatar = defaultAvatar(senderName, avatarColor);
        IconCompat icon = avatar != null ? IconCompat.createWithBitmap(avatar) : null;

        Person sender = new Person.Builder()
                .setName(senderName)
                .setKey(groupId != null ? groupId : senderName)
                .setIcon(icon)
                .build();

        // 1:1 이면 title == senderName, 그룹이면 title == 그룹명 → 대화 제목/그룹 표시.
        boolean isGroup = title != null && !title.equals(senderName);

        NotificationCompat.MessagingStyle style =
                new NotificationCompat.MessagingStyle(new Person.Builder().setName("나").build());
        style.addMessage(body, System.currentTimeMillis(), sender);
        if (isGroup) {
            style.setConversationTitle(title);
            style.setGroupConversation(true);
        }

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        if (linkUrl != null) open.putExtra("hinest.linkUrl", linkUrl);
        // minSdk 24 → FLAG_IMMUTABLE(API 23+) 항상 사용 가능.
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, notifId(groupId, senderName), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(smallIcon())
                .setStyle(style)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)        // 헤드업 배너(구버전 호환)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)  // 잠금화면에 내용 표시
                .setNumber(1)                                         // 앱 아이콘 배지 카운트
                .setContentIntent(contentIntent);
        if (groupId != null) b.setGroup(groupId);

        // 앱이 포그라운드면 시스템 알림을 띄우지 않는다 — 사용자가 앱을 보고 있어 SSE 로 메시지가
        // 인앱에 즉시 표시되므로 채팅방을 보는 중에 헤드업이 또 뜨는 중복·방해를 막는다(요구사항).
        // iOS 가 포그라운드 푸시 배너를 억제(willPresent 미구현=무표시)하는 것과 동일한 동작.
        // 백그라운드/잠금이면 appForeground=false 라 아래로 진행해 정상 표시된다.
        if (MainActivity.appForeground) return;

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(notifId(groupId, senderName), b.build());
    }

    /** 같은 방은 같은 id 로 묶여 갱신(=collapse). 없으면 발신자명 해시. */
    private int notifId(String groupId, String senderName) {
        String key = groupId != null ? groupId : (senderName != null ? senderName : "chat");
        return key.hashCode();
    }

    /** 상태바 작은 아이콘 — 앱 아이콘(FCM 기본과 동일). 0 이면 시스템 기본. */
    private int smallIcon() {
        int icon = getApplicationInfo().icon;
        return icon != 0 ? icon : android.R.drawable.sym_def_app_icon;
    }

    /** /uploads 아바타를 토큰 인증으로 받아 원형 크롭. 실패하면 null(→ 기본 아바타). 절대 throw 안 함. */
    private Bitmap fetchAvatar(String path) {
        if (path == null || !path.startsWith("/uploads/")) return null;
        HttpURLConnection conn = null;
        try {
            SharedPreferences sp = getSharedPreferences(HiNestNativePlugin.PREFS, Context.MODE_PRIVATE);
            String token = sp.getString(HiNestNativePlugin.KEY_TOKEN, null);
            String urlStr = API_BASE + path;
            if (token != null && !token.isEmpty()) {
                String enc = URLEncoder.encode(token, "UTF-8");
                urlStr += (urlStr.contains("?") ? "&" : "?") + "token=" + enc;
            }
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(7000);
            conn.setInstanceFollowRedirects(true);
            conn.connect();
            if (conn.getResponseCode() != 200) return null;
            InputStream is = conn.getInputStream();
            try {
                Bitmap raw = BitmapFactory.decodeStream(is);
                return raw != null ? circleCrop(raw) : null;
            } finally {
                is.close();
            }
        } catch (Throwable t) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 정사각 중앙 크롭 → 원형 마스크(AVATAR_PX). */
    private Bitmap circleCrop(Bitmap src) {
        int size = Math.min(src.getWidth(), src.getHeight());
        int x = (src.getWidth() - size) / 2;
        int y = (src.getHeight() - size) / 2;
        Bitmap sq = Bitmap.createBitmap(src, x, y, size, size);
        Bitmap out = Bitmap.createBitmap(AVATAR_PX, AVATAR_PX, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        c.drawCircle(AVATAR_PX / 2f, AVATAR_PX / 2f, AVATAR_PX / 2f, p);
        p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
        c.drawBitmap(sq, new Rect(0, 0, size, size), new RectF(0, 0, AVATAR_PX, AVATAR_PX), p);
        if (sq != src) sq.recycle();
        return out;
    }

    /** 사진 미등록/실패 시 앱 기본 아바타(색 원형 + 이름 첫 글자, 흰색)를 직접 그림 — iOS 와 동일. */
    private Bitmap defaultAvatar(String name, String colorHex) {
        String initial = (name != null && !name.isEmpty()) ? name.substring(0, 1) : "?";
        int bg = parseColor(colorHex, 0xFF3D54C4); // 기본 인디고 (iOS 기본색과 동일)
        Bitmap out = Bitmap.createBitmap(AVATAR_PX, AVATAR_PX, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint circle = new Paint(Paint.ANTI_ALIAS_FLAG);
        circle.setColor(bg);
        c.drawCircle(AVATAR_PX / 2f, AVATAR_PX / 2f, AVATAR_PX / 2f, circle);
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.WHITE);
        text.setTextSize(AVATAR_PX * 0.46f);
        text.setTypeface(Typeface.create(Typeface.DEFAULT, Typeface.BOLD));
        text.setTextAlign(Paint.Align.CENTER);
        Paint.FontMetrics fm = text.getFontMetrics();
        float baseline = AVATAR_PX / 2f - (fm.ascent + fm.descent) / 2f;
        c.drawText(initial, AVATAR_PX / 2f, baseline, text);
        return out;
    }

    private int parseColor(String hex, int fallback) {
        if (hex == null) return fallback;
        try {
            String h = hex.trim();
            if (!h.startsWith("#")) h = "#" + h;
            return Color.parseColor(h);
        } catch (Throwable t) {
            return fallback;
        }
    }

    private static String nonEmpty(String v, String fallback) {
        return (v == null || v.isEmpty()) ? fallback : v;
    }
}
