package com.hivits.hinest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 커스텀 플러그인은 반드시 super.onCreate(=Bridge 초기화) 이전에 등록.
        // HiNestNative: 세션 토큰을 SharedPreferences 에 보관 → 채팅 아바타 알림이 /uploads 인증에 사용.
        registerPlugin(HiNestNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
