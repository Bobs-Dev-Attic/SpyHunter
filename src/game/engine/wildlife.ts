import * as THREE from "three";

function buildBird(): { group: THREE.Group; wingPivotL: THREE.Group; wingPivotR: THREE.Group } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, flatShading: true, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 5), bodyMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const wingGeo = new THREE.PlaneGeometry(0.32, 0.1);
  wingGeo.rotateX(-Math.PI / 2); // lie flat (span in X/Z) instead of standing up in X/Y
  wingGeo.translate(0.16, 0, 0); // hinge edge at local origin, wing extends outward
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3d,
    flatShading: true,
    side: THREE.DoubleSide,
    roughness: 0.85,
  });

  const wingPivotL = new THREE.Group();
  wingPivotL.add(new THREE.Mesh(wingGeo, wingMat));
  group.add(wingPivotL);

  const wingPivotR = new THREE.Group();
  wingPivotR.rotation.y = Math.PI;
  wingPivotR.add(new THREE.Mesh(wingGeo, wingMat));
  group.add(wingPivotR);

  return { group, wingPivotL, wingPivotR };
}

export class BirdFlock {
  readonly group = new THREE.Group();
  private readonly birds: {
    pivot: THREE.Group;
    wingPivotL: THREE.Group;
    wingPivotR: THREE.Group;
    angle: number;
    angularSpeed: number;
    radius: number;
    height: number;
    flapPhase: number;
    flapSpeed: number;
  }[] = [];

  constructor(center: THREE.Vector3, count: number, baseRadius: number, baseHeight: number) {
    for (let i = 0; i < count; i++) {
      const { group: birdGroup, wingPivotL, wingPivotR } = buildBird();
      const pivot = new THREE.Group();
      pivot.position.copy(center);
      pivot.add(birdGroup);
      birdGroup.position.x = baseRadius + (Math.random() - 0.5) * 3;
      this.group.add(pivot);

      this.birds.push({
        pivot,
        wingPivotL,
        wingPivotR,
        angle: (i / count) * Math.PI * 2,
        angularSpeed: 0.35 + Math.random() * 0.2,
        radius: baseRadius + (Math.random() - 0.5) * 3,
        height: baseHeight + (Math.random() - 0.5) * 3,
        flapPhase: Math.random() * Math.PI * 2,
        flapSpeed: 7 + Math.random() * 3,
      });
    }
  }

  update(dt: number) {
    for (const bird of this.birds) {
      bird.angle += bird.angularSpeed * dt;
      bird.flapPhase += bird.flapSpeed * dt;

      const localX = Math.cos(bird.angle) * bird.radius;
      const localZ = Math.sin(bird.angle) * bird.radius;
      bird.pivot.children[0].position.set(localX, bird.height, localZ);
      // Faces along the circular path's tangent direction (-sin, 0, cos) for
      // the current angle, matching the forwardVector(heading) convention
      // used elsewhere (forward = (sin(h), 0, cos(h))): solving sin(h)=-sin(angle)
      // and cos(h)=cos(angle) gives h = -angle.
      bird.pivot.children[0].rotation.y = -bird.angle;

      const flap = Math.sin(bird.flapPhase) * 0.6;
      bird.wingPivotL.rotation.z = flap;
      bird.wingPivotR.rotation.z = flap;
    }
  }
}

function buildLizardMeshes(): { group: THREE.Group; tail: THREE.Object3D } {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a7a4a, flatShading: true, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 2, 6), mat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.05;
  group.add(body);

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.08, 5), mat);
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.05, 0.11);
  group.add(head);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 5), mat);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -0.08;
  const tailPivot = new THREE.Object3D();
  tailPivot.position.set(0, 0.05, -0.09);
  tailPivot.add(tail);
  group.add(tailPivot);

  return { group, tail: tailPivot };
}

const SCURRY_DURATION = 0.55;

export class Lizard {
  readonly group: THREE.Group;
  private readonly tail: THREE.Object3D;
  private readonly basePos: THREE.Vector3;
  private target: THREE.Vector3 | null = null;
  private moveT = 0;
  private idleTimer: number;
  private phase = Math.random() * Math.PI * 2;

  constructor(pos: THREE.Vector3) {
    const { group, tail } = buildLizardMeshes();
    this.group = group;
    this.tail = tail;
    this.basePos = pos.clone();
    this.group.position.copy(pos);
    this.group.rotation.y = Math.random() * Math.PI * 2;
    this.idleTimer = 2 + Math.random() * 6;
  }

  update(dt: number) {
    this.phase += dt * 5;
    this.tail.rotation.y = Math.sin(this.phase) * 0.35;

    if (this.target) {
      this.moveT += dt / SCURRY_DURATION;
      const p = Math.min(this.moveT, 1);
      this.group.position.x = THREE.MathUtils.lerp(this.basePos.x, this.target.x, p);
      this.group.position.z = THREE.MathUtils.lerp(this.basePos.z, this.target.z, p);
      this.group.position.y = Math.sin(p * Math.PI) * 0.05;

      const dx = this.target.x - this.basePos.x;
      const dz = this.target.z - this.basePos.z;
      if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) {
        this.group.rotation.y = Math.atan2(dx, dz);
      }

      if (p >= 1) {
        this.basePos.copy(this.target);
        this.target = null;
        this.moveT = 0;
        this.idleTimer = 3 + Math.random() * 6;
      }
    } else {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.5 + Math.random() * 1.2;
        this.target = new THREE.Vector3(
          this.basePos.x + Math.cos(angle) * dist,
          0,
          this.basePos.z + Math.sin(angle) * dist,
        );
        this.moveT = 0;
      }
    }
  }
}
