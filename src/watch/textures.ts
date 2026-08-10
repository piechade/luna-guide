import * as THREE from 'three';

// All canvas textures for the watch: blue sunray dial (with punched holes for
// the moon aperture and the date window), the two-moon sky disc, the date disc.

export const DIAL_R = 16.2; // mm
export const APERTURE_CENTER = 7.9; // distance from dial center towards 6 o'clock
export const APERTURE_R = 4.3;
export const DATE_CENTER_X = 10.2; // towards 3 o'clock (inside the numeral ring, like the original)
export const DATE_W = 2.7;
export const DATE_H = 2.3;

// Proportions taken from TUDOR's official M91560-0002 product photography:
// minute DOTS at ~0.87 R (larger pearls on the fives), applied even numerals at
// ~0.72 R, slender faceted wedges on the odd hours, shield + TUDOR + GENEVE
// above the center, and a single tiny "SWISS MADE" line on the outer flange.
const NUM_FONT = `'Century Gothic', 'Futura', 'Avenir Next', 'Segoe UI', sans-serif`;

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
  base.addColorStop(0, '#1a4478');
  base.addColorStop(0.65, '#123663');
  base.addColorStop(1, '#0b2344');
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

  // Broad sheen from 10-o'clock direction (kept subtle — the real dial only
  // washes out under direct light, not permanently)
  const sheen = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  sheen.addColorStop(0, 'rgba(180,210,255,0.07)');
  sheen.addColorStop(0.45, 'rgba(180,210,255,0)');
  sheen.addColorStop(1, 'rgba(0,0,30,0.14)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Minute track: dots, with larger pearls on the fives
  ctx.save();
  ctx.translate(cx, cy);
  for (let m = 0; m < 60; m++) {
    const a = (m / 60) * Math.PI * 2 - Math.PI / 2; // 0 => 12 o'clock at top
    const isFive = m % 5 === 0;
    ctx.fillStyle = isFive ? 'rgba(230,236,246,0.95)' : 'rgba(206,215,230,0.7)';
    const r = px(14.35);
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, px(isFive ? 0.23 : 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Applied-look Arabic numerals on the EVEN hours only (6 → moon aperture)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of [12, 2, 4, 8, 10]) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const r = px(11.7);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ctx.font = `400 ${px(3.5)}px ${NUM_FONT}`;
    ctx.fillStyle = 'rgba(8,16,34,0.8)';
    ctx.fillText(String(h), x + 2, y + 3);
    const grad = ctx.createLinearGradient(x, y - px(1.7), x, y + px(1.7));
    grad.addColorStop(0, '#f4f7fb');
    grad.addColorStop(0.5, '#b9c2d0');
    grad.addColorStop(1, '#eaeff6');
    ctx.fillStyle = grad;
    ctx.fillText(String(h), x, y);
  }

  // Slender faceted wedge markers on the odd hours, tips pointing inward.
  // The one at 3 is short and sits outside the date window.
  for (const h of [1, 3, 5, 7, 9, 11]) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    // 3 carries a horizontal cut-off cone between date window and dot ring
    if (h === 3) drawWedge(ctx, cx, cy, a, 13.6, 12.1, 0.72, 0.4);
    else drawWedge(ctx, cx, cy, a, 12.9, 10.4, 0.85);
  }

  // Applied trapezoid at 6, floating between aperture and 30-min pearl with
  // clear dial on BOTH sides, like the original
  drawWedge(ctx, cx, cy, Math.PI / 2, 13.75, 12.95, 0.95, 0.78);

  // Deliberately NO brand text or emblem on the dial: naming the watch in
  // prose is referential use, but printing the mark on the (virtual) product
  // itself would not be. The logo area stays empty.

  // SWISS MADE: tiny, curved along the bottom edge of the dial
  ctx.font = `500 ${px(0.62)}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = 'rgba(235,240,248,0.92)';
  drawArcText(ctx, 'SWISS MADE', cx, cy, px(15.45), px(0.14));

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

  // Silver cloud bank fixed to the dial along the aperture bottom (the moon
  // disc rises and sets behind it, as on the real watch). Drawn after the
  // punch so it reads as dial, clipped to the aperture circle.
  ctx.save();
  ctx.translate(cx, cy + px(APERTURE_CENTER));
  ctx.beginPath();
  ctx.arc(0, 0, px(APERTURE_R), 0, Math.PI * 2);
  ctx.clip();
  const ar = px(APERTURE_R);
  const cloudGrad = ctx.createLinearGradient(0, 0, 0, ar);
  cloudGrad.addColorStop(0, '#eef1f5');
  cloudGrad.addColorStop(1, '#b4bfcc');
  ctx.fillStyle = cloudGrad;
  for (const [dx, dy, r] of [
    [-0.52, 0.6, 0.36],
    [-0.1, 0.68, 0.4],
    [0.32, 0.72, 0.32],
    [0.64, 0.6, 0.26],
  ]) {
    ctx.beginPath();
    ctx.arc(dx * ar, dy * ar, r * ar, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Thin polished ring around the aperture
  ctx.save();
  ctx.translate(cx, cy + px(APERTURE_CENTER));
  const ringGrad = ctx.createLinearGradient(-ar, -ar, ar, ar);
  ringGrad.addColorStop(0, 'rgba(245,248,252,0.95)');
  ringGrad.addColorStop(0.5, 'rgba(150,162,180,0.9)');
  ringGrad.addColorStop(1, 'rgba(235,240,248,0.85)');
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = px(0.22);
  ctx.beginPath();
  ctx.arc(0, 0, px(APERTURE_R + 0.08), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Slender faceted marker along the hour direction, tip pointing inward. */
function drawWedge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  angle: number,
  rOuter: number,
  rInner: number,
  baseW: number,
  tipW = 0,
): void {
  const path = (o: number) => {
    ctx.beginPath();
    ctx.moveTo(px(rOuter), -px(baseW / 2) + o);
    ctx.lineTo(px(rOuter), px(baseW / 2) + o);
    ctx.lineTo(px(rInner), px(tipW / 2) + o);
    ctx.lineTo(px(rInner), -px(tipW / 2) + o);
    ctx.closePath();
  };
  // Drop shadow
  ctx.save();
  ctx.translate(cx + 2, cy + 3);
  ctx.rotate(angle);
  ctx.fillStyle = 'rgba(8,16,34,0.75)';
  path(0);
  ctx.fill();
  ctx.restore();
  // Two facets: one bright, one shaded, split along the marker's spine
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = '#f2f5fa';
  ctx.beginPath();
  ctx.moveTo(px(rOuter), -px(baseW / 2));
  ctx.lineTo(px(rOuter), 0);
  ctx.lineTo(px(rInner), 0);
  ctx.lineTo(px(rInner), -px(tipW / 2));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#9aa5b5';
  ctx.beginPath();
  ctx.moveTo(px(rOuter), px(baseW / 2));
  ctx.lineTo(px(rOuter), 0);
  ctx.lineTo(px(rInner), 0);
  ctx.lineTo(px(rInner), px(tipW / 2));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Text curved along the BOTTOM edge of the dial: glyphs follow the circle of
 * radius r, upright relative to the dial center, reading left → right.
 */
function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  spacing: number,
): void {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  // Start angle: left end of the arc (angles decrease as we advance rightwards)
  let a = Math.PI / 2 + total / 2 / r;
  [...text].forEach((ch, i) => {
    const adv = (widths[i] / 2 + (i > 0 ? spacing / 2 : 0)) / r;
    a -= adv;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a -= (widths[i] / 2 + spacing / 2) / r;
  });
}

/** Blue sky disc with two brushed-silver moons and four-point silver stars. */
export function makeMoonDiscTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const cx = 256;
  const cy = 256;

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 256);
  bg.addColorStop(0, '#16437c');
  bg.addColorStop(1, '#0c2a52');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, 256, 0, Math.PI * 2);
  ctx.fill();

  // Subtle linear brushing across the disc
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 256, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 160; i++) {
    const x = Math.abs(Math.sin(i * 78.233) * 43758.5453) % 1 * 512;
    const bright = i % 2 === 0;
    ctx.strokeStyle = bright ? 'rgba(220,235,255,0.05)' : 'rgba(0,10,30,0.06)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }
  ctx.restore();

  // Four-point silver sparkle stars (deterministic pseudo-random)
  for (let i = 0; i < 22; i++) {
    const a = Math.abs(Math.sin(i * 127.1) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(i * 311.7) * 12543.897) % 1;
    const r = 60 + a * 175;
    const th = b * Math.PI * 2;
    const x = cx + Math.cos(th) * r;
    const y = cy + Math.sin(th) * r;
    const s = 5 + ((a * b * 7919) % 1) * 8;
    drawSparkle(ctx, x, y, s);
  }

  // Two moons, opposite each other on the carrying circle
  for (const ang of [0, Math.PI]) {
    // Carrying radius = disc-center → aperture-center distance (3.1 mm of
    // 7.6 mm disc radius), so the full-moon pose is centered in the aperture.
    const mr = 256 * (3.1 / 7.6);
    const x = cx + Math.sin(ang) * mr;
    const y = cy - Math.cos(ang) * mr;
    const moonR = 256 * 0.24;
    const g = ctx.createRadialGradient(x - moonR * 0.35, y - moonR * 0.35, moonR * 0.1, x, y, moonR);
    g.addColorStop(0, '#fbfcfe');
    g.addColorStop(0.6, '#dde3ea');
    g.addColorStop(1, '#a8b3c2');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, moonR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,132,148,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Faint brushing on the moon face
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, moonR, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 14; i++) {
      const yy = y - moonR + ((i + 0.5) / 14) * moonR * 2;
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(90,100,115,0.1)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - moonR, yy);
      ctx.lineTo(x + moonR, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const w = s * 0.24;
  ctx.fillStyle = 'rgba(226,235,248,0.95)';
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + w * 0.4, y - w * 0.4, x + s, y);
  ctx.quadraticCurveTo(x + w * 0.4, y + w * 0.4, x, y + s);
  ctx.quadraticCurveTo(x - w * 0.4, y + w * 0.4, x - s, y);
  ctx.quadraticCurveTo(x - w * 0.4, y - w * 0.4, x, y - s);
  ctx.closePath();
  ctx.fill();
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
