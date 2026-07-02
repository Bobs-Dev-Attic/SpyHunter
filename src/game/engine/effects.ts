import * as THREE from "three";

const MAX_PARTICLES = 240;

/**
 * Lightweight recycled point-sprite pool for dust/skid puffs. Avoids per-frame
 * allocation: particles are written into a ring buffer and dead ones are
 * parked far below the ground rather than removed.
 */
export class DustEmitter {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private cursor = 0;

  constructor() {
    this.positions = new Float32Array(MAX_PARTICLES * 3);
    this.velocities = new Float32Array(MAX_PARTICLES * 3);
    this.ages = new Float32Array(MAX_PARTICLES).fill(999);
    this.lifetimes = new Float32Array(MAX_PARTICLES).fill(1);

    for (let i = 0; i < MAX_PARTICLES; i++) this.positions[i * 3 + 1] = -50;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd8c090,
      size: 0.55,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(pos: THREE.Vector3, count: number, spread: number) {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      this.positions[i * 3 + 0] = pos.x + (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] = 0.15;
      this.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * spread;
      this.velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.6;
      this.velocities[i * 3 + 1] = 0.3 + Math.random() * 0.4;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      this.ages[i] = 0;
      this.lifetimes[i] = 0.5 + Math.random() * 0.4;
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.ages[i] > this.lifetimes[i]) continue;
      this.ages[i] += dt;
      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      if (this.ages[i] > this.lifetimes[i]) {
        this.positions[i * 3 + 1] = -50;
      }
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
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
