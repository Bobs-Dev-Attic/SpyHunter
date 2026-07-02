import * as THREE from "three";
import { ROAD_WIDTH, Track } from "./track";
import { buildEnvironment, type Collider } from "./environment";
import { Car } from "./car";
import { InputController } from "./input";
import { BloodDecals, SkidMarks, SmokeEmitter } from "./effects";
import { BirdFlock, Lizard } from "./wildlife";
import { AI_PROFILES, AIRacer, buildStartingGrid } from "./aiRacer";
import { DebrisSystem } from "./debris";
import { Bystander, placeBystanders } from "./bystanders";

const BASE_VIEW_HEIGHT = 20;
const MIN_VIEW_HEIGHT = 14;
const MAX_VIEW_HEIGHT = 30;
// Zoom out with speed...
const SPEED_ZOOM_FACTOR = 0.09;
// ...and pull in an extra bit when braking hard, on top of the speed term.
const DECEL_ZOOM_THRESHOLD = 6;
const DECEL_ZOOM_FACTOR = 0.5;
const MAX_DECEL_ZOOM_PULL = 6;
const CAMERA_OFFSET = new THREE.Vector3(24, 30, 24);
const MIN_LAP_TIME = 4;

export interface RacerBlip {
  x: number;
  z: number;
  color: number;
}

export interface HudState {
  currentTime: number;
  lastLap: number | null;
  bestLap: number | null;
  speedKmh: number;
  offroad: boolean;
  carX: number;
  carZ: number;
  carHeading: number;
  racers: RacerBlip[];
  rpm: number;
  fuelPercent: number;
  oilTempC: number;
  checkEngineOn: boolean;
  lowFuel: boolean;
  handbrakeOn: boolean;
}

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private track: Track;
  private car: Car;
  private input: InputController;
  private dirtSmoke: SmokeEmitter;
  private exhaust: SmokeEmitter;
  private exhaustTimer = 0;
  private readonly backwardBias = new THREE.Vector3();
  private readonly exhaustPos = new THREE.Vector3();
  private skidMarks: SkidMarks;
  private colliders: Collider[];
  private lizards: Lizard[];
  private birdFlocks: BirdFlock[] = [];
  private racers: AIRacer[] = [];
  private readonly allCars: Car[] = [];
  private debris: DebrisSystem;
  private bystanders: Bystander[] = [];
  private fireEmitter: SmokeEmitter;
  private fireSmoke: SmokeEmitter;
  private readonly firePos = new THREE.Vector3();
  private blood: BloodDecals;

  private raf = 0;
  private lastTime = 0;
  private running = true;

  private lapStartIndexZone: boolean[];
  private prevLapIndex = 0;
  private currentLapTime = 0;
  private lastLapTime: number | null = null;
  private bestLapTime: number | null = null;

  private hudListeners = new Set<(hud: HudState) => void>();
  private resizeObserver: ResizeObserver;

  private containerWidth = 1;
  private containerHeight = 1;
  private currentViewHeight = BASE_VIEW_HEIGHT;

  constructor(private canvas: HTMLCanvasElement, private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.track = new Track();
    this.scene.add(this.track.group);
    const environment = buildEnvironment(this.track);
    this.scene.add(environment.group);
    this.colliders = environment.colliders;
    // Lizard meshes are already parented under environment.group (added
    // above); we just keep references here to drive their per-frame update.
    this.lizards = environment.lizards;

    this.car = new Car(this.track, undefined, 1);
    this.scene.add(this.car.root);

    const grid = buildStartingGrid(this.track, AI_PROFILES.length);
    this.racers = AI_PROFILES.map(
      (profile, i) => new AIRacer(this.track, profile, grid[i].position, grid[i].heading, i + 2),
    );
    for (const racer of this.racers) this.scene.add(racer.car.root);
    this.allCars = [this.car, ...this.racers.map((r) => r.car)];

    this.birdFlocks = this.createBirdFlocks();
    for (const flock of this.birdFlocks) this.scene.add(flock.group);

    this.dirtSmoke = new SmokeEmitter({
      maxParticles: 220,
      color: 0xc9a878,
      baseSize: [16, 26],
      growth: 2.8,
      opacity: [0.4, 0.6],
      lifetime: [0.7, 1.1],
      drag: 0.8,
      rise: 0.6,
    });
    this.scene.add(this.dirtSmoke.points);

    this.exhaust = new SmokeEmitter({
      maxParticles: 120,
      color: 0xd8d8d8,
      baseSize: [6, 10],
      growth: 2.2,
      opacity: [0.25, 0.4],
      lifetime: [0.5, 0.8],
      drag: 0.6,
      rise: 0.9,
    });
    this.scene.add(this.exhaust.points);

    this.fireEmitter = new SmokeEmitter({
      maxParticles: 150,
      color: 0xff6a1a,
      baseSize: [10, 18],
      growth: 1.6,
      opacity: [0.55, 0.8],
      lifetime: [0.25, 0.4],
      drag: 0.5,
      rise: 2.2,
      baseHeight: [0.25, 0.55],
    });
    this.scene.add(this.fireEmitter.points);

    this.fireSmoke = new SmokeEmitter({
      maxParticles: 180,
      color: 0x2a2622,
      baseSize: [14, 24],
      growth: 3.2,
      opacity: [0.35, 0.55],
      lifetime: [1.2, 1.8],
      drag: 0.4,
      rise: 1.1,
      baseHeight: [0.4, 0.7],
    });
    this.scene.add(this.fireSmoke.points);

    this.debris = new DebrisSystem();
    this.scene.add(this.debris.group);

    this.bystanders = placeBystanders(this.track);
    for (const bystander of this.bystanders) this.scene.add(bystander.group);

    this.blood = new BloodDecals();
    this.scene.add(this.blood.group);

    this.skidMarks = new SkidMarks();
    this.scene.add(this.skidMarks.mesh);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
    this.camera.position.copy(this.car.position).add(CAMERA_OFFSET);
    this.camera.lookAt(this.car.position);
    this.scene.add(this.camera);

    this.setupLights();

    this.input = new InputController(window);

    this.lapStartIndexZone = new Array(this.track.samples.length).fill(false);

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();

    this.raf = requestAnimationFrame(this.loop);
  }

  private createBirdFlocks(): BirdFlock[] {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const { point } of this.track.samples) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    const flockOffsets: [number, number][] = [
      [-0.3, -0.25],
      [0.32, 0.1],
      [-0.05, 0.35],
    ];
    return flockOffsets.map(([fx, fz]) => {
      const center = new THREE.Vector3(centerX + fx * spanX, 0, centerZ + fz * spanZ);
      return new BirdFlock(center, 3, 6 + Math.random() * 4, 14 + Math.random() * 6);
    });
  }

  private setupLights() {
    const hemi = new THREE.HemisphereLight(0xbfd9ea, 0xcaa974, 0.65);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.35);
    sun.position.set(60, 90, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const bounds = 140;
    sun.shadow.camera.left = -bounds;
    sun.shadow.camera.right = bounds;
    sun.shadow.camera.top = bounds;
    sun.shadow.camera.bottom = -bounds;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 260;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
    this.scene.add(sun.target);

    const fillLight = new THREE.DirectionalLight(0xbcd6ff, 0.25);
    fillLight.position.set(-40, 30, -20);
    this.scene.add(fillLight);

    this.scene.fog = new THREE.Fog(0xe8dcb8, 90, 200);
  }

  private onResize() {
    this.containerWidth = this.container.clientWidth;
    this.containerHeight = this.container.clientHeight;
    this.applyFrustum(this.currentViewHeight);
    this.renderer.setSize(this.containerWidth, this.containerHeight, false);
  }

  /** Re-derives the camera frustum for the current container size and zoom level. Cheap enough to call every frame. */
  private applyFrustum(viewHeight: number) {
    const aspect = Math.max(this.containerWidth / Math.max(this.containerHeight, 1), 0.1);
    const viewWidth = viewHeight * aspect;

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }

  onHudUpdate(cb: (hud: HudState) => void) {
    this.hudListeners.add(cb);
    return () => this.hudListeners.delete(cb);
  }

  /** Track centerline points (subsampled) for drawing a minimap. Static for the session, so callers can cache it. */
  getTrackOutline(): [number, number][] {
    const step = 4;
    const points: [number, number][] = [];
    for (let i = 0; i < this.track.samples.length; i += step) {
      const p = this.track.samples[i].point;
      points.push([p.x, p.z]);
    }
    return points;
  }

  setTouchInput(throttle: number, brake: number, steer: number, handbrake = false) {
    this.input.setTouchAxes(throttle, brake, steer, handbrake);
  }

  private loop = (time: number) => {
    if (!this.running) return;
    const dt = this.lastTime ? Math.min((time - this.lastTime) / 1000, 1 / 20) : 0;
    this.lastTime = time;

    const input = this.input.state;
    this.car.update(dt, input, this.track);
    for (const racer of this.racers) racer.update(dt, this.track, this.allCars);

    for (const car of this.allCars) car.resolveCollisions(this.colliders);
    for (let i = 0; i < this.allCars.length; i++) {
      for (let j = i + 1; j < this.allCars.length; j++) {
        this.allCars[i].resolveCarCollision(this.allCars[j]);
      }
    }

    for (const car of this.allCars) {
      for (const ev of car.drainDetachments()) {
        this.debris.spawn(ev.mesh, ev.velocity, ev.angularVelocity);
      }
    }
    this.debris.update(dt);

    for (const bystander of this.bystanders) bystander.update(dt, this.allCars);
    for (const car of this.allCars) {
      for (const bystander of this.bystanders) bystander.tryHit(car);
    }
    for (const bystander of this.bystanders) {
      for (const point of bystander.drainBlood()) this.blood.spawn(point);
    }
    this.blood.update(dt);

    for (const car of this.allCars) {
      if (!car.isOnFire) continue;
      this.firePos.set(car.position.x, car.position.y, car.position.z);
      this.fireEmitter.spawn(this.firePos, 3, 0.5);
      this.fireSmoke.spawn(this.firePos, 2, 0.6);
    }
    this.fireEmitter.update(dt);
    this.fireSmoke.update(dt);

    const speedKmh = this.car.speedKmh;
    const backward = this.backwardBias.copy(this.car.forward).negate();
    if ((this.car.isSkidding || this.car.isOffroad) && speedKmh > 8) {
      this.dirtSmoke.spawn(this.car.position, this.car.isSkidding ? 3 : 1, 1.6, backward);
    }
    this.dirtSmoke.update(dt);

    this.exhaustTimer -= dt;
    if (this.exhaustTimer <= 0) {
      const underLoad = input.throttle > 0.4;
      this.exhaust.spawn(this.car.getExhaustPosition(this.exhaustPos), underLoad ? 2 : 1, 0.08, backward);
      this.exhaustTimer = (underLoad ? 0.05 : 0.15) + Math.random() * 0.03;
    }
    this.exhaust.update(dt);

    let skidWrote = false;
    for (const wheelIndex of [2, 3]) {
      const contact = this.car.getWheelContact(wheelIndex);
      skidWrote = this.skidMarks.mark(`w${wheelIndex}`, contact, this.car.side, this.car.isSkidding && speedKmh > 5) || skidWrote;
    }
    if (skidWrote) this.skidMarks.commit();

    for (const lizard of this.lizards) lizard.update(dt);
    for (const flock of this.birdFlocks) flock.update(dt);

    this.updateLap(dt);
    this.updateZoom(dt);

    this.camera.position.copy(this.car.position).add(CAMERA_OFFSET);
    this.camera.lookAt(this.car.position);

    this.renderer.render(this.scene, this.camera);

    for (const cb of this.hudListeners) {
      cb({
        currentTime: this.currentLapTime,
        lastLap: this.lastLapTime,
        bestLap: this.bestLapTime,
        speedKmh: this.car.speedKmh,
        offroad: this.car.isOffroad,
        carX: this.car.position.x,
        carZ: this.car.position.z,
        carHeading: this.car.heading,
        racers: this.racers.map((r) => ({ x: r.car.position.x, z: r.car.position.z, color: r.car.color })),
        rpm: this.car.rpm,
        fuelPercent: this.car.fuelPercent,
        oilTempC: this.car.oilTempC,
        checkEngineOn: this.car.checkEngineOn,
        lowFuel: this.car.lowFuel,
        handbrakeOn: this.car.handbrakeOn,
      });
    }

    this.raf = requestAnimationFrame(this.loop);
  };

  private updateLap(dt: number) {
    this.currentLapTime += dt;

    // Nearest-sample lookup can jump discontinuously once the car is far
    // from the track (e.g. exploring the open desert), which would
    // otherwise register as a spurious wrap-around and reset the lap timer.
    // Only track progress while close enough for the index to move
    // continuously along the loop.
    if (this.track.distanceToCenterline(this.car.position) > ROAD_WIDTH * 3) {
      return;
    }

    const idx = this.track.closestIndex(this.car.position);
    const n = this.track.samples.length;
    const nearStart = idx < n * 0.06 || idx > n * 0.94;
    const wrapped = this.prevLapIndex > n * 0.7 && idx < n * 0.3;

    if (wrapped && nearStart && this.currentLapTime > MIN_LAP_TIME) {
      this.lastLapTime = this.currentLapTime;
      if (this.bestLapTime === null || this.lastLapTime < this.bestLapTime) {
        this.bestLapTime = this.lastLapTime;
      }
      this.currentLapTime = 0;
    }
    this.prevLapIndex = idx;
  }

  /** Zooms out with speed and pulls in an extra bit under hard braking, then eases back to the base level. */
  private updateZoom(dt: number) {
    const speedTerm = this.car.speedKmh * SPEED_ZOOM_FACTOR;

    const decel = -this.car.forwardAccel;
    const decelPulse =
      decel > DECEL_ZOOM_THRESHOLD
        ? Math.min((decel - DECEL_ZOOM_THRESHOLD) * DECEL_ZOOM_FACTOR, MAX_DECEL_ZOOM_PULL)
        : 0;

    const target = THREE.MathUtils.clamp(
      BASE_VIEW_HEIGHT + speedTerm - decelPulse,
      MIN_VIEW_HEIGHT,
      MAX_VIEW_HEIGHT,
    );
    this.currentViewHeight = THREE.MathUtils.lerp(this.currentViewHeight, target, 1 - Math.pow(0.01, dt));
    this.applyFrustum(this.currentViewHeight);
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.renderer.dispose();
  }
}
