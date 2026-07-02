"use client";

import { useEffect, useRef } from "react";
import type { HudState } from "@/game/engine/Engine";

const SIZE = 130;
const PADDING = 12;

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  scale: number;
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
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const scale = (SIZE - PADDING * 2) / span;
  return { minX, maxX, minZ, maxZ, scale };
}

export function MiniMap({ hud, trackPoints }: { hud: HudState; trackPoints: [number, number][] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boundsRef = useRef<Bounds | null>(null);
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

    const toCanvas = (x: number, z: number): [number, number] => {
      const cx = PADDING + (x - bounds.minX) * bounds.scale + ((SIZE - PADDING * 2) - (bounds.maxX - bounds.minX) * bounds.scale) / 2;
      const cy = PADDING + (z - bounds.minZ) * bounds.scale + ((SIZE - PADDING * 2) - (bounds.maxZ - bounds.minZ) * bounds.scale) / 2;
      return [cx, cy];
    };

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.fillStyle = "rgba(20,18,12,0.55)";
    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, 10);
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

  return (
    <canvas
      ref={canvasRef}
      width={SIZE * dpr}
      height={SIZE * dpr}
      style={{
        // Top-right, below the speed readout -- bottom corners are reserved
        // for the touch throttle/brake/steer buttons on mobile.
        position: "absolute",
        right: 12,
        top: 100,
        width: SIZE,
        height: SIZE,
        pointerEvents: "none",
      }}
    />
  );
}
