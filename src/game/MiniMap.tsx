"use client";

import { useEffect, useRef, useState } from "react";
import type { HudState } from "@/game/engine/Engine";

const SIZE_PRESETS = { sm: 96, md: 130, lg: 176 } as const;
type MapSize = keyof typeof SIZE_PRESETS;
const SIZE_ORDER: MapSize[] = ["sm", "md", "lg"];

const PADDING = 12;

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function computeBounds(points: [number, number][]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function MiniMap({ hud, trackPoints }: { hud: HudState; trackPoints: [number, number][] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const [mapSize, setMapSize] = useState<MapSize>("md");
  const size = SIZE_PRESETS[mapSize];
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  useEffect(() => {
    if (trackPoints.length > 0) boundsRef.current = computeBounds(trackPoints);
  }, [trackPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const bounds = boundsRef.current;
    if (!canvas || !bounds) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
    const scale = (size - PADDING * 2) / span;

    const toCanvas = (x: number, z: number): [number, number] => {
      const cx = PADDING + (x - bounds.minX) * scale + ((size - PADDING * 2) - (bounds.maxX - bounds.minX) * scale) / 2;
      const cy = PADDING + (z - bounds.minZ) * scale + ((size - PADDING * 2) - (bounds.maxZ - bounds.minZ) * scale) / 2;
      return [cx, cy];
    };

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = "rgba(20,18,12,0.55)";
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(245,239,224,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();

    if (trackPoints.length > 1) {
      ctx.beginPath();
      trackPoints.forEach(([x, z], i) => {
        const [cx, cy] = toCanvas(x, z);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(245,239,224,0.75)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
    }

    for (const racer of hud.racers) {
      const [rx, ry] = toCanvas(racer.x, racer.z);
      ctx.beginPath();
      ctx.arc(rx, ry, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = `#${racer.color.toString(16).padStart(6, "0")}`;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    const [carX, carY] = toCanvas(hud.carX, hud.carZ);
    const fx = Math.sin(hud.carHeading);
    const fz = Math.cos(hud.carHeading);
    const sx = fz;
    const sz = -fx;
    const tip: [number, number] = [carX + fx * 6, carY + fz * 6];
    const backLeft: [number, number] = [carX - fx * 3.5 + sx * 3, carY - fz * 3.5 + sz * 3];
    const backRight: [number, number] = [carX - fx * 3.5 - sx * 3, carY - fz * 3.5 - sz * 3];

    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(backLeft[0], backLeft[1]);
    ctx.lineTo(backRight[0], backRight[1]);
    ctx.closePath();
    ctx.fillStyle = "#5b9bf5";
    ctx.fill();

    ctx.restore();
  });

  const cycleSize = () => {
    setMapSize((prev) => SIZE_ORDER[(SIZE_ORDER.indexOf(prev) + 1) % SIZE_ORDER.length]);
  };

  return (
    <div
      style={{
        // Top-right, below the speed readout -- bottom corners are reserved
        // for the touch throttle/brake/steer buttons on mobile.
        position: "absolute",
        right: 12,
        top: 100,
        width: size,
        height: size,
      }}
    >
      <canvas
        ref={canvasRef}
        width={size * dpr}
        height={size * dpr}
        style={{ width: size, height: size, pointerEvents: "none" }}
      />
      <button
        onClick={cycleSize}
        aria-label="Resize minimap"
        style={{
          position: "absolute",
          top: 3,
          left: 3,
          width: 16,
          height: 16,
          borderRadius: 4,
          border: "1px solid rgba(245,239,224,0.4)",
          background: "rgba(10,9,6,0.5)",
          color: "#f5efe0",
          fontSize: 9,
          lineHeight: "14px",
          fontFamily: '"Courier New", ui-monospace, monospace',
          cursor: "pointer",
          pointerEvents: "auto",
          padding: 0,
        }}
      >
        {mapSize === "sm" ? "S" : mapSize === "md" ? "M" : "L"}
      </button>
    </div>
  );
}
