import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface CameraPose {
  pos: [number, number, number];
  target: [number, number, number];
}

const BASE_FOV = 38; // vertical on landscape; locked as HORIZONTAL fov on portrait

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private flying = false;
  private flyT = 0;
  private flyDur = 0;
  private fromPos = new THREE.Vector3();
  private toPos = new THREE.Vector3();
  private fromTarget = new THREE.Vector3();
  private toTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 800);
    this.camera.position.set(30, 34, 30);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 160;

    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(30, 60, 20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
    rim.position.set(-40, 10, -30);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x334466, 0.5));

    this.scene.add(makeStars());

    this.resize();
    window.addEventListener('resize', () => this.resize());
    // The wizard panel overlays the lower part of the screen on phones and its
    // height changes per step — re-anchor the view whenever it resizes.
    const panel = document.getElementById('panel');
    if (panel && 'ResizeObserver' in window) {
      new ResizeObserver(() => this.resize()).observe(panel);
    }
  }

  flyTo(pose: CameraPose, dur = 1.5): void {
    this.fromPos.copy(this.camera.position);
    this.fromTarget.copy(this.controls.target);
    this.toPos.set(...pose.pos);
    this.toTarget.set(...pose.target);
    this.flyT = 0;
    this.flyDur = dur;
    this.flying = true;
  }

  update(dt: number): void {
    if (this.flying) {
      this.flyT += Math.max(0, dt);
      const raw = Math.min(1, this.flyT / this.flyDur);
      const v = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      this.camera.position.lerpVectors(this.fromPos, this.toPos, v);
      this.controls.target.lerpVectors(this.fromTarget, this.toTarget, v);
      if (raw >= 1) this.flying = false;
    }
    this.controls.update();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);

    // On phones the step panel covers the bottom of the screen. Render into a
    // virtual, taller image and show its top part, so the camera target lands
    // in the center of the UNCOVERED area instead of behind the panel.
    let occlusion = 0;
    const panel = document.getElementById('panel');
    if (w <= 640 && panel && panel.offsetParent !== null) {
      const top = panel.getBoundingClientRect().top;
      occlusion = Math.round(Math.min(Math.max(0, h - top), h - 140));
    }
    const virtualH = h + occlusion;
    const aspect = w / virtualH;
    this.camera.aspect = aspect;
    // Portrait: lock the HORIZONTAL fov instead, so the watch fits the width.
    this.camera.fov =
      aspect < 1
        ? THREE.MathUtils.radToDeg(
            2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / aspect),
          )
        : BASE_FOV;
    if (occlusion > 0) this.camera.setViewOffset(w, virtualH, 0, occlusion, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }
}

function makeStars(): THREE.Points {
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 250 + Math.random() * 150;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaabbdd,
    size: 1.1,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
  });
  return new THREE.Points(geo, mat);
}
