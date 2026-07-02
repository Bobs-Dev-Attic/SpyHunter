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
