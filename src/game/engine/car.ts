import * as THREE from "three";
import type { InputState } from "./input";
import type { Track } from "./track";
import { CURB_WIDTH, ROAD_WIDTH, SAND_SHOULDER_WIDTH } from "./track";
import type { Collider } from "./environment";

const ENGINE_ACCEL = 15;
const REVERSE_ACCEL = 8;
const BRAKE_DECEL = 26;
// Rolling resistance while coasting (no throttle/brake). Kept low so the car
// glides on momentum instead of snapping to a stop the instant you lift off.
const DRAG = 0.22;
const MAX_SPEED = 27;
const MAX_REVERSE_SPEED = 10;
const MAX_TURN_RATE = 2.9;
// How quickly tires "catch" the heading change (lateral slip damping).
const GRIP_ROAD = 5.5;
const GRIP_CURB = 4.0;
const GRIP_SHOULDER = 3.0;
const GRIP_DESERT = 2.0;
const GRIP_DRIFT = 1.3;
const WHEEL_RADIUS = 0.28;
const MAX_VISUAL_STEER = 0.5;
// A car can't meaningfully change heading with the wheels not rolling — this
// ramps turn authority up with speed instead of allowing a stationary spin.
const TURN_SPEED_RAMP = 4.5;
export const CAR_COLLISION_RADIUS = 0.85;
const COLLISION_RESTITUTION = 1.4;

// Damage model: an impact below DENT_MIN_IMPACT (relative closing speed,
// m/s) is treated as a shrug-off bump. Above it, cumulative damage (0..1)
// climbs, body panels near the hit dent inward, and crossing further
// thresholds detaches parts / catches the car on fire. Nothing repairs --
// this is arcade wear, not a pit stop.
const DENT_MIN_IMPACT = 4;
const DAMAGE_PER_IMPACT_SCALE = 28;
const MAX_DAMAGE_PER_IMPACT = 0.3;
const DENT_DEPTH_SCALE = 0.18;
const MAX_DENT = 0.14;
const BODY_MIN_HALF_EXTENT = 0.15;
const FRONT_BUMPER_DETACH_DAMAGE = 0.35;
const REAR_BUMPER_DETACH_DAMAGE = 0.5;
const ROOF_DETACH_DAMAGE = 0.65;
const TIRE_DETACH_DAMAGE = 0.8;
const FIRE_DAMAGE = 0.75;
const TIRE_GRIP_PENALTY = 0.18;
const TIRE_SPEED_PENALTY = 0.12;

export interface DetachEvent {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
}

export interface CarColors {
  body: number;
  stripe: number;
}

export const DEFAULT_CAR_COLORS: CarColors = { body: 0x2255cc, stripe: 0xf2f2f2 };

function makeNumberPlateTexture(num: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#f5f2e8";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 56px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(num % 100).padStart(2, "0"), size / 2, size / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface SurfaceProfile {
  speedScale: number;
  grip: number;
  offroad: boolean;
}

function surfaceProfile(distanceFromCenterline: number): SurfaceProfile {
  const roadHalf = ROAD_WIDTH / 2;
  const curbHalf = roadHalf + CURB_WIDTH;
  const shoulderHalf = curbHalf + SAND_SHOULDER_WIDTH;

  if (distanceFromCenterline <= roadHalf) {
    return { speedScale: 1, grip: GRIP_ROAD, offroad: false };
  }
  if (distanceFromCenterline <= curbHalf) {
    // Rumble strip: still grippy, but the bumps knock some speed and bite off.
    return { speedScale: 0.88, grip: GRIP_CURB, offroad: true };
  }
  if (distanceFromCenterline <= shoulderHalf) {
    // Soft sand shoulder: forgiving to run wide onto, but noticeably slower.
    return { speedScale: 0.72, grip: GRIP_SHOULDER, offroad: true };
  }
  return { speedScale: 0.5, grip: GRIP_DESERT, offroad: true };
}

function buildWheel(): THREE.Group {
  const pivot = new THREE.Group();
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.5, metalness: 0.3 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.22, 10), tireMat);
  tire.rotation.z = Math.PI / 2;
  tire.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8), hubMat);
  hub.rotation.z = Math.PI / 2;
  const spin = new THREE.Group();
  spin.add(tire, hub);
  pivot.add(spin);
  pivot.userData.spin = spin;
  return pivot;
}

function buildCarMesh(colors: CarColors, carNumber: number) {
  const root = new THREE.Group();

  const suspension = new THREE.Group();
  suspension.position.y = WHEEL_RADIUS;
  root.add(suspension);

  const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.45, metalness: 0.15 });
  const bumperMat = new THREE.MeshStandardMaterial({ color: colors.stripe, roughness: 0.5 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.4 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2733, roughness: 0.2, metalness: 0.6 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.42, 1.9), bodyMat);
  body.position.y = 0.24;
  body.castShadow = true;
  suspension.add(body);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.07, 0.1, 1.92), bumperMat);
  stripe.position.y = 0.1;
  suspension.add(stripe);

  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.24), bumperMat);
  frontBumper.position.set(0, 0.16, 0.95);
  suspension.add(frontBumper);

  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.2), bumperMat);
  rearBumper.position.set(0, 0.16, -0.93);
  suspension.add(rearBumper);

  const exhaustPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.4, metalness: 0.7 }),
  );
  exhaustPipe.rotation.x = Math.PI / 2;
  exhaustPipe.position.set(-0.3, 0.08, -1.0);
  suspension.add(exhaustPipe);

  const exhaustAnchor = new THREE.Object3D();
  exhaustAnchor.position.set(-0.3, 0.1, -1.08);
  suspension.add(exhaustAnchor);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.36, 1.0), cabinMat);
  cabin.position.set(0, 0.62, -0.05);
  cabin.castShadow = true;
  suspension.add(cabin);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.3, 0.86), glassMat);
  windshield.position.set(0, 0.6, -0.06);
  windshield.scale.set(0.98, 0.98, 0.98);
  suspension.add(windshield);

  const roofRack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), bumperMat);
  roofRack.position.set(0, 0.82, -0.1);
  suspension.add(roofRack);

  const plateGeo = new THREE.PlaneGeometry(0.48, 0.48);
  plateGeo.rotateX(-Math.PI / 2);
  const plateMat = new THREE.MeshBasicMaterial({ map: makeNumberPlateTexture(carNumber), transparent: true });
  const numberPlate = new THREE.Mesh(plateGeo, plateMat);
  numberPlate.position.set(0, 0.855, 0.05);
  suspension.add(numberPlate);

  for (const side of [1, -1]) {
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.12, 0.05),
      new THREE.MeshStandardMaterial({ color: 0xfff6cf, emissive: 0x554400, roughness: 0.3 }),
    );
    headlight.position.set(side * 0.36, 0.26, 1.07);
    suspension.add(headlight);

    const taillight = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.1, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0x330000, roughness: 0.3 }),
    );
    taillight.position.set(side * 0.34, 0.26, -1.05);
    suspension.add(taillight);
  }

  const wheelOffsets: [number, number, boolean][] = [
    [0.52, 0.68, true],
    [-0.52, 0.68, true],
    [0.55, -0.68, false],
    [-0.55, -0.68, false],
  ];
  const wheels = wheelOffsets.map(([x, z, steerable]) => {
    const wheel = buildWheel();
    wheel.position.set(x, WHEEL_RADIUS, z);
    wheel.userData.steerable = steerable;
    root.add(wheel);
    return wheel;
  });

  const shadowGeo = new THREE.CircleGeometry(1.3, 16);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.01;
  root.add(shadow);

  return {
    root,
    suspension,
    wheels,
    exhaustAnchor,
    bodyGeometry: body.geometry as THREE.BoxGeometry,
    frontBumper,
    rearBumper,
    roofRack,
  };
}

export class Car {
  readonly root: THREE.Group;
  private readonly suspension: THREE.Group;
  private readonly wheels: THREE.Group[];
  private readonly exhaustAnchor: THREE.Object3D;
  private readonly bodyGeometry: THREE.BoxGeometry;
  private frontBumper: THREE.Object3D | null;
  private rearBumper: THREE.Object3D | null;
  private roofRack: THREE.Object3D | null;

  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  heading = 0;
  /** World-space forward/side basis from the current heading, refreshed every update(). */
  forward = new THREE.Vector3(0, 0, 1);
  side = new THREE.Vector3(1, 0, 0);
  private visualSteer = 0;
  private prevForwardSpeed = 0;
  private impactPulse = 0;

  speedKmh = 0;
  isOffroad = false;
  isSkidding = false;
  /** Forward acceleration (m/s^2, signed), exposed for camera-feel hooks like braking zoom-in. */
  forwardAccel = 0;
  /** Body color, exposed so overlays (e.g. the minimap) can tint a car's blip to match. */
  readonly color: number;

  /** Cumulative crash damage, 0 (pristine) .. 1 (wrecked). Never repairs. */
  damage = 0;
  isOnFire = false;
  tireLost: [boolean, boolean, boolean, boolean] = [false, false, false, false];
  private readonly detachedParts = new Set<string>();
  private pendingDetachments: DetachEvent[] = [];

  constructor(track: Track, colors: CarColors = DEFAULT_CAR_COLORS, carNumber = 1) {
    this.color = colors.body;
    const { root, suspension, wheels, exhaustAnchor, bodyGeometry, frontBumper, rearBumper, roofRack } = buildCarMesh(
      colors,
      carNumber,
    );
    this.root = root;
    this.suspension = suspension;
    this.wheels = wheels;
    this.exhaustAnchor = exhaustAnchor;
    this.bodyGeometry = bodyGeometry;
    this.frontBumper = frontBumper;
    this.rearBumper = rearBumper;
    this.roofRack = roofRack;

    this.position.copy(track.startPosition);
    this.heading = track.startHeading;
    this.syncTransform();
  }

  reset(track: Track) {
    this.position.copy(track.startPosition);
    this.heading = track.startHeading;
    this.velocity.set(0, 0, 0);
    this.syncTransform();
  }

  private forwardVector(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** World-space ground contact point for wheel index (0/1 front, 2/3 rear). */
  getWheelContact(index: number, target = new THREE.Vector3()): THREE.Vector3 {
    this.wheels[index].getWorldPosition(target);
    target.y = 0.025;
    return target;
  }

  /** World-space tailpipe tip, for exhaust particle spawning. */
  getExhaustPosition(target = new THREE.Vector3()): THREE.Vector3 {
    this.exhaustAnchor.getWorldPosition(target);
    return target;
  }

  update(dt: number, input: InputState, track: Track) {
    this.impactPulse *= Math.pow(0.0006, dt);

    const forward = this.forwardVector();
    const side = new THREE.Vector3(forward.z, 0, -forward.x);

    let forwardSpeed = this.velocity.dot(forward);
    let lateralSpeed = this.velocity.dot(side);

    const surface = surfaceProfile(track.distanceToCenterline(this.position));
    this.isOffroad = surface.offroad;
    const speedScale = surface.speedScale;

    let accel = 0;
    if (input.throttle > 0) {
      accel += input.throttle * ENGINE_ACCEL * speedScale;
    }
    if (input.brake > 0) {
      if (forwardSpeed > 0.4) {
        accel -= input.brake * BRAKE_DECEL;
      } else {
        accel -= input.brake * REVERSE_ACCEL * speedScale;
      }
    }
    forwardSpeed += accel * dt;

    // Rolling resistance only — much gentler than braking, so lifting off
    // the throttle coasts instead of feeling like the brake is being held.
    const dragFactor = Math.max(0, 1 - DRAG * dt * (this.isOffroad ? 1.5 : 1));
    forwardSpeed *= dragFactor;

    const tireLossCount = this.tireLost.filter(Boolean).length;
    const maxFwd = MAX_SPEED * speedScale * (1 - tireLossCount * TIRE_SPEED_PENALTY);
    forwardSpeed = THREE.MathUtils.clamp(forwardSpeed, -MAX_REVERSE_SPEED, maxFwd);

    // Turn authority ramps up with actual rolling speed and is ~0 at a
    // standstill — steering alone can no longer spin the car in place.
    // Negated: with forward = (sin(heading), 0, cos(heading)), increasing
    // heading rotates the car counter-clockwise in bird's-eye view, which is
    // a left turn -- so a positive (rightward) steer input must *decrease*
    // heading to actually turn the car right.
    const speedForTurn = 1 - Math.exp(-Math.abs(forwardSpeed) / TURN_SPEED_RAMP);
    const reverseSign = forwardSpeed < 0 ? -1 : 1;
    const turnRate = -input.steer * MAX_TURN_RATE * speedForTurn * reverseSign;
    this.heading += turnRate * dt;

    const grip = (input.handbrake ? GRIP_DRIFT : surface.grip) * (1 - tireLossCount * TIRE_GRIP_PENALTY);
    const slipMagnitude = Math.abs(lateralSpeed);
    lateralSpeed *= Math.max(0, 1 - grip * dt);

    this.isSkidding =
      (input.handbrake && Math.abs(forwardSpeed) > 7) ||
      slipMagnitude > 3.2 ||
      (input.brake > 0.6 && forwardSpeed > 9);

    const newForward = this.forwardVector();
    const newSide = new THREE.Vector3(newForward.z, 0, -newForward.x);
    this.forward = newForward;
    this.side = newSide;
    this.velocity
      .copy(newForward)
      .multiplyScalar(forwardSpeed)
      .addScaledVector(newSide, lateralSpeed);

    this.position.addScaledVector(this.velocity, dt);

    const forwardAccel = (forwardSpeed - this.prevForwardSpeed) / Math.max(dt, 1e-4);
    this.prevForwardSpeed = forwardSpeed;
    this.speedKmh = Math.abs(forwardSpeed) * 3.6;
    this.forwardAccel = forwardAccel;

    this.visualSteer = THREE.MathUtils.lerp(this.visualSteer, -input.steer * MAX_VISUAL_STEER, 1 - Math.pow(0.001, dt));

    const targetRoll = THREE.MathUtils.clamp(-lateralSpeed * 0.055, -0.22, 0.22);
    const targetPitch = THREE.MathUtils.clamp(-forwardAccel * 0.014, -0.14, 0.14);
    this.suspension.rotation.z = THREE.MathUtils.lerp(this.suspension.rotation.z, targetRoll, 1 - Math.pow(0.0015, dt));
    this.suspension.rotation.x = THREE.MathUtils.lerp(this.suspension.rotation.x, targetPitch, 1 - Math.pow(0.0015, dt));
    const bob = Math.max(0, Math.abs(lateralSpeed) * 0.004) + this.impactPulse * 0.12;
    this.suspension.position.y = WHEEL_RADIUS - bob;

    for (const wheel of this.wheels) {
      if (!wheel.parent) continue;
      if (wheel.userData.steerable) {
        wheel.rotation.y = this.visualSteer;
      }
      const spin = wheel.userData.spin as THREE.Group;
      spin.rotation.x -= (forwardSpeed / WHEEL_RADIUS) * dt;
    }

    this.syncTransform();
  }

  /** Circle-vs-circle collision against static scenery (trees/rocks/cacti). */
  resolveCollisions(colliders: Collider[]) {
    let hit = false;
    for (const c of colliders) {
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const minDist = CAR_COLLISION_RADIUS + c.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;

      const dist = Math.sqrt(Math.max(distSq, 1e-6));
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = minDist - dist;
      this.position.x += nx * overlap;
      this.position.z += nz * overlap;

      const vDotN = this.velocity.x * nx + this.velocity.z * nz;
      if (vDotN < 0) {
        this.velocity.x -= vDotN * nx * COLLISION_RESTITUTION;
        this.velocity.z -= vDotN * nz * COLLISION_RESTITUTION;
        this.impactPulse = Math.min(1, this.impactPulse + Math.abs(vDotN) / 14);
        this.applyDamage(Math.abs(vDotN), new THREE.Vector3(-nx, 0, -nz));
        hit = true;
      }
    }
    if (hit) this.syncTransform();
    return hit;
  }

  /**
   * Mutual circle-vs-circle collision against another car. Unlike
   * resolveCollisions (a static obstacle pushes only the car), both cars
   * here are dynamic: the overlap is split 50/50 and both velocities get an
   * impulse along the collision normal, so a bump reads as two cars
   * glancing off each other rather than one car hitting a wall. Call once
   * per pair per frame (order doesn't matter, the response is symmetric).
   */
  resolveCarCollision(other: Car): boolean {
    const dx = this.position.x - other.position.x;
    const dz = this.position.z - other.position.z;
    const minDist = CAR_COLLISION_RADIUS * 2;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist) return false;

    const dist = Math.sqrt(Math.max(distSq, 1e-6));
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = (minDist - dist) / 2;
    this.position.x += nx * overlap;
    this.position.z += nz * overlap;
    other.position.x -= nx * overlap;
    other.position.z -= nz * overlap;

    const relVx = this.velocity.x - other.velocity.x;
    const relVz = this.velocity.z - other.velocity.z;
    const vDotN = relVx * nx + relVz * nz;
    if (vDotN < 0) {
      const impulse = vDotN * COLLISION_RESTITUTION * 0.5;
      this.velocity.x -= impulse * nx;
      this.velocity.z -= impulse * nz;
      other.velocity.x += impulse * nx;
      other.velocity.z += impulse * nz;
      this.impactPulse = Math.min(1, this.impactPulse + Math.abs(vDotN) / 14);
      other.impactPulse = Math.min(1, other.impactPulse + Math.abs(vDotN) / 14);
      this.applyDamage(Math.abs(vDotN), new THREE.Vector3(-nx, 0, -nz));
      other.applyDamage(Math.abs(vDotN), new THREE.Vector3(nx, 0, nz));
    }

    this.syncTransform();
    other.syncTransform();
    return true;
  }

  /** Drains and returns any parts that detached this frame, for the caller to hand off to a debris system. */
  drainDetachments(): DetachEvent[] {
    if (this.pendingDetachments.length === 0) return [];
    const events = this.pendingDetachments;
    this.pendingDetachments = [];
    return events;
  }

  /**
   * Registers a crash impact: accumulates damage, crumples the body mesh
   * near the hit side, and past thresholds detaches bumpers/roof/a wheel or
   * sets the car on fire. worldImpactDir points from the car's center
   * toward the side that got hit (world space, Y ignored).
   */
  private applyDamage(impactSpeed: number, worldImpactDir: THREE.Vector3) {
    if (impactSpeed < DENT_MIN_IMPACT || this.damage >= 1) return;

    const delta = Math.min(MAX_DAMAGE_PER_IMPACT, impactSpeed / DAMAGE_PER_IMPACT_SCALE);
    this.damage = Math.min(1, this.damage + delta);

    const cosT = Math.cos(this.heading);
    const sinT = Math.sin(this.heading);
    // World -> local (inverse of the root's heading rotation).
    const localNormal = new THREE.Vector3(
      worldImpactDir.x * cosT - worldImpactDir.z * sinT,
      0,
      worldImpactDir.x * sinT + worldImpactDir.z * cosT,
    );

    this.dentAxis(localNormal, delta);

    const isFrontHit = localNormal.z > 0.3;
    const isRearHit = localNormal.z < -0.3;

    if (this.frontBumper && isFrontHit && this.damage > FRONT_BUMPER_DETACH_DAMAGE && !this.detachedParts.has("front")) {
      this.detachPart(this.frontBumper, "front", localNormal);
      this.frontBumper = null;
    }
    if (this.rearBumper && isRearHit && this.damage > REAR_BUMPER_DETACH_DAMAGE && !this.detachedParts.has("rear")) {
      this.detachPart(this.rearBumper, "rear", localNormal);
      this.rearBumper = null;
    }
    if (this.roofRack && this.damage > ROOF_DETACH_DAMAGE && !this.detachedParts.has("roof")) {
      this.detachPart(this.roofRack, "roof", localNormal);
      this.roofRack = null;
    }
    if (this.damage > TIRE_DETACH_DAMAGE && !this.detachedParts.has("tire")) {
      const idx = isFrontHit || isRearHit ? (isFrontHit ? (localNormal.x >= 0 ? 0 : 1) : localNormal.x >= 0 ? 2 : 3) : 2;
      this.detachWheel(idx, localNormal);
      this.detachedParts.add("tire");
    }
    if (this.damage > FIRE_DAMAGE) this.isOnFire = true;
  }

  /** Crumples the body box's vertices on the hit face inward, so repeated crashes visibly mangle the car. */
  private dentAxis(localNormal: THREE.Vector3, strength: number) {
    const pos = this.bodyGeometry.attributes.position as THREE.BufferAttribute;
    const useX = Math.abs(localNormal.x) > Math.abs(localNormal.z);
    const dir = useX ? Math.sign(localNormal.x || 1) : Math.sign(localNormal.z || 1);
    const push = -dir * Math.min(MAX_DENT, strength * DENT_DEPTH_SCALE);

    for (let i = 0; i < pos.count; i++) {
      const v = useX ? pos.getX(i) : pos.getZ(i);
      if (Math.sign(v || 1) !== dir) continue;
      const next = v + push;
      const clamped = dir > 0 ? Math.max(next, BODY_MIN_HALF_EXTENT) : Math.min(next, -BODY_MIN_HALF_EXTENT);
      if (useX) pos.setX(i, clamped);
      else pos.setZ(i, clamped);
    }
    pos.needsUpdate = true;
    this.bodyGeometry.computeVertexNormals();
  }

  /** Detaches a body part (bumper/roof rack) into world space with an outward+upward velocity, queued for debris. */
  private detachPart(mesh: THREE.Object3D, tag: string, localNormal: THREE.Vector3) {
    this.detachedParts.add(tag);

    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    const worldQuat = new THREE.Quaternion();
    mesh.getWorldQuaternion(worldQuat);
    mesh.parent?.remove(mesh);
    mesh.position.copy(worldPos);
    mesh.quaternion.copy(worldQuat);

    const cosT = Math.cos(this.heading);
    const sinT = Math.sin(this.heading);
    // Local -> world.
    const worldDirX = localNormal.x * cosT + localNormal.z * sinT;
    const worldDirZ = -localNormal.x * sinT + localNormal.z * cosT;

    const velocity = this.velocity.clone();
    velocity.x += worldDirX * (2.5 + Math.random() * 2.5);
    velocity.z += worldDirZ * (2.5 + Math.random() * 2.5);
    velocity.y = 2.5 + Math.random() * 2;

    const angularVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 10,
    );
    this.pendingDetachments.push({ mesh, velocity, angularVelocity });
  }

  private detachWheel(index: number, localNormal: THREE.Vector3) {
    const wheel = this.wheels[index];
    if (!wheel.parent) return;
    this.tireLost[index] = true;

    const worldPos = new THREE.Vector3();
    wheel.getWorldPosition(worldPos);
    const worldQuat = new THREE.Quaternion();
    wheel.getWorldQuaternion(worldQuat);
    wheel.parent?.remove(wheel);
    wheel.position.copy(worldPos);
    wheel.quaternion.copy(worldQuat);

    const cosT = Math.cos(this.heading);
    const sinT = Math.sin(this.heading);
    const worldDirX = localNormal.x * cosT + localNormal.z * sinT;
    const worldDirZ = -localNormal.x * sinT + localNormal.z * cosT;

    const velocity = this.velocity.clone();
    velocity.x += worldDirX * (2 + Math.random() * 2) + (Math.random() - 0.5) * 3;
    velocity.z += worldDirZ * (2 + Math.random() * 2) + (Math.random() - 0.5) * 3;
    velocity.y = 3 + Math.random() * 2;

    const angularVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
      (Math.random() - 0.5) * 14,
    );
    this.pendingDetachments.push({ mesh: wheel, velocity, angularVelocity });
  }

  private syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
    this.root.updateMatrixWorld(true);
  }
}
