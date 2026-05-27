import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, apiSWR } from "../api";
import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import { alertAsync } from "../components/ConfirmHost";
import { isDevAccount, DevBadge } from "../lib/devBadge";
import { resolvePresence, type PresenceStatus, type WorkStatus } from "../lib/presence";

type ProfileUser = {
  id: string;
  name: string;
  email: string;
  team: string | null;
  position: string | null;
  role: string;
  avatarColor: string;
  avatarUrl: string | null;
  isDeveloper: boolean;
  active: boolean;
  employeeNo: string | null;
  hireDate: string | null;
  phone: string | null;
  presenceStatus: PresenceStatus | null;
  presenceMessage: string | null;
  presenceUpdatedAt: string | null;
  createdAt: string;
};

export default function UserProfilePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user: me } = useAuth();
  const [u, setU] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [openingDM, setOpeningDM] = useState(false);

  // 본인 페이지면 자체 마이페이지로 리다이렉트 — /profile 이 풀 편집 가능 화면.
  useEffect(() => {
    if (me && id && me.id === id) {
      nav("/profile", { replace: true });
    }
  }, [me, id, nav]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    apiSWR<{ user: ProfileUser }>(`/api/users/${id}`, {
      onCached: (r) => { if (alive) { setU(r.user); setLoading(false); } },
      onFresh: (r) => { if (alive) { setU(r.user); setLoading(false); } },
      onError: () => { if (alive) { setErr("불러오기 실패"); setLoading(false); } },
    });
    return () => { alive = false; };
  }, [id]);

  async function startDM() {
    if (!u || openingDM) return;
    setOpeningDM(true);
    try {
      const r = await api<{ room: { id: string } }>("/api/chat/rooms", {
        method: "POST",
        json: { type: "DIRECT", memberIds: [u.id] },
      });
      window.dispatchEvent(new CustomEvent("chat:open"));
      window.dispatchEvent(new CustomEvent("chat:open-room", { detail: { roomId: r.room.id } }));
    } catch (e: any) {
      alertAsync({ title: "대화방 열기 실패", description: e?.message ?? "잠시 후 다시 시도해 주세요." });
    } finally {
      setOpeningDM(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="팀원" title="프로필" />
        <div className="panel p-12 text-center text-ink-500 text-[13px]">불러오는 중…</div>
      </div>
    );
  }
  if (err || !u) {
    return (
      <div>
        <PageHeader eyebrow="팀원" title="프로필" />
        <div className="panel p-12 text-center">
          <div className="text-[14px] font-bold text-ink-900">프로필을 찾을 수 없어요</div>
          <div className="text-[12.5px] text-ink-500 mt-1">{err ?? "사용자가 없거나 접근 권한이 없습니다."}</div>
          <button className="btn-ghost mt-4" onClick={() => nav(-1)}>돌아가기</button>
        </div>
      </div>
    );
  }

  const presence = resolvePresence(u.presenceStatus, null as WorkStatus | null);
  const isReviewer = me?.role === "ADMIN" || me?.role === "MANAGER";
  const initial = (u.name?.[0] ?? "?").toUpperCase();

  return (
    <div>
      <PageHeader
        eyebrow="팀원"
        title="프로필"
        right={
          <button className="btn-ghost" onClick={() => nav(-1)}>
            ← 돌아가기
          </button>
        }
      />

      {/* 히어로 카드 — 그라데이션 헤더 + 큰 아바타 + 액션 */}
      <div className="panel p-0 overflow-hidden mb-4">
        <div
          className="relative px-6 sm:px-10 py-10"
          style={{
            background:
              "linear-gradient(135deg, var(--c-brand) 0%, #7C3AED 100%)",
            color: "#fff",
          }}
        >
          {/* 격자 패턴 */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(ellipse at center, #000 0%, transparent 75%)",
              pointerEvents: "none",
            }}
          />
          <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* 아바타 */}
            <div className="relative">
              <div
                className="w-24 h-24 rounded-2xl grid place-items-center text-[36px] font-extrabold overflow-hidden"
                style={{
                  background: u.avatarUrl ? "transparent" : u.avatarColor,
                  color: "#fff",
                  border: "3px solid rgba(255,255,255,0.32)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
                }}
              >
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" loading="lazy" decoding="async"/>
                ) : (
                  initial
                )}
              </div>
              {/* presence 점 */}
              <span
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full"
                style={{
                  background: presence.color,
                  border: "3px solid #fff",
                }}
                title={presence.label}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-[28px] font-extrabold tracking-tight">{u.name}</h1>
                {u.isDeveloper && <DevBadge size="md" />}
                {!u.active && (
                  <span className="chip" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>비활성</span>
                )}
              </div>
              <div className="text-[14px] text-white/85">
                {[u.team, u.position].filter(Boolean).join(" · ") || "—"}
              </div>
              <div className="text-[12.5px] text-white/70 mt-1 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: presence.color }} />
                {presence.label}
                {u.presenceMessage && <span> · {u.presenceMessage}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col sm:gap-2">
              <button
                onClick={startDM}
                disabled={openingDM}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[13px] transition"
                style={{ background: "#fff", color: "var(--c-brand)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
                {openingDM ? "여는 중…" : "1:1 대화"}
              </button>
              {u.email !== "" && (
                <a
                  href={`mailto:${u.email}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-[13px] transition"
                  style={{
                    background: "rgba(255,255,255,0.18)",
                    color: "#fff",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.22)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  메일
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 정보 카드들 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="panel p-5">
          <div className="text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-ink-500 mb-3">기본 정보</div>
          <Field label="이름" value={u.name} />
          <Field label="이메일" value={u.email} mono />
          <Field label="권한" value={roleLabel(u.role)} />
          <Field label="팀" value={u.team ?? "—"} />
          <Field label="직급" value={u.position ?? "—"} />
        </div>
        <div className="panel p-5">
          <div className="text-[10.5px] font-extrabold tracking-[0.06em] uppercase text-ink-500 mb-3">근무 정보</div>
          <Field label="사번" value={u.employeeNo ?? "—"} mono />
          <Field label="입사일" value={u.hireDate ?? "—"} />
          <Field label="연락처" value={u.phone ?? "—"} mono />
          <Field label="가입일" value={new Date(u.createdAt).toLocaleDateString("ko-KR")} />
          {!isReviewer && (u.employeeNo === null || u.phone === null || u.hireDate === null) && (
            <div className="text-[10.5px] text-ink-400 mt-3 leading-relaxed">
              일부 정보는 관리자만 볼 수 있어요.
            </div>
          )}
        </div>
      </div>

      <div className="panel p-3 mt-4 flex items-center gap-2 flex-wrap">
        <Link to="/directory" className="btn-ghost btn-xs">팀원 전체 보기</Link>
        <Link to="/org" className="btn-ghost btn-xs">조직도</Link>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-ink-100 last:border-0">
      <div className="text-[12px] text-ink-500">{label}</div>
      <div className={`text-[13px] font-semibold text-ink-900 text-right ${mono ? "font-mono tracking-[0.02em]" : ""} truncate`}>
        {value}
      </div>
    </div>
  );
}

function roleLabel(r: string): string {
  if (r === "ADMIN") return "관리자";
  if (r === "MANAGER") return "매니저";
  if (r === "MEMBER") return "팀원";
  return r;
}
