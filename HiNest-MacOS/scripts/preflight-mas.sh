#!/usr/bin/env bash
#
# Mac App Store 제출 사전 점검 — 느린 서명 빌드(npm run dist:mas) 전에
# 인증서·프로비저닝 프로파일·식별자 일치를 빠르게 검증한다.
#
# Apple 로그인/자격증명은 전혀 필요 없다 — 로컬 키체인과 파일만 읽는다.
# MAS 빌드가 실패하는 가장 흔한 원인(서명 identity 누락 / 프로파일 불일치 / 만료)을
# 암호 같은 electron-builder 오류 대신 사람이 읽을 수 있는 체크리스트로 먼저 잡아준다.
#
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PROFILE="build/embedded.provisionprofile"
TEAM="3NVCLTSP9V"
APP_ID="$(node -p "require('./package.json').build.appId" 2>/dev/null || echo '')"
EXPECTED_APPID="${TEAM}.${APP_ID}"

fail=0
pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; fail=$((fail + 1)); }
info() { printf "    %s\n" "$1"; }

echo "── HiNest · Mac App Store 사전 점검 ───────────────────────"
echo "  appId : ${APP_ID:-<package.json 읽기 실패>}"
echo "  team  : ${TEAM}"
echo

# ── [1] 프로비저닝 프로파일 ────────────────────────────────
echo "[1] 프로비저닝 프로파일 (Mac App Store 배포용)"
if [[ -f "$PROFILE" ]]; then
  pass "파일 존재: $PROFILE"
  PLIST="$(security cms -D -i "$PROFILE" 2>/dev/null || echo '')"
  if [[ -n "$PLIST" ]]; then
    pb() { /usr/libexec/PlistBuddy -c "Print $1" /dev/stdin <<<"$PLIST" 2>/dev/null; }
    p_appid="$(pb ':Entitlements:com.apple.application-identifier')"
    p_team="$(pb ':Entitlements:com.apple.developer.team-identifier')"
    p_name="$(pb ':Name')"
    p_exp="$(pb ':ExpirationDate')"
    [[ -n "$p_name" ]] && info "이름: $p_name"
    if [[ "$p_appid" == "$EXPECTED_APPID" ]]; then
      pass "App ID 일치: $p_appid"
    else
      bad "App ID 불일치 — 프로파일=[$p_appid] 기대=[$EXPECTED_APPID]"
    fi
    if [[ "$p_team" == "$TEAM" ]]; then
      pass "팀 ID 일치: $p_team"
    else
      bad "팀 ID 불일치 — 프로파일=[$p_team] 기대=[$TEAM]"
    fi
    if [[ -n "$p_exp" ]]; then
      info "만료일: $p_exp"
      # 만료 임박/만료 경고 (best-effort, date 파싱 실패해도 무시)
      exp_epoch="$(date -j -f "%a %b %d %T %Z %Y" "$p_exp" "+%s" 2>/dev/null || echo '')"
      if [[ -n "$exp_epoch" ]]; then
        now_epoch="$(date "+%s")"
        if (( exp_epoch < now_epoch )); then
          bad "프로파일이 만료됨 — 포털에서 재발급 필요"
        fi
      fi
    fi
  else
    bad "프로파일 디코드 실패 (security cms -D) — 파일이 손상됐을 수 있음"
  fi
else
  bad "없음: $PROFILE"
  info "→ developer.apple.com → Profiles → Mac App Store 배포 프로파일 생성"
  info "  (App ID=$APP_ID, Apple Distribution 인증서) → 다운로드 후 이 경로/이름으로 저장"
fi
echo

# ── [2] 앱 서명 인증서 ─────────────────────────────────────
echo "[2] 앱(.app) 서명 인증서 — Apple Distribution / 3rd Party Mac Developer Application"
APPCERT="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -Ei "Apple Distribution|3rd Party Mac Developer Application" \
  | grep "$TEAM" || true)"
if [[ -n "$APPCERT" ]]; then
  pass "발견:"
  echo "$APPCERT" | sed 's/^/      /'
else
  bad "앱 서명 인증서 없음"
  info "→ Xcode: Settings → Accounts → Manage Certificates → + → Apple Distribution"
  info "  또는 포털에서 'Apple Distribution' 인증서 발급 후 키체인에 설치"
fi
echo

# ── [3] 설치 패키지 서명 인증서 ────────────────────────────
echo "[3] 설치패키지(.pkg) 서명 인증서 — Mac Installer Distribution / 3rd Party Mac Developer Installer"
INSTCERT="$(security find-identity -v 2>/dev/null \
  | grep -Ei "Mac Installer Distribution|3rd Party Mac Developer Installer" \
  | grep "$TEAM" || true)"
if [[ -n "$INSTCERT" ]]; then
  pass "발견:"
  echo "$INSTCERT" | sed 's/^/      /'
else
  bad "설치패키지 서명 인증서 없음"
  info "→ Xcode: Settings → Accounts → Manage Certificates → + → Mac Installer Distribution"
  info "  또는 포털에서 'Mac Installer Distribution' 인증서 발급 후 키체인에 설치"
fi
echo

# ── [4] 엔타이틀먼트 파일 ──────────────────────────────────
echo "[4] 엔타이틀먼트 파일"
for f in \
  build/entitlements.mas.plist \
  build/entitlements.mas.inherit.plist \
  build/entitlements.mas.loginhelper.plist; do
  if [[ -f "$f" ]]; then pass "$f"; else bad "없음: $f"; fi
done
echo

# ── [5] 앱 아이콘 (1024 포함 필수) ─────────────────────────
echo "[5] 앱 아이콘"
if [[ -f assets/icon.icns ]]; then
  if iconutil -c iconset assets/icon.icns -o /tmp/hinest_iconcheck.iconset >/dev/null 2>&1 \
     && [[ -f /tmp/hinest_iconcheck.iconset/icon_512x512@2x.png ]]; then
    pass "icon.icns 에 1024(512@2x) 포함 — App Store 규격 충족"
  else
    bad "icon.icns 에 1024(512@2x) 해상도 누락 — 업로드 시 리젝될 수 있음"
  fi
  rm -rf /tmp/hinest_iconcheck.iconset
else
  bad "없음: assets/icon.icns"
fi
echo

# ── 결과 ───────────────────────────────────────────────────
echo "───────────────────────────────────────────────────────────"
if [[ "$fail" -eq 0 ]]; then
  printf "\033[32m✓ 모든 점검 통과\033[0m — 'npm run dist:mas' 로 서명 빌드를 진행하세요.\n"
  exit 0
else
  printf "\033[31m✗ %d개 항목 미충족\033[0m — 위 안내대로 준비 후 다시 실행하세요.\n" "$fail"
  echo "  (점검을 건너뛰고 강제 빌드: npm run build && npx electron-builder --mac mas)"
  exit 1
fi
