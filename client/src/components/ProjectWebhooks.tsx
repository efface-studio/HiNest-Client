import { useEffect, useRef, useState } from "react";
import { api, apiSWR } from "../api";
import { confirmAsync, alertAsync, promptAsync } from "./ConfirmHost";

type Channel = {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  color: string;
  token: string;
  createdAt: string;
  _count?: { events: number };
};

type WebhookEvent = {
  id: string;
  title: string;
  body: string | null;
  rawPayload: string;
  sourceIp: string | null;
  createdAt: string;
};

/**
 * 프로젝트 웹훅 채널 — 외부 서비스가 고유 URL 로 POST 하면 이벤트 피드에 쌓임.
 * 관리자/멤버가 채널을 만들고, URL 을 복사해 외부에 등록하는 패턴.
 */
export default function ProjectWebhooks({ projectId }: { projectId: string }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [openCreate, setOpenCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", color: "#6366F1" });

  async function load() {
    // 이전에 열었던 프로젝트면 캐시된 채널 목록부터 즉시 그리고, 네트워크에서 새 값 오면 교체.
    await apiSWR<{ channels: Channel[] }>(`/api/project/${projectId}/webhook`, {
      onCached: (r) => {
        setChannels(r.channels);
        setLoaded(true);
      },
      onFresh: (r) => {
        setChannels(r.channels);
        setLoaded(true);
        // 이전 구현은 클로저 캡처된 `selected` 를 참조해, 사용자가 load() 중에
        // 다른 채널을 클릭하면 엉뚱한 채널 기준으로 유효성 체크를 함.
        // 함수형 업데이트로 항상 최신 selected 를 사용하고, 채널이 리네임/토큰재발급
        // 등으로 바뀌었으면 fresh 레코드로 교체(스태일 데이터 방지).
        setSelected((cur) => {
          if (!cur) return cur;
          const fresh = r.channels.find((c) => c.id === cur.id);
          return fresh ?? null;
        });
      },
    });
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [projectId]);

  // 채널을 빠르게 전환하거나 60초 주기 fetch 가 느린 네트워크에서 늦게 도착할 때,
  // 이전 요청 응답이 새 선택의 이벤트를 덮어쓰는 걸 막기 위한 토큰.
  const eventsTokenRef = useRef(0);
  async function loadEvents(ch: Channel) {
    const my = ++eventsTokenRef.current;
    try {
      const r = await api<{ events: WebhookEvent[] }>(`/api/project/${projectId}/webhook/${ch.id}/events`);
      if (my !== eventsTokenRef.current) return;
      setEvents(r.events);
    } catch {
      /* 60초마다 재시도되므로 일시적 오류는 조용히 넘어감 */
    }
  }
  useEffect(() => {
    if (!selected) return;
    // 채널이 바뀌면 이전 이벤트 리스트를 즉시 비워 잠깐이라도 오인 표시되지 않게.
    setEvents([]);
    loadEvents(selected);
    // 비용 절감: 60초 주기 자동 조회 + 탭이 보이지 않으면 폴링 정지(다시 보이면 즉시 1회 조회 후 재개).
    // 앱 전반의 폴링(알림·사내톡·결재 카운트)과 동일한 visibilitychange 패턴.
    let id: number | null = null;
    const start = () => { if (id === null) id = window.setInterval(() => loadEvents(selected), 60_000); };
    const stop = () => { if (id !== null) { window.clearInterval(id); id = null; } };
    if (document.visibilityState === "visible") start();
    const onVis = () => {
      if (document.visibilityState === "visible") { loadEvents(selected); start(); }
      else stop();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line
  }, [selected?.id]);

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api(`/api/project/${projectId}/webhook`, {
      method: "POST",
      json: form,
    });
    setOpenCreate(false);
    setForm({ name: "", description: "", color: "#6366F1" });
    load();
  }

  async function removeChannel(id: string) {
    const ok = await confirmAsync({
      title: "웹훅 채널 삭제",
      description: "이 채널을 삭제할까요? 기존 URL 은 즉시 무효화돼요.",
      tone: "danger",
      confirmLabel: "삭제",
    });
    if (!ok) return;
    await api(`/api/project/${projectId}/webhook/${id}`, { method: "DELETE" });
    if (selected?.id === id) setSelected(null);
    load();
  }

  async function rotateToken(id: string) {
    const ok = await confirmAsync({
      title: "URL 재발급",
      description: "URL 을 재발급할까요? 기존 URL 은 더 이상 동작하지 않아요.",
      confirmLabel: "재발급",
    });
    if (!ok) return;
    const r = await api<{ channel: Channel }>(`/api/project/${projectId}/webhook/${id}/rotate`, { method: "POST" });
    if (selected?.id === id) setSelected(r.channel);
    load();
  }

  function webhookUrlFor(token: string) {
    return `${window.location.origin}/api/webhook/${token}`;
  }
  async function copyUrl(token: string) {
    try {
      await navigator.clipboard.writeText(webhookUrlFor(token));
      alertAsync({ title: "복사 완료", description: "URL 을 클립보드에 복사했어요." });
    } catch {
      // 클립보드 API 가 막힌 환경(구버전 Safari 등) — 대체로 promptAsync 로 사용자가 직접 복사하도록.
      await promptAsync({
        title: "URL 복사",
        description: "아래 URL 을 복사해주세요.",
        defaultValue: webhookUrlFor(token),
        confirmLabel: "닫기",
      });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-bold">
          웹훅 채널 <span className="text-slate-400 font-normal">({channels.length})</span>
        </div>
        <button className="btn-primary !px-3 !py-1 text-xs" onClick={() => setOpenCreate(true)}>
          + 채널
        </button>
      </div>

      {loaded && channels.length === 0 && (
        <div className="text-sm text-slate-400 text-center py-10 border-2 border-dashed border-slate-200 rounded-lg">
          아직 채널이 없습니다. 외부 서비스의 이벤트를 수신하려면 채널을 만들고 URL 을 등록하세요.
        </div>
      )}

      {/* 채널 리스트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {channels.map((ch) => (
          <div
            key={ch.id}
            className={`border rounded-lg p-3 cursor-pointer hover:bg-slate-50 ${
              selected?.id === ch.id ? "border-brand-500 bg-brand-50/30" : "border-slate-200"
            }`}
            onClick={() => setSelected(ch)}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: ch.color }} />
              <div className="font-bold text-slate-900 text-sm truncate">{ch.name}</div>
              <span className="ml-auto text-[11px] text-slate-400">
                {ch._count?.events ?? 0} 건
              </span>
            </div>
            {ch.description && (
              <div className="text-[11px] text-slate-500 line-clamp-2 mb-2">{ch.description}</div>
            )}
            <div className="flex items-center gap-1 text-[11px]">
              <button
                className="btn-ghost !px-2 !py-0.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  copyUrl(ch.token);
                }}
              >
                URL 복사
              </button>
              <button
                className="btn-ghost !px-2 !py-0.5 text-[11px]"
                onClick={(e) => {
                  e.stopPropagation();
                  rotateToken(ch.id);
                }}
              >
                재발급
              </button>
              <button
                className="btn-ghost !px-2 !py-0.5 text-[11px] text-rose-500"
                onClick={(e) => {
                  e.stopPropagation();
                  removeChannel(ch.id);
                }}
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 선택한 채널의 수신 이벤트 피드 */}
      {selected && (
        <div className="mt-5 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: selected.color }} />
            <div className="text-sm font-bold">{selected.name} · 수신 이벤트</div>
            <button
              className="btn-ghost !px-2 !py-0.5 text-[11px] ml-auto"
              onClick={() => loadEvents(selected)}
            >
              새로고침
            </button>
          </div>
          <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-3 text-[11px] font-mono break-all text-slate-600">
            POST {webhookUrlFor(selected.token)}
          </div>
          {events.length === 0 ? (
            <div className="text-sm text-slate-400 text-center py-8">
              아직 수신된 이벤트가 없습니다.
            </div>
          ) : (
            <div className="space-y-2 max-h-[380px] overflow-auto">
              {events.map((ev) => (
                <details key={ev.id} className="border border-slate-100 rounded-lg px-3 py-2 bg-white">
                  <summary className="cursor-pointer flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">{ev.title}</div>
                      {ev.body && (
                        <div className="text-[11px] text-slate-500 line-clamp-1">{ev.body}</div>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">
                      {new Date(ev.createdAt).toLocaleString("ko-KR")}
                    </span>
                  </summary>
                  <pre className="mt-2 text-[11px] bg-slate-900 text-slate-100 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all">
                    {safePretty(ev.rawPayload)}
                  </pre>
                  {ev.sourceIp && (
                    <div className="mt-1 text-[10px] text-slate-400">from {ev.sourceIp}</div>
                  )}
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 생성 모달 */}
      {openCreate && (
        <div
          className="fixed inset-0 bg-slate-900/40 grid place-items-center p-4 z-50"
          onClick={() => setOpenCreate(false)}
        >
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">새 웹훅 채널</h3>
            <form onSubmit={createChannel} className="space-y-3">
              <div>
                <label className="label">채널 이름</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="예: GitHub 배포 알림"
                  maxLength={60}
                  required
                />
              </div>
              <div>
                <label className="label">설명 (선택)</label>
                <input
                  className="input"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="이 채널이 어떤 이벤트를 받는지 메모"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="label">색상</label>
                <input
                  type="color"
                  className="w-16 h-8 border border-slate-200 rounded"
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-ghost" onClick={() => setOpenCreate(false)}>
                  취소
                </button>
                <button className="btn-primary">만들기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function safePretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
