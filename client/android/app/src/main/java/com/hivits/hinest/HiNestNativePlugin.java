package com.hivits.hinest;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
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

    /**
     * JS: HiNestNative.isIgnoringBatteryOptimizations() → { ignoring: boolean }.
     * 앱이 OEM 배터리 최적화에서 제외돼 있는지 — 백그라운드/잠금 상태 알림 신뢰도의 핵심 지표.
     */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean ignoring = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    /**
     * JS: HiNestNative.requestIgnoreBatteryOptimizations().
     * 배터리 최적화 제외 시스템 다이얼로그를 띄운다(카톡 방식). 일부 기기에서 이 인텐트가 없으면
     * 배터리 최적화 설정 목록 화면으로 폴백. 실제 허용은 사용자가 시스템 UI 에서 결정한다.
     */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + ctx.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                call.resolve();
            } catch (Throwable t2) {
                call.reject("배터리 최적화 설정을 열 수 없어요");
            }
        }
    }
}
