"use client";

import { useEffect, useRef, useState } from "react";
import { Engine, type HudState } from "@/game/engine/Engine";
import { Hud } from "@/game/Hud";
import { TouchControls } from "@/game/TouchControls";
import { MiniMap } from "@/game/MiniMap";

const INITIAL_HUD: HudState = {
  currentTime: 0,
  lastLap: null,
  bestLap: null,
  speedKmh: 0,
  offroad: false,
  carX: 0,
  carZ: 0,
  carHeading: 0,
  racers: [],
};

export default function Game() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL_HUD);
  const [isTouch, setIsTouch] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);
  const [trackPoints, setTrackPoints] = useState<[number, number][]>([]);

  useEffect(() => {
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);

    const checkOrientation = () => setIsPortrait(window.innerHeight > window.innerWidth);
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const engine = new Engine(canvasRef.current, containerRef.current);
    engineRef.current = engine;
    setTrackPoints(engine.getTrackOutline());
    const unsubscribe = engine.onHudUpdate(setHud);
    return () => {
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: "fixed", inset: 0, background: "#1a1710" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
      <Hud hud={hud} />
      {trackPoints.length > 0 && <MiniMap hud={hud} trackPoints={trackPoints} />}
      {isTouch && (
        <TouchControls
          onChange={(throttle, brake, steer, handbrake) =>
            engineRef.current?.setTouchInput(throttle, brake, steer, handbrake)
          }
        />
      )}
      {!isTouch && (
        <div style={hintStyle}>W/↑ accelerate · S/↓ brake · A/D steer · Space handbrake</div>
      )}
      {isPortrait && (
        <div style={rotateOverlayStyle}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⤾</div>
          Rotate your device to landscape to play
        </div>
      )}
      <div style={versionStyle}>v{process.env.NEXT_PUBLIC_APP_VERSION}</div>
    </div>
  );
}

const hintStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 14,
  textAlign: "center",
  color: "#f5efe0",
  opacity: 0.65,
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontSize: 13,
  pointerEvents: "none",
  textShadow: "0 2px 6px rgba(0,0,0,0.55)",
};

const versionStyle: React.CSSProperties = {
  position: "absolute",
  left: 6,
  bottom: 4,
  color: "#f5efe0",
  opacity: 0.4,
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontSize: 10,
  pointerEvents: "none",
  textShadow: "0 1px 4px rgba(0,0,0,0.55)",
};

const rotateOverlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,9,6,0.92)",
  color: "#f5efe0",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: '"Courier New", ui-monospace, monospace',
  fontSize: 18,
  textAlign: "center",
  padding: 24,
  zIndex: 10,
};
