import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";

/**
 * 기존 DatePicker + TimePicker 조합으로 다시 만든 호환 래퍼.
 * - 캘린더 일러스트는 우리가 이전에 쓰던 \"일정 페이지 캘린더\" 스타일 그대로.
 * - 모든 콜사이트 (SchedulePage / ExpensePage / JournalPage / AttendancePage / ApprovalsPage / ShareLinkModal / ProjectCalendar) 가 이 컴포넌트를 그대로 호출.
 *
 * 값 형식:
 *   mode=\"datetime\" → \"YYYY-MM-DDTHH:mm\"
 *   mode=\"date\"     → \"YYYY-MM-DD\"
 */

type Mode = "datetime" | "date";

type Props = {
  value: string;
  onChange: (v: string) => void;
  mode?: Mode;
  min?: string;
  placeholder?: string;
  className?: string;
};

function splitValue(v: string, mode: Mode): { date: string; time: string } {
  if (!v) return { date: "", time: "" };
  if (mode === "date") return { date: v.slice(0, 10), time: "" };
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!m) return { date: v.slice(0, 10), time: "" };
  return { date: m[1], time: m[2] };
}

function combine(date: string, time: string, mode: Mode): string {
  if (mode === "date") return date;
  if (!date) return "";
  // 시간 비어있으면 09:00 기본 — 빈 datetime 으로 저장하면 서버 파싱이 깨질 수 있으니.
  return `${date}T${time || "09:00"}`;
}

export default function DateTimePicker({ value, onChange, mode = "datetime", min, placeholder, className }: Props) {
  const { date, time } = splitValue(value, mode);
  const minDate = min ? min.slice(0, 10) : undefined;

  if (mode === "date") {
    return (
      <DatePicker
        value={date}
        onChange={(d) => onChange(d)}
        placeholder={placeholder ?? "YYYY-MM-DD"}
        className={className}
        variant="input"
        min={minDate}
      />
    );
  }

  return (
    <div className={`flex items-stretch gap-2 ${className ?? ""}`}>
      <div className="flex-1 min-w-0">
        <DatePicker
          value={date}
          onChange={(d) => onChange(combine(d, time, mode))}
          placeholder="YYYY-MM-DD"
          variant="input"
          min={minDate}
        />
      </div>
      <div className="w-[110px] flex-shrink-0">
        <TimePicker
          value={time}
          onChange={(t) => onChange(combine(date, t, mode))}
          placeholder="--:--"
          minuteStep={5}
        />
      </div>
    </div>
  );
}
