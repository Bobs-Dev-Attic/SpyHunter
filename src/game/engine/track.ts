import * as THREE from "three";

export const ROAD_WIDTH = 9;
const CURB_WIDTH = 0.9;
const SAND_SHOULDER_WIDTH = 5;
const SAMPLES_PER_SEGMENT = 24;

// Control points are generated as a radial function r(theta) rather than
// hand-placed, so the loop's curvature stays bounded everywhere by
// construction. A hand-placed hairpin risks a local turn radius smaller than
// the road's half-width, which makes the constant-width road/curb ribbon
// self-intersect into a degenerate bowtie mesh (it rendered as a jagged dark
// starburst artifact under the sun light). The sinusoidal blend below keeps
// the tightest radius of curvature comfortably above ROAD_WIDTH / 2 while
// still reading as sweeping S-curves with a couple of pronounced bends.
function generateLoopPoints(): [number, number][] {
  const base = 66;
  const count = 24;
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const r = base + 18 * Math.cos(theta) + 10 * Math.cos(3 * theta + 1.1);
    points.push([r * Math.cos(theta), r * Math.sin(theta)]);
  }
  return points;
}

const CONTROL_POINTS: [number, number][] = generateLoopPoints();

export interface TrackSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
}

export class Track {
  readonly group = new THREE.Group();
  readonly samples: TrackSample[];
  readonly startPosition: THREE.Vector3;
  readonly startHeading: number;

  private readonly curve: THREE.CatmullRomCurve3;

  constructor() {
    const pts = CONTROL_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);

    const divisions = CONTROL_POINTS.length * SAMPLES_PER_SEGMENT;
    this.samples = [];
    for (let i = 0; i < divisions; i++) {
      const t = i / divisions;
      const point = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      this.samples.push({ point, tangent });
    }

    this.startPosition = this.samples[0].point.clone();
    const startTangent = this.samples[0].tangent;
    this.startHeading = Math.atan2(startTangent.x, startTangent.z);

    this.group.add(this.buildRoadMesh());
    this.group.add(this.buildCurbMesh());
    this.group.add(this.buildFinishLine());
  }

  /** Returns the index of the closest sample point to a world position. */
  closestIndex(pos: THREE.Vector3): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const d = this.samples[i].point.distanceToSquared(pos);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  /** Signed lateral offset (world units) of pos from the track centerline, plus distance-squared. */
  distanceToCenterline(pos: THREE.Vector3): number {
    const idx = this.closestIndex(pos);
    return Math.sqrt(this.samples[idx].point.distanceToSquared(pos));
  }

  private buildRibbon(halfWidth: number, yOffset: number): THREE.BufferGeometry {
    const n = this.samples.length;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < n; i++) {
      const { point, tangent } = this.samples[i];
      const side = new THREE.Vector3().crossVectors(up, tangent).normalize();
      const left = point.clone().addScaledVector(side, halfWidth);
      const right = point.clone().addScaledVector(side, -halfWidth);

      positions[i * 6 + 0] = left.x;
      positions[i * 6 + 1] = yOffset;
      positions[i * 6 + 2] = left.z;
      positions[i * 6 + 3] = right.x;
      positions[i * 6 + 4] = yOffset;
      positions[i * 6 + 5] = right.z;

      const v = (i / n) * 40;
      uvs[i * 4 + 0] = 0;
      uvs[i * 4 + 1] = v;
      uvs[i * 4 + 2] = 1;
      uvs[i * 4 + 3] = v;
    }

    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = ((i + 1) % n) * 2;
      const d = ((i + 1) % n) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  private buildRoadMesh(): THREE.Mesh {
    const geo = this.buildRibbon(ROAD_WIDTH / 2, 0.02);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8d8d92,
      roughness: 0.95,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;

    // Dashed centerline using a thin, slightly raised strip with a repeating pattern via vertex colors.
    const lineGeo = this.buildRibbon(0.18, 0.03);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const line = new THREE.Mesh(lineGeo, lineMat);
    mesh.add(line);

    return mesh;
  }

  private buildCurbMesh(): THREE.Group {
    const group = new THREE.Group();
    const outerHalf = ROAD_WIDTH / 2 + CURB_WIDTH;
    const innerHalf = ROAD_WIDTH / 2;
    const n = this.samples.length;
    const up = new THREE.Vector3(0, 1, 0);
    const segmentLength = 3.2;

    for (const sign of [1, -1]) {
      const positions: number[] = [];
      const colors: number[] = [];
      let dashIndex = 0;
      let accum = 0;
      let prevPoint: THREE.Vector3 | null = null;

      for (let i = 0; i <= n; i++) {
        const s = this.samples[i % n];
        if (prevPoint) accum += prevPoint.distanceTo(s.point);
        prevPoint = s.point;
        if (accum > segmentLength) {
          accum = 0;
          dashIndex++;
        }
        const side = new THREE.Vector3().crossVectors(up, s.tangent).normalize();
        const outer = s.point.clone().addScaledVector(side, sign * outerHalf);
        const inner = s.point.clone().addScaledVector(side, sign * innerHalf);
        positions.push(inner.x, 0.04, inner.z, outer.x, 0.04, outer.z);
        const isRed = dashIndex % 2 === 0;
        const r = isRed ? 0.85 : 0.95;
        const g = isRed ? 0.12 : 0.95;
        const b = isRed ? 0.12 : 0.95;
        colors.push(r, g, b, r, g, b);
      }

      const indices: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, c, b, b, c, d);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
      group.add(new THREE.Mesh(geo, mat));
    }

    return group;
  }

  private buildFinishLine(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(ROAD_WIDTH, 1.4, 8, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(this.startPosition);
    mesh.position.y = 0.05;
    mesh.rotation.y = -this.startHeading;
    return mesh;
  }

  /** Also builds the sand shoulder ribbon, meant to be added to the ground layer beneath decorations. */
  buildShoulderMesh(): THREE.Mesh {
    const geo = this.buildRibbon(ROAD_WIDTH / 2 + CURB_WIDTH + SAND_SHOULDER_WIDTH, 0.01);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8b876, roughness: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }
}
