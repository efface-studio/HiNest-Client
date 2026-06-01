import { useEffect, useMemo, useRef, useState } from "react";

type Cat = { id: string; label: string; icon: string; items: string[] };

const CATS: Cat[] = [
  {
    id: "recent",
    label: "자주 쓰는",
    icon: "⏱",
    items: [], // filled from localStorage
  },
  {
    id: "smileys",
    label: "표정",
    icon: "😀",
    items: ["😀","😃","😄","😁","😆","😅","😂","🤣","🥲","☺️","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🥸","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🫢","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠"],
  },
  {
    id: "people",
    label: "사람",
    icon: "👋",
    items: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦾","🦵","🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","💋"],
  },
  {
    id: "nature",
    label: "자연",
    icon: "🐶",
    items: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐽","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🪱","🐛","🦋","🐌","🐞","🐜","🪰","🪲","🦗","🪳","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🌵","🎄","🌲","🌳","🌴","🪵","🌱","🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂","🍁","🍄","🌾","💐","🌷","🌹","🥀","🌺","🌸","🌼","🌻","🌞","🌝","🌛","🌜","🌚","🌕","🌖","🌗","🌘","🌑","🌒","🌓","🌔","🌙","🌎","🌍","🌏","🪐","💫","⭐","🌟","✨","⚡","☄️","💥","🔥","🌈","☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","☃️","⛄","🌬️","💨","💧","💦","☔","☂️","🌊"],
  },
  {
    id: "food",
    label: "음식",
    icon: "🍔",
    items: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🫑","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🫓","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","☕","🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊","🥄","🍴","🍽️","🥣","🥡","🥢","🧂"],
  },
  {
    id: "activities",
    label: "활동",
    icon: "⚽",
    items: ["⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎱","🪀","🏓","🏸","🏒","🏑","🥍","🏏","🪃","🥅","⛳","🪁","🏹","🎣","🤿","🥊","🥋","🎽","🛹","🛼","🛷","⛸️","🥌","🎿","⛷️","🏂","🪂","🏋️","🤼","🤸","⛹️","🤺","🤾","🏌️","🏇","🧘","🏄","🏊","🤽","🚣","🧗","🚵","🚴","🏆","🥇","🥈","🥉","🏅","🎖️","🏵️","🎗️","🎫","🎟️","🎪","🤹","🎭","🩰","🎨","🎬","🎤","🎧","🎼","🎹","🥁","🪘","🎷","🎺","🪗","🎸","🪕","🎻","🎲","♟️","🎯","🎳","🎮","🎰","🧩"],
  },
  {
    id: "objects",
    label: "사물",
    icon: "💡",
    items: ["⌚","📱","📲","💻","⌨️","🖥️","🖨️","🖱️","🖲️","🕹️","🗜️","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽️","🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛","⏳","📡","🔋","🪫","🔌","💡","🔦","🕯️","🪔","🧯","🛢️","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖️","🪜","🧰","🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️","🪤","🧱","⛓️","🧲","🔫","💣","🧨","🪓","🔪","🗡️","⚔️","🛡️","🚬","⚰️","🪦","⚱️","🏺","🔮","📿","🧿","💈","⚗️","🔭","🔬","🕳️","🩹","🩺","💊","💉","🩸","🧬","🦠","🧫","🧪","🌡️","🧹","🪠","🧺","🧻","🚽","🚰","🚿","🛁","🛀","🧼","🪥","🪒","🧽","🪣","🧴","🛎️","🔑","🗝️","🚪","🪑","🛋️","🛏️","🛌","🧸","🪆","🖼️","🪞","🪟","🛍️","🛒","🎁","🎈","🎏","🎀","🪄","🪅","🎊","🎉","🎎","🏮","🎐","🧧","✉️","📩","📨","📧","💌","📥","📤","📦","🏷️","🪧","📪","📫","📬","📭","📮","📯","📜","📃","📄","📑","🧾","📊","📈","📉","🗒️","🗓️","📆","📅","🗑️","📇","🗃️","🗳️","🗄️","📋","📁","📂","🗂️","🗞️","📰","📓","📔","📒","📕","📗","📘","📙","📚","📖","🔖","🧷","🔗","📎","🖇️","📐","📏","🧮","📌","📍","✂️","🖊️","🖋️","✒️","🖌️","🖍️","📝","✏️","🔍","🔎","🔏","🔐","🔒","🔓"],
  },
  {
    id: "symbols",
    label: "기호",
    icon: "❤️",
    items: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❤️‍🔥","❤️‍🩹","💖","💗","💘","💝","💞","💟","♥️","💓","💕","💌","💋","👑","💯","✅","☑️","✔️","❌","❎","⭕","🚫","🔞","📵","🚭","❗","❓","❕","❔","‼️","⁉️","💤","💫","💢","💣","💥","💦","💨","🕳️","🗨️","🗯️","💭","♨️","🌀","🔱","⚜️","🔰","♻️","✳️","❇️","✴️","💠","🔘","🔲","🔳","⚪","⚫","🔴","🟠","🟡","🟢","🔵","🟣","🟤","🔶","🔷","🔸","🔹","▪️","▫️","◾","◽","◼️","◻️","🟥","🟧","🟨","🟩","🟦","🟪","🟫","⬛","⬜","🎵","🎶","🎼"],
  },
];

const RECENT_KEY = "hinest.emoji.recent";
function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
function pushRecent(e: string) {
  const cur = getRecent().filter((x) => x !== e);
  const next = [e, ...cur].slice(0, 32);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export default function EmojiPicker({
  onPick,
  onClose,
  compact = false,
}: {
  onPick: (emoji: string) => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const [cat, setCat] = useState<string>("smileys");
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>(getRecent());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose?.();
    }
    // 다음 tick에 등록해서 여는 클릭이 바로 닫지 않게
    const t = setTimeout(() => document.addEventListener("mousedown", onDoc), 50);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", onDoc); };
  }, [onClose]);

  const items = useMemo(() => {
    let base: string[] = [];
    if (q.trim()) {
      const keyword = q.trim();
      // char substring match (best-effort; sufficient for emoji chars)
      base = CATS.flatMap((c) => c.items).filter((e) => e.includes(keyword));
    } else if (cat === "recent") {
      base = recent;
    } else {
      base = CATS.find((c) => c.id === cat)?.items ?? [];
    }
    return Array.from(new Set(base));
  }, [cat, q, recent]);

  function pick(e: string) {
    onPick(e);
    pushRecent(e);
    setRecent(getRecent());
  }

  const size = compact ? 320 : 340;

  return (
    <div
      ref={ref}
      className="panel overflow-hidden shadow-pop"
      style={{ width: size }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-ink-150">
        <div className="relative flex-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8E959E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            className="input h-[30px] text-[12px] pl-8"
            placeholder="이모지 찾기"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
      </div>

      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-ink-100 bg-ink-25">
        {CATS.filter((c) => c.id !== "recent" || recent.length > 0).map((c) => (
          <button
            key={c.id}
            onClick={() => { setCat(c.id); setQ(""); }}
            className={`w-8 h-8 rounded-md grid place-items-center text-[14px] transition ${
              cat === c.id && !q ? "bg-ink-100" : "hover:bg-ink-100"
            }`}
            title={c.label}
          >
            {c.icon}
          </button>
        ))}
      </div>

      <div className="max-h-[260px] overflow-y-auto p-2 grid" style={{ gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
        {items.length === 0 && (
          <div className="col-span-8 py-10 text-center text-[11px] text-ink-500">
            {q ? "일치하는 이모지가 없어요" : "아직 없음"}
          </div>
        )}
        {items.map((e, i) => (
          <button
            key={e + i}
            onClick={() => pick(e)}
            className="w-9 h-9 rounded-md grid place-items-center hover:bg-ink-100 text-[20px]"
            title={e}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Inline popover wrapper */
export function EmojiPopover({
  open,
  anchor,
  onPick,
  onClose,
  placement = "top-right",
}: {
  open: boolean;
  anchor: React.RefObject<HTMLElement>;
  onPick: (e: string) => void;
  onClose: () => void;
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const pickerW = 340;
    const pickerH = 340;
    let top = r.bottom + 6;
    let left = r.left;
    if (placement.startsWith("top")) top = r.top - pickerH - 6;
    if (placement.endsWith("right")) left = r.right - pickerW;
    // 화면 경계 보정
    left = Math.max(8, Math.min(window.innerWidth - pickerW - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - pickerH - 8, top));
    setPos({ top, left });
  }, [open, anchor, placement]);

  if (!open || !pos) return null;
  return (
    <div className="fixed z-[60]" style={{ top: pos.top, left: pos.left }}>
      <EmojiPicker onPick={(e) => { onPick(e); onClose(); }} onClose={onClose} />
    </div>
  );
}
