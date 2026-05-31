import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// 기본 회사(테넌트) — 기존 단일 회사 데이터의 귀속처. 마이그레이션과 동일한 고정 id.
const DEFAULT_COMPANY_ID = "company_default";

async function main() {
  // 기본 회사 보장 (마이그레이션이 이미 만들었으면 멱등)
  await prisma.company.upsert({
    where: { id: DEFAULT_COMPANY_ID },
    update: {},
    create: { id: DEFAULT_COMPANY_ID, name: "주식회사 하이비츠", status: "ACTIVE" },
  });

  // 기본 관리자 (Super Admin)
  const email = "admin@hinest.local";
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    const passwordHash = await bcrypt.hash("admin1234", 10);
    admin = await prisma.user.create({
      data: {
        email,
        name: "관리자",
        passwordHash,
        role: "ADMIN",
        superAdmin: true,
        position: "시스템관리자",
        team: "경영지원",
        avatarColor: "#36D7B7",
        companyId: DEFAULT_COMPANY_ID,
      },
    });

    // 샘플 공지
    await prisma.notice.create({
      data: {
        title: "HiNest 오픈 안내",
        content:
          "안녕하세요. 사내 관리툴 HiNest 가 오픈되었습니다. 관리자 페이지에서 초대키를 발급받아 회원가입 해주세요.",
        pinned: true,
        authorId: admin.id,
      },
    });

    // 전사 채팅방
    const room = await prisma.chatRoom.create({
      data: {
        name: "전사 공지방",
        type: "GROUP",
        members: { create: [{ userId: admin.id }] },
      },
    });
    await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        senderId: admin.id,
        content: "반갑습니다. HiNest 전사 공지방입니다.",
      },
    });

    console.log("Seeded admin:", email, "/ password: admin1234");
  } else {
    // 기존 admin 계정을 Super Admin 으로 승격(멱등)
    if (!admin.superAdmin) {
      await prisma.user.update({ where: { id: admin.id }, data: { superAdmin: true } });
      console.log("Promoted admin to Super Admin:", email);
    } else {
      console.log("Admin already exists (Super Admin):", email);
    }
  }

  // --- 테스트 계정 3종 ---
  const accounts = [
    {
      email: "admin1",
      name: "김하나",
      password: "admin1234",
      role: "ADMIN" as const,
      superAdmin: true,
      position: "이사",
      team: "경영지원",
      avatarColor: "#273990",
    },
    {
      email: "admin2",
      name: "이관리",
      password: "admin1234",
      role: "ADMIN" as const,
      superAdmin: false,
      position: "팀장",
      team: "경영지원",
      avatarColor: "#3D54C4",
    },
    {
      email: "admin3",
      name: "박직원",
      password: "admin1234",
      role: "MEMBER" as const,
      superAdmin: false,
      position: "사원",
      team: "개발",
      avatarColor: "#6278D0",
    },
  ];

  for (const a of accounts) {
    const hash = await bcrypt.hash(a.password, 10);
    await prisma.user.upsert({
      where: { email: a.email },
      update: {
        name: a.name,
        passwordHash: hash,
        role: a.role,
        superAdmin: a.superAdmin,
        position: a.position,
        team: a.team,
        avatarColor: a.avatarColor,
        active: true,
      },
      create: {
        email: a.email,
        name: a.name,
        passwordHash: hash,
        role: a.role,
        superAdmin: a.superAdmin,
        position: a.position,
        team: a.team,
        avatarColor: a.avatarColor,
        companyId: DEFAULT_COMPANY_ID,
      },
    });
    console.log(`Upserted ${a.email} / ${a.password} (${a.role}${a.superAdmin ? "+SUPER" : ""})`);
  }

  // --- 플랫폼 운영자 (멀티테넌시) ---
  // 어느 회사에도 속하지 않는 최상위 계정. 회사 가입 승인 콘솔 전용.
  // 회사 내부 superAdmin 과 구분되며 companyId 는 null.
  const platformHash = await bcrypt.hash("platform1234", 10);
  await prisma.user.upsert({
    where: { email: "platform@hinest.local" },
    update: { platformAdmin: true, active: true },
    create: {
      email: "platform@hinest.local",
      name: "플랫폼 운영자",
      passwordHash: platformHash,
      role: "MEMBER",
      platformAdmin: true,
      companyId: null,
      avatarColor: "#0F172A",
    },
  });
  console.log("Upserted platform@hinest.local / platform1234 (PLATFORM ADMIN)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
