import * as THREE from "three";
import { ROAD_WIDTH, Track } from "./track";
import { buildEnvironment, type Collider } from "./environment";
import { Car } from "./car";
import { InputController } from "./input";
import { SkidMarks, SmokeEmitter } from "./effects";

const VIEW_HEIGHT = 20;
const CAMERA_OFFSET = new THREE.Vector3(24, 30, 24);
const MIN_LAP_TIME = 4;

export interface HudState {
  currentTime: number;
  lastLap: number | null;
  bestLap: number | null;
  speedKmh: number;
  offroad: boolean;
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

    this.car = new Car(this.track);
    this.scene.add(this.car.root);

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
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = Math.max(width / Math.max(height, 1), 0.1);
    const viewWidth = VIEW_HEIGHT * aspect;

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
  }

  onHudUpdate(cb: (hud: HudState) => void) {
    this.hudListeners.add(cb);
    return () => this.hudListeners.delete(cb);
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
    this.car.resolveCollisions(this.colliders);

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

    this.updateLap(dt);

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

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.input.dispose();
    this.renderer.dispose();
  }
}
