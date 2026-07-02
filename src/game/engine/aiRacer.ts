import * as THREE from "three";
import type { InputState } from "./input";
import { Car, type CarColors } from "./car";
import type { Track } from "./track";

export interface AIProfile {
  name: string;
  /** 0..1 — how precisely they hold the racing line and anticipate corners. */
  skill: number;
  /** 0..1 — how hard they push speed and how little space they leave in traffic. */
  aggressiveness: number;
  colors: CarColors;
}

const STEER_GAIN = 2.2;
const BASE_LOOKAHEAD = 6;
const SKILL_LOOKAHEAD = 7;
const CURVE_PROBE_AHEAD = 9;
const CORNER_SPEED_SENSITIVITY = 1.35;
// Detection window for traffic: cars within this far ahead and this far to
// either side are treated as something to steer around / slow down for.
const TRAFFIC_FORWARD_RANGE = 9;
const TRAFFIC_SIDE_RANGE = 2.6;
// A car ahead that's essentially stopped (stalled, crashed, or just parked
// after a spin-out) is treated as a fixed obstacle to route around, not
// traffic to match speed with -- otherwise the old logic would cap the
// desired speed down toward the stopped car's ~0 and the AI would just queue
// up behind it forever instead of passing.
const STOPPED_CAR_SPEED = 1.5;
const STOPPED_AVOID_STRENGTH = 5.5;
const MOVING_AVOID_STRENGTH = 3.2;
const MIN_PASSING_SPEED = 6;

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AIRacer {
  readonly car: Car;
  readonly profile: AIProfile;

  private wobblePhase = Math.random() * Math.PI * 2;
  private readonly wobbleFreq = 0.6 + Math.random() * 0.6;
  private readonly lineBias = (Math.random() - 0.5) * 3;

  constructor(
    track: Track,
    profile: AIProfile,
    startPosition: THREE.Vector3,
    startHeading: number,
    carNumber: number,
  ) {
    this.profile = profile;
    this.car = new Car(track, profile.colors, carNumber);
    this.car.position.copy(startPosition);
    this.car.heading = startHeading;
  }

  update(dt: number, track: Track, traffic: Car[]) {
    const input = this.computeInput(dt, track, traffic);
    this.car.update(dt, input, track);
  }

  private computeInput(dt: number, track: Track, traffic: Car[]): InputState {
    const { skill, aggressiveness } = this.profile;
    const car = this.car;

    const idx = track.closestIndex(car.position);
    const n = track.samples.length;
    const sampleSpacing = Math.max(track.samples[0].point.distanceTo(track.samples[1].point), 0.05);

    const lookaheadDist = BASE_LOOKAHEAD + skill * SKILL_LOOKAHEAD;
    const lookaheadSteps = Math.max(1, Math.round(lookaheadDist / sampleSpacing));
    const targetIdx = (idx + lookaheadSteps) % n;
    const targetSample = track.samples[targetIdx];

    this.wobblePhase += dt * this.wobbleFreq;
    const imprecision = (1 - skill) * 1.6;
    const wobble = Math.sin(this.wobblePhase) * imprecision;
    const lineOffset = this.lineBias * (1 - skill * 0.5) + wobble;

    const up = new THREE.Vector3(0, 1, 0);
    const trackSide = new THREE.Vector3().crossVectors(up, targetSample.tangent).normalize();
    const targetPoint = targetSample.point.clone().addScaledVector(trackSide, lineOffset);

    // Traffic avoidance: nudge the aim point away from cars ahead in our lane
    // and cap our desired speed so we don't rear-end them. Aggressiveness
    // shrinks the margins (tailgates closer, squeezes through tighter gaps)
    // but never removes the avoidance outright.
    let avoidLateral = 0;
    let trafficSpeedCap = Infinity;
    const safetyForward = TRAFFIC_FORWARD_RANGE * (1 - aggressiveness * 0.4);
    const safetySide = TRAFFIC_SIDE_RANGE * (1 - aggressiveness * 0.3);

    for (const other of traffic) {
      if (other === car) continue;
      const rel = other.position.clone().sub(car.position);
      const fwdComp = rel.dot(car.forward);
      const sideComp = rel.dot(car.side);
      if (fwdComp <= 0 || fwdComp > safetyForward) continue;
      if (Math.abs(sideComp) > safetySide) continue;

      const closeness = 1 - fwdComp / safetyForward;
      const laneDanger = 1 - Math.abs(sideComp) / safetySide;
      const threat = closeness * laneDanger;

      const otherSpeed = other.speedKmh / 3.6;
      const isStopped = otherSpeed < STOPPED_CAR_SPEED;

      avoidLateral += (sideComp >= 0 ? -1 : 1) * threat * (isStopped ? STOPPED_AVOID_STRENGTH : MOVING_AVOID_STRENGTH);
      trafficSpeedCap = Math.min(
        trafficSpeedCap,
        isStopped ? Math.max(MIN_PASSING_SPEED, fwdComp * 0.8) : otherSpeed + fwdComp * 0.5,
      );
    }

    avoidLateral = THREE.MathUtils.clamp(avoidLateral, -5, 5);
    targetPoint.addScaledVector(car.side, avoidLateral);

    const toTarget = targetPoint.sub(car.position);
    const desiredHeading = Math.atan2(toTarget.x, toTarget.z);
    const headingError = normalizeAngle(desiredHeading - car.heading);
    const steerNoise = (1 - skill) * 0.25 * Math.sin(this.wobblePhase * 1.7);
    const steer = THREE.MathUtils.clamp(-headingError * STEER_GAIN + steerNoise, -1, 1);

    // Curvature ahead sets the cornering speed target; skill lets them carry
    // more speed through a given bend, aggressiveness pushes the ceiling up.
    const probeSteps = Math.max(1, Math.round(CURVE_PROBE_AHEAD / sampleSpacing));
    const aheadIdx = (idx + probeSteps) % n;
    const turnAngle = Math.abs(
      normalizeAngle(Math.atan2(track.samples[aheadIdx].tangent.x, track.samples[aheadIdx].tangent.z) -
        Math.atan2(track.samples[idx].tangent.x, track.samples[idx].tangent.z)),
    );

    const maxSpeed = 16 + skill * 8 + aggressiveness * 5;
    const cornerFactor = Math.max(0.35, 1 - turnAngle * CORNER_SPEED_SENSITIVITY * (1 - skill * 0.5));
    let desiredSpeed = maxSpeed * cornerFactor;
    desiredSpeed = Math.min(desiredSpeed, trafficSpeedCap);

    const currentSpeed = car.speedKmh / 3.6;
    let throttle = 0;
    let brake = 0;
    if (currentSpeed < desiredSpeed - 1) {
      throttle = 1;
    } else if (currentSpeed > desiredSpeed + 1) {
      brake = THREE.MathUtils.clamp((currentSpeed - desiredSpeed) / 6, 0.2, 1);
    } else {
      throttle = 0.4;
    }

    const handbrake = brake > 0.6 && turnAngle > 0.6 && aggressiveness > 0.5;

    return { throttle, brake, steer, handbrake };
  }
}

export interface GridSlot {
  position: THREE.Vector3;
  heading: number;
}

/** Staggered starting grid behind the player's pole position, alternating left/right of the centerline. */
export function buildStartingGrid(track: Track, count: number): GridSlot[] {
  const forward = track.samples[0].tangent.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, forward).normalize();
  const heading = track.startHeading;

  const slots: GridSlot[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2) + 1;
    const lateral = col * 2.4;
    const behind = row * 4.2 + 3.5;
    const position = track.startPosition
      .clone()
      .addScaledVector(side, lateral)
      .addScaledVector(forward, -behind);
    slots.push({ position, heading });
  }
  return slots;
}

const PALETTE: CarColors[] = [
  { body: 0xc9312b, stripe: 0xf2e9d8 },
  { body: 0x2f9e44, stripe: 0xf2f2f2 },
  { body: 0xe8b923, stripe: 0x2b2b2e },
  { body: 0xe8722c, stripe: 0xf2f2f2 },
  { body: 0x8b3fd1, stripe: 0xf2e9d8 },
  { body: 0xd8d8d8, stripe: 0xc9312b },
];

export const AI_PROFILES: AIProfile[] = [
  { name: "Rookie", skill: 0.28, aggressiveness: 0.2, colors: PALETTE[0] },
  { name: "Steady", skill: 0.58, aggressiveness: 0.4, colors: PALETTE[1] },
  { name: "Ace", skill: 0.9, aggressiveness: 0.55, colors: PALETTE[2] },
  { name: "Hothead", skill: 0.5, aggressiveness: 0.92, colors: PALETTE[3] },
  { name: "Veteran", skill: 0.8, aggressiveness: 0.3, colors: PALETTE[4] },
  { name: "Wildcard", skill: 0.42, aggressiveness: 0.7, colors: PALETTE[5] },
];
