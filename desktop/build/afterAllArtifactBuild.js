// 모든 아티팩트(DMG 등) 빌드 후 호출되는 훅.
// DMG 는 electron-builder 가 afterSign 이후에 만들기 때문에 .app 스테이플과는 별개로
// 여기서 DMG 자체도 공증 + 스테이플 해준다.
// (공증 서버는 이미 .app 을 인식하므로 DMG 만 새로 제출 → 티켓이 DMG 에 박혀 오프라인
//  배포 시에도 Gatekeeper 가 네트워크 없이 검증 가능.)
//
// 자격 증명: afterSign.js 와 동일 — env var(APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID)
// 우선, 없으면 keychain profile 'hinest-notary' fallback.

const { execSync } = require("child_process");

const KEYCHAIN_PROFILE = "hinest-notary";

module.exports = async function (context) {
  if (process.platform !== "darwin") return;
  if (process.env.HINEST_SKIP_NOTARIZE === "1") {
    console.log("[afterAllArtifactBuild] HINEST_SKIP_NOTARIZE=1 — 공증 스킵");
    return context.artifactPaths;
  }

  // 자격 증명 결정 — env var 우선, 그다음 keychain profile.
  const appleId = process.env.APPLE_ID;
  const appleAsPwd = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeam = process.env.APPLE_TEAM_ID;
  const useEnvCreds = !!(appleId && appleAsPwd && appleTeam);
  const credsArgs = useEnvCreds
    ? `--apple-id "${appleId}" --password "${appleAsPwd}" --team-id "${appleTeam}"`
    : `--keychain-profile "${KEYCHAIN_PROFILE}"`;

  const dmgs = (context.artifactPaths || []).filter((p) => p.endsWith(".dmg"));
  for (const dmg of dmgs) {
    console.log(
      `[afterAllArtifactBuild] notarytool submit DMG (${useEnvCreds ? "env vars" : `keychain profile '${KEYCHAIN_PROFILE}'`}): ${dmg}`
    );
    try {
      execSync(`xcrun notarytool submit "${dmg}" ${credsArgs} --wait`, { stdio: "inherit" });
      console.log(`[afterAllArtifactBuild] stapling ${dmg}`);
      execSync(`xcrun stapler staple "${dmg}"`, { stdio: "inherit" });
      console.log("[afterAllArtifactBuild] DMG stapled ✔");
    } catch (e) {
      console.error("[afterAllArtifactBuild] DMG notarize/staple failed:", e && e.message ? e.message : e);
      throw e;
    }
  }
  return context.artifactPaths;
};
