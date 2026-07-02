"use client";

import { useRef } from "react";

interface Props {
  onChange: (throttle: number, brake: number, steer: number, handbrake: boolean) => void;
}

export function TouchControls({ onChange }: Props) {
  const state = useRef({ throttle: 0, brake: 0, steer: 0, handbrake: false });

  const emit = () => {
    const s = state.current;
    onChange(s.throttle, s.brake, s.steer, s.handbrake);
  };

  const bind = (setter: (down: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      setter(true);
      emit();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      setter(false);
      emit();
    },
    onPointerCancel: () => {
      setter(false);
      emit();
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.buttons === 0) {
        setter(false);
        emit();
      }
    },
  });

  return (
    <div style={styles.root}>
      <div style={styles.steerGroup}>
        <button
          style={styles.button}
          aria-label="Steer left"
          {...bind((down) => (state.current.steer = down ? -1 : state.current.steer < 0 ? 0 : state.current.steer))}
        >
          ◀
        </button>
        <button
          style={styles.button}
          aria-label="Steer right"
          {...bind((down) => (state.current.steer = down ? 1 : state.current.steer > 0 ? 0 : state.current.steer))}
        >
          ▶
        </button>
      </div>
      <div style={styles.pedalGroup}>
        <button
          style={{ ...styles.button, ...styles.handbrake }}
          aria-label="Handbrake"
          {...bind((down) => (state.current.handbrake = down))}
        >
          ⤿
        </button>
        <button
          style={{ ...styles.button, ...styles.brake }}
          aria-label="Brake"
          {...bind((down) => (state.current.brake = down ? 1 : 0))}
        >
          ▼
        </button>
        <button
          style={{ ...styles.button, ...styles.throttle }}
          aria-label="Throttle"
          {...bind((down) => (state.current.throttle = down ? 1 : 0))}
        >
          ▲
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: "absolute",
    inset: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    padding: "0 18px 22px",
    pointerEvents: "none",
  },
  steerGroup: {
    display: "flex",
    gap: 14,
    pointerEvents: "auto",
  },
  pedalGroup: {
    display: "flex",
    gap: 14,
    alignItems: "flex-end",
    pointerEvents: "auto",
  },
  button: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    border: "2px solid rgba(245,239,224,0.5)",
    background: "rgba(20,18,12,0.45)",
    color: "#f5efe0",
    fontSize: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    touchAction: "none",
    WebkitTapHighlightColor: "transparent",
  },
  brake: {
    borderColor: "rgba(255,120,120,0.6)",
  },
  throttle: {
    width: 74,
    height: 74,
    borderColor: "rgba(140,220,150,0.7)",
  },
  handbrake: {
    width: 52,
    height: 52,
    fontSize: 18,
    borderColor: "rgba(255,207,107,0.7)",
  },
};
