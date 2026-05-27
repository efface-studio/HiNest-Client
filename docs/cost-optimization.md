# HiNest AWS 비용 최적화 플레이북

월 청구서를 가장 큰 항목부터 깎는 순서. 코드/워크플로우로 자동화한 부분과,
인프라 결정이라 수동으로 결정해야 하는 부분을 분리해 둔다.

---

## 청구서 우선순위 — 큰 것부터

| 순위 | 항목 | 월 추정 | 자동화 가능? |
|------|------|---------|--------------|
| 1 | **NAT Gateway** (있다면) | ₩42,000+ | ⚠️ 진단만 자동, 제거는 수동 |
| 2 | Fargate compute (다운사이즈) | ₩12,000 | ✅ 자동 진단 + 적용 |
| 3 | ALB ↔ API Gateway 전환 | ₩16,000 | ⚠️ 수동 (DNS/SSL 변경) |
| 4 | CloudWatch retention | ₩2,000~30,000 | ✅ 매주 자동 |
| 5 | ECR 이미지 누적 | ₩2,000 | ✅ 라이프사이클 자동 |
| 6 | 미사용 EIP | ₩5,000/개 | ⚠️ 진단만 자동 |
| 7 | 클라이언트 백그라운드 폴링 | ALB LCU 미세 | ✅ 코드로 처리 (PR #138) |

---

## 1. NAT Gateway — 가장 큰 한 방

**왜 큰가**: 시간당 $0.045 × 24h × 30일 = **$32.4/월** (트래픽 별도). 그냥 존재만 해도 ₩42,000.

**진단**:
```bash
gh workflow run cost-vpc-audit.yml
```
출력으로 NAT 개수 + 월 예상 비용 + ECS task 가 NAT 경유 중인지 표시.

**제거 옵션**:

### Option A — public subnet 이동 (가장 간단)
ECS task 를 public subnet 에 배치하고 `assignPublicIp=ENABLED`. Outbound 트래픽이 IGW 로 직접 빠져서 NAT 불필요.

- 장점: 비용 0, 마이그레이션 5분
- 단점: Task IP 가 public 노출 (SG inbound 가 ALB SG 만 허용하면 실질 위험 없음)

```bash
# task 가 사용하는 service 의 network configuration 변경
aws ecs update-service \
  --cluster hinest-prod --service hinest-server \
  --network-configuration "awsvpcConfiguration={subnets=[$PUB_SUBNET_A,$PUB_SUBNET_B],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --force-new-deployment
```

### Option B — VPC Interface Endpoint (private 유지)
S3 (Gateway, 무료), ECR / CloudWatch Logs (Interface, ~$7/월). NAT 통과량을 줄이지만 NAT 자체는 유지 → 결과적으로 NAT 비용은 그대로.

> HiNest 규모(30명, 하루 트래픽 수 GB)에선 **Option A 가 명확히 우위**. 외부 API 호출은 SES (region-internal) 뿐이라 public subnet 으로 옮겨도 보안적 차이 거의 없음.

---

## 2. Fargate Rightsize — 안전하게 다운사이즈

**진단**:
```bash
gh workflow run cost-fargate-diagnose.yml
```
7일치 CPU/Memory 사용률 (avg/p95/max) 출력 + 안전 기준 (p95<40%/50%) 만족하면 다음 사이즈 권장.

**적용**:
```bash
gh workflow run cost-fargate-rightsize.yml -f cpu=256 -f memory=512
```
- 새 task definition 등록 → service 롤아웃 → `services-stable` 대기 → `/api/health` 검증
- 실패 시 **직전 리비전으로 자동 롤백**

**예상 절감 (Seoul 리전, 730h/월)**:

| 현재 | 다운사이즈 | 월 변화 |
|------|-----------|---------|
| 512 CPU / 1024 MB ($17.95) | 256 CPU / 512 MB ($8.97) | **-$8.98 (-₩12,100)** |
| 1024 CPU / 2048 MB ($35.89) | 512 CPU / 1024 MB ($17.95) | **-$17.94 (-₩24,200)** |

> PR #138 (백그라운드 polling 정지) 의 진짜 가치가 여기서 실현됨. polling 으로 CPU 가 항상 30~40% 차 있던 상태에선 다운사이즈가 불가능했음.

---

## 3. ALB → API Gateway 검토

**언제 이득인가**:
- ALB 고정비 = $16/월 (Seoul 리전 LB-Hours) + LCU 별도
- API Gateway HTTP API = 요청 100만 건당 $1
- 30명 × 일 1000 req × 30일 = 90만 req → APIGW = $0.9/월

**즉 RPS 가 낮다면 APIGW 가 매월 ~$15 저렴**. 다만 마이그레이션이 코드 외 작업이 많음:

| 항목 | 복잡도 |
|------|--------|
| Route 53 DNS 변경 (`api.nest.hi-vits.com`) | 낮음 |
| ACM 인증서 (이미 보유) | 낮음 |
| SSE (`/api/notification/stream`) 지원 | **APIGW HTTP API 는 SSE OK, 단 30s 타임아웃** |
| 큰 응답 (10MB 이상 파일) | **HTTP API 한도 10MB — 업로드/다운로드는 ALB 유지 권장** |
| WebSocket (HiNest 미사용) | N/A |

**결론**: SSE 가 30초 안에 첫 이벤트 보내는 한 동작. 파일 업로드/다운로드는 별도 도메인(`upload.nest.hi-vits.com`) 으로 ALB 유지하는 하이브리드 구성이 안전.

지금 단계 추천: **NAT 제거 + Fargate 다운사이즈 먼저**. APIGW 전환은 사용자가 100명 넘으면 그때 재검토.

---

## 4. CloudWatch retention — 매주 자동

이미 PR #138 에서 처리. `cost-log-retention.yml` 가 매주 월요일 자동 실행.

기본 정책:
- `/ecs/hinest*` : 30일
- `/ecs/onetime*`, `seed*`, `diag*` : 7일

---

## 5. ECR 라이프사이클 — 새 워크플로우

**적용**:
```bash
gh workflow run cost-ecr-lifecycle.yml
```

정책:
- `v*`, `release-*` 태그 : 영구 (rollback 용)
- `buildcache` : 영구 (BuildKit 캐시 효율)
- 그 외 SHA / latest 태그 : 최근 10개만, 나머지 자동 삭제
- untagged (orphan layer) : 7일 후 삭제

**예상 절감**: 한 달 30회 배포 × 200MB = 6GB / 월 누적. 1년이면 72GB × $0.10 = **$7.2/월 (₩9,700)** 누적.
지금 적용하면 미래 7개월부터 의미 있는 절감.

---

## 실행 순서 (추천)

```bash
# 1. 현 상태 파악
gh workflow run cost-vpc-audit.yml        # NAT GW / EIP 점유
gh workflow run cost-fargate-diagnose.yml # 7일치 CPU/Mem

# 2. 즉시 가능한 자동 절감
gh workflow run cost-log-retention.yml    # retention 적용 (PR #138)
gh workflow run cost-ecr-lifecycle.yml    # ECR 라이프사이클

# 3. 큰 결정 — 사용자 판단 후
#   NAT GW 가 있고 ECS public 이동이 OK 면:
#   → 콘솔에서 service network config 변경 + NAT 제거
#
#   Fargate diagnose 가 "다운사이즈 권장" 으로 나오면:
gh workflow run cost-fargate-rightsize.yml -f cpu=256 -f memory=512
```

---

## 비용 측정 (before/after 실측)

청구 항목별 변화를 정확히 보려면 **AWS Cost Explorer**:

1. AWS Console → **Cost Explorer**
2. **Group by: Service** + 일별 분포 7일치 → before 기준선
3. 변경 적용 → 다음 주 같은 차트로 비교
4. **Group by: Usage Type** 으로 NAT-Hours / DataTransfer-Out 등 세부 확인

월말 청구서가 아니라 **일별 추정 비용**이 즉시 반영되므로 24h 뒤면 변화가 보임.

---

## 최종 목표 (HiNest 30명 규모)

| 항목 | Before (예상) | After (목표) | 절감 |
|------|---------------|--------------|------|
| 월 청구 합 | ₩100,000 | ₩40,000~50,000 | **50~60%** |
| Fargate | ₩25,000 | ₩12,000 | -₩13,000 |
| NAT GW | ₩42,000 (있다면) | ₩0 | -₩42,000 |
| ALB | ₩22,000 | ₩22,000 | (유지) |
| CloudWatch | ₩5,000 | ₩2,000 | -₩3,000 |
| ECR + S3 | ₩6,000 | ₩4,000 | -₩2,000 |

> 단, **NAT GW 가 실제 존재하는 경우**. 없으면 절감 폭은 -₩18,000 (18%) 수준.
