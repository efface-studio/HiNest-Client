# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# HiNest 서버 — Fargate 배포용 멀티스테이지 Dockerfile
#
# 구조:
#   1) deps    : 프로덕션 deps 만 깨끗하게 설치 → runner 로 복사
#   2) builder : dev deps 까지 설치해서 prisma generate + tsc 실행 → dist/ 생성
#   3) runner  : 최종 이미지. non-root, 최소 용량, HEALTHCHECK 포함.
#
# 왜 멀티스테이지: tsx/typescript 같은 빌드 타임 툴과 300MB 짜리 @types/* 를
#                  프로덕션 이미지에 포함시킬 이유가 없음. 이미지가 작을수록
#                  Fargate task 기동이 빠르고 ECR 전송/저장 비용도 줄어듦.
# ---------------------------------------------------------------------------

# ============================ Stage 1: deps ================================
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma 바이너리가 alpine(musl) 에서 동작하려면 libc6-compat 필요.
# openssl 은 Prisma engine(linux-musl-openssl-3.0.x) 이 링크함.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
# --omit=dev 로 프로덕션 deps 만. postinstall(prisma generate) 는 생성 대상 client 를
# 이 단계에서 만들어 같이 남김 → runner 로 복사할 때 별도 generate 필요 없음.
RUN npm ci --omit=dev

# ============================ Stage 2: builder =============================
FROM node:22-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
# builder 는 전체 deps 필요 (tsc, @types/*, tsx 등).
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# prisma generate + tsc 한 번에.
RUN npm run build

# ============================ Stage 3: runner ==============================
FROM node:22-alpine AS runner
WORKDIR /app

# runtime 에도 openssl 필요 (Prisma query engine 이 동적 링크).
RUN apk add --no-cache libc6-compat openssl tini

# 보안: non-root 사용자로 실행.
# node 이미지에 기본 제공되는 node(uid 1000) 사용.
ENV NODE_ENV=production
ENV PORT=4000

# 런타임 필수 산출물만 복사:
#  - node_modules (프로덕션 + prisma client)
#  - dist (tsc 결과)
#  - prisma (migrate deploy 에 필요. schema + migrations 폴더)
#  - package.json (npm start 진입점)
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist          ./dist
COPY --from=builder --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma/client ./node_modules/@prisma/client
# Prisma CLI 는 devDep 이라 deps 스테이지에 없지만, 컨테이너 기동 시
# migrate deploy 를 자동 수행하기 위해 builder 스테이지에서 복사.
COPY --from=builder --chown=node:node /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=node:node /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json ./

# uploads/ 는 컨테이너 로컬 폴백용. 실제 파일은 S3 로 가므로 이 디렉터리는
# 생성해두되 비어있는 상태. Fargate 컨테이너 FS 는 휘발성이라 여기 저장하면 안 됨.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 4000

# tini 로 PID 1 신호 처리 (SIGTERM → graceful shutdown). Fargate 는 재배포/스케일링
# 시 SIGTERM 보내고 stopTimeout(기본 30s) 후 SIGKILL → tini 없으면 Node 가 신호를
# 깔끔하게 못 받아 연결이 뚝 끊김.
ENTRYPOINT ["/sbin/tini", "--"]

# 컨테이너 자체 HEALTHCHECK — Fargate 는 ALB 쪽 healthcheck 를 쓰지만,
# 로컬 docker run 이나 ECS container-level 이상 감지 시 유용.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT||4000) + '/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 컨테이너 기동 시: 1) prisma migrate deploy (멱등) → 2) 서버 기동.
# 새 migration 이 추가되면 배포만으로 자동 적용되어 수동 작업이 필요 없음.
# 실패 시 (DB 장애 등) exit 1 로 태스크가 재시작되어 배포가 롤백되도록.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/index.js"]
