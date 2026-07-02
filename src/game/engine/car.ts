import * as THREE from "three";
import type { InputState } from "./input";
import type { Track } from "./track";
import { ROAD_WIDTH } from "./track";

const ENGINE_ACCEL = 15;
const REVERSE_ACCEL = 8;
const BRAKE_DECEL = 26;
const DRAG = 0.65;
const MAX_SPEED = 27;
const MAX_REVERSE_SPEED = 10;
const MAX_TURN_RATE = 2.9;
const GRIP_NORMAL = 7.5;
const GRIP_DRIFT = 1.4;
const GRIP_OFFROAD = 2.6;
const WHEEL_RADIUS = 0.28;
const MAX_VISUAL_STEER = 0.5;

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

  return { root, suspension, wheels };
}

export class Car {
  readonly root: THREE.Group;
  private readonly suspension: THREE.Group;
  private readonly wheels: THREE.Group[];

  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  heading = 0;
  private visualSteer = 0;
  private prevForwardSpeed = 0;

  speedKmh = 0;
  isOffroad = false;

  constructor(track: Track) {
    const { root, suspension, wheels } = buildCarMesh();
    this.root = root;
    this.suspension = suspension;
    this.wheels = wheels;

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

  update(dt: number, input: InputState, track: Track) {
    const forward = this.forwardVector();
    const side = new THREE.Vector3(forward.z, 0, -forward.x);

    let forwardSpeed = this.velocity.dot(forward);
    let lateralSpeed = this.velocity.dot(side);

    this.isOffroad = track.distanceToCenterline(this.position) > ROAD_WIDTH / 2;
    const speedScale = this.isOffroad ? 0.55 : 1;

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

    const dragFactor = Math.max(0, 1 - DRAG * dt * (this.isOffroad ? 1.6 : 1));
    forwardSpeed *= dragFactor;

    const maxFwd = MAX_SPEED * speedScale;
    forwardSpeed = THREE.MathUtils.clamp(forwardSpeed, -MAX_REVERSE_SPEED, maxFwd);

    const speedForTurn = THREE.MathUtils.clamp(Math.abs(forwardSpeed) / 6, 0.22, 1);
    const reverseSign = forwardSpeed < 0 ? -1 : 1;
    const turnRate = input.steer * MAX_TURN_RATE * speedForTurn * reverseSign;
    this.heading += turnRate * dt;

    const grip = input.handbrake ? GRIP_DRIFT : this.isOffroad ? GRIP_OFFROAD : GRIP_NORMAL;
    lateralSpeed *= Math.max(0, 1 - grip * dt);

    const newForward = this.forwardVector();
    const newSide = new THREE.Vector3(newForward.z, 0, -newForward.x);
    this.velocity
      .copy(newForward)
      .multiplyScalar(forwardSpeed)
      .addScaledVector(newSide, lateralSpeed);

    this.position.addScaledVector(this.velocity, dt);

    const forwardAccel = (forwardSpeed - this.prevForwardSpeed) / Math.max(dt, 1e-4);
    this.prevForwardSpeed = forwardSpeed;
    this.speedKmh = Math.abs(forwardSpeed) * 3.6;

    this.visualSteer = THREE.MathUtils.lerp(this.visualSteer, input.steer * MAX_VISUAL_STEER, 1 - Math.pow(0.001, dt));

    const targetRoll = THREE.MathUtils.clamp(-lateralSpeed * 0.045, -0.16, 0.16);
    const targetPitch = THREE.MathUtils.clamp(-forwardAccel * 0.012, -0.1, 0.1);
    this.suspension.rotation.z = THREE.MathUtils.lerp(this.suspension.rotation.z, targetRoll, 1 - Math.pow(0.0005, dt));
    this.suspension.rotation.x = THREE.MathUtils.lerp(this.suspension.rotation.x, targetPitch, 1 - Math.pow(0.0005, dt));
    const bob = Math.max(0, Math.abs(lateralSpeed) * 0.004);
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

  private syncTransform() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.heading;
  }
}
