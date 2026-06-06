// 서명 직후에 Apple notary 서비스로 제출 → 승인 대기 → app 에 스테이플.
//
// 두 가지 자격 증명 방식을 모두 지원:
//
//  1) env var 방식 (CI 권장) — APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID 세 개가
//     모두 있으면 그걸로 notarytool 호출. GitHub Actions 등 신규 환경에 권장.
//
//  2) keychain profile 방식 (로컬 권장) — env var 가 없으면 keychain profile "hinest-notary"
//     에 미리 저장된 자격 증명을 사용. 로컬 개발자 본인 맥에 한 번만 셋업:
//       xcrun notarytool store-credentials hinest-notary \
//         --apple-id <dev apple id> --team-id 3NVCLTSP9V --password <app-specific password>
//
// 어느 쪽도 안 되거나 HINEST_SKIP_NOTARIZE=1 이면 공증 스킵(무서명 빌드/빠른 로컬 테스트용).
// DMG 자체는 electron-builder 가 후속 단계에서 만들고 자동 스테이플 해준다 (afterAllArtifactBuild).

const { execSync } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");

const KEYCHAIN_PROFILE = "hinest-notary";

module.exports = async function (context) {
  if (context.electronPlatformName !== "darwin") return;

  // HINEST_SKIP_NOTARIZE=1 로 공증 스킵 (로컬 빠른 테스트용 / CI 무서명 빌드)
  if (process.env.HINEST_SKIP_NOTARIZE === "1") {
    console.log("[afterSign] HINEST_SKIP_NOTARIZE=1 — 공증 스킵");
    return;
  }

  // 자격 증명 결정 — env var 우선, 그다음 keychain profile.
  const appleId = process.env.APPLE_ID;
  const appleAsPwd = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeam = process.env.APPLE_TEAM_ID;
  const useEnvCreds = !!(appleId && appleAsPwd && appleTeam);

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  // notarytool 은 .app 을 직접 받지 않는다 — zip/pkg/dmg 만 받음.
  // ditto 로 번들 전체를 압축해서 제출 → 승인 후에 원본 .app 을 staple.
  const zipPath = `${appPath}.zip`;

  console.log(`[afterSign] zipping app for notarization: ${zipPath}`);
  try {
    execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: "inherit" });
  } catch (e) {
    console.error("[afterSign] zip failed:", e && e.message ? e.message : e);
    throw e;
  }

  const credsArgs = useEnvCreds
    ? `--apple-id "${appleId}" --password "${appleAsPwd}" --team-id "${appleTeam}"`
    : `--keychain-profile "${KEYCHAIN_PROFILE}"`;
  console.log(
    `[afterSign] notarytool submit (${useEnvCreds ? "env vars" : `keychain profile '${KEYCHAIN_PROFILE}'`}): ${zipPath}`
  );
  try {
    execSync(`xcrun notarytool submit "${zipPath}" ${credsArgs} --wait`, { stdio: "inherit" });
    console.log("[afterSign] notarize accepted — stapling app");
    execSync(`xcrun stapler staple "${appPath}"`, { stdio: "inherit" });
    console.log("[afterSign] app stapled ✔");
  } catch (e) {
    console.error("[afterSign] notarize/staple failed:", e && e.message ? e.message : e);
    throw e;
  } finally {
    try { fs.unlinkSync(zipPath); } catch {}
  }
};
