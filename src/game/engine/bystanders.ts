import * as THREE from "three";
import { CAR_COLLISION_RADIUS, type Car } from "./car";
import { CURB_WIDTH, ROAD_WIDTH, SAND_SHOULDER_WIDTH, type Track } from "./track";
import { stepRigidBody, type RigidBodyState } from "./debris";

const DANGER_RADIUS = 5.5;
const APPROACH_THRESHOLD = 2;
const DODGE_SPEED = 3.4;
const HIT_RADIUS = 0.42;
const RAGDOLL_DURATION = 3.2;
const UP = new THREE.Vector3(0, 1, 0);

const SHIRT_COLORS = [0xd8432b, 0x2b6fd8, 0xe8b923, 0x3f9e52, 0xd84bb0, 0xf2f2f2, 0x2b2b2e, 0xe8722c];
const SKIN_COLORS = [0xe8b98a, 0xc98a5a, 0x8a5a3a, 0xf2d9b8];
const PANTS_COLORS = [0x2b3a4a, 0x4a3a2b, 0x3a3a3a];

interface BystanderMesh {
  group: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
}

const HIP_HEIGHT = 0.55;

function buildBystanderMesh(): BystanderMesh {
  const group = new THREE.Group();
  const shirt = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  const skin = SKIN_COLORS[Math.floor(Math.random() * SKIN_COLORS.length)];
  const pants = PANTS_COLORS[Math.floor(Math.random() * PANTS_COLORS.length)];

  const bodyMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 });

  // Legs are separate meshes pivoted at the hip so they can swing during
  // walking/running, instead of one static cylinder.
  const legGeo = new THREE.CapsuleGeometry(0.1, 0.32, 3, 5);
  legGeo.translate(0, -0.24, 0);

  const legL = new THREE.Mesh(legGeo, pantsMat);
  legL.position.set(0.09, HIP_HEIGHT, 0);
  legL.castShadow = true;
  group.add(legL);

  const legR = new THREE.Mesh(legGeo, pantsMat);
  legR.position.set(-0.09, HIP_HEIGHT, 0);
  legR.castShadow = true;
  group.add(legR);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 3, 6), bodyMat);
  torso.position.y = 0.75;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), skinMat);
  head.position.y = 1.12;
  head.castShadow = true;
  group.add(head);

  const armGeo = new THREE.CapsuleGeometry(0.055, 0.34, 3, 5);
  armGeo.translate(0, -0.18, 0);

  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(0.24, 0.9, 0);
  group.add(armL);

  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set(-0.24, 0.9, 0);
  group.add(armR);

  return { group, armL, armR, legL, legR };
}

type BystanderState = "idle" | "dodging" | "ragdoll" | "recovering";

/**
 * A trackside spectator. Idles with a cheering bob/wave, scrambles out of
 * the way when a car is on an approach course within DANGER_RADIUS, and if
 * actually clipped by a car falls into a brief rigid-body ragdoll (shared
 * physics step with car debris) before getting back up near home.
 */
export class Bystander {
  readonly group: THREE.Group;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly home: THREE.Vector3;
  private readonly homeHeading: number;
  private readonly baseY: number;

  private state: BystanderState = "idle";
  private phase = Math.random() * Math.PI * 2;
  private readonly dodgeTarget = new THREE.Vector3();
  private readonly rag: RigidBodyState = { velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3() };
  private ragTimer = 0;

  constructor(position: THREE.Vector3, outward: THREE.Vector3) {
    const { group, armL, armR, legL, legR } = buildBystanderMesh();
    this.group = group;
    this.armL = armL;
    this.armR = armR;
    this.legL = legL;
    this.legR = legR;
    this.group.position.copy(position);
    this.home = position.clone();
    this.baseY = position.y;
    this.homeHeading = Math.atan2(-outward.x, -outward.z);
    this.group.rotation.y = this.homeHeading;
  }

  private findThreat(cars: Car[]): Car | null {
    let closest: Car | null = null;
    let closestDist = DANGER_RADIUS;
    for (const car of cars) {
      const dx = this.group.position.x - car.position.x;
      const dz = this.group.position.z - car.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > DANGER_RADIUS) continue;
      const speed = car.velocity.length();
      if (speed < 1.5) continue;
      const approach = (car.velocity.x * dx + car.velocity.z * dz) / dist;
      if (approach > APPROACH_THRESHOLD && dist < closestDist) {
        closest = car;
        closestDist = dist;
      }
    }
    return closest;
  }

  /** Bobbing/waving idle cheer, or -- with `running` -- a leg-pumping scramble. */
  private cheerPose(rate: number, running: boolean) {
    this.phase += rate;
    const legSwing = running ? 0.85 : 0.3;
    this.group.position.y = this.baseY + Math.max(0, Math.sin(this.phase)) * 0.12;
    this.armL.rotation.z = Math.sin(this.phase) * 0.9;
    this.armR.rotation.z = -Math.sin(this.phase + 0.6) * 0.9;
    this.legL.rotation.x = Math.sin(this.phase) * legSwing;
    this.legR.rotation.x = -Math.sin(this.phase) * legSwing;
  }

  private resetPose() {
    this.armL.rotation.z = 0;
    this.armR.rotation.z = 0;
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
  }

  update(dt: number, cars: Car[]) {
    switch (this.state) {
      case "idle": {
        this.cheerPose(dt * 4, false);
        const threat = this.findThreat(cars);
        if (threat) {
          this.state = "dodging";
          const away = new THREE.Vector3(this.group.position.x - threat.position.x, 0, this.group.position.z - threat.position.z);
          if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
          away.normalize();
          this.dodgeTarget.copy(this.group.position).addScaledVector(away, 3);
        }
        break;
      }
      case "dodging": {
        const threat = this.findThreat(cars);
        if (threat) {
          const away = new THREE.Vector3(this.group.position.x - threat.position.x, 0, this.group.position.z - threat.position.z);
          if (away.lengthSq() > 1e-4) {
            away.normalize();
            this.dodgeTarget.copy(this.group.position).addScaledVector(away, 3);
          }
        }
        const toTarget = new THREE.Vector3().subVectors(this.dodgeTarget, this.group.position);
        const dist = toTarget.length();
        if (dist > 0.15) {
          toTarget.normalize();
          this.group.position.addScaledVector(toTarget, DODGE_SPEED * dt);
          this.group.rotation.y = Math.atan2(toTarget.x, toTarget.z);
        }
        this.cheerPose(dt * 11, true);
        if (!threat && dist <= 0.15) this.state = "idle";
        break;
      }
      case "ragdoll": {
        stepRigidBody(this.group, this.rag, dt, this.baseY);
        this.ragTimer += dt;
        if (this.ragTimer > RAGDOLL_DURATION) this.state = "recovering";
        break;
      }
      case "recovering": {
        const targetQuat = new THREE.Quaternion().setFromAxisAngle(UP, this.homeHeading);
        this.group.quaternion.slerp(targetQuat, 1 - Math.pow(0.0005, dt));
        this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, this.baseY, 1 - Math.pow(0.001, dt));
        const angleDiff = this.group.quaternion.angleTo(targetQuat);
        if (angleDiff < 0.05 && Math.abs(this.group.position.y - this.baseY) < 0.02) {
          this.group.quaternion.copy(targetQuat);
          this.group.position.y = this.baseY;
          this.state = "idle";
        }
        break;
      }
    }
  }

  /** Called per car per frame; knocks the bystander down if actually clipped. Returns true if a hit occurred. */
  tryHit(car: Car): boolean {
    if (this.state === "ragdoll" || this.state === "recovering") return false;
    const dx = this.group.position.x - car.position.x;
    const dz = this.group.position.z - car.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > HIT_RADIUS + CAR_COLLISION_RADIUS) return false;

    this.state = "ragdoll";
    this.ragTimer = 0;
    this.resetPose();
    this.rag.velocity.copy(car.velocity).multiplyScalar(0.7);
    this.rag.velocity.y = 3 + Math.random() * 2;
    this.rag.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
    return true;
  }
}

const MIN_TRACKSIDE_OFFSET = ROAD_WIDTH / 2 + CURB_WIDTH + SAND_SHOULDER_WIDTH + 0.8;
const MAX_TRACKSIDE_OFFSET = MIN_TRACKSIDE_OFFSET + 1.2;

/** Scatters small cheering clusters along both sides of the track, just outside the sand shoulder. */
export function placeBystanders(track: Track): Bystander[] {
  const bystanders: Bystander[] = [];
  const n = track.samples.length;
  const stride = Math.max(1, Math.floor(n / 90));

  for (let i = 0; i < n; i += stride) {
    if (Math.random() > 0.55) continue;
    const sample = track.samples[i];
    const side = new THREE.Vector3().crossVectors(UP, sample.tangent).normalize();
    const sideSign = Math.random() < 0.5 ? 1 : -1;
    const clusterSize = 1 + Math.floor(Math.random() * 3);

    for (let c = 0; c < clusterSize; c++) {
      const offset = MIN_TRACKSIDE_OFFSET + Math.random() * (MAX_TRACKSIDE_OFFSET - MIN_TRACKSIDE_OFFSET);
      const along = (Math.random() - 0.5) * 2.5;
      const position = sample.point
        .clone()
        .addScaledVector(side, sideSign * offset)
        .addScaledVector(sample.tangent, along);
      const outward = side.clone().multiplyScalar(sideSign);
      bystanders.push(new Bystander(position, outward));
    }
  }
  return bystanders;
}
