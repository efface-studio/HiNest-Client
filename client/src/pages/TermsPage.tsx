import LegalLayout, { LegalSection } from "../components/LegalLayout";

/**
 * 이용약관 — 앱스토어/플레이스토어 심사 요건(공개 접근 가능한 약관 링크).
 * 운영자는 제출 전 굵게 표시된 [ ] 항목(운영자/회사명·문의처·관할·시행일)을 채워야 한다.
 */
export default function TermsPage() {
  return (
    <LegalLayout title="이용약관" effectiveDate="2026-06-01">
      <LegalSection heading="제1조 (목적)">
        <p>
          본 약관은 HiNest(이하 "서비스")가 제공하는 워크스페이스 서비스의 이용과 관련하여 서비스와
          이용자(회사 및 그 구성원) 간의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.
        </p>
      </LegalSection>

      <LegalSection heading="제2조 (정의)">
        <ul className="list-disc pl-5 space-y-1">
          <li>"서비스"란 근태·결재·급여·일정·메시지 등 사내 업무 기능을 제공하는 HiNest 를 말합니다.</li>
          <li>"회사(테넌트)"란 서비스 이용을 신청하고 승인받은 단일 조직 단위를 말합니다.</li>
          <li>"회원"이란 회사에 소속되어 계정을 발급받아 서비스를 이용하는 개인을 말합니다.</li>
          <li>"관리자"란 회사 내에서 구성원·데이터를 관리할 권한을 가진 회원을 말합니다.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="제3조 (약관의 효력 및 변경)">
        <p>
          본 약관은 서비스 화면에 게시함으로써 효력이 발생합니다. 서비스는 관련 법령을 위반하지 않는
          범위에서 약관을 변경할 수 있으며, 변경 시 적용일과 사유를 명시하여 사전 공지합니다.
        </p>
      </LegalSection>

      <LegalSection heading="제4조 (가입 및 계정)">
        <ul className="list-disc pl-5 space-y-1">
          <li>회사는 가입 신청 후 운영자의 승인을 받아 서비스를 이용할 수 있습니다.</li>
          <li>구성원은 회사 관리자의 초대를 통해 계정을 발급받습니다.</li>
          <li>회원은 계정 정보를 정확하게 유지하고, 비밀번호 등 인증 수단을 본인 책임으로 관리해야 합니다.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="제5조 (서비스의 제공 및 변경)">
        <p>
          서비스는 연중무휴 제공을 원칙으로 하나, 시스템 점검·장애·천재지변 등 불가피한 사유가 있는
          경우 일시 중단될 수 있습니다. 서비스는 운영상·기술상 필요에 따라 기능의 전부 또는 일부를
          변경할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection heading="제6조 (회원의 의무)">
        <ul className="list-disc pl-5 space-y-1">
          <li>타인의 정보를 도용하거나 허위 정보를 등록하지 않습니다.</li>
          <li>서비스의 정상적 운영을 방해하거나 권한 없이 타 회사·타 회원의 데이터에 접근하지 않습니다.</li>
          <li>관계 법령, 본 약관 및 서비스 이용 안내를 준수합니다.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="제7조 (데이터의 관리 책임)">
        <p>
          회사가 업무 목적으로 등록·생성한 데이터(근태·급여·결재·인사 정보 등)의 관리 주체는 해당
          회사입니다. 서비스는 회사(테넌트)별로 데이터를 격리하여 보관하며, 다른 회사의 데이터에 접근할
          수 없도록 합니다.
        </p>
      </LegalSection>

      <LegalSection heading="제8조 (이용 제한 및 해지)">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원은 언제든지 서비스 내 "회원 탈퇴"를 통해 이용계약을 해지할 수 있습니다.</li>
          <li>탈퇴 시 개인 식별 정보 및 인증 수단은 「개인정보처리방침」에 따라 처리됩니다.</li>
          <li>법령 위반·부정 이용이 확인되는 경우 서비스 이용이 제한되거나 회사 계정이 정지·해지될 수 있습니다.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="제9조 (면책)">
        <p>
          서비스는 천재지변, 회원의 귀책 사유, 제3자의 불법 행위 등 서비스의 합리적 통제를 벗어난 사유로
          발생한 손해에 대해서는 관련 법령이 허용하는 범위에서 책임을 지지 않습니다.
        </p>
      </LegalSection>

      <LegalSection heading="제10조 (준거법 및 관할)">
        <p>
          본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련한 분쟁에 대하여는
          <b> [관할 법원 — 예: 서울중앙지방법원]</b>을 제1심 관할 법원으로 합니다.
        </p>
      </LegalSection>

      <LegalSection heading="문의">
        <p>약관에 관한 문의: <b>developer.seojiwan@gmail.com</b></p>
      </LegalSection>
    </LegalLayout>
  );
}
