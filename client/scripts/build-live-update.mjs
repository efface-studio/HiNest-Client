#!/usr/bin/env node
/**
 * Live Updates 번들 생성기 — vite build 직후 자동 실행.
 *
 *   입력: client/dist/  (vite 결과물)
 *   출력: client/dist/live-updates/bundle-<sha>.zip + manifest.json
 *
 * Vercel 이 client/dist 를 그대로 정적 호스팅하므로, 출력물이 자동으로
 *   https://nest.hi-vits.com/live-updates/manifest.json
 *   https://nest.hi-vits.com/live-updates/bundle-<sha>.zip
 * 로 노출된다 (추가 인프라/CI 0).
 *
 * 버전:
 *   - 짧은 git SHA (예: a3f9c2) — 결정적, 유니크. Capgo SDK 는 version 문자열 비교만 하므로
 *     SHA 가 다르면 새 버전으로 본다. 같은 코드 = 같은 SHA = 동일 버전 (사용자 재다운로드 X).
 *   - git 정보가 없는 환경(CI 외)에선 Date.now() 폴백 — 결정성 깨지지만 동작은 보장.
 *
 * 안전:
 *   - live-updates/ 디렉토리 자체는 zip 대상에서 제외 (재귀 zip 방지).
 *   - 빌드가 깨졌어도 SDK 의 notifyAppReady 타임아웃(10초)이 자동 롤백 보장.
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip"); // adm-zip 은 CJS

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const outDir = path.join(distDir, "live-updates");

async function main() {
  await mkdir(outDir, { recursive: true });

  let version;
  try {
    version = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    version = String(Date.now()); // CI 외 환경 fallback
  }

  const zipName = `bundle-${version}.zip`;
  const zipPath = path.join(outDir, zipName);

  // dist 통째 zip — live-updates/ 자체는 제외(재귀 방지).
  // adm-zip 은 폴더 통째 추가 + 필터 가능.
  const zip = new AdmZip();
  zip.addLocalFolder(distDir, "", (filename) => {
    // 제외 패턴: 자기 자신(live-updates/) + macOS 메타.
    if (filename.startsWith("live-updates/") || filename === "live-updates") return false;
    if (filename.endsWith(".DS_Store")) return false;
    return true;
  });
  zip.writeZip(zipPath);

  const buf = readFileSync(zipPath);
  const checksum = "sha256-" + createHash("sha256").update(buf).digest("hex");

  const manifest = {
    version,
    url: `/live-updates/${zipName}`,
    checksum,
    size: buf.length,
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const kb = (buf.length / 1024).toFixed(1);
  console.log(`✅ live-update bundle ${version} — ${kb} KB`);
  console.log(`   manifest:  ${path.relative(process.cwd(), path.join(outDir, "manifest.json"))}`);
  console.log(`   bundle:    ${path.relative(process.cwd(), zipPath)}`);
}

main().catch((e) => {
  console.error("[build-live-update] failed:", e);
  process.exit(1);
});
