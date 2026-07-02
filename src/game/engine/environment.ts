import * as THREE from "three";
import { CURB_WIDTH, ROAD_WIDTH, SAND_SHOULDER_WIDTH, Track } from "./track";
import { Lizard } from "./wildlife";

const GROUND_SIZE = 420;

export interface Collider {
  id: number;
  x: number;
  z: number;
  radius: number;
}

function makeSandTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e0c084";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const shade = Math.random();
    ctx.fillStyle =
      shade > 0.5 ? "rgba(160,120,60,0.10)" : "rgba(255,235,190,0.12)";
    const r = Math.random() * 1.6 + 0.4;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(GROUND_SIZE / 12, GROUND_SIZE / 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: makeSandTexture(),
    roughness: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.position.y = -0.02;
  return mesh;
}

function buildTree(): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 6), trunkMat);
  trunk.position.y = 0.55;
  trunk.castShadow = true;
  group.add(trunk);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x5f9a4a, flatShading: true, roughness: 0.9 });
  const canopyMat2 = new THREE.MeshStandardMaterial({ color: 0x74b356, flatShading: true, roughness: 0.9 });
  const blobs = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < blobs; i++) {
    const scale = 0.75 + Math.random() * 0.55;
    const geo = new THREE.IcosahedronGeometry(scale, 0);
    const mesh = new THREE.Mesh(geo, i % 2 === 0 ? canopyMat : canopyMat2);
    mesh.position.set(
      (Math.random() - 0.5) * 0.8,
      1.1 + Math.random() * 0.9,
      (Math.random() - 0.5) * 0.8,
    );
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildRock(): THREE.Mesh {
  const geo = new THREE.DodecahedronGeometry(0.4 + Math.random() * 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8378, flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  mesh.castShadow = true;
  return mesh;
}

function buildCactus(): { group: THREE.Group; arms: THREE.Mesh[] } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f7d4a, flatShading: true, roughness: 0.85 });
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 3, 6), mat);
  core.position.y = 0.75;
  core.castShadow = true;
  group.add(core);
  const arms: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.5, 3, 6), mat.clone());
    const side = i === 0 ? 1 : -1;
    arm.position.set(side * 0.28, 1.0, 0);
    arm.rotation.z = side * 0.9;
    arm.castShadow = true;
    group.add(arm);
    arms.push(arm);
  }
  return { group, arms };
}

// The play camera is a fixed-direction orthographic camera: it translates
// with the car but never rotates, so its view volume is an infinite-depth
// box with a constant (small) cross-section. Scattering 3D scenery objects
// in a wide ring around the track is a trap here — no matter how large the
// radius, some fraction of the ring always lines up inside that box and
// renders directly behind the car. A painted horizon on the inside of the
// sky dome sidesteps the problem entirely: since the camera never rotates,
// the same texture region is always in view, so it reads as a stable
// distant backdrop instead of scenery that drifts through the foreground.
function makeSkyTexture(): THREE.CanvasTexture {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
  sky.addColorStop(0, "#4d92c9");
  sky.addColorStop(1, "#bcdcec");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.62);

  const ground = ctx.createLinearGradient(0, height * 0.6, 0, height);
  ground.addColorStop(0, "#e8dcb8");
  ground.addColorStop(1, "#d8b876");
  ctx.fillStyle = ground;
  ctx.fillRect(0, height * 0.58, width, height * 0.42);

  const drawRange = (baseY: number, amp: number, color: string, seed: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, baseY + amp);
    const peaks = 14;
    for (let i = 0; i <= peaks; i++) {
      const x = (i / peaks) * width;
      const n = Math.sin(i * 12.9898 + seed) * 43758.5453;
      const rand = n - Math.floor(n);
      const y = baseY - rand * amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, baseY + amp);
    ctx.closePath();
    ctx.fill();
  };

  drawRange(height * 0.6, 46, "#a98a63", 3.1);
  drawRange(height * 0.62, 30, "#8a6b48", 7.7);

  // Make the horizon band seamlessly tileable in X for the wrap-around sphere.
  const seamFix = ctx.getImageData(0, 0, 4, height);
  ctx.putImageData(seamFix, width - 4, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function buildSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(GROUND_SIZE * 0.9, 32, 20);
  const mat = new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geo, mat);
}

// Base collision radius per decoration type (world units at scale 1), tuned
// to roughly match each mesh's visible trunk/body footprint rather than its
// full canopy/branch extent.
const COLLIDER_RADIUS: Record<"tree" | "rock" | "cactus", number> = {
  tree: 0.5,
  rock: 0.55,
  cactus: 0.4,
};

const DECORATION_MIN_IMPACT = 3;
const DECORATION_DAMAGE_SCALE = 20;
const TREE_TOPPLE_HEALTH = 0.6;
const CACTUS_ARM_HEALTH = 0.5;
const FALL_DURATION = 0.9;

export interface DetachedArmEvent {
  mesh: THREE.Object3D;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
}

/**
 * Wraps a tree or cactus so a hard-enough car impact can topple it (trees)
 * or snap an arm off (cacti) instead of it just being an inert collision
 * cylinder forever. Rocks aren't wrapped -- they're hard enough to just
 * shrug off a bumper.
 */
export class Decoration {
  readonly object: THREE.Object3D;
  readonly collider: Collider;
  readonly kind: "tree" | "cactus";
  health = 0;
  falling = false;
  fallen = false;
  colliderRemoved = false;
  private fallProgress = 0;
  private readonly fallAxis = new THREE.Vector3(1, 0, 0);
  private armsRemaining: THREE.Mesh[];

  constructor(object: THREE.Object3D, collider: Collider, kind: "tree" | "cactus", arms: THREE.Mesh[] = []) {
    this.object = object;
    this.collider = collider;
    this.kind = kind;
    this.armsRemaining = arms;
  }

  /** Registers an impact; returns a detached cactus arm to hand to a debris system, if one broke off. */
  registerHit(impactSpeed: number, worldDir: THREE.Vector3): DetachedArmEvent | null {
    if (this.fallen || this.falling || impactSpeed < DECORATION_MIN_IMPACT) return null;
    this.health = Math.min(1, this.health + impactSpeed / DECORATION_DAMAGE_SCALE);

    if (this.kind === "tree" && this.health > TREE_TOPPLE_HEALTH) {
      this.falling = true;
      this.fallAxis.set(worldDir.z, 0, -worldDir.x).normalize();
      return null;
    }

    if (this.kind === "cactus" && this.health > CACTUS_ARM_HEALTH && this.armsRemaining.length > 0) {
      const arm = this.armsRemaining.pop()!;
      this.health = 0.15;

      const worldPos = new THREE.Vector3();
      arm.getWorldPosition(worldPos);
      const worldQuat = new THREE.Quaternion();
      arm.getWorldQuaternion(worldQuat);
      arm.parent?.remove(arm);
      arm.position.copy(worldPos);
      arm.quaternion.copy(worldQuat);

      const velocity = worldDir.clone().multiplyScalar(2.5 + Math.random() * 2).setY(2.5 + Math.random() * 1.5);
      const angularVelocity = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
      );
      return { mesh: arm, velocity, angularVelocity };
    }

    return null;
  }

  /** Advances the topple animation. Call every frame; cheap no-op once settled. */
  update(dt: number) {
    if (!this.falling || this.fallen) return;
    this.fallProgress = Math.min(1, this.fallProgress + dt / FALL_DURATION);
    const eased = 1 - Math.pow(1 - this.fallProgress, 2);
    this.object.setRotationFromAxisAngle(this.fallAxis, eased * (Math.PI / 2 + 0.1));
    if (this.fallProgress >= 1) this.fallen = true;
  }
}

export function buildEnvironment(
  track: Track,
): { group: THREE.Group; colliders: Collider[]; lizards: Lizard[]; decorations: Decoration[] } {
  const group = new THREE.Group();
  group.add(buildSkyDome());
  group.add(buildGround());
  group.add(track.buildShoulderMesh());

  const decorationGroup = new THREE.Group();
  const colliders: Collider[] = [];
  const destructibles: Decoration[] = [];
  let nextColliderId = 0;
  // Keep decorations clear of the road, curb, and sand shoulder entirely so
  // every collidable object sits out in the open desert friction tier.
  const minClearance = ROAD_WIDTH / 2 + CURB_WIDTH + SAND_SHOULDER_WIDTH + 2;
  const half = GROUND_SIZE / 2 - 10;
  const targetCount = 260;
  let placed = 0;
  let attempts = 0;

  while (placed < targetCount && attempts < targetCount * 12) {
    attempts++;
    const x = (Math.random() - 0.5) * 2 * half;
    const z = (Math.random() - 0.5) * 2 * half;
    const pos = new THREE.Vector3(x, 0, z);
    if (track.distanceToCenterline(pos) < minClearance) continue;

    const roll = Math.random();
    let item: THREE.Object3D;
    let kind: keyof typeof COLLIDER_RADIUS;
    let arms: THREE.Mesh[] = [];
    if (roll < 0.45) {
      item = buildTree();
      kind = "tree";
    } else if (roll < 0.75) {
      item = buildRock();
      kind = "rock";
    } else {
      const cactus = buildCactus();
      item = cactus.group;
      arms = cactus.arms;
      kind = "cactus";
    }

    const scale = 0.8 + Math.random() * 0.6;
    item.position.set(x, 0, z);
    item.scale.setScalar(scale);
    item.rotation.y = Math.random() * Math.PI * 2;
    decorationGroup.add(item);
    const collider: Collider = { id: nextColliderId++, x, z, radius: COLLIDER_RADIUS[kind] * scale };
    colliders.push(collider);
    if (kind === "tree" || kind === "cactus") {
      destructibles.push(new Decoration(item, collider, kind, arms));
    }
    placed++;
  }

  // Lizards are small and non-solid (no collider), so they're allowed to sit
  // a bit closer to the road than the trees/rocks/cacti -- just past the
  // sand shoulder, like they're basking at the road's edge.
  const lizards: Lizard[] = [];
  const lizardClearance = ROAD_WIDTH / 2 + CURB_WIDTH + SAND_SHOULDER_WIDTH + 0.5;
  const targetLizardCount = 16;
  let lizardsPlaced = 0;
  let lizardAttempts = 0;

  while (lizardsPlaced < targetLizardCount && lizardAttempts < targetLizardCount * 15) {
    lizardAttempts++;
    const x = (Math.random() - 0.5) * 2 * half;
    const z = (Math.random() - 0.5) * 2 * half;
    const pos = new THREE.Vector3(x, 0, z);
    if (track.distanceToCenterline(pos) < lizardClearance) continue;

    const lizard = new Lizard(pos);
    decorationGroup.add(lizard.group);
    lizards.push(lizard);
    lizardsPlaced++;
  }

  group.add(decorationGroup);
  return { group, colliders, lizards, decorations: destructibles };
}
