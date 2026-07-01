/**
 * 채팅 관련 공유 타입.
 * ChatMiniApp / MessageBubble / 확장 뷰들에서 공통으로 사용.
 */

export type RoomMember = { muted?: boolean; user: { id: string; name: string; avatarColor?: string; avatarUrl?: string | null; position?: string | null; team?: string | null } };

export type Room = {
  id: string;
  name: string;
  type: "GROUP" | "DIRECT" | "TEAM";
  /** 그룹/팀방 생성자 — DELETE 권한 판정. legacy row 는 null. */
  createdById?: string | null;
  members: RoomMember[];
  messages: {
    content: string;
    createdAt: string;
    kind?: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "SHARE";
    fileName?: string | null;
    senderId?: string;
  }[];
};

export type Reaction = {
  userId: string;
  emoji: string;
  user?: { name: string };
};

export type Message = {
  id: string;
  // 서버는 include 여부에 따라 roomId 를 포함하기도/생략하기도 한다. SSE 푸시
  // 페이로드엔 항상 포함 — 클라는 optional 로 읽고 활용.
  roomId?: string;
  content: string;
  kind: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "SHARE";
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileSize?: number | null;
  deletedAt?: string | null;
  editedAt?: string | null;
  pinnedAt?: string | null;
  pinnedById?: string | null;
  createdAt: string;
  sender: { id: string; name: string; avatarColor?: string; avatarUrl?: string | null };
  reactions?: Reaction[];
  // 낙관적 전송 UI 전용 필드(서버는 안 봄).
  //  - pending: 로컬에 낙관적으로 삽입된 메시지(id 는 임시).
  //  - pendingClientId: 서버 응답/SSE 와 매칭해 dedup 하는 클라이언트 UUID.
  //  - pendingSetId: 다중 첨부는 한 번의 send() 가 여러 메시지를 만드므로,
  //    세트 단위 재시도(세트 전체 삭제 + payload 재전송)를 위해 같은 setId 를 공유.
  //  - status: 'sending' 전송 중 · 'failed' 실패(재시도 UI 노출). 성공 시 제거/교체.
  pending?: boolean;
  pendingClientId?: string;
  pendingSetId?: string;
  status?: "sending" | "failed";
};

export type Attachment = {
  url: string;
  name: string;
  type: string;
  size: number;
  kind: "IMAGE" | "VIDEO" | "FILE";
};

export type MessageHit = {
  roomId: string;
  room: Room;
  message: {
    id: string;
    content: string;
    createdAt: string;
    sender: { id: string; name: string; avatarColor?: string; avatarUrl?: string | null };
  };
};

export type RoomLocalSetting = { nickname?: string; muted?: boolean };
