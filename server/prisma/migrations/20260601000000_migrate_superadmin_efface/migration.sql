-- 총관리자(superAdmin) 이관: xixn2@hi-vits.com → xixn2@efface.dev
--   NEW  xixn2@efface.dev (서지완): superAdmin=true, role=ADMIN, companyId = OLD 상속,
--        로그인 비번 test1234! (bcrypt rounds=12). step-up 비번(superPasswordHash)은
--        NULL 로 둬 첫 super 동작 때 본인이 직접 설정(auth.ts setup 분기).
--   OLD  xixn2@hi-vits.com: superAdmin=false 로 강등 (그 외 정보는 유지).
-- NEW 가 이미 있으면 비번/권한/회사만 재설정해 멱등. OLD 가 없으면 강등은 no-op.

DO $$
DECLARE
  target_hash text := '$2a$12$6A9xbl0LAsy8AoYtp6t4D.Y5r1NZ04LBc.6PPVJ8Kpb.PCrtZ3uvO';
  old_company text;
BEGIN
  SELECT "companyId" INTO old_company FROM "User" WHERE email = 'xixn2@hi-vits.com';

  IF EXISTS (SELECT 1 FROM "User" WHERE email = 'xixn2@efface.dev') THEN
    UPDATE "User"
      SET "passwordHash" = target_hash,
          "superAdmin"   = true,
          role           = 'ADMIN',
          "companyId"    = old_company,
          active         = true
      WHERE email = 'xixn2@efface.dev';
  ELSE
    INSERT INTO "User" (id, email, name, "passwordHash", role, "superAdmin", "companyId", active, "avatarColor", "createdAt", "updatedAt")
    VALUES (
      'cmo_super_efface_seed',
      'xixn2@efface.dev',
      '서지완',
      target_hash,
      'ADMIN',
      true,
      old_company,
      true,
      '#36D7B7',
      NOW(),
      NOW()
    );
  END IF;

  UPDATE "User" SET "superAdmin" = false WHERE email = 'xixn2@hi-vits.com';
END $$;
