import { useEffect, useMemo, useState } from "react";
import {
  formatDateOnly,
  formatDateTime,
  formatTimeOnly,
  pad2,
  parseDateTimeValue,
} from "./columnEditors";

type Mode = "datetime" | "date" | "time";

type Props = {
  mode: Mode;
  value: string;
  nullable?: boolean;
  onConfirm: (value: string | null) => void;
  onCancel: () => void;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function DateTimePicker({
  mode,
  value,
  nullable = true,
  onConfirm,
  onCancel,
}: Props) {
  const initial = parseDateTimeValue(value) ?? new Date();
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());
  const [day, setDay] = useState(initial.getDate());
  const [hour, setHour] = useState(initial.getHours());
  const [minute, setMinute] = useState(initial.getMinutes());
  const [second, setSecond] = useState(initial.getSeconds());
  const [text, setText] = useState(() => {
    if (!value) {
      const d = new Date();
      if (mode === "date") return formatDateOnly(d);
      if (mode === "time") return formatTimeOnly(d);
      return formatDateTime(d);
    }
    return value;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1).getDay();
    const total = daysInMonth(year, month);
    const prevTotal = daysInMonth(year, month === 0 ? 11 : month - 1);
    const list: { day: number; inMonth: boolean }[] = [];
    for (let i = first - 1; i >= 0; i--) {
      list.push({ day: prevTotal - i, inMonth: false });
    }
    for (let d = 1; d <= total; d++) list.push({ day: d, inMonth: true });
    while (list.length % 7 !== 0) {
      list.push({ day: list.length - (first + total) + 1, inMonth: false });
    }
    while (list.length < 42) {
      const last = list[list.length - 1]!;
      list.push({
        day: last.inMonth ? 1 : last.day + 1,
        inMonth: false,
      });
    }
    return list;
  }, [year, month]);

  function syncTextFromParts(
    y = year,
    m = month,
    d = day,
    h = hour,
    mi = minute,
    s = second,
  ) {
    const dt = new Date(y, m, d, h, mi, s);
    if (mode === "date") setText(formatDateOnly(dt));
    else if (mode === "time") setText(formatTimeOnly(dt));
    else setText(formatDateTime(dt));
  }

  function shiftMonth(delta: number) {
    const dt = new Date(year, month + delta, 1);
    setYear(dt.getFullYear());
    setMonth(dt.getMonth());
  }

  function selectDay(d: number, inMonth: boolean) {
    if (!inMonth) return;
    setDay(d);
    syncTextFromParts(year, month, d, hour, minute, second);
  }

  function bump(
    which: "hour" | "minute" | "second",
    delta: number,
  ) {
    let h = hour;
    let mi = minute;
    let s = second;
    if (which === "hour") h = (h + delta + 24) % 24;
    if (which === "minute") mi = (mi + delta + 60) % 60;
    if (which === "second") s = (s + delta + 60) % 60;
    setHour(h);
    setMinute(mi);
    setSecond(s);
    syncTextFromParts(year, month, day, h, mi, s);
  }

  function applyText(raw: string) {
    setText(raw);
    const parsed = parseDateTimeValue(raw);
    if (!parsed) return;
    setYear(parsed.getFullYear());
    setMonth(parsed.getMonth());
    setDay(parsed.getDate());
    setHour(parsed.getHours());
    setMinute(parsed.getMinutes());
    setSecond(parsed.getSeconds());
  }

  function confirm() {
    const parsed = parseDateTimeValue(text);
    if (!parsed) {
      if (nullable && !text.trim()) {
        onConfirm(null);
        return;
      }
      return;
    }
    if (mode === "date") onConfirm(formatDateOnly(parsed));
    else if (mode === "time") onConfirm(formatTimeOnly(parsed));
    else onConfirm(formatDateTime(parsed));
  }

  const showCalendar = mode === "datetime" || mode === "date";
  const showTime = mode === "datetime" || mode === "time";

  return (
    <div
      className="dtp-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="dtp-panel" role="dialog" aria-label="选择日期时间">
        <div className="dtp-body">
          {showCalendar && (
            <div className="dtp-calendar">
              <div className="dtp-cal-head">
                <button type="button" onClick={() => shiftMonth(-1)}>
                  ‹
                </button>
                <span>
                  {year}年 {month + 1}月
                </span>
                <button type="button" onClick={() => shiftMonth(1)}>
                  ›
                </button>
              </div>
              <div className="dtp-weekdays">
                {WEEKDAYS.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="dtp-days">
                {cells.map((c, i) => {
                  const selected = c.inMonth && c.day === day;
                  return (
                    <button
                      key={`${i}-${c.inMonth}-${c.day}`}
                      type="button"
                      className={[
                        "dtp-day",
                        c.inMonth ? "" : "is-out",
                        selected ? "is-selected" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => selectDay(c.day, c.inMonth)}
                    >
                      {c.day}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {showTime && (
            <div className="dtp-clock">
              <div className="dtp-clock-face" aria-hidden>
                <div className="dtp-clock-center" />
                <div
                  className="dtp-hand is-hour"
                  style={{
                    transform: `rotate(${((hour % 12) + minute / 60) * 30}deg)`,
                  }}
                />
                <div
                  className="dtp-hand is-minute"
                  style={{
                    transform: `rotate(${(minute + second / 60) * 6}deg)`,
                  }}
                />
                <div
                  className="dtp-hand is-second"
                  style={{ transform: `rotate(${second * 6}deg)` }}
                />
                <div className="dtp-clock-readout">
                  {pad2(hour)}:{pad2(minute)}:{pad2(second)}
                </div>
              </div>
              <div className="dtp-time-spinners">
                {(
                  [
                    ["时", "hour", hour],
                    ["分", "minute", minute],
                    ["秒", "second", second],
                  ] as const
                ).map(([label, key, val]) => (
                  <div key={key} className="dtp-spin">
                    <button type="button" onClick={() => bump(key, 1)}>
                      ▲
                    </button>
                    <span>
                      {pad2(val)}
                      <small>{label}</small>
                    </span>
                    <button type="button" onClick={() => bump(key, -1)}>
                      ▼
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="dtp-footer">
          <input
            className="dtp-text"
            value={text}
            onChange={(e) => applyText(e.target.value)}
            spellCheck={false}
          />
          <div className="dtp-actions">
            {nullable && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => onConfirm(null)}
              >
                NULL
              </button>
            )}
            <button type="button" className="ghost-btn" onClick={onCancel}>
              取消
            </button>
            <button type="button" className="primary-btn" onClick={confirm}>
              好
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
