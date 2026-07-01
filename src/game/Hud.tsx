"use client";

import type { HudState } from "@/game/engine/Engine";

function formatTime(seconds: number | null): string {
  if (seconds === null) return "--:--.---";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms
    .toString()
    .padStart(3, "0")}`;
}

export function Hud({ hud }: { hud: HudState }) {
  return (
    <div style={styles.root}>
      <div style={styles.timers}>
        <div style={styles.timerRow}>
          <span style={styles.bigTime}>{formatTime(hud.currentTime)}</span>
        </div>
        <div style={styles.timerRow}>
          <span style={styles.label}>LAST LAP</span>
          <span style={styles.value}>{formatTime(hud.lastLap)}</span>
        </div>
        <div style={styles.timerRow}>
          <span style={styles.label}>BEST LAP</span>
          <span style={styles.value}>{formatTime(hud.bestLap)}</span>
        </div>
      </div>

      <div style={styles.speedWrap}>
        <span style={styles.speedValue}>{Math.round(hud.speedKmh)}</span>
        <span style={styles.speedUnit}>km/h</span>
        {hud.offroad && <span style={styles.offroad}>OFFROAD</span>}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    padding: "18px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    fontFamily: '"Courier New", ui-monospace, monospace',
    color: "#f5efe0",
    textShadow: "0 2px 6px rgba(0,0,0,0.55)",
  },
  timers: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  timerRow: {
    display: "flex",
    gap: 10,
    alignItems: "baseline",
  },
  bigTime: {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: 1,
  },
  label: {
    fontSize: 13,
    opacity: 0.85,
    letterSpacing: 1,
  },
  value: {
    fontSize: 15,
    fontWeight: 600,
  },
  speedWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
  },
  speedValue: {
    fontSize: 34,
    fontWeight: 700,
    lineHeight: 1,
  },
  speedUnit: {
    fontSize: 12,
    opacity: 0.8,
  },
  offroad: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: 700,
    color: "#ffcf6b",
    letterSpacing: 1,
  },
};
