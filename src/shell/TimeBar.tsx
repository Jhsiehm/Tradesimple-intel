import { useEffect, useRef, useState } from "react";

export type Domain = { start: number; end: number; step: number };
export type TimeNote = { label: string; text: string; tone?: "stale" | "ok" };

type Props = {
  domain: Domain;
  value: number | null;
  onChange: (t: number | null) => void;
  notes: TimeNote[];
  title: string;
};

const SPEEDS = [1, 3, 6];
const TICK = 750;

export function TimeBar({ domain, value, onChange, notes, title }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const cursor = value ?? domain.end;
  const ref = useRef({ cursor, domain, onChange });
  ref.current = { cursor, domain, onChange };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const { cursor: at, domain: d, onChange: set } = ref.current;
      const next = at + d.step * speed;
      if (next >= d.end) {
        set(null);
        setPlaying(false);
      } else set(next);
    }, TICK);
    return () => window.clearInterval(timer);
  }, [playing, speed]);

  const nudge = (steps: number) => {
    const next = Math.max(domain.start, Math.min(domain.end, cursor + steps * domain.step));
    onChange(next >= domain.end ? null : next);
  };
  const play = () => {
    if (playing) return setPlaying(false);
    if (value == null) onChange(domain.start);
    setPlaying(true);
  };
  const daily = domain.step >= 24 * 60 * 60 * 1000;
  const behind = domain.end - cursor;

  return (
    <div className="timebar" role="group" aria-label={title}>
      <div className="timebar-controls">
        <em>{title}</em>
        <button onClick={() => nudge(-1)} title="Back one frame" aria-label="Back one frame">◂</button>
        <button className="timebar-play" onClick={play} aria-pressed={playing} title={playing ? "Pause" : value == null ? "Replay the window up to now" : "Play forward to now"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <button onClick={() => nudge(1)} title="Forward one frame" aria-label="Forward one frame">▸</button>
        <span className="seg timebar-speed" title="Frames per tick">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
          ))}
        </span>
        <button className={value == null ? "timebar-now on" : "timebar-now"} onClick={() => { setPlaying(false); onChange(null); }} title="Jump to the latest frame and follow it">
          {value == null ? "● LIVE" : "NOW"}
        </button>
        <strong className="timebar-at">{stamp(cursor, daily)}</strong>
        <span className="timebar-behind">{value == null ? "latest frame" : `−${span(behind, daily)} from latest`}</span>
      </div>
      <input
        type="range"
        min={domain.start}
        max={domain.end}
        step={domain.step}
        value={cursor}
        onChange={(e) => { const t = Number(e.target.value); onChange(t >= domain.end ? null : t); }}
        aria-label="Time"
      />
      <div className="timebar-scale">
        <span>{stamp(domain.start, daily)}</span>
        <span className="timebar-notes">
          {notes.map((n) => (
            <span key={n.label} className={n.tone === "stale" ? "stale" : undefined}><b>{n.label}</b> {n.text}</span>
          ))}
        </span>
        <span>{stamp(domain.end, daily)}</span>
      </div>
    </div>
  );
}

export function stamp(t: number, daily = false) {
  const iso = new Date(t).toISOString();
  return daily ? iso.slice(0, 10) : `${iso.slice(5, 10)} ${iso.slice(11, 16)}Z`;
}

export function span(ms: number, daily = false) {
  if (daily) return `${Math.round(ms / 86400000)}d`;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h}h${String(mins % 60).padStart(2, "0")}` : `${h}h`;
}
