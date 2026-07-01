export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (negative = left)
  handbrake: boolean;
}

export class InputController {
  private keys = new Set<string>();
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchSteer = 0;
  private touchHandbrake = false;

  constructor(private target: EventTarget = window) {
    this.target.addEventListener("keydown", this.onKeyDown as EventListener);
    this.target.addEventListener("keyup", this.onKeyUp as EventListener);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  setTouchAxes(throttle: number, brake: number, steer: number, handbrake = false) {
    this.touchThrottle = throttle;
    this.touchBrake = brake;
    this.touchSteer = steer;
    this.touchHandbrake = handbrake;
  }

  get state(): InputState {
    const up = this.keys.has("KeyW") || this.keys.has("ArrowUp");
    const down = this.keys.has("KeyS") || this.keys.has("ArrowDown");
    const left = this.keys.has("KeyA") || this.keys.has("ArrowLeft");
    const right = this.keys.has("KeyD") || this.keys.has("ArrowRight");
    const hand = this.keys.has("Space");

    let steer = (right ? 1 : 0) - (left ? 1 : 0);
    if (steer === 0) steer = this.touchSteer;

    return {
      throttle: up ? 1 : this.touchThrottle,
      brake: down ? 1 : this.touchBrake,
      steer,
      handbrake: hand || this.touchHandbrake,
    };
  }

  dispose() {
    this.target.removeEventListener("keydown", this.onKeyDown as EventListener);
    this.target.removeEventListener("keyup", this.onKeyUp as EventListener);
  }
}
