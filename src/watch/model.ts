import * as THREE from 'three';
import {
  APERTURE_CENTER,
  DATE_CENTER_X,
  DATE_H,
  DATE_W,
  DIAL_R,
  DateDisc,
  makeDialTexture,
  makeMoonDiscTexture,
} from './textures';
import { SYNODIC_MONTH } from '../moon';

// The watch lies flat: dial faces +Y, 12 o'clock points to -Z, crown at +X.
// All dimensions roughly in millimetres (case Ø 39 mm → radius 19.5).

const CASE_R = 19.5;
const DIAL_Y = 2.25;
const MOON_DISC_R = 7.6;
const MOON_DISC_CENTER_Z = APERTURE_CENTER + 3.1; // disc center sits below the aperture

export const CROWN_LABELS = ['verschraubt', 'Position 1 · Aufzug', 'Position 2 · Korrektur', 'Position 3 · Zeit'] as const;

export class WatchModel {
  readonly group = new THREE.Group();

  private readonly crownGroup = new THREE.Group();
  private readonly crownSpinner = new THREE.Group();
  private readonly hourGroup = new THREE.Group();
  private readonly minuteGroup = new THREE.Group();
  private readonly secondGroup = new THREE.Group();
  private readonly moonDisc: THREE.Mesh;
  private readonly dangerSector: THREE.Mesh;
  private readonly dateDisc = new DateDisc();

  /** Continuous crown pull-out: 0 = screwed down … 3 = time-setting. */
  crownPull = 0;
  /** Displayed time in minutes since 12:00 (0..720 wraps the dial). */
  displayMinutes = 10 * 60 + 9;
  /** Second hand angle in seconds 0..60. */
  displaySeconds = 34;
  /** Whether the movement is running (advances time + sweeps seconds). */
  running = false;
  /** When true, display tracks the real clock (after successful sync). */
  liveSync = false;
  /** Moon disc rotation expressed in days from the full-moon-centered pose. */
  moonDays = 0;

  constructor() {
    const steel = new THREE.MeshStandardMaterial({ color: 0xd9dee6, metalness: 1.0, roughness: 0.16 });
    const steelBrushed = new THREE.MeshStandardMaterial({ color: 0xc4cad4, metalness: 0.95, roughness: 0.34 });

    // --- Case (lathe profile, axis = Y) ---
    const profile: THREE.Vector2[] = [
      new THREE.Vector2(5.5, -4.7),
      new THREE.Vector2(15.5, -4.7),
      new THREE.Vector2(18.6, -3.9),
      new THREE.Vector2(CASE_R + 0.3, -1.4),
      new THREE.Vector2(CASE_R + 0.3, 1.2),
      new THREE.Vector2(18.9, 2.6),
      new THREE.Vector2(17.6, 3.5),
      new THREE.Vector2(16.7, 3.7),
      new THREE.Vector2(16.4, 2.0),
    ];
    const caseMesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 128), steel);
    this.group.add(caseMesh);

    const caseback = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 0.8, 96), steelBrushed);
    caseback.position.y = -4.7;
    this.group.add(caseback);

    // --- Lugs (tapered, hugging the case) ---
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const geo = new THREE.BoxGeometry(2.9, 2.7, 6.2);
        // Taper the outer end a little
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          if (pos.getZ(i) > 0) {
            pos.setX(i, pos.getX(i) * 0.72);
            pos.setY(i, pos.getY(i) * 0.7);
          }
        }
        geo.computeVertexNormals();
        const lug = new THREE.Mesh(geo, steel);
        lug.position.set(sx * 10.9, -1.3, sz * 16.6);
        lug.rotation.x = sz > 0 ? 0.2 : Math.PI - 0.2; // taper always outward, dipping down
        lug.rotation.y = sx * sz * 0.14;
        this.group.add(lug);
      }
    }

    // --- Dial ---
    const dialTex = makeDialTexture();
    const dial = new THREE.Mesh(
      new THREE.CircleGeometry(DIAL_R, 128),
      new THREE.MeshStandardMaterial({
        map: dialTex,
        transparent: true,
        alphaTest: 0.4,
        metalness: 0.35,
        roughness: 0.5,
      }),
    );
    dial.rotation.x = -Math.PI / 2;
    dial.position.y = DIAL_Y;
    dial.renderOrder = 1; // danger sector (2) and crystal (3) must blend on top
    this.group.add(dial);

    // Rehaut (chapter ring wall between dial and crystal)
    const rehaut = new THREE.Mesh(new THREE.CylinderGeometry(16.4, 16.2, 1.4, 96, 1, true), steelBrushed);
    rehaut.position.y = DIAL_Y + 0.6;
    this.group.add(rehaut);

    // --- Moon disc behind the dial ---
    this.moonDisc = new THREE.Mesh(
      new THREE.CircleGeometry(MOON_DISC_R, 96),
      new THREE.MeshStandardMaterial({
        map: makeMoonDiscTexture(),
        metalness: 0.25,
        roughness: 0.55,
        // The disc overhangs the dial radius towards 6 o'clock — clip it there
        // so it cannot poke through the case flank (requires localClippingEnabled).
        clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 0, -1), DIAL_R - 0.3)],
      }),
    );
    this.moonDisc.rotation.x = -Math.PI / 2;
    this.moonDisc.position.set(0, DIAL_Y - 0.45, MOON_DISC_CENTER_Z);
    this.group.add(this.moonDisc);

    // Opaque annulus just under the dial rim: clips any moon-disc overflow
    // that would otherwise peek through the dial/rehaut gap.
    const discMask = new THREE.Mesh(
      new THREE.RingGeometry(DIAL_R - 0.4, DIAL_R + 0.7, 96),
      new THREE.MeshBasicMaterial({ color: 0x060b18 }),
    );
    discMask.rotation.x = -Math.PI / 2;
    discMask.position.y = DIAL_Y - 0.32;
    this.group.add(discMask);

    // --- Date plate behind the window at 3 ---
    const datePlate = new THREE.Mesh(
      new THREE.PlaneGeometry(DATE_W + 0.6, DATE_H + 0.6),
      new THREE.MeshBasicMaterial({ map: this.dateDisc.texture }),
    );
    datePlate.rotation.x = -Math.PI / 2;
    datePlate.position.set(DATE_CENTER_X, DIAL_Y - 0.28, 0);
    this.group.add(datePlate);

    // --- Danger sector (quick-set lock-out ~20:00–03:00) ---
    this.dangerSector = new THREE.Mesh(
      new THREE.RingGeometry(9.6, 15.6, 96, 1, 0, (210 * Math.PI) / 180),
      new THREE.MeshBasicMaterial({
        color: 0xff5555,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.dangerSector.rotation.x = -Math.PI / 2;
    this.dangerSector.position.y = DIAL_Y + 0.12;
    this.dangerSector.renderOrder = 2;
    this.group.add(this.dangerSector);

    // --- Hands ---
    const handMat = new THREE.MeshStandardMaterial({
      color: 0xeef1f6,
      metalness: 1.0,
      roughness: 0.12,
      side: THREE.DoubleSide,
    });
    const hour = new THREE.Mesh(handShape(9.2, 1.7), handMat);
    this.hourGroup.add(hour);
    this.hourGroup.position.y = DIAL_Y + 0.55;
    const minute = new THREE.Mesh(handShape(14.2, 1.2), handMat);
    this.minuteGroup.add(minute);
    this.minuteGroup.position.y = DIAL_Y + 0.85;
    const second = new THREE.Mesh(secondShape(), handMat);
    this.secondGroup.add(second);
    this.secondGroup.position.y = DIAL_Y + 1.1;
    this.group.add(this.hourGroup, this.minuteGroup, this.secondGroup);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.9, 32), handMat);
    cap.position.y = DIAL_Y + 0.7;
    this.group.add(cap);

    // --- Crystal (domed sapphire) ---
    // Large sphere radius → gentle dome (~2 mm rise), colorless and near
    // invisible like the real sapphire instead of a tall milky blue bubble.
    const domeR = 70;
    const theta = Math.asin(16.5 / domeR);
    const crystal = new THREE.Mesh(
      new THREE.SphereGeometry(domeR, 96, 48, 0, Math.PI * 2, 0, theta),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        roughness: 0.03,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    crystal.position.y = 3.6 - domeR * Math.cos(theta);
    crystal.renderOrder = 3;
    this.group.add(crystal);

    // --- Crown at +X ---
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7.5, 24), steelBrushed);
    stem.rotation.z = Math.PI / 2;
    stem.position.x = -3.6;
    this.crownSpinner.add(stem);

    const crownBody = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 2.0, 48), steel);
    crownBody.rotation.z = Math.PI / 2;
    this.crownSpinner.add(crownBody);

    // Knurling ridges
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.45, 0.45), steelBrushed);
      ridge.position.set(0, Math.cos(a) * 2.05, Math.sin(a) * 2.05);
      ridge.rotation.x = -a;
      this.crownSpinner.add(ridge);
    }
    const crownCap = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.9, 0.5, 48), steel);
    crownCap.rotation.z = Math.PI / 2;
    crownCap.position.x = 1.2;
    this.crownSpinner.add(crownCap);
    const rose = new THREE.Mesh(new THREE.SphereGeometry(1.15, 32, 16), steelBrushed);
    rose.scale.set(0.35, 1, 1);
    rose.position.x = 1.45;
    this.crownSpinner.add(rose);

    this.crownGroup.add(this.crownSpinner);
    this.group.add(this.crownGroup);

    this.setDate(new Date().getDate());
    this.applyCrown();
    this.applyHands();
    this.applyMoon();
  }

  /** Crown spin around its own axis (radians, cosmetic). */
  set crownSpin(a: number) {
    this.crownSpinner.rotation.x = a;
  }

  get crownSpin(): number {
    return this.crownSpinner.rotation.x;
  }

  get dateValue(): number {
    return this.dateDisc.value;
  }

  setDate(day: number): void {
    this.dateDisc.set(day);
  }

  set dangerOpacity(o: number) {
    (this.dangerSector.material as THREE.MeshBasicMaterial).opacity = o;
  }

  /**
   * moonDays = 0 → a moon sits centered in the aperture (full-moon pose).
   * One day advances the disc by π / SYNODIC_MONTH (two-moon disc).
   */
  private applyMoon(): void {
    this.moonDisc.rotation.z = (this.moonDays * Math.PI) / SYNODIC_MONTH;
  }

  private applyCrown(): void {
    this.crownGroup.position.set(CASE_R + 1.15 + this.crownPull * 1.05, 0, 0);
  }

  private applyHands(): void {
    const m = ((this.displayMinutes % 720) + 720) % 720;
    this.minuteGroup.rotation.y = -((m % 60) / 60) * Math.PI * 2;
    this.hourGroup.rotation.y = -(m / 720) * Math.PI * 2;
    this.secondGroup.rotation.y = -(((this.displaySeconds % 60) + 60) % 60 / 60) * Math.PI * 2;
  }

  /** Advance runtime state; called every frame. */
  tick(dt: number): void {
    if (this.liveSync) {
      const now = new Date();
      this.displayMinutes = (now.getHours() % 12) * 60 + now.getMinutes() + now.getSeconds() / 60;
      this.displaySeconds = now.getSeconds() + now.getMilliseconds() / 1000;
    } else if (this.running) {
      this.displayMinutes += dt / 60;
      this.displaySeconds += dt;
    }
    this.applyHands();
    this.applyCrown();
    this.applyMoon();
  }
}

function handShape(len: number, w: number): THREE.ShapeGeometry {
  // Dauphine-style: elongated diamond with a short tail, pointing +Y in shape
  // space; rotated so it points to 12 o'clock (-Z) at rotation 0.
  const s = new THREE.Shape();
  s.moveTo(0, len);
  s.lineTo(-w / 2, len * 0.28);
  s.lineTo(-w / 2.6, -2.0);
  s.lineTo(w / 2.6, -2.0);
  s.lineTo(w / 2, len * 0.28);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function secondShape(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const w = 0.28;
  s.moveTo(-w / 2, -3.6);
  s.lineTo(-w / 2, 15.2);
  s.lineTo(w / 2, 15.2);
  s.lineTo(w / 2, -3.6);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  const ring = new THREE.ShapeGeometry(circleShape(0.85, 0, -2.4));
  const merged = mergeGeos(geo, ring);
  merged.rotateX(-Math.PI / 2);
  return merged as THREE.ShapeGeometry;
}

function circleShape(r: number, x: number, y: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(x, y, r, 0, Math.PI * 2, false);
  return s;
}

function mergeGeos(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  // Tiny local merge to avoid pulling in BufferGeometryUtils.
  const geos = [a, b].map((g) => g.toNonIndexed());
  const total = geos.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array as Float32Array, off);
    off += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
