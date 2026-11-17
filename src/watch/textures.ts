import * as THREE from 'three';

// Canvas textures of the dial side, each drawn once at start-up. Geometry
// carries everything that has to stay crisp in a close-up (numerals, minute
// track, stars, date numerals); the textures only add what geometry cannot:
// soft contact shadows, the fine dial lettering and the grain of frosted silver.

/** One flat outline with optional holes, in dial plan coordinates:
 * millimetres, x towards three o'clock, y towards twelve. */
export type Silhouette = THREE.Vector2[][];

const OCCLUSION_SIZE = 1024;

/**
 * Contact shadows of the applied furniture for the dial's aoMap. White is
 * unshadowed. `radius` is the plan radius that maps onto the texture edge and
 * `rimStart` the radius where the shadow of the rehaut begins.
 */
export function makeDialOcclusionTexture(silhouettes: Silhouette[], radius: number, rimStart: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OCCLUSION_SIZE;
  const ctx = canvas.getContext('2d')!;
  const scale = OCCLUSION_SIZE / 2 / radius;
  const centre = OCCLUSION_SIZE / 2;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, OCCLUSION_SIZE, OCCLUSION_SIZE);

  // The rehaut stands over the rim of the dial and shades it.
  const rim = ctx.createRadialGradient(centre, centre, rimStart * scale, centre, centre, radius * scale);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  rim.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, OCCLUSION_SIZE, OCCLUSION_SIZE);

  // Only the blurred shadows are wanted, not the hard-edged shapes that cast
  // them: the shapes are drawn far outside the canvas and their shadows are
  // offset back into place.
  const away = OCCLUSION_SIZE * 2;
  ctx.beginPath();
  for (const silhouette of silhouettes) for (const contour of silhouette) {
    contour.forEach((p, i) => {
      const x = centre + p.x * scale - away;
      const y = centre - p.y * scale;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  // A wide soft halo, then a tight dark line where metal meets lacquer. The
  // slight shift matches a key light from the upper left.
  ctx.fillStyle = '#000';
  for (const [blur, alpha, shift] of [[0.7, 0.55, 0.07], [0.2, 0.75, 0.02]]) {
    ctx.shadowColor = `rgba(0,0,0,${alpha})`;
    ctx.shadowBlur = blur * scale;
    ctx.shadowOffsetX = away + shift * scale;
    ctx.shadowOffsetY = shift * 0.6 * scale;
    ctx.fill('evenodd');
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A printed block of the dial lettering: where it sits on the dial (plan
 * millimetres) and which part of the lettering sheet it shows. */
export interface LetteringDecal {
  /** xMin, yMin, xMax, yMax in dial plan coordinates. */
  rect: [number, number, number, number];
  /** uMin, vMin, uMax, vMax on the sheet. */
  uv: [number, number, number, number];
}

export interface LetteringSheet {
  /** Coverage of the print: use as alphaMap. */
  texture: THREE.CanvasTexture;
  decals: LetteringDecal[];
}

const SHEET_W = 1024;
const SHEET_H = 768;
/** Sheet resolution in pixels per millimetre. */
const SHEET_SCALE = 124;

/**
 * Pad-printed lettering of the study dial: crescent emblem, the LUNA wordmark
 * and its subtitle above the centre, the edition line below the minute track.
 * The wordmark is drawn from strokes, so it looks the same on every device.
 */
export function makeLetteringSheet(): LetteringSheet {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Top block: 8 mm wide, 5.3 mm high, centred 6.55 mm above the dial centre.
  const top: LetteringDecal = { rect: [-4, 3.9, 4, 9.2], uv: [0, 0, 0, 0] };
  const topPx = placeBlock(top, 4, 4);
  ctx.save();
  // Block coordinates: millimetres, origin at the dial centre line / block floor, y up.
  ctx.translate(topPx.x + topPx.w / 2, topPx.y + topPx.h);
  ctx.scale(SHEET_SCALE, -SHEET_SCALE);
  ctx.translate(0, -top.rect[1]);
  drawCrescent(ctx, 0, 8.42, 0.5);
  drawWordmark(ctx, 0, 5.78, 1.22);
  ctx.restore();
  drawTracked(ctx, 'MONDPHASE', topPx.x + topPx.w / 2, topPx.y + (top.rect[3] - 4.62) * SHEET_SCALE, 0.5, 0.27);

  // Edition line below six o'clock, between the minute track and the rehaut.
  const bottom: LetteringDecal = { rect: [-3.4, -15.5, 3.4, -14.9], uv: [0, 0, 0, 0] };
  const bottomPx = placeBlock(bottom, 4, topPx.y + topPx.h + 8);
  drawTracked(ctx, 'STUDIO / 02', bottomPx.x + bottomPx.w / 2, bottomPx.y + bottomPx.h / 2, 0.38, 0.15);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return { texture, decals: [top, bottom] };
}

/** Reserves the sheet area of a decal at pixel position (x, y) and fills in its uv rectangle. */
function placeBlock(decal: LetteringDecal, x: number, y: number): { x: number; y: number; w: number; h: number } {
  const w = (decal.rect[2] - decal.rect[0]) * SHEET_SCALE;
  const h = (decal.rect[3] - decal.rect[1]) * SHEET_SCALE;
  // CanvasTexture flips Y: the top canvas row is v = 1.
  decal.uv = [x / SHEET_W, 1 - (y + h) / SHEET_H, (x + w) / SHEET_W, 1 - y / SHEET_H];
  return { x, y, w, h };
}

/** Small crescent, open towards the upper right. */
function drawCrescent(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(x + r * 0.42, y + r * 0.2, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** L U N A as widely spaced monoline capitals, cut flat at baseline and cap height. */
function drawWordmark(ctx: CanvasRenderingContext2D, centreX: number, baseline: number, cap: number): void {
  const weight = 0.128;
  const half = weight / 2;
  // Centre lines in units of the cap height; verticals run past the band and are clipped flat.
  const letters: { width: number; draw: () => void }[] = [
    { width: 0.6, draw: () => { ctx.moveTo(half, 1.3); ctx.lineTo(half, half); ctx.lineTo(0.6, half); } },
    {
      width: 0.74,
      draw: () => {
        ctx.moveTo(half, 1.3);
        ctx.lineTo(half, 0.37);
        ctx.arc(0.37, 0.37, 0.37 - half, Math.PI, 0, false);
        ctx.lineTo(0.74 - half, 1.3);
      },
    },
    {
      width: 0.76,
      draw: () => {
        ctx.moveTo(half, -0.3); ctx.lineTo(half, 1.3);
        ctx.moveTo(0.76 - half, -0.3); ctx.lineTo(0.76 - half, 1.3);
        ctx.moveTo(half * 0.6, 1.08); ctx.lineTo(0.76 - half * 0.6, -0.08);
      },
    },
    {
      width: 0.86,
      draw: () => {
        ctx.moveTo(-0.045, -0.3); ctx.lineTo(0.43, 1.11); ctx.lineTo(0.905, -0.3);
        ctx.moveTo(0.17, 0.3); ctx.lineTo(0.69, 0.3);
      },
    },
  ];
  const gap = 0.52;
  const total = letters.reduce((sum, l) => sum + l.width, 0) + gap * (letters.length - 1);
  ctx.save();
  ctx.translate(centreX - total * cap / 2, baseline);
  ctx.scale(cap, cap);
  ctx.lineWidth = weight;
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 12;
  let x = 0;
  for (const letter of letters) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.beginPath();
    ctx.rect(-0.2, 0, letter.width + 0.4, 1);
    ctx.clip();
    ctx.beginPath();
    letter.draw();
    ctx.stroke();
    ctx.restore();
    x += letter.width + gap;
  }
  ctx.restore();
}

/** Centred capitals with fixed tracking; sizes in millimetres, position in sheet pixels. */
function drawTracked(ctx: CanvasRenderingContext2D, text: string, centreX: number, middleY: number, capHeight: number, tracking: number): void {
  // Capitals of the common grotesques are about 0.72 em high.
  ctx.font = `600 ${capHeight / 0.72 * SHEET_SCALE}px "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const widths = [...text].map(ch => ctx.measureText(ch).width);
  const gap = tracking * SHEET_SCALE;
  let x = centreX - (widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1)) / 2;
  [...text].forEach((ch, i) => {
    ctx.fillText(ch, x, middleY + capHeight * SHEET_SCALE / 2);
    x += widths[i] + gap;
  });
}

/** Sand-blasted silver, as on the cloud plate and the moons: one tile of fine
 * grain that repeats in both directions. */
export interface FrostedGrain {
  /** Light and dark grains, with a few that glint. */
  map: THREE.DataTexture;
  /** Slopes of the same grains, so single grains catch the lamps. */
  normalMap: THREE.DataTexture;
  /** Width of one tile in millimetres. */
  tile: number;
}

const GRAIN_SIZE = 256;
/** Texels per millimetre: a grain spans two to three texels, about 0.02 mm. */
const GRAIN_SCALE = 130;

export function makeFrostedGrain(): FrostedGrain {
  const size = GRAIN_SIZE;
  const random = seededRandom(29);
  const noise = Float32Array.from({ length: size * size }, random);
  const at = (x: number, y: number): number => noise[((y + size) % size) * size + (x + size) % size];
  // White noise softened over neighbouring texels gives grains instead of single pixels.
  const height = new Float32Array(size * size);
  let mean = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (4 * at(x, y) + 2 * (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1))
      + at(x - 1, y - 1) + at(x + 1, y - 1) + at(x - 1, y + 1) + at(x + 1, y + 1)) / 16;
    height[y * size + x] = h;
    mean += h / (size * size);
  }
  let spread = 0;
  for (const h of height) spread += (h - mean) ** 2 / (size * size);
  spread = Math.sqrt(spread);
  const relief = (x: number, y: number): number => (height[((y + size) % size) * size + (x + size) % size] - mean) / spread;

  const tint = new Uint8Array(size * size * 4);
  const slope = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = (y * size + x) * 4;
    // A few grains face the light squarely and glint.
    const glint = random() < 0.03 ? 1 : 0;
    const value = Math.round(THREE.MathUtils.clamp(0.87 + 0.05 * relief(x, y) + 0.13 * glint, 0, 1) * 255);
    tint[n] = tint[n + 1] = tint[n + 2] = value;
    tint[n + 3] = 255;
    const normal = new THREE.Vector3(relief(x - 1, y) - relief(x + 1, y), relief(x, y - 1) - relief(x, y + 1), 4).normalize();
    slope[n] = Math.round((normal.x * 0.5 + 0.5) * 255);
    slope[n + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
    slope[n + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
    slope[n + 3] = 255;
  }
  const tile = (data: Uint8Array, colorSpace: THREE.ColorSpace): THREE.DataTexture => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = colorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  };
  return { map: tile(tint, THREE.SRGBColorSpace), normalMap: tile(slope, THREE.NoColorSpace), tile: size / GRAIN_SCALE };
}

/** Small deterministic generator, so the artwork is identical on every start. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
