import { startRegistration, startAuthentication, browserSupportsWebAuthn, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { api } from "../api";

export async function canUsePasskey(): Promise<{ supported: boolean; platform: boolean }> {
  const supported = browserSupportsWebAuthn();
  if (!supported) return { supported: false, platform: false };
  try {
    const platform = await platformAuthenticatorIsAvailable();
    return { supported, platform };
  } catch {
    return { supported, platform: false };
  }
}

/** WebAuthn 호출이 무한 대기하지 않게 최대 60초로 강제 타임아웃 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} 타임아웃 (${Math.round(ms / 1000)}초). OS 생체 인증 창이 뜨지 않았어요. 앱 서명/공증 상태를 확인해주세요.`));
    }, ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export async function registerPasskey(deviceName?: string) {
  console.info("[passkey] registerPasskey start");
  const opts = await api<any>("/api/passkey/register/options", { method: "POST", json: {} });
  console.info("[passkey] got register options", { rpId: opts?.rp?.id });
  let response: any;
  try {
    response = await withTimeout(startRegistration({ optionsJSON: opts }), 65_000, "패스키 등록");
  } catch (e: any) {
    console.error("[passkey] startRegistration failed", e?.name, e?.message, e);
    throw e;
  }
  console.info("[passkey] startRegistration ok — verifying with server");
  await api("/api/passkey/register/verify", {
    method: "POST",
    json: { response, deviceName },
  });
  console.info("[passkey] register verified ✓");
}

/** 인증 성공 시 개발자면 서버가 super cookie 를 자동 설정해줌 */
export async function authenticateWithPasskey(): Promise<{ ok: boolean; super?: boolean; expiresAt?: number }> {
  console.info("[passkey] authenticateWithPasskey start");
  const opts = await api<any>("/api/passkey/auth/options", { method: "POST", json: {} });
  console.info("[passkey] got auth options", { rpId: opts?.rpId, allow: opts?.allowCredentials?.length });
  let response: any;
  try {
    response = await withTimeout(startAuthentication({ optionsJSON: opts }), 65_000, "패스키 인증");
  } catch (e: any) {
    console.error("[passkey] startAuthentication failed", e?.name, e?.message, e);
    throw e;
  }
  return await api<{ ok: boolean; super?: boolean; expiresAt?: number }>(
    "/api/passkey/auth/verify",
    { method: "POST", json: { response } }
  );
}

export async function listPasskeys() {
  return api<{ passkeys: { id: string; deviceName?: string; createdAt: string; lastUsedAt?: string | null; transports?: string | null }[] }>(
    "/api/passkey"
  );
}

export async function removePasskey(id: string) {
  return api(`/api/passkey/${id}`, { method: "DELETE" });
}
