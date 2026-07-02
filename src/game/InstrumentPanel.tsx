"use client";

import type { HudState } from "@/game/engine/Engine";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const GAUGE_START = 130; // degrees; 0=right, 90=down (SVG y-down), sweeping clockwise
const GAUGE_SWEEP = 280;

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

interface GaugeProps {
  value: number;
  min: number;
  max: number;
  majorStep: number;
  size: number;
  label: string;
  decimals?: number;
  redlineStart?: number;
}

/** Circular analog gauge (speedometer/tachometer) rendered as SVG -- ticks, optional redline arc, needle, digital readout. */
function Gauge({ value, min, max, majorStep, size, label, decimals = 0, redlineStart }: GaugeProps) {
  const frac = clamp01((value - min) / (max - min));
  const valueAngle = GAUGE_START + frac * GAUGE_SWEEP;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 9;

  const ticks: React.ReactNode[] = [];
  const majorCount = Math.round((max - min) / majorStep);
  for (let i = 0; i <= majorCount; i++) {
    const a = GAUGE_START + (i / majorCount) * GAUGE_SWEEP;
    const [x1, y1] = polar(cx, cy, r, a);
    const [x2, y2] = polar(cx, cy, r - 7, a);
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f5efe0" strokeWidth={1.4} opacity={0.75} />);
  }

  let redlineArc: React.ReactNode = null;
  if (redlineStart !== undefined) {
    const a1 = GAUGE_START + clamp01((redlineStart - min) / (max - min)) * GAUGE_SWEEP;
    const a2 = GAUGE_START + GAUGE_SWEEP;
    const [x1, y1] = polar(cx, cy, r, a1);
    const [x2, y2] = polar(cx, cy, r, a2);
    redlineArc = <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} stroke="#c9312b" strokeWidth={3.5} fill="none" opacity={0.85} />;
  }

  const [nx, ny] = polar(cx, cy, r - 12, valueAngle);

  return (
    <svg width={size} height={size} style={{ overflow: "visible" }}>
      <circle cx={cx} cy={cy} r={r} fill="rgba(10,9,6,0.4)" stroke="rgba(245,239,224,0.35)" strokeWidth={1.5} />
      {redlineArc}
      {ticks}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#ff5a3c" strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={3} fill="#f5efe0" />
      <text
        x={cx}
        y={cy + size * 0.24}
        textAnchor="middle"
        fontSize={size * 0.15}
        fill="#f5efe0"
        fontFamily="'Courier New', monospace"
        fontWeight={700}
      >
        {value.toFixed(decimals)}
      </text>
      <text
        x={cx}
        y={size - 4}
        textAnchor="middle"
        fontSize={size * 0.1}
        fill="#f5efe0"
        opacity={0.7}
        fontFamily="'Courier New', monospace"
        letterSpacing={1}
      >
        {label}
      </text>
    </svg>
  );
}

interface BarGaugeProps {
  value: number;
  min: number;
  max: number;
  label: string;
  width: number;
  height: number;
  colorFor: (frac: number) => string;
}

/** Small linear bar gauge (fuel/oil temp). */
function BarGauge({ value, min, max, label, width, height, colorFor }: BarGaugeProps) {
  const frac = clamp01((value - min) / (max - min));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
      <div
        style={{
          width,
          height,
          borderRadius: 3,
          background: "rgba(10,9,6,0.45)",
          border: "1px solid rgba(245,239,224,0.3)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${frac * 100}%`, height: "100%", background: colorFor(frac) }} />
      </div>
      <div style={{ fontSize: 8, opacity: 0.7, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

function fuelColor(frac: number): string {
  if (frac < 0.15) return "#c9312b";
  if (frac < 0.35) return "#e8b923";
  return "#3f9e52";
}

function oilColor(frac: number): string {
  if (frac > 0.85) return "#c9312b";
  if (frac > 0.6) return "#e8b923";
  return "#3f9e52";
}

function WarningLight({ on, label, color }: { on: boolean; label: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, opacity: on ? 1 : 0.35 }}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: on ? color : "rgba(245,239,224,0.25)",
          boxShadow: on ? `0 0 6px 2px ${color}` : "none",
        }}
      />
      <div style={{ fontSize: 7, letterSpacing: 0.5 }}>{label}</div>
    </div>
  );
}

export function InstrumentPanel({ hud, compact }: { hud: HudState; compact: boolean }) {
  const tachSize = compact ? 56 : 92;
  const speedoSize = compact ? 66 : 104;
  const barWidth = compact ? 34 : 52;
  const barHeight = compact ? 7 : 9;

  return (
    <div style={styles.root}>
      <div style={styles.sideCol}>
        <BarGauge value={hud.fuelPercent} min={0} max={100} label="FUEL" width={barWidth} height={barHeight} colorFor={fuelColor} />
        <BarGauge value={hud.oilTempC} min={60} max={150} label="OIL" width={barWidth} height={barHeight} colorFor={oilColor} />
      </div>
      <Gauge value={hud.rpm / 1000} min={0} max={7} majorStep={1} size={tachSize} label="RPM x1000" decimals={1} redlineStart={6.5} />
      <Gauge value={hud.speedKmh} min={0} max={140} majorStep={20} size={speedoSize} label="KM/H" decimals={0} />
      <div style={styles.sideCol}>
        <WarningLight on={hud.checkEngineOn} label="ENGINE" color="#e8b923" />
        <WarningLight on={hud.lowFuel} label="FUEL" color="#e8b923" />
        <WarningLight on={hud.handbrakeOn} label="BRAKE" color="#ff5a3c" />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "absolute",
    left: "50%",
    bottom: 8,
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 12,
    background: "rgba(20,18,12,0.55)",
    border: "1px solid rgba(245,239,224,0.35)",
    color: "#f5efe0",
    fontFamily: '"Courier New", ui-monospace, monospace',
    pointerEvents: "none",
    textShadow: "0 1px 3px rgba(0,0,0,0.5)",
  },
  sideCol: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
};
