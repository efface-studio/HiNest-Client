package com.hivits.hinest;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 네이티브 보조 플러그인.
 *
 * 현재 용도: 세션 토큰을 SharedPreferences 에 보관해 {@link HiNestMessagingService}(채팅 아바타
 * 알림)가 /uploads 아바타를 인증 다운로드할 수 있게 한다. iOS 의 App Group
 * (key "hinest.session.token") 공유와 동일한 목적의 안드로이드 미러.
 *
 * 토큰은 앱 전용 SharedPreferences 에만 저장되고 외부로 노출되지 않는다(MODE_PRIVATE).
 */
@CapacitorPlugin(name = "HiNestNative")
public class HiNestNativePlugin extends Plugin {

    /** SharedPreferences 파일명 / 키 — 메시징 서비스가 같은 값으로 읽는다. */
    static final String PREFS = "hinest";
    static final String KEY_TOKEN = "session.token";

    /** JS: HiNestNative.setSessionToken({ token }). 빈/누락이면 제거(로그아웃). */
    @PluginMethod
    public void setSessionToken(PluginCall call) {
        String token = call.getString("token", "");
        SharedPreferences sp = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (token == null || token.isEmpty()) {
            sp.edit().remove(KEY_TOKEN).apply();
        } else {
            sp.edit().putString(KEY_TOKEN, token).apply();
        }
        call.resolve();
    }
}
