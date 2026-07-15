import LegalLayout, { LegalSection } from "../components/LegalLayout";

/**
 * 개인정보처리방침 — 앱스토어/플레이스토어 심사 요건(공개 접근 가능한 방침 링크).
 *
 * 아래 내용은 HiNest 가 실제로 수집·처리하는 데이터(계정·HR·근태·급여·접속로그 등)에
 * 기반한 표준 방침이다. 서비스 운영자는 제출 전 굵게 표시된 [ ] 항목(운영자명·문의처·
 * 위탁업체·시행일)을 실제 값으로 채워야 한다.
 */
export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="개인정보처리방침" effectiveDate="2026-06-01">
      <p>
        HiNest(이하 "서비스")는 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를
        보호하기 위해 다음과 같은 처리방침을 둡니다. 본 방침은 서비스 화면에 공개되어 누구나 언제든지
        확인할 수 있습니다.
      </p>

      <LegalSection heading="1. 수집하는 개인정보 항목">
        <p>서비스는 워크스페이스 업무 지원을 위해 다음 정보를 수집·처리합니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><b>계정 정보</b>: 이메일, 이름, 비밀번호(단방향 암호화하여 저장), 프로필 이미지·색상</li>
          <li><b>소속·인사 정보</b>: 소속 회사, 사번, 부서·팀, 직급/직무, 고용형태, 입사일, 연락처, 생년월일 등 회사가 등록한 인사 항목</li>
          <li><b>업무 데이터</b>: 근태(출퇴근) 기록, 휴가, 일정, 결재 문서, 급여명세서, 업무일지, 공지·메시지, 첨부파일</li>
          <li><b>자동 수집 정보</b>: 접속 일시·IP 주소, 기기·브라우저 정보(User-Agent), 세션·인증 토큰, 서비스 이용 기록</li>
        </ul>
      </LegalSection>

      <LegalSection heading="2. 개인정보의 수집·이용 목적">
        <ul className="list-disc pl-5 space-y-1">
          <li>회원 식별 및 로그인·인증, 워크스페이스 접근 권한 관리</li>
          <li>근태·휴가·결재·급여·업무일지 등 사내 업무 기능 제공</li>
          <li>공지·메시지·알림 등 구성원 간 협업 지원</li>
          <li>부정 이용 방지, 보안 사고 대응, 접속 기록 관리</li>
          <li>서비스 운영·개선 및 고객 문의 대응</li>
        </ul>
      </LegalSection>

      <LegalSection heading="3. 보유 및 이용 기간">
        <p>
          이용자가 회원 탈퇴를 하면 개인정보는 지체 없이 파기합니다. 다만 관계 법령에서 일정 기간 보존을
          요구하는 경우 해당 기간 동안 분리 보관합니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>근로·임금 관련 기록: 「근로기준법」에 따라 3년</li>
          <li>전자금융·거래 관련 기록: 관계 법령이 정한 기간</li>
          <li>접속 로그(통신비밀보호법): 3개월</li>
        </ul>
        <p>
          법령상 보존 의무가 없는 개인 식별 정보(이름·이메일·연락처 등)는 탈퇴 즉시 익명화 또는
          삭제합니다.
        </p>
      </LegalSection>

      <LegalSection heading="4. 개인정보의 제3자 제공">
        <p>
          서비스는 이용자의 개인정보를 외부에 제공하지 않습니다. 다만 법령에 근거가 있거나 수사기관이
          적법한 절차에 따라 요청하는 경우에 한해 제공할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection heading="5. 개인정보 처리의 위탁">
        <p>
          서비스는 안정적 운영을 위해 클라우드 인프라·이메일 발송 등 일부 처리를 외부에 위탁할 수 있으며,
          위탁 시 관련 법령에 따라 안전한 관리가 이루어지도록 합니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>클라우드 호스팅·데이터베이스: <b>Supabase Inc. (Amazon Web Services 인프라 기반)</b></li>
          <li>이메일(알림·급여명세서) 발송: <b>Amazon Web Services, Inc. (Amazon SES)</b></li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. 정보주체의 권리와 행사 방법">
        <p>이용자는 언제든지 다음 권리를 행사할 수 있습니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>개인정보 열람·정정: 서비스 내 "내 프로필"에서 직접 확인·수정</li>
          <li>처리 정지·삭제 요청: 아래 문의처 또는 서비스 내 <b>"회원 탈퇴"</b>를 통해 계정 및 개인 식별 정보 삭제</li>
        </ul>
        <p>
          회원 탈퇴 시 비밀번호·인증 수단(패스키 등)·세션은 즉시 파기되어 재로그인이 불가능하며, 이름·이메일
          등 개인 식별 정보는 익명화됩니다.
        </p>
      </LegalSection>

      <LegalSection heading="7. 개인정보의 파기">
        <p>
          보유 기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구가
          불가능한 방식으로 영구 삭제하며, 출력물은 분쇄 또는 소각합니다.
        </p>
      </LegalSection>

      <LegalSection heading="8. 개인정보의 안전성 확보 조치">
        <ul className="list-disc pl-5 space-y-1">
          <li>비밀번호 단방향 암호화 저장, 전송 구간 암호화(HTTPS)</li>
          <li>접근 권한 관리 및 최소 권한 원칙, 회사(테넌트)별 데이터 격리</li>
          <li>접속 기록 보관 및 이상 접근 모니터링</li>
        </ul>
      </LegalSection>

      <LegalSection heading="9. 개인정보 보호책임자 및 문의처">
        <p>
          개인정보 처리에 관한 문의·불만·피해 구제는 아래로 접수할 수 있습니다.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>개인정보 보호책임자: <b>서지완 (대표)</b></li>
          <li>문의 이메일: <b>xixn2@efface.dev</b></li>
        </ul>
      </LegalSection>

      <LegalSection heading="10. 방침의 변경">
        <p>
          본 방침은 법령·서비스 변경에 따라 개정될 수 있으며, 변경 시 서비스 화면을 통해 공지합니다.
        </p>
      </LegalSection>
    </LegalLayout>
  );
}
