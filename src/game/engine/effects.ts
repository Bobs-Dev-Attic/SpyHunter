import * as THREE from "three";

let softDiscTexture: THREE.CanvasTexture | null = null;

/** Shared soft radial-gradient sprite so smoke puffs read as billowy rather than flat dots. */
function getSoftDiscTexture(): THREE.CanvasTexture {
  if (softDiscTexture) return softDiscTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.7)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  softDiscTexture = new THREE.CanvasTexture(canvas);
  return softDiscTexture;
}

export interface SmokeOptions {
  maxParticles: number;
  color: number;
  /** Point size in screen pixels at spawn, randomized within this range. */
  baseSize: [number, number];
  /** Size multiplier reached by end of life (puffs expand as they disperse). */
  growth: number;
  opacity: [number, number];
  lifetime: [number, number];
  /** Fraction of velocity retained per second (air resistance). */
  drag?: number;
  /** Upward acceleration, world units/s^2 (buoyancy). */
  rise?: number;
  /** Spawn height above the given spawn position, randomized within this range. Defaults to ground-hugging. */
  baseHeight?: [number, number];
}

/**
 * Recycled point-sprite pool for smoke-style effects (dirt kickup, exhaust).
 * Unlike a plain PointsMaterial, a small custom shader drives per-particle
 * size (grows with age) and opacity (fades with age) from two extra
 * attributes computed on the CPU each frame — a flat dot doesn't read as
 * smoke, a puff that expands and fades does. Dead slots are parked far below
 * the ground rather than removed, so spawning never allocates.
 */
export class SmokeEmitter {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly growth: number;
  private readonly drag: number;
  private readonly rise: number;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly baseSizes: Float32Array;
  private readonly baseOpacities: Float32Array;
  private readonly sizeAttr: Float32Array;
  private readonly opacityAttr: Float32Array;
  private cursor = 0;
  private readonly opts: SmokeOptions;

  constructor(opts: SmokeOptions) {
    this.opts = opts;
    this.max = opts.maxParticles;
    this.growth = opts.growth;
    this.drag = opts.drag ?? 0.7;
    this.rise = opts.rise ?? 0.5;

    this.positions = new Float32Array(this.max * 3);
    this.velocities = new Float32Array(this.max * 3);
    this.ages = new Float32Array(this.max).fill(999);
    this.lifetimes = new Float32Array(this.max).fill(1);
    this.baseSizes = new Float32Array(this.max);
    this.baseOpacities = new Float32Array(this.max);
    this.sizeAttr = new Float32Array(this.max);
    this.opacityAttr = new Float32Array(this.max);

    for (let i = 0; i < this.max; i++) this.positions[i * 3 + 1] = -50;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizeAttr, 1));
    geo.setAttribute("aOpacity", new THREE.BufferAttribute(this.opacityAttr, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(opts.color) },
        map: { value: getSoftDiscTexture() },
      },
      vertexShader: `
        attribute float aSize;
        attribute float aOpacity;
        varying float vOpacity;
        void main() {
          vOpacity = aOpacity;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D map;
        varying float vOpacity;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          float a = tex.a * vOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(color, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(pos: THREE.Vector3, count: number, spread: number, forwardBias?: THREE.Vector3) {
    const [sizeMin, sizeMax] = this.opts.baseSize;
    const [opMin, opMax] = this.opts.opacity;
    const [lifeMin, lifeMax] = this.opts.lifetime;

    const [heightMin, heightMax] = this.opts.baseHeight ?? [0.15, 0.3];
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      this.positions[i * 3 + 0] = pos.x + (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] = pos.y + heightMin + Math.random() * (heightMax - heightMin);
      this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;

      const bx = forwardBias ? forwardBias.x * 0.8 : 0;
      const bz = forwardBias ? forwardBias.z * 0.8 : 0;
      this.velocities[i * 3 + 0] = bx + (Math.random() - 0.5) * 0.8;
      this.velocities[i * 3 + 1] = this.rise * (0.5 + Math.random() * 0.6);
      this.velocities[i * 3 + 2] = bz + (Math.random() - 0.5) * 0.8;

      this.ages[i] = 0;
      this.lifetimes[i] = lifeMin + Math.random() * (lifeMax - lifeMin);
      this.baseSizes[i] = sizeMin + Math.random() * (sizeMax - sizeMin);
      this.baseOpacities[i] = opMin + Math.random() * (opMax - opMin);
    }
  }

  update(dt: number) {
    const dragFactor = Math.max(0, 1 - this.drag * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.ages[i] > this.lifetimes[i]) continue;
      this.ages[i] += dt;
      if (this.ages[i] > this.lifetimes[i]) {
        this.positions[i * 3 + 1] = -50;
        this.opacityAttr[i] = 0;
        continue;
      }

      this.velocities[i * 3 + 0] *= dragFactor;
      this.velocities[i * 3 + 2] *= dragFactor;
      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      const t = this.ages[i] / this.lifetimes[i];
      this.sizeAttr[i] = this.baseSizes[i] * THREE.MathUtils.lerp(1, this.growth, t);
      this.opacityAttr[i] = this.baseOpacities[i] * (1 - t);
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aOpacity as THREE.BufferAttribute).needsUpdate = true;
  }
}

const MAX_SKID_SEGMENTS = 700;
const SKID_MARK_WIDTH = 0.2;

/**
 * Persistent tire-track ribbon rendered behind each rear wheel while
 * slipping/locking up. Each slot is an independent quad (two triangles, six
 * vertices) written directly into a fixed-size non-indexed buffer — a ring
 * buffer of quads rather than a growing mesh, so long drifts don't allocate.
 * A `null` "last point" per wheel breaks the ribbon between separate skids.
 */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private cursor = 0;
  private readonly lastEdges = new Map<string, { left: THREE.Vector3; right: THREE.Vector3 }>();

  constructor() {
    this.positions = new Float32Array(MAX_SKID_SEGMENTS * 6 * 3);
    for (let i = 1; i < this.positions.length; i += 3) this.positions[i] = -50;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.MeshBasicMaterial({
      color: 0x15110d,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  private writeQuad(prevLeft: THREE.Vector3, prevRight: THREE.Vector3, left: THREE.Vector3, right: THREE.Vector3) {
    const base = this.cursor * 18;
    const verts = [prevLeft, left, prevRight, prevRight, left, right];
    for (let v = 0; v < 6; v++) {
      this.positions[base + v * 3] = verts[v].x;
      this.positions[base + v * 3 + 1] = verts[v].y;
      this.positions[base + v * 3 + 2] = verts[v].z;
    }
    this.cursor = (this.cursor + 1) % MAX_SKID_SEGMENTS;
  }

  /** Call once per wheel per frame. `active` false breaks the trail (lift off / off-surface). */
  mark(wheelId: string, contactPoint: THREE.Vector3, sideDir: THREE.Vector3, active: boolean): boolean {
    if (!active) {
      this.lastEdges.delete(wheelId);
      return false;
    }

    const left = contactPoint.clone().addScaledVector(sideDir, SKID_MARK_WIDTH);
    const right = contactPoint.clone().addScaledVector(sideDir, -SKID_MARK_WIDTH);
    left.y = 0.022;
    right.y = 0.022;

    const prev = this.lastEdges.get(wheelId);
    let wrote = false;
    if (prev) {
      this.writeQuad(prev.left, prev.right, left, right);
      wrote = true;
    }
    this.lastEdges.set(wheelId, { left, right });
    return wrote;
  }

  commit() {
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

let bloodSplatTexture: THREE.CanvasTexture | null = null;

/** A dark-red irregular splat, alpha-blended so it reads as a stain rather than a flat circle. */
function getBloodSplatTexture(): THREE.CanvasTexture {
  if (bloodSplatTexture) return bloodSplatTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;

  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * size * 0.22;
    const bx = cx + Math.cos(angle) * dist;
    const by = cy + Math.sin(angle) * dist;
    const r = size * (0.12 + Math.random() * 0.22);
    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    gradient.addColorStop(0, "rgba(94,10,10,0.9)");
    gradient.addColorStop(0.6, "rgba(74,6,6,0.6)");
    gradient.addColorStop(1, "rgba(74,6,6,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }

  bloodSplatTexture = new THREE.CanvasTexture(canvas);
  return bloodSplatTexture;
}

const BLOOD_LIFETIME = 25;
const BLOOD_FADE_DURATION = 5;

interface BloodSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  active: boolean;
}

/**
 * Small pool of ground decals for bystander injuries. Each spawn reuses the
 * oldest slot (or an inactive one), so this never allocates once warmed up.
 * Fades out and hides itself after BLOOD_LIFETIME seconds.
 */
export class BloodDecals {
  readonly group = new THREE.Group();
  private readonly slots: BloodSlot[];
  private cursor = 0;

  constructor(maxDecals = 40) {
    const texture = getBloodSplatTexture();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);

    this.slots = Array.from({ length: maxDecals }, () => {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.visible = false;
      mesh.position.y = -50;
      this.group.add(mesh);
      return { mesh, material, age: BLOOD_LIFETIME, active: false };
    });
  }

  spawn(position: THREE.Vector3, scale = 0.55) {
    const slot = this.slots[this.cursor];
    this.cursor = (this.cursor + 1) % this.slots.length;

    slot.mesh.position.set(position.x, 0.018, position.z);
    slot.mesh.rotation.y = Math.random() * Math.PI * 2;
    slot.mesh.scale.setScalar(scale * (0.75 + Math.random() * 0.5));
    slot.mesh.visible = true;
    slot.material.opacity = 0.85;
    slot.age = 0;
    slot.active = true;
  }

  update(dt: number) {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.age += dt;
      if (slot.age > BLOOD_LIFETIME - BLOOD_FADE_DURATION) {
        const t = Math.max(0, (BLOOD_LIFETIME - slot.age) / BLOOD_FADE_DURATION);
        slot.material.opacity = 0.85 * t;
      }
      if (slot.age >= BLOOD_LIFETIME) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }
  }
}
