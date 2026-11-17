import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DIAL_Y, GROUND_Y } from './watch/dimensions';

import {
  VIEWS, clearDistance, fitOf, lensFor, viewpoint,
  type CameraPose, type Fit, type KeepOut, type OrbitLimits, type Rect, type Vec3,
} from './views';

export { VIEWS, type CameraPose, type ViewName } from './views';
/** Camera azimuth the studio is composed for: the overview pose. */
const HERO_AZIMUTH = Math.atan2(
  VIEWS.overview.pos[0] - VIEWS.overview.target[0], VIEWS.overview.pos[2] - VIEWS.overview.target[2],
);
const UP = new THREE.Vector3(0, 1, 0);

/** Orbit limits that hold in every view: not straight up from below the
 * floor, and not further away than the lens keeps the watch readable. How
 * close the camera gets is decided by the keep-out volume in views.ts. */
const MAX_POLAR = Math.PI * 0.88;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 420;
/** How many times closer than its pose the camera may go. The lens of a pose
 * is long, so beyond this the picture is a patch of a millimetre or two. */
const MAX_MAGNIFICATION = 6;
/** A marked free rectangle smaller than this (CSS px) is ignored. */
const MIN_SAFE = 24;

/** Upper bound of the drawing-buffer scale; more is wasted on a 39 mm watch. */
const MAX_PIXEL_RATIO = 2;
/** Upper bound of the drawing buffer in pixels (it is multisampled, so its
 * memory is a multiple of this): desktop, and devices with a touch screen. */
const PIXEL_BUDGET = 6.0e6;
const PIXEL_BUDGET_TOUCH = 3.2e6;
/** A still picture is redrawn once at full resolution after this pause. */
const SETTLE_MS = 180;
/** Average frame time (ms) above which the moving picture gets coarser … */
const SLOW_FRAME_MS = 21;
/** … and below which it may get finer again. */
const FAST_FRAME_MS = 17.5;
/** The floor shadow follows moving parts at most this often. */
const GROUND_INTERVAL_MS = 400;
/** prepare() gives up waiting for the shader compiler after this long. */
const COMPILE_TIMEOUT_MS = 8000;

/** Counters for diagnostics (`window.__luna.sceneMgr.stats` in dev builds). */
export interface RenderStats {
  /** Frames actually drawn / render() calls that had nothing to do. */
  drawn: number;
  skipped: number;
  /** Drawing-buffer scale in use, and the one used while the picture moves. */
  pixelRatio: number;
  motionPixelRatio: number;
  /** Smoothed time between consecutive drawn frames, in ms (0 = no sample yet). */
  frameMs: number;
  /** How often the shadow map under the hands and the floor shadow were re-rendered. */
  shadowUpdates: number;
  groundUpdates: number;
}

const _offset = new THREE.Vector3();
const _pan = new THREE.Vector3();
const _orbit = new THREE.Spherical();
const _target: Vec3 = [0, 0, 0];
const _dir: Vec3 = [0, 0, 0];

/** Renderer, camera, studio lighting and shadows.
 *
 * Call update() and render() every animation frame. render() draws only when
 * the picture would differ (camera, size, or anything in the scene graph) and
 * returns within a few hundredths of a millisecond otherwise.
 *
 * The canvas may lie under headings and controls. An element with the id
 * `stage-safe` marks the part of it that is free; every pose is framed inside
 * that rectangle, with the optical centre in its middle. Without the element
 * the whole canvas counts as free. */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  /** The visitor asked for reduced motion; follows the system setting while the page is open. */
  reducedMotion: boolean;
  /** What the camera must keep out of: with the caseback off it may look up from inside the bracelet. */
  private keepOut: KeepOut = 'closed';
  /** A narrower keep-out waits until the flight under way has taken the camera out of the wider one. */
  private pendingKeepOut: KeepOut | null = null;
  readonly stats: RenderStats = {
    drawn: 0, skipped: 0, pixelRatio: 1, motionPixelRatio: 1, frameMs: 0, shadowUpdates: 0, groundUpdates: 0,
  };

  // Camera flight: the target moves in a straight line, the camera swings
  // around it, so it never cuts through the watch.
  private flying = false;
  private flyT = 0;
  private flyDur = 0;
  private readonly fromTarget = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly toPos = new THREE.Vector3();
  private readonly fromOrbit = new THREE.Spherical();
  private readonly toOrbit = new THREE.Spherical();
  private pose: CameraPose = VIEWS.overview;
  // Lens: what the free rectangle has to show, and where that rectangle is.
  private fit: Fit = fitOf(VIEWS.overview);
  private fitFrom: Fit = this.fit;
  private fitTo: Fit = this.fit;
  private readonly size = { width: 1, height: 1 };
  private safe: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private safeElement: HTMLElement | null = null;
  private readonly observer: ResizeObserver;
  // Keep-out: the distance the visitor asked for and the one last granted.
  private wantDistance = 0;
  private lastDistance = 0;

  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly keyHome = direction(KEY_AZIMUTH, 50).multiplyScalar(70).add(new THREE.Vector3(0, DIAL_Y, 0));
  private readonly fillHome = direction(70, 32).multiplyScalar(70);
  private readonly ground: GroundShadow;
  /** Objects of the rig itself; they are neither hashed nor given shadows. */
  private readonly rig = new Set<THREE.Object3D>();
  /** Meshes that cast into the shadow map, and the groups above them. */
  private readonly casters = new Set<THREE.Object3D>();

  // Render on demand.
  private dirty = true;
  private frame = 0;
  private lastDrawFrame = -2;
  private lastDrawTime = 0;
  private streak = 0;
  // Change detection over the scene graph.
  private signature = NaN;
  private layoutSignature = NaN;
  private casterSignature = NaN;
  private hash = 0;
  private layoutHash = 0;
  private casterHash = 0;
  private nodes = 0;
  private knownNodes = -1;
  // Shadows follow the model, not the camera.
  private groundStale = true;
  private groundTime = -1e9;
  private shadowTurn = NaN;
  // Adaptive resolution.
  private fixedRatio: number | null = null;
  private maxRatio = 0;
  private motionRatio = 1;
  private ratioCeiling = 1;
  private samples = 0;
  private devicePixelRatio = 0;
  private readonly touch = window.matchMedia('(pointer: coarse)').matches;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.buildEnvironment();
    this.camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
    this.camera.position.set(...VIEWS.overview.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...VIEWS.overview.target);
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = false;
    this.controls.maxDistance = MAX_DISTANCE;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.addEventListener('start', () => {
      if (this.flying) { this.flying = false; this.limit(undefined); }
      this.applyPendingKeepOut();
    });
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.wantDistance = this.lastDistance = this.camera.position.distanceTo(this.controls.target);
    this.limit(this.pose.limits, this.lastDistance / MAX_MAGNIFICATION);

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = motion.matches;
    this.controls.enableDamping = !motion.matches;
    motion.addEventListener('change', () => {
      this.reducedMotion = motion.matches;
      this.controls.enableDamping = !motion.matches;
      if (motion.matches && this.flying) this.arrive();
    });

    // The environment lights the steel. The key adds what an environment
    // cannot: a travelling sheen on the dial and real shadows under the hands.
    this.key = new THREE.DirectionalLight(0xfff6ea, KEY_INTENSITY);
    this.key.position.copy(this.keyHome);
    this.key.target.position.set(0, DIAL_Y, 0);
    this.key.castShadow = true;
    const shadow = this.key.shadow;
    shadow.mapSize.setScalar(this.touch ? 1024 : 2048);
    // The map only spans the dial opening, where shadows are readable; the
    // far plane leaves room for the lifted parts of the exploded view.
    shadow.camera.left = shadow.camera.bottom = -25;
    shadow.camera.right = shadow.camera.top = 25;
    shadow.camera.near = 30;
    shadow.camera.far = 110;
    shadow.bias = -0.0006;
    shadow.normalBias = 0.03;
    shadow.radius = this.touch ? 1.6 : 2.6;
    this.fill = new THREE.DirectionalLight(0xdfeaff, FILL_INTENSITY);
    this.fill.position.copy(this.fillHome);
    this.ground = new GroundShadow();
    this.scene.add(this.key, this.key.target, this.fill, this.ground.mesh);
    this.rig.add(this.key).add(this.key.target).add(this.fill).add(this.ground.mesh);

    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.dirty = true; });
    // A resize reallocates the drawing buffer, which empties the canvas. The
    // observer runs after layout and before paint, so drawing here puts the
    // new picture into the very frame that shows the new size.
    const relayout = (): void => {
      if (this.resize() && this.stats.drawn > 0) this.present(performance.now(), true);
    };
    this.observer = new ResizeObserver(relayout);
    this.observer.observe(canvas.parentElement!);
    // The free rectangle can move without the canvas changing size.
    window.addEventListener('resize', relayout);
    this.resize();
  }

  /** Move the camera to a pose. The lens follows, so the subject of the pose
   * fills the free part of the stage. */
  flyTo(pose: CameraPose, dur = 1.3): void {
    this.controls.autoRotate = false;
    this.settle();
    this.dirty = true;
    this.pose = pose;
    this.controls.enablePan = false;
    const { pos, target } = viewpoint(pose, this.safe.width < this.safe.height);
    this.fitTo = fitOf(pose, pos, target);
    this.toPos.set(...pos);
    this.toTarget.set(...target);
    this.toOrbit.setFromVector3(_offset.subVectors(this.toPos, this.toTarget));
    // No per-view limits on the way: a flight must not be clamped half-way.
    this.limit({ polar: [0, 180] });
    if (this.reducedMotion || dur <= 0) { this.arrive(); return; }
    this.fromTarget.copy(this.controls.target);
    this.fromOrbit.setFromVector3(_offset.subVectors(this.camera.position, this.controls.target));
    // The shorter way round.
    const turn = this.toOrbit.theta - this.fromOrbit.theta;
    this.toOrbit.theta = this.fromOrbit.theta + turn - Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
    this.fitFrom = this.fit;
    this.flyT = 0;
    this.flyDur = dur;
    this.flying = true;
  }

  /** Set what the camera must keep out of. Call it after flyTo(): a keep-out that would push the
   * camera out of where it stands only applies once the flight has arrived. */
  setKeepOut(keepOut: KeepOut): void {
    if (this.flying && keepOut === 'closed' && this.keepOut !== 'closed') { this.pendingKeepOut = keepOut; return; }
    this.pendingKeepOut = null;
    if (keepOut === this.keepOut) return;
    this.keepOut = keepOut;
    this.dirty = true;
  }

  /** Turn the camera around its target by hand, in degrees: `azimuth` to the
   * right (counter-clockwise seen from above), `polar` upwards, towards the
   * top view. Stays within the limits of the current view. */
  orbitBy(azimuth: number, polar: number): void {
    this.interrupt();
    const { camera, controls } = this;
    _orbit.setFromVector3(_offset.subVectors(camera.position, controls.target));
    _orbit.theta += THREE.MathUtils.degToRad(azimuth);
    _orbit.phi = THREE.MathUtils.clamp(_orbit.phi - THREE.MathUtils.degToRad(polar), 0.001, Math.PI - 0.001);
    camera.position.setFromSpherical(_orbit).add(controls.target);
    this.reframe();
  }

  /** Move the camera towards its target (`factor` > 1 magnifies) or away from
   * it, as far as the watch and the limits of the current view allow. */
  zoomBy(factor: number): void {
    if (!(factor > 0)) return;
    this.interrupt();
    const { camera, controls } = this;
    _offset.subVectors(camera.position, controls.target);
    const distance = THREE.MathUtils.clamp(_offset.length() / factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(_offset.setLength(distance));
    this.reframe();
  }

  update(dt: number): void {
    const { camera, controls } = this;
    // Auto-rotation is a full turn; a view that confines the camera to one side would stall it.
    if (controls.autoRotate && Number.isFinite(controls.minAzimuthAngle)) {
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
    }
    if (this.flying) {
      this.flyT += Math.max(0, dt);
      const t = Math.min(1, this.flyT / this.flyDur);
      if (t >= 1) {
        this.arrive();
      } else {
        const v = t * t * t * (t * (t * 6 - 15) + 10);
        const from = this.fromOrbit;
        const to = this.toOrbit;
        controls.target.lerpVectors(this.fromTarget, this.toTarget, v);
        _orbit.set(from.radius * (to.radius / from.radius) ** v, from.phi + (to.phi - from.phi) * v, from.theta + (to.theta - from.theta) * v);
        camera.position.setFromSpherical(_orbit.makeSafe()).add(controls.target);
        const a = this.fitFrom;
        const b = this.fitTo;
        this.fit = { x: a.x * (b.x / a.x) ** v, y: a.y * (b.y / a.y) ** v, margin: a.margin + (b.margin - a.margin) * v };
        this.applyLens();
      }
      this.dirty = true;
    }
    controls.update(dt);
    this.clampPan();
    this.guard();
  }

  /** A pose that allows panning keeps its target on its own level and within `pan` of where it began;
   * camera and target move together, so the view direction stays as the visitor left it. */
  private clampPan(): void {
    const reach = this.pose.pan ?? 0;
    if (reach <= 0 || this.flying) return;
    const { camera, controls } = this;
    const home = this.toTarget;
    _pan.subVectors(controls.target, home);
    _pan.y = 0;
    const r = Math.hypot(_pan.x, _pan.z);
    if (r > reach) _pan.multiplyScalar(reach / r);
    _pan.add(home).sub(controls.target);
    if (_pan.lengthSq() < 1e-12) return;
    controls.target.add(_pan);
    camera.position.add(_pan);
    this.dirty = true;
  }

  /** Request a redraw. Moving, showing or hiding objects, fading or recolouring
   * a material and updating its `map` are noticed automatically; call this
   * for anything else (shader uniforms, other textures, geometry edits). */
  invalidate(): void { this.dirty = true; }

  /** Measure the stage again. Size changes of the canvas and of `#stage-safe`
   * are noticed automatically; call this when the free rectangle only moved. */
  refit(): void {
    if (this.resize() && this.stats.drawn > 0) this.present(performance.now(), true);
  }

  /** Compile every shader of the scene before the first frame, without
   * blocking the page where the browser can do that in the background
   * (KHR_parallel_shader_compile). Add the model first. Settles when the first
   * frame can be drawn without a long stall, or after a few seconds; never rejects. */
  async prepare(): Promise<void> {
    try {
      // Without the extension nothing reports when the compiler is done, and the first frame waits for it all the same.
      if (this.renderer.getContext().isContextLost() || !this.renderer.extensions.has('KHR_parallel_shader_compile')) return;
      // Receiving shadows is a property of the program, so the flags come first.
      this.assignShadows();
      let timer = 0;
      const compiled = this.renderer.compileAsync(this.scene, this.camera);
      const timeout = new Promise<void>(resolve => { timer = window.setTimeout(resolve, COMPILE_TIMEOUT_MS); });
      // A failure after the timeout has nobody waiting for it any more.
      compiled.catch(() => undefined);
      await Promise.race([compiled, timeout]);
      clearTimeout(timer);
    } catch (error) {
      console.warn('Shader warm-up failed; the first frame compiles them instead.', error);
    }
    this.dirty = true;
  }

  /** Compile the shaders of `object` (already in the scene, visible or not) before it first shows,
   * off the main thread where the browser can. Settles when they are ready, or after a few seconds. */
  async prepareObject(object: THREE.Object3D): Promise<void> {
    try {
      if (this.renderer.getContext().isContextLost() || !this.renderer.extensions.has('KHR_parallel_shader_compile')) return;
      let timer = 0;
      const compiled = this.renderer.compileAsync(object, this.camera, this.scene);
      const timeout = new Promise<void>(resolve => { timer = window.setTimeout(resolve, COMPILE_TIMEOUT_MS); });
      compiled.catch(() => undefined);
      await Promise.race([compiled, timeout]);
      clearTimeout(timer);
    } catch (error) {
      console.warn('Shader warm-up failed; the first frame compiles them instead.', error);
    }
  }

  /** Render the studio into the reflection environment. Its contents do not survive a lost WebGL context. */
  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const studio = makeStudio();
    this.scene.environment?.dispose();
    this.scene.environment = pmrem.fromScene(studio, 0, 0.1, 100).texture;
    studio.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    pmrem.dispose();
  }

  /** Call after the browser restored a lost WebGL context: everything that
   * lived on the graphics card only (environment, both shadows, the drawing
   * buffer) is made again. */
  restore(): void {
    this.buildEnvironment();
    this.groundTime = -1e9;
    this.refreshShadows();
    this.resize(true);
  }

  /** Re-render the shadows on the next frame, e.g. after geometry was edited in place. */
  refreshShadows(): void {
    this.knownNodes = -1;
    this.dirty = true;
  }

  /** Pin the drawing-buffer scale (for tests and screenshots), or hand it back
   * to the frame-time governor with 'auto'. */
  setPixelRatio(ratio: number | 'auto'): void {
    this.fixedRatio = ratio === 'auto' ? null : ratio;
    this.dirty = true;
  }

  /** Called every animation frame; draws only if the picture would differ. */
  render(): void {
    this.frame++;
    if (document.hidden) return;
    // Browser zoom and a move to another monitor change the pixel ratio; the
    // second one comes without a resize, and not every browser reports it
    // through a media query.
    if ((window.devicePixelRatio || 1) !== this.devicePixelRatio) this.resize();
    this.present(performance.now(), false);
  }

  /** Draws a frame if one is due, or in any case when `forced` (the drawing
   * buffer was just reallocated and is empty). */
  private present(now: number, forced: boolean): void {
    if (this.sceneChanged() || forced) this.dirty = true;
    const stillRatio = this.fixedRatio ?? this.maxRatio;
    if (!this.dirty) {
      // Nothing moved: sharpen a picture that was drawn coarser while moving
      // and catch up on the floor shadow, then rest.
      const settled = now - this.lastDrawTime > SETTLE_MS;
      const sharpen = settled && this.renderer.getPixelRatio() !== stillRatio;
      const reshadow = this.groundStale && now - this.groundTime > GROUND_INTERVAL_MS;
      if (!sharpen && !reshadow) { this.stats.skipped++; return; }
    }
    this.dirty = false;

    let ratio = stillRatio;
    if (!forced) {
      const consecutive = this.lastDrawFrame === this.frame - 1;
      this.streak = consecutive ? this.streak + 1 : 0;
      if (consecutive) this.govern(now - this.lastDrawTime);
      // Single frames (a ticking seconds hand, a settled camera) are drawn at
      // full resolution; only an unbroken run of frames uses the governed one.
      if (this.fixedRatio === null && this.streak >= 2) ratio = this.motionRatio;
      this.lastDrawFrame = this.frame;
    }
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);

    this.aimStudio();
    if (this.nodes !== this.knownNodes) {
      this.knownNodes = this.nodes;
      this.assignShadows();
      // Fingerprint again with the new set of casters, or the next frame would see a change.
      this.sceneChanged();
      this.groundStale = true;
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (this.groundStale && now - this.groundTime > GROUND_INTERVAL_MS) {
      this.groundStale = false;
      this.groundTime = now;
      this.ground.update(this.renderer, this.scene);
      this.stats.groundUpdates++;
    }
    if (this.renderer.shadowMap.needsUpdate) this.stats.shadowUpdates++;
    this.renderer.getDrawingBufferSize(this.ground.frame);
    this.renderer.render(this.scene, this.camera);
    this.lastDrawTime = now;
    this.stats.drawn++;
    this.stats.pixelRatio = ratio;
    this.stats.motionPixelRatio = this.motionRatio;
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  /** The flight is over: the camera stands exactly on the pose and the limits of the view hold. */
  private arrive(): void {
    this.flying = false;
    this.applyPendingKeepOut();
    this.controls.target.copy(this.toTarget);
    this.camera.position.copy(this.toPos);
    this.fit = this.fitTo;
    this.applyLens();
    this.limit(this.pose.limits, Math.max(MIN_DISTANCE, this.toOrbit.radius / MAX_MAGNIFICATION));
    this.controls.enablePan = (this.pose.pan ?? 0) > 0;
    this.controls.update();
    this.wantDistance = this.lastDistance = this.camera.position.distanceTo(this.controls.target);
    this.guard();
    this.dirty = true;
  }

  /** The visitor takes over from a flight, by pointer (the controls' start event) or by key. */
  private interrupt(): void {
    if (this.flying) { this.flying = false; this.limit(undefined); }
    this.applyPendingKeepOut();
    this.settle();
  }

  private applyPendingKeepOut(): void {
    if (!this.pendingKeepOut) return;
    this.keepOut = this.pendingKeepOut;
    this.pendingKeepOut = null;
  }

  /** Let the controls clamp a camera that was moved by hand, then keep it out of the watch. */
  private reframe(): void {
    this.controls.update();
    this.guard();
    this.dirty = true;
  }

  /** Drop what is left of a drag's inertia, so it cannot push the camera off a pose. */
  private settle(): void {
    const controls = this.controls;
    if (!controls.enableDamping) return;
    // Undamped, the controls apply the rest of the movement at once and forget it.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
  }

  private limit(limits: OrbitLimits | undefined, closest = MIN_DISTANCE): void {
    const controls = this.controls;
    const rad = THREE.MathUtils.degToRad;
    controls.minAzimuthAngle = limits?.azimuth ? rad(limits.azimuth[0]) : -Infinity;
    controls.maxAzimuthAngle = limits?.azimuth ? rad(limits.azimuth[1]) : Infinity;
    controls.minPolarAngle = limits?.polar ? rad(limits.polar[0]) : 0;
    controls.maxPolarAngle = limits?.polar ? rad(limits.polar[1]) : MAX_POLAR;
    controls.minDistance = closest;
  }

  /** Keeps the camera outside the watch. Orbiting slides it along the outside
   * of the keep-out volume and back to the distance the visitor chose. */
  private guard(): void {
    const { camera, controls } = this;
    _offset.subVectors(camera.position, controls.target);
    const distance = _offset.length();
    if (distance < 1e-6) return;
    // A distance that is not the one granted last was chosen by the visitor
    // (or by a flight). Zooming in against the keep-out leaves the wish as it is.
    if (Math.abs(distance - this.lastDistance) > 1e-4) {
      this.wantDistance = this.flying || distance > this.lastDistance ? distance : Math.min(this.wantDistance, distance);
    }
    _offset.divideScalar(distance);
    controls.target.toArray(_target);
    _offset.toArray(_dir);
    const granted = Math.min(MAX_DISTANCE, clearDistance(_target, _dir, this.wantDistance, this.keepOut));
    if (Math.abs(granted - distance) > 1e-4) {
      camera.position.copy(controls.target).addScaledVector(_offset, granted);
      this.dirty = true;
    }
    this.lastDistance = granted;
  }

  /** Field of view and optical centre for the current fit and free rectangle. */
  private applyLens(): void {
    const { width, height } = this.size;
    const camera = this.camera;
    const lens = lensFor(this.fit, this.size, this.safe);
    camera.aspect = width / height;
    camera.fov = lens.fov;
    // The picture is a window of the same size as the canvas, shifted so that
    // the optical centre lands in the middle of the free rectangle.
    if (lens.offsetX === 0 && lens.offsetY === 0) camera.clearViewOffset();
    else camera.setViewOffset(width, height, -lens.offsetX, -lens.offsetY, width, height);
    camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Canvas size and the free rectangle on it, in CSS pixels. Returns whether either changed. */
  private measure(): boolean {
    const box = this.renderer.domElement.parentElement!.getBoundingClientRect();
    // A hidden stage (text guide shown) keeps the last size and its drawing buffer.
    if (box.width < 1 || box.height < 1) return false;
    const { width, height } = box;
    const element = document.getElementById('stage-safe');
    if (element !== this.safeElement) {
      if (this.safeElement) this.observer.unobserve(this.safeElement);
      if (element) this.observer.observe(element);
      this.safeElement = element;
    }
    let x = 0, y = 0, w = width, h = height;
    if (element) {
      const free = element.getBoundingClientRect();
      const left = Math.max(free.left, box.left), top = Math.max(free.top, box.top);
      const right = Math.min(free.right, box.right), bottom = Math.min(free.bottom, box.bottom);
      if (right - left >= MIN_SAFE && bottom - top >= MIN_SAFE) {
        x = left - box.left; y = top - box.top; w = right - left; h = bottom - top;
      }
    }
    const { size, safe } = this;
    if (size.width === width && size.height === height && safe.x === x && safe.y === y && safe.width === w && safe.height === h) return false;
    size.width = width;
    size.height = height;
    this.safe = { x, y, width: w, height: h };
    return true;
  }

  /** Follows the layout and the screen. Returns whether the drawing buffer was
   * reallocated, which leaves the canvas empty until the next draw. */
  private resize(force = false): boolean {
    const moved = this.measure();
    const { width, height } = this.size;
    const budget = this.touch ? PIXEL_BUDGET_TOUCH : PIXEL_BUDGET;
    const device = this.devicePixelRatio = window.devicePixelRatio || 1;
    // Never coarser than one buffer pixel per CSS pixel because of the budget.
    const maxRatio = Math.min(device, MAX_PIXEL_RATIO, Math.max(1, Math.sqrt(budget / (width * height))));
    let reallocated = false;
    if (maxRatio !== this.maxRatio) {
      this.maxRatio = this.motionRatio = this.ratioCeiling = maxRatio;
      this.samples = 0;
      const ratio = this.fixedRatio ?? maxRatio;
      if (this.renderer.getPixelRatio() !== ratio) { this.renderer.setPixelRatio(ratio); reallocated = true; }
    }
    const buffer = this.renderer.getSize(_bufferSize);
    if (force || buffer.x !== width || buffer.y !== height) {
      this.renderer.setSize(width, height, false);
      reallocated = true;
    }
    if (moved || reallocated) this.applyLens();
    return reallocated;
  }

  // ── Studio and shadows ────────────────────────────────────────────────────

  /** The studio turns with the camera, as if the watch lay on a turntable in
   * front of a fixed camera and fixed lights. Every side of the watch is seen
   * in the light the overview was composed for, and reflections glide over
   * the steel while it is turned. */
  private aimStudio(): void {
    const turn = this.controls.getAzimuthalAngle() - HERO_AZIMUTH;
    this.scene.environmentRotation.y = turn;
    this.key.position.copy(this.keyHome).applyAxisAngle(UP, turn);
    this.fill.position.copy(this.fillHome).applyAxisAngle(UP, turn);
    this.ground.lean(turn);
    // Shadows under the hands follow in steps too small to see.
    if (!(Math.abs(Math.sin((turn - this.shadowTurn) / 2)) < 0.006)) {
      this.shadowTurn = turn;
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  /** Lowers the resolution of the moving picture while frames arrive late and
   * raises it again, never back to a scale that already proved too slow. */
  private govern(frameMs: number): void {
    if (frameMs > 250) return; // a hitch (shader compile, tab switch), not a trend
    const s = this.stats;
    s.frameMs = s.frameMs === 0 ? frameMs : s.frameMs + (frameMs - s.frameMs) * 0.08;
    this.samples++;
    const minRatio = Math.min(1, this.maxRatio);
    if (this.samples >= 24 && s.frameMs > SLOW_FRAME_MS && this.motionRatio > minRatio) {
      this.ratioCeiling = this.motionRatio * 0.93;
      this.motionRatio = Math.max(minRatio, Math.round(this.motionRatio * 0.8 * 20) / 20);
      this.samples = 0;
      s.frameMs = 0;
    } else if (this.samples >= 120 && s.frameMs < FAST_FRAME_MS && this.motionRatio < this.ratioCeiling) {
      this.motionRatio = Math.min(this.ratioCeiling, this.motionRatio * 1.12);
      this.samples = 0;
    } else if (this.samples >= 600 && s.frameMs < FAST_FRAME_MS && this.ratioCeiling < this.maxRatio) {
      // Ten smooth seconds at the ceiling: the slowdown may have been temporary.
      this.ratioCeiling = Math.min(this.maxRatio, this.ratioCeiling * 1.1);
      this.samples = 120;
    }
  }

  /** Cheap fingerprint of everything that usually changes a watch picture:
   * transforms and visibility of the whole graph, opacity, colours and the
   * `map` texture version of every mesh material. */
  private sceneChanged(): boolean {
    this.hash = 0;
    this.layoutHash = 0;
    this.casterHash = 0;
    this.nodes = 0;
    const children = this.scene.children;
    for (let i = 0; i < children.length; i++) if (!this.rig.has(children[i])) this.hashNode(children[i]);
    // The floor shadow only follows parts that move or appear, not ones that
    // turn on the spot (hands, crown, calendar discs).
    if (this.layoutHash !== this.layoutSignature) this.groundStale = true;
    this.layoutSignature = this.layoutHash;
    // The shadow map only follows what casts into it.
    if (this.casterHash !== this.casterSignature) this.renderer.shadowMap.needsUpdate = true;
    this.casterSignature = this.casterHash;
    const changed = this.hash !== this.signature;
    this.signature = this.hash;
    return changed;
  }

  private hashNode(o: THREE.Object3D): void {
    const k = ++this.nodes;
    const p = o.position;
    const q = o.quaternion;
    const s = o.scale;
    // Rounded to a few micrometres and hundredths of a degree: hands creeping
    // by less than a fraction of a pixel do not cost a frame.
    const size = Math.round((s.x + s.y * 3 + s.z * 7) * 2000) * 17.9 + (o.visible ? 29.7 : 0);
    let h = Math.round(p.x * 500) * 1.13 + Math.round(p.y * 500) * 2.71 + Math.round(p.z * 500) * 3.37 + size
      + Math.round(q.x * 4000) * 5.11 + Math.round(q.y * 4000) * 7.13
      + Math.round(q.z * 4000) * 11.7 + Math.round(q.w * 4000) * 13.3;
    // The floor shadow is blurred over centimetres: it follows in millimetre steps.
    const layout = Math.round(p.x) * 1.13 + Math.round(p.y) * 2.71 + Math.round(p.z) * 3.37 + size;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const m = mesh.material as HashedMaterial | HashedMaterial[];
      if (!Array.isArray(m)) {
        h += Math.round(m.opacity * 250) * 31.1 + (m.visible ? 37.3 : 0) + (m.map ? m.map.version * 41.9 : 0)
          + Math.round((m.emissiveIntensity ?? 0) * 250) * 43.7;
        if (m.color) h += Math.round((m.color.r + m.color.g * 2 + m.color.b * 4) * 500) * 53.9;
        if (m.emissive) h += Math.round((m.emissive.r + m.emissive.g * 2 + m.emissive.b * 4) * 500) * 59.3;
      }
      const instances = (mesh as THREE.InstancedMesh).instanceMatrix;
      if (instances) h += instances.version * 47.3;
    }
    const weight = 1 + k * 0.6180339887;
    this.hash += h * weight;
    this.layoutHash += layout * weight;
    // Nothing under a hidden node can change the picture; its own visible flag is in the hash.
    if (!o.visible) return;
    if (this.casters.has(o)) this.casterHash += h * weight;
    const children = o.children;
    for (let i = 0; i < children.length; i++) this.hashNode(children[i]);
  }

  /** Decides who casts and who receives the key light's shadows. Part modules
   * need not care: everything opaque inside the dial opening casts, everything
   * that is not bare metal receives (metal shows reflections, not shadows).
   * A mesh opts out with `userData.lunaShadow = false`. */
  private assignShadows(): void {
    this.scene.updateMatrixWorld();
    this.casters.clear();
    const well = new THREE.Box3(new THREE.Vector3(-18, DIAL_Y - 1.2, -18), new THREE.Vector3(18, DIAL_Y + 2.6, 18));
    const box = new THREE.Box3();
    const centre = new THREE.Vector3();
    const visit = (o: THREE.Object3D): void => {
      if (this.rig.has(o)) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.lunaShadow !== false) {
        const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as HashedMaterial;
        const instanced = mesh as THREE.InstancedMesh;
        if (instanced.isInstancedMesh) {
          if (!instanced.boundingBox) instanced.computeBoundingBox();
          box.copy(instanced.boundingBox!);
        } else {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          box.copy(mesh.geometry.boundingBox!);
        }
        box.applyMatrix4(mesh.matrixWorld);
        const solid = !m.transparent && m.opacity >= 1 && !((m.transmission ?? 0) > 0) && m.depthWrite;
        // The centre counts: a crown whose stem reaches under the dial casts nothing there.
        mesh.castShadow = solid && well.containsPoint(box.getCenter(centre));
        mesh.receiveShadow = solid && 'roughness' in m && (m.metalness ?? 0) < 0.9;
        if (mesh.castShadow) for (let node: THREE.Object3D | null = mesh; node; node = node.parent) this.casters.add(node);
      }
      for (const child of o.children) visit(child);
    };
    visit(this.scene);
  }
}

const _bufferSize = new THREE.Vector2();

/** The material properties the change detection and the shadow assignment read. */
interface HashedMaterial extends THREE.Material {
  map?: THREE.Texture | null;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  metalness?: number;
  transmission?: number;
}

// ── Studio ──────────────────────────────────────────────────────────────────
//
// Directions are given as azimuth/elevation in degrees. Azimuth 0 looks from
// the watch towards the viewer's side (six o'clock, +Z), 90 towards the crown
// (+X), ±180 towards twelve; elevation 90 is straight above the dial.

const KEY_AZIMUTH = -114;
/** Key and fill lamp. The environment does most of the lighting; the lamps
 * are tuned for the dial's sheen and the shadows of the hands. */
const KEY_INTENSITY = 2.6;
const FILL_INTENSITY = 0.55;
const EXPOSURE = 1;

function direction(azimuth: number, elevation: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuth);
  const el = THREE.MathUtils.degToRad(elevation);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

interface Panel {
  azimuth: number;
  elevation: number;
  /** Half extent in degrees: across (horizontal) and up. */
  width: number;
  height: number;
  /** Radiance at the centre; display white is about 1.25 on polished steel. */
  power: number;
  tint?: [number, number, number];
  /** How much the panel darkens towards its rim (0 = even, 1 = to black). */
  falloff?: number;
  /** Softness of the edge in degrees. */
  feather?: number;
}

/** Softboxes, in painting order. Their rims are soft and their centres hot,
 * so polished steel shows gradients instead of flat white patches. */
const SOFTBOXES: Panel[] = [
  // Overhead diffuser: what flat, upward-facing steel mirrors in the dial view.
  // Small and hot: polished flats mirror it white, satin tops average it with
  // the room around it and stay a calm grey.
  { azimuth: -120, elevation: 87, width: 17, height: 17, power: 1.7, falloff: 0.35, feather: 4 },
  // Key, behind the left shoulder of the watch: a wide dim glow whose upper
  // rim fades slowly (flat lug and link tops pick up a gradient from it) …
  { azimuth: -146, elevation: 41, width: 40, height: 19, power: 0.8, tint: [1, 0.985, 0.96], falloff: 0.3, feather: 8 },
  // … around a hot core.
  { azimuth: -142, elevation: 34, width: 30, height: 11, power: 2.4, tint: [1, 0.985, 0.96], falloff: 0.5, feather: 2.5 },
  // Strip on the crown side: one clean vertical highlight on flanks and bezel.
  { azimuth: 76, elevation: 27, width: 6.5, height: 27, power: 2.0, tint: [0.94, 0.97, 1], falloff: 0.35, feather: 1.6 },
  // Low front fill, warm: lifts the faces turned to the viewer.
  { azimuth: 6, elevation: 17, width: 25, height: 8, power: 0.95, tint: [1, 0.96, 0.9], falloff: 0.5, feather: 2.5 },
  // Its neighbour towards the crown side: with the strip and the kicker it
  // closes a ring of lights around the watch, broken by the dark gaps that a
  // polished bezel needs to show its roundness.
  { azimuth: 50, elevation: 21, width: 11, height: 10, power: 1.4, tint: [1, 0.98, 0.95], falloff: 0.4, feather: 2 },
  // Kicker behind the crown side: sparkle on far edges.
  { azimuth: 146, elevation: 20, width: 12, height: 15, power: 2.6, falloff: 0.4, feather: 1.6 },
  // Low strip on the left: keeps the nine o'clock flank alive.
  { azimuth: -70, elevation: 15, width: 18, height: 9, power: 1.25, tint: [0.96, 0.98, 1], falloff: 0.4, feather: 1.6 },
  // Bounce card on the floor in front: a soft glow on downward-turned faces.
  { azimuth: 25, elevation: -38, width: 30, height: 12, power: 0.62, tint: [1, 0.98, 0.95], falloff: 0.7, feather: 6 },
  // Bounce card low on the crown side: the crown's cap and the tucked-under
  // edge of the flank mirror it instead of the bare floor.
  { azimuth: 110, elevation: -23, width: 21, height: 9, power: 1.05, tint: [1, 0.98, 0.95], falloff: 0.55, feather: 5 },
  // Light table straight below: the caseback is not a black hole when the
  // watch is turned over.
  { azimuth: 0, elevation: -90, width: 26, height: 26, power: 0.8, falloff: 0.6, feather: 6 },
  { azimuth: -60, elevation: -66, width: 17, height: 3.5, power: 1.7, tint: [0.96, 0.98, 1], falloff: 0.4, feather: 1.6 },
  // Low softbox behind the watch, the key's counterpart below the horizon: seen
  // from underneath, caseback and clasp mirror its gradient instead of the dark floor.
  { azimuth: -150, elevation: -43, width: 36, height: 15, power: 1.2, tint: [0.97, 0.985, 1], falloff: 0.6, feather: 7 },
];

/** Black cards between the lights: they draw the dark lines that give steel its edges. */
const FLAGS: Panel[] = [
  { azimuth: -28, elevation: 32, width: 16, height: 26, power: 0.012, feather: 1.5 },
  // The same card continued on the floor: seen from above, the outer slope of
  // the bezel mirrors the floor, and this is its one dark band.
  { azimuth: -28, elevation: -24, width: 15, height: 20, power: 0.015, feather: 2 },
  { azimuth: 112, elevation: 30, width: 11, height: 26, power: 0.012, feather: 1.5 },
  { azimuth: -178, elevation: 12, width: 12, height: 7, power: 0.012, feather: 1.5 },
  { azimuth: 40, elevation: 46, width: 16, height: 5, power: 0.015, feather: 1.5 },
  { azimuth: 115, elevation: -70, width: 14, height: 4, power: 0.02, feather: 1.5 },
];

function panelCall(p: Panel): string {
  const c = direction(p.azimuth, p.elevation);
  const u = new THREE.Vector3(0, 1, 0).cross(c);
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
  u.normalize();
  const v = c.clone().cross(u);
  const vec = (x: THREE.Vector3) => `vec3(${x.x.toFixed(5)}, ${x.y.toFixed(5)}, ${x.z.toFixed(5)})`;
  const tan = (deg: number) => Math.tan(THREE.MathUtils.degToRad(deg)).toFixed(5);
  const [r, g, b] = (p.tint ?? [1, 1, 1]).map(t => (t * p.power).toFixed(4));
  return `col = panel( col, d, ${vec(c)}, ${vec(u)}, ${vec(v)}, vec2(${tan(p.width)}, ${tan(p.height)}), ${tan(p.feather ?? 2)}, vec3(${r}, ${g}, ${b}), ${(p.falloff ?? 0).toFixed(3)} );`;
}

/** A procedural photo studio, rendered once into the reflection environment:
 * a grey room over a light floor sweep, softboxes and black flags. Everything is
 * analytic, so there are no texture seams and no aliased edges. */
function makeStudio(): THREE.Scene {
  const keySide = direction(KEY_AZIMUTH - 30, 0);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;

      // A rounded rectangle on the plane facing direction c, with a soft rim.
      vec3 panel( vec3 col, vec3 d, vec3 c, vec3 u, vec3 v, vec2 size, float feather, vec3 light, float falloff ) {
        float facing = dot( d, c );
        if ( facing < 0.05 ) return col;
        vec2 q = vec2( dot( d, u ), dot( d, v ) ) / facing;
        float corner = min( size.x, size.y ) * 0.4;
        vec2 e = abs( q ) - size + corner;
        float sd = length( max( e, 0.0 ) ) + min( max( e.x, e.y ), 0.0 ) - corner;
        float mask = 1.0 - smoothstep( - feather, feather, sd );
        vec2 n = q / size;
        float profile = 1.0 - falloff * clamp( dot( n, n ) * 0.5, 0.0, 1.0 );
        return mix( col, light * profile, mask );
      }

      void main() {
        vec3 d = normalize( vDir );
        // Room: a light floor sweep that darkens under the watch, walls darker than
        // the sweep, brighter towards the ceiling and on the key side, and a dark
        // seam where the two meet.
        vec3 ground = mix( vec3( 0.09, 0.093, 0.1 ), vec3( 0.5, 0.495, 0.487 ), smoothstep( - 1.0, - 0.06, d.y ) );
        vec3 wall = mix( vec3( 0.14, 0.144, 0.153 ), vec3( 0.3, 0.3, 0.303 ), smoothstep( 0.03, 0.8, d.y ) );
        wall *= 0.82 + 0.18 * dot( normalize( d.xz + 1e-5 ), vec2( ${keySide.x.toFixed(4)}, ${keySide.z.toFixed(4)} ) );
        vec3 col = mix( ground, wall, smoothstep( - 0.035, 0.035, d.y ) );
        col *= 1.0 - 0.8 * ( 1.0 - smoothstep( 0.0, 0.075, abs( d.y - 0.012 ) ) );
        ${SOFTBOXES.map(panelCall).join('\n        ')}
        ${FLAGS.map(panelCall).join('\n        ')}
        gl_FragColor = vec4( col, 1.0 );
      }`,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20), material));
  return scene;
}

// ── Floor shadow ────────────────────────────────────────────────────────────

/** Side length of the square shadow catcher, in millimetres. */
const GROUND_SIZE = 190;
/** Everything up to this height above the floor darkens it. */
const GROUND_REACH = 68;
const GROUND_RESOLUTION = 256;

/** Soft shadow on the invisible floor under the watch: the scene is rendered
 * once from below into a small height map, which is blurred twice — tightly
 * where something touches the floor, widely for everything hovering above it.
 * Works for any geometry and is refreshed only when the model changes. */
class GroundShadow {
  readonly mesh: THREE.Mesh;
  private readonly eye = new THREE.OrthographicCamera(
    -GROUND_SIZE / 2, GROUND_SIZE / 2, GROUND_SIZE / 2, -GROUND_SIZE / 2, 0, GROUND_REACH,
  );
  private readonly heightMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blurScene = new THREE.Scene();
  private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Size of the drawing buffer in pixels; the shadow fades towards its border. */
  readonly frame = new THREE.Vector2(1, 1);
  private targetA = makeGroundTarget();
  private targetB = makeGroundTarget();
  private readonly clearColor = new THREE.Color();

  constructor() {
    // Looking straight up from the floor: image x = watch X, image y = watch Z.
    this.eye.position.set(0, GROUND_Y, 0);
    this.eye.rotation.x = Math.PI / 2;
    this.eye.updateMatrixWorld();
    // R: closeness to the floor (contact), G: coverage (anything above).
    this.heightMaterial = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        #include <common>
        #include <batching_pars_vertex>
        varying float vHeight;
        void main() {
          #include <batching_vertex>
          #include <begin_vertex>
          #include <project_vertex>
          vHeight = - mvPosition.z;
        }`,
      fragmentShader: /* glsl */`
        varying float vHeight;
        void main() {
          float contact = exp( - max( vHeight, 0.0 ) / 5.5 );
          float hover = 1.0 - 0.45 * clamp( vHeight / ${GROUND_REACH.toFixed(1)}, 0.0, 1.0 );
          gl_FragColor = vec4( contact, hover, 0.0, 1.0 );
        }`,
    });
    // Nine-tap Gaussian; the two channels are blurred with different reaches.
    this.blurMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { map: { value: null }, stepContact: { value: new THREE.Vector2() }, stepHover: { value: new THREE.Vector2() } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map;
        uniform vec2 stepContact;
        uniform vec2 stepHover;
        varying vec2 vUv;
        void main() {
          vec2 sum = texture2D( map, vUv ).rg * 0.2042;
          for ( int i = 1; i <= 4; i ++ ) {
            float w = i == 1 ? 0.1802 : i == 2 ? 0.1238 : i == 3 ? 0.0663 : 0.0276;
            float k = float( i );
            sum.r += w * ( texture2D( map, vUv + stepContact * k ).r + texture2D( map, vUv - stepContact * k ).r );
            sum.g += w * ( texture2D( map, vUv + stepHover * k ).g + texture2D( map, vUv - stepHover * k ).g );
          }
          gl_FragColor = vec4( sum, 0.0, 1.0 );
        }`,
    });
    this.blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial));

    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        map: { value: this.targetA.texture }, lean: { value: new THREE.Vector2() }, frame: { value: this.frame },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = vec2( uv.x, 1.0 - uv.y );
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map;
        uniform vec2 lean;
        uniform vec2 frame;
        varying vec2 vUv;
        void main() {
          float contact = texture2D( map, vUv ).r;
          // The wide shadow leans away from the key light.
          float hover = texture2D( map, vUv - lean ).g;
          float shade = 1.0 - ( 1.0 - 0.76 * smoothstep( 0.0, 0.7, contact ) ) * ( 1.0 - 0.3 * smoothstep( 0.02, 0.8, hover ) );
          vec2 rim = abs( vUv - 0.5 ) * 2.0;
          shade *= 1.0 - smoothstep( 0.72, 1.0, max( rim.x, rim.y ) );
          // Never a hard line where the canvas ends: fade towards its border.
          vec2 border = min( gl_FragCoord.xy, frame - gl_FragCoord.xy ) / ( 0.08 * min( frame.x, frame.y ) );
          shade *= smoothstep( 0.0, 1.0, min( border.x, border.y ) );
          gl_FragColor = vec4( vec3( 0.075, 0.085, 0.1 ), shade );
        }`,
    }));
    this.mesh.name = 'Floor shadow';
    this.mesh.position.y = GROUND_Y;
    this.mesh.renderOrder = -1;
  }

  /** Points the lean of the wide shadow away from the key light, which has
   * been turned by `turn` radians about the dial axis. */
  lean(turn: number): void {
    const azimuth = THREE.MathUtils.degToRad(KEY_AZIMUTH + 180) + turn;
    const uniforms = (this.mesh.material as THREE.ShaderMaterial).uniforms;
    uniforms.lean.value.set(Math.sin(azimuth) * 0.032, Math.cos(azimuth) * 0.032);
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const target = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    const shadowsDue = renderer.shadowMap.needsUpdate;
    const override = scene.overrideMaterial;
    renderer.shadowMap.needsUpdate = false;

    this.mesh.visible = false;
    scene.overrideMaterial = this.heightMaterial;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.targetA);
    renderer.clear();
    renderer.render(scene, this.eye);
    scene.overrideMaterial = override;
    this.mesh.visible = true;

    // Blur passes ping-pong between the two targets. The contact channel is
    // only blurred by the first, narrow pair; the hover channel by all three.
    const texel = 1 / GROUND_RESOLUTION;
    for (const [contact, hover] of [[1.1, 1.6], [0, 4.2], [0, 9.5]]) {
      this.blur(renderer, contact * texel, 0, hover * texel, 0);
      this.blur(renderer, 0, contact * texel, 0, hover * texel);
    }

    renderer.setRenderTarget(target);
    renderer.setClearColor(this.clearColor, alpha);
    renderer.shadowMap.needsUpdate = shadowsDue;
  }

  private blur(renderer: THREE.WebGLRenderer, cx: number, cy: number, hx: number, hy: number): void {
    const u = this.blurMaterial.uniforms;
    u.map.value = this.targetA.texture;
    u.stepContact.value.set(cx, cy);
    u.stepHover.value.set(hx, hy);
    renderer.setRenderTarget(this.targetB);
    renderer.render(this.blurScene, this.blurCamera);
    [this.targetA, this.targetB] = [this.targetB, this.targetA];
    (this.mesh.material as THREE.ShaderMaterial).uniforms.map.value = this.targetA.texture;
  }
}

function makeGroundTarget(): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(GROUND_RESOLUTION, GROUND_RESOLUTION, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
  });
  target.texture.generateMipmaps = false;
  return target;
}
