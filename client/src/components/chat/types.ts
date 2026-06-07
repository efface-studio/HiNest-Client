/**
 * 채팅 관련 공유 타입.
 * ChatMiniApp / MessageBubble / 확장 뷰들에서 공통으로 사용.
 */

export type RoomMember = { muted?: boolean; user: { id: string; name: string; avatarColor?: string; avatarUrl?: string | null } };

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
  pinnedAt?: string | null;
  pinnedById?: string | null;
  createdAt: string;
  sender: { id: string; name: string; avatarColor?: string; avatarUrl?: string | null };
  reactions?: Reaction[];
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
