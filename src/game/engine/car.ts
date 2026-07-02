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
const CAR_COLLISION_RADIUS = 0.85;
const COLLISION_RESTITUTION = 1.4;

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

function buildCarMesh() {
  const root = new THREE.Group();

  const suspension = new THREE.Group();
  suspension.position.y = WHEEL_RADIUS;
  root.add(suspension);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.45, metalness: 0.15 });
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
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

  return { root, suspension, wheels, exhaustAnchor };
}

export class Car {
  readonly root: THREE.Group;
  private readonly suspension: THREE.Group;
  private readonly wheels: THREE.Group[];
  private readonly exhaustAnchor: THREE.Object3D;

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

  constructor(track: Track) {
    const { root, suspension, wheels, exhaustAnchor } = buildCarMesh();
    this.root = root;
    this.suspension = suspension;
    this.wheels = wheels;
    this.exhaustAnchor = exhaustAnchor;

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

    const maxFwd = MAX_SPEED * speedScale;
    forwardSpeed = THREE.MathUtils.clamp(forwardSpeed, -MAX_REVERSE_SPEED, maxFwd);

    // Turn authority ramps up with actual rolling speed and is ~0 at a
    // standstill — steering alone can no longer spin the car in place.
    const speedForTurn = 1 - Math.exp(-Math.abs(forwardSpeed) / TURN_SPEED_RAMP);
    const reverseSign = forwardSpeed < 0 ? -1 : 1;
    const turnRate = input.steer * MAX_TURN_RATE * speedForTurn * reverseSign;
    this.heading += turnRate * dt;

    const grip = input.handbrake ? GRIP_DRIFT : surface.grip;
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

    this.visualSteer = THREE.MathUtils.lerp(this.visualSteer, input.steer * MAX_VISUAL_STEER, 1 - Math.pow(0.001, dt));

    const targetRoll = THREE.MathUtils.clamp(-lateralSpeed * 0.055, -0.22, 0.22);
    const targetPitch = THREE.MathUtils.clamp(-forwardAccel * 0.014, -0.14, 0.14);
    this.suspension.rotation.z = THREE.MathUtils.lerp(this.suspension.rotation.z, targetRoll, 1 - Math.pow(0.0015, dt));
    this.suspension.rotation.x = THREE.MathUtils.lerp(this.suspension.rotation.x, targetPitch, 1 - Math.pow(0.0015, dt));
    const bob = Math.max(0, Math.abs(lateralSpeed) * 0.004) + this.impactPulse * 0.12;
    this.suspension.position.y = WHEEL_RADIUS - bob;

    for (const wheel of this.wheels) {
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
        hit = true;
      }
    }
    if (hit) this.syncTransform();
    return hit;
  }

  private syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
    this.root.updateMatrixWorld(true);
  }
}
