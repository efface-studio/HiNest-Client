import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { imgSrc } from "../api";

export type MentionUser = {
  id: string;
  name: string;
  team?: string | null;
  position?: string | null;
  avatarColor?: string;
  avatarUrl?: string | null;
};

type Props = {
  items: MentionUser[];
  command: (attrs: { id: string; label: string }) => void;
};

/**
 * 회의록 @멘션 자동완성 팝업.
 * TipTap suggestion 플러그인에서 ref 로 onKeyDown 을 호출한다 —
 * useImperativeHandle 로 이동/선택 동작 노출.
 */
const MentionList = forwardRef<{ onKeyDown: (e: { event: KeyboardEvent }) => boolean }, Props>(
  function MentionList({ items, command }, ref) {
    const [selected, setSelected] = useState(0);

    useEffect(() => {
      setSelected(0);
    }, [items]);

    function pick(i: number) {
      const u = items[i];
      if (!u) return;
      command({ id: u.id, label: u.name });
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          pick(selected);
          return true;
        }
        return false;
      },
    }));

    if (!items.length) {
      return (
        <div className="mention-popup">
          <div className="mention-empty">해당하는 사용자가 없어요</div>
        </div>
      );
    }

    return (
      <div className="mention-popup">
        {items.map((u, i) => (
          <button
            key={u.id}
            type="button"
            className={`mention-item ${i === selected ? "is-active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(i);
            }}
            onMouseEnter={() => setSelected(i)}
          >
            <span
              className="mention-avatar"
              style={{ background: u.avatarUrl ? "transparent" : u.avatarColor ?? "#94A3B8" }}
            >
              {u.avatarUrl ? <img src={imgSrc(u.avatarUrl)} alt={u.name} loading="lazy" decoding="async"/> : u.name[0]}
            </span>
            <span className="mention-name">{u.name}</span>
            {(u.team || u.position) && (
              <span className="mention-meta">
                {[u.team, u.position].filter(Boolean).join(" · ")}
              </span>
            )}
          </button>
        ))}
      </div>
    );
  },
);

export default MentionList;
