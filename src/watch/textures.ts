import * as THREE from 'three';

// All canvas textures for the watch: blue sunray dial (with punched holes for
// the moon aperture and the date window), the two-moon sky disc, the date disc.

export const DIAL_R = 16.2; // mm
export const APERTURE_CENTER = 9.4; // distance from dial center towards 6 o'clock
export const APERTURE_R = 4.1;
export const DATE_CENTER_X = 12.55; // towards 3 o'clock
export const DATE_W = 3.1;
export const DATE_H = 3.3;

const SIZE = 1024;
const S = SIZE / 2 / DIAL_R; // px per mm

function px(mm: number): number {
  return mm * S;
}

export function makeDialTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  const cx = SIZE / 2;
  const cy = SIZE / 2;

  // Base blue with vignette
  const base = ctx.createRadialGradient(cx, cy, 0, cx, cy, SIZE / 2);
  base.addColorStop(0, '#1d4a80');
  base.addColorStop(0.65, '#153a68');
  base.addColorStop(1, '#0c2547');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Sunray brushing: fine radial strokes with pseudo-random alternation
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 1440; i++) {
    const a = (i / 1440) * Math.PI * 2;
    const bright = Math.pow(Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, 2);
    ctx.strokeStyle =
      i % 2 === 0
        ? `rgba(255,255,255,${0.028 * bright})`
        : `rgba(0,0,20,${0.05 * bright})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * SIZE * 0.72, Math.sin(a) * SIZE * 0.72);
    ctx.stroke();
  }
  ctx.restore();

  // Broad sheen from 10-o'clock direction
  const sheen = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  sheen.addColorStop(0, 'rgba(180,210,255,0.16)');
  sheen.addColorStop(0.45, 'rgba(180,210,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,30,0.18)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Minute track
  ctx.save();
  ctx.translate(cx, cy);
  for (let m = 0; m < 60; m++) {
    const a = (m / 60) * Math.PI * 2 - Math.PI / 2; // 0 => 12 o'clock at top
    const isFive = m % 5 === 0;
    ctx.strokeStyle = isFive ? 'rgba(226,232,244,0.95)' : 'rgba(200,210,228,0.55)';
    ctx.lineWidth = isFive ? 4 : 2;
    const r0 = px(isFive ? 15.0 : 15.4);
    const r1 = px(15.9);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();

  // Applied-look Arabic numerals (silver with darker edge)
  const numeralHours = [1, 2, 4, 5, 7, 8, 10, 11];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of numeralHours) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const r = px(12.9);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.font = `600 ${px(3.3)}px Georgia, serif`;
    ctx.fillStyle = 'rgba(10,20,40,0.85)';
    ctx.fillText(String(h), x + 2, y + 3);
    const grad = ctx.createLinearGradient(x, y - px(1.6), x, y + px(1.6));
    grad.addColorStop(0, '#f2f5fa');
    grad.addColorStop(0.5, '#b9c2d0');
    grad.addColorStop(1, '#e8edf5');
    ctx.fillStyle = grad;
    ctx.fillText(String(h), x, y);
  }

  // Faceted arrow markers at 12 and 9 (3 carries the date window)
  drawArrow(ctx, cx, cy - px(13.1), 0);
  drawArrow(ctx, cx - px(13.1), cy, -Math.PI / 2);

  // Logo block
  ctx.fillStyle = '#e6ebf4';
  ctx.font = `600 ${px(1.9)}px "Segoe UI", sans-serif`;
  drawSpaced(ctx, 'TUDOR', cx, cy - px(7.2), px(0.55));
  ctx.font = `400 ${px(1.05)}px "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(220,228,242,0.85)';
  drawSpaced(ctx, '1926  LUNA', cx, cy - px(5.1), px(0.3));

  // SWISS MADE at the bottom edge, flanking the aperture
  ctx.font = `500 ${px(0.85)}px "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(210,220,238,0.8)';
  ctx.fillText('SWISS', cx - px(6.9), cy + px(14.9));
  ctx.fillText('MADE', cx + px(6.9), cy + px(14.9));

  // Polished bevel ring around the sky aperture
  ctx.save();
  ctx.translate(cx, cy + px(APERTURE_CENTER));
  const bevel = ctx.createRadialGradient(0, 0, px(APERTURE_R * 0.92), 0, 0, px(APERTURE_R + 0.55));
  bevel.addColorStop(0, 'rgba(240,245,255,0.95)');
  bevel.addColorStop(0.6, 'rgba(150,165,190,0.9)');
  bevel.addColorStop(1, 'rgba(240,245,255,0.15)');
  ctx.fillStyle = bevel;
  ctx.beginPath();
  ctx.arc(0, 0, px(APERTURE_R + 0.55), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Frame around the date window
  ctx.save();
  ctx.translate(cx + px(DATE_CENTER_X), cy);
  ctx.strokeStyle = 'rgba(235,240,250,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(-px(DATE_W / 2) - 2, -px(DATE_H / 2) - 2, px(DATE_W) + 4, px(DATE_H) + 4);
  ctx.restore();

  // Punch the holes (alpha cut-outs)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy + px(APERTURE_CENTER), px(APERTURE_R), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(
    cx + px(DATE_CENTER_X - DATE_W / 2),
    cy - px(DATE_H / 2),
    px(DATE_W),
    px(DATE_H),
  );
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  const w = px(1.5);
  const h = px(2.3);
  const grad = ctx.createLinearGradient(-w, 0, w, 0);
  grad.addColorStop(0, '#f2f5fa');
  grad.addColorStop(0.5, '#aab4c4');
  grad.addColorStop(1, '#e8edf5');
  ctx.fillStyle = 'rgba(10,20,40,0.85)';
  ctx.beginPath();
  ctx.moveTo(2, h / 2 + 3);
  ctx.lineTo(-w / 2 + 2, -h / 2 + 3);
  ctx.lineTo(w / 2 + 2, -h / 2 + 3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, h / 2); // point towards dial center
  ctx.lineTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawSpaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  let cur = x - total / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, cur + widths[i] / 2, y);
    cur += widths[i] + spacing;
  });
}

/** Deep-blue sky disc with two golden moons and scattered stars. */
export function makeMoonDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const cx = 256;
  const cy = 256;

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 256);
  bg.addColorStop(0, '#122c55');
  bg.addColorStop(1, '#081a38');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, 256, 0, Math.PI * 2);
  ctx.fill();

  // Stars (deterministic pseudo-random)
  for (let i = 0; i < 90; i++) {
    const a = (Math.sin(i * 127.1) * 43758.5453) % 1;
    const b = (Math.sin(i * 311.7) * 12543.897) % 1;
    const r = Math.abs(a) * 235;
    const th = Math.abs(b) * Math.PI * 2;
    const x = cx + Math.cos(th) * r;
    const y = cy + Math.sin(th) * r;
    const s = 1 + (Math.abs(a * b) % 1) * 2.2;
    ctx.fillStyle = i % 7 === 0 ? 'rgba(255,220,150,0.95)' : 'rgba(230,240,255,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Two moons, opposite each other on the carrying circle
  for (const ang of [0, Math.PI]) {
    const mr = 256 * 0.47; // carrying radius in px (disc r = 256px = MOON_DISC_R mm)
    const x = cx + Math.sin(ang) * mr;
    const y = cy - Math.cos(ang) * mr;
    const moonR = 256 * 0.21;
    const g = ctx.createRadialGradient(x - moonR * 0.35, y - moonR * 0.35, moonR * 0.1, x, y, moonR);
    g.addColorStop(0, '#ffe9a8');
    g.addColorStop(0.7, '#f0c65c');
    g.addColorStop(1, '#c99a33');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, moonR, 0, Math.PI * 2);
    ctx.fill();
    // Craters
    ctx.fillStyle = 'rgba(160,120,40,0.35)';
    for (const [dx, dy, cr] of [
      [-0.3, 0.1, 0.16],
      [0.25, -0.2, 0.12],
      [0.05, 0.38, 0.1],
      [0.35, 0.28, 0.08],
    ]) {
      ctx.beginPath();
      ctx.arc(x + dx * moonR, y + dy * moonR, cr * moonR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** White date plate showing a single number; redrawable in place. */
export class DateDisc {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private current = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.set(1);
  }

  get value(): number {
    return this.current;
  }

  set(day: number): void {
    const d = ((Math.round(day) - 1 + 31 * 4) % 31) + 1;
    this.current = d;
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f6f9';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#101318';
    ctx.font = '700 78px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(d), 64, 70);
    this.texture.needsUpdate = true;
  }
}
