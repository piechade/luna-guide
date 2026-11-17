import * as THREE from 'three';

/** Materials shared by all part modules, created once per watch.
 *
 * The three grained materials need neither UVs nor tangents. Their grain is
 * laid out in the coordinates of the geometry itself, so it stays put on parts
 * that move or turn; geometry built in watch coordinates gets the grain along
 * the watch axes.
 *
 * The satin finishes (`brushed`, `brushedCircular`, `rehaut`, `frosted`) take
 * their light from the studio and only a small share from the lamps. A
 * `clone()` keeps grain and finish; a plain copy of the parameters does not. */
export interface WatchMaterials {
  /** Mirror-polished steel: bezel, case flanks, hands, applied indices. */
  steel: THREE.MeshStandardMaterial;
  /** Satin-brushed steel: caseback, outer bracelet rows, crown medallion.
   * Straight grain, perpendicular to the geometry's X axis: lengthwise over
   * lugs and links and all the way round a closed bracelet loop. */
  brushed: THREE.MeshStandardMaterial;
  /** Shadowed steel for recesses, slots and gaps. */
  darkSteel: THREE.MeshStandardMaterial;
  /** Double-sided satin steel for open walls (rehaut, aperture wall), with a
   * circular grain like `brushedCircular`. */
  rehaut: THREE.MeshStandardMaterial;
  /** Satin steel with a circular grain around the geometry's Y axis: case
   * flanks and bezels, circular-grained casebacks, wheels and discs. */
  brushedCircular: THREE.MeshStandardMaterial;
  /** Fine bead-blasted steel without a grain direction: recessed medallions,
   * clasp interiors, engraving grounds. */
  frosted: THREE.MeshStandardMaterial;
}

export function makeMaterials(): WatchMaterials {
  const grain = makeGrainTexture();
  // 316L steel is almost neutral with a faint cool cast. Polished parts stay
  // just above the roughness at which the studio's light/dark bands blur.
  const steel = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.075 });
  // Satin parts are a step darker than polished ones: a calm grey between their highlights.
  const brushed = new SatinSteel(grain, 'linear', { color: 0xbfc3c7, metalness: 1, roughness: 0.3 });
  const brushedCircular = new SatinSteel(grain, 'circular', { color: 0xbfc3c7, metalness: 1, roughness: 0.3 });
  // Recesses see little of the studio: dark, dull, hardly any reflection.
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x4a525c, metalness: 1, roughness: 0.42, envMapIntensity: 0.5,
  });
  const rehaut = new SatinSteel(grain, 'circular', {
    color: 0xd3d7da, metalness: 1, roughness: 0.24, side: THREE.DoubleSide,
  });
  const frosted = new SatinSteel(null, 'none', { color: 0xc3c7cb, metalness: 1, roughness: 0.56 });
  return { steel, brushed, darkSteel, rehaut, brushedCircular, frosted };
}

// ── Brushed-steel grain ─────────────────────────────────────────────────────
//
// Real satin finishing is thousands of parallel scratches: across them the
// surface is rough, along them it is smooth. Two things make that visible:
// the reflection is smeared across the scratches, and single scratches catch
// the light. Both are computed from the position and the normal alone, in the
// geometry's own coordinates, so geometry needs no UVs and no tangents.

/** Grain texture period across the scratches / along them, in millimetres. */
const GRAIN_ACROSS_MM = 4.6;
const GRAIN_ALONG_MM = 44;

/** R: scratch depth (roughness), G: slope across the scratches (normal). */
function makeGrainTexture(): THREE.DataTexture {
  const size = 512;
  const height = new Float32Array(size * size);
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // One scratch: a column band with a soft cross-section, fading at both ends.
  const scratch = (width: number, minLength: number, depth: number) => {
    const u = random() * size;
    const v0 = random() * size;
    const length = size * (minLength + random() * (1 - minLength));
    const amplitude = depth * (random() * 2 - 1);
    const drift = (random() - 0.5) * 2.5; // scratches are never perfectly parallel
    for (let j = 0; j < length; j++) {
      const along = j / length;
      const fade = Math.min(1, along * 6, (1 - along) * 6);
      const centre = u + drift * along;
      const row = ((Math.floor(v0 + j) % size) + size) % size;
      for (let i = Math.floor(centre - width); i <= Math.ceil(centre + width); i++) {
        const d = (i - centre) / width;
        if (Math.abs(d) >= 1) continue;
        const col = ((i % size) + size) % size;
        height[row * size + col] += amplitude * fade * (1 - d * d) ** 2;
      }
    }
  };
  for (let i = 0; i < 2600; i++) scratch(0.7 + random() * 1.3, 0.25, 1);    // hairlines
  for (let i = 0; i < 420; i++) scratch(2.5 + random() * 3.5, 0.45, 0.6);    // visible strokes
  for (let i = 0; i < 70; i++) scratch(12 + random() * 22, 0.7, 0.4);        // broad bands that survive at a distance
  let peak = 1e-6;
  for (let i = 0; i < height.length; i++) peak = Math.max(peak, Math.abs(height[i]));
  const data = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const n = row * size + col;
    const h = height[n] / peak;
    const slope = (height[row * size + ((col + 1) % size)] - height[row * size + ((col + size - 1) % size)]) / peak;
    data[n * 4] = Math.round(THREE.MathUtils.clamp(0.5 + 0.5 * h, 0, 1) * 255);
    data[n * 4 + 1] = Math.round(THREE.MathUtils.clamp(0.5 + 1.6 * slope, 0, 1) * 255);
    data[n * 4 + 2] = 128;
    data[n * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = 'Brushed-steel grain';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** The single environment lookup of the stock shader; replaced by a fan of
 * lookups across the scratches. */
const STOCK_IBL = 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );';

/** Position along the geometry's axes in millimetres, and those axes as seen
 * by the camera. */
const GRAIN_VARYINGS = /* glsl */`
  varying vec3 vLunaPos;
  varying vec3 vLunaX;
  varying vec3 vLunaY;
  varying vec3 vLunaZ;
  varying float vLunaShift;
`;

const GRAIN_VERTEX = /* glsl */`
  mat3 lunaToView = mat3( modelViewMatrix );
  #ifdef USE_INSTANCING
    lunaToView = lunaToView * mat3( instanceMatrix );
  #endif
  #ifdef USE_BATCHING
    lunaToView = lunaToView * mat3( batchingMatrix );
  #endif
  vLunaX = lunaToView[ 0 ];
  vLunaY = lunaToView[ 1 ];
  vLunaZ = lunaToView[ 2 ];
  // True millimetres even where a mesh is stretched (links scaled to width).
  vLunaPos = transformed * vec3( length( vLunaX ), length( vLunaY ), length( vLunaZ ) );
  // Rows of one shape (bracelet links) each get their own stretch of grain.
  // It depends on Z alone, so a crown sliding out along X and parts lifted
  // along Y keep theirs.
  float lunaRow = modelMatrix[ 3 ].z;
  #ifdef USE_INSTANCING
    lunaRow += instanceMatrix[ 3 ].z;
  #endif
  vLunaShift = lunaRow * 0.2137;
`;

/** Scratches run perpendicular to the X axis along the surface: lengthwise
 * over lugs and links, and all the way round a bracelet loop. Faces that look
 * along X fall back to scratches along Z. */
const GRAIN_LINEAR = /* glsl */`
  vec3 lunaX = normalize( vLunaX );
  vec3 lunaZ = normalize( vLunaZ );
  vec3 lunaAlong = cross( normal, lunaX );
  float lunaSide = smoothstep( 0.1, 0.4, length( lunaAlong ) );
  vec3 lunaFallback = lunaZ - normal * dot( normal, lunaZ );
  lunaFallback *= dot( lunaFallback, lunaAlong ) < 0.0 ? - 1.0 : 1.0;
  lunaAlong = normalize( mix( lunaFallback, normalize( lunaAlong + 1e-6 ), lunaSide ) + 1e-6 );
  vec3 lunaAcross = cross( lunaAlong, normal );
  vec2 lunaUv = vec2(
    mix( vLunaPos.y, vLunaPos.x, lunaSide ) / ${GRAIN_ACROSS_MM.toFixed(1)},
    ( vLunaPos.z + vLunaPos.y ) / ${GRAIN_ALONG_MM.toFixed(1)} ) + vLunaShift;
  vec4 lunaGrain = texture2D( lunaGrainMap, lunaUv );
`;

/** Scratches run around the Y axis: rings on flat faces, level lines on
 * walls. The angle wraps, so texture gradients are given explicitly. */
const GRAIN_CIRCULAR = /* glsl */`
  vec3 lunaX = normalize( vLunaX );
  vec3 lunaY = normalize( vLunaY );
  vec3 lunaZ = normalize( vLunaZ );
  vec3 lunaNormalG = vec3( dot( normal, lunaX ), dot( normal, lunaY ), dot( normal, lunaZ ) );
  float lunaRadius = max( length( vLunaPos.xz ), 1e-3 );
  vec3 lunaRing = vec3( - vLunaPos.z, 0.0, vLunaPos.x ) / lunaRadius;
  vec3 lunaAlongG = lunaRing - lunaNormalG * dot( lunaNormalG, lunaRing );
  vec3 lunaAlong = normalize( lunaX * lunaAlongG.x + lunaY * lunaAlongG.y + lunaZ * lunaAlongG.z + 1e-6 );
  vec3 lunaAcross = cross( lunaAlong, normal );
  // Across the grain the coordinate follows the profile: outwards on flat
  // faces, up or down on walls (the sign keeps it monotonic over chamfers).
  float lunaUp = lunaNormalG.y < 0.0 ? 1.0 : - 1.0;
  vec3 lunaPx = dFdx( vLunaPos );
  vec3 lunaPy = dFdy( vLunaPos );
  vec2 lunaUv = vec2(
    ( lunaRadius + lunaUp * vLunaPos.y ) / ${GRAIN_ACROSS_MM.toFixed(1)},
    atan( vLunaPos.z, vLunaPos.x ) * ${(3 / (Math.PI * 2)).toFixed(6)} );
  vec2 lunaUvDx = vec2(
    ( dot( lunaPx.xz, vLunaPos.xz ) / lunaRadius + lunaUp * lunaPx.y ) / ${GRAIN_ACROSS_MM.toFixed(1)},
    ( vLunaPos.x * lunaPx.z - vLunaPos.z * lunaPx.x ) / ( lunaRadius * lunaRadius ) * ${(3 / (Math.PI * 2)).toFixed(6)} );
  vec2 lunaUvDy = vec2(
    ( dot( lunaPy.xz, vLunaPos.xz ) / lunaRadius + lunaUp * lunaPy.y ) / ${GRAIN_ACROSS_MM.toFixed(1)},
    ( vLunaPos.x * lunaPy.z - vLunaPos.z * lunaPy.x ) / ( lunaRadius * lunaRadius ) * ${(3 / (Math.PI * 2)).toFixed(6)} );
  vec4 lunaGrain = textureGrad( lunaGrainMap, lunaUv, lunaUvDx, lunaUvDy );
`;

/** Seen from far away the scratches are finer than a pixel and average out.
 * A second, much coarser stretch of the same texture takes over there at
 * reduced strength, so the steel still reads as brushed in the overview
 * without looking hatched. `lunaSpread` is the footprint of a pixel across
 * the grain, in texture periods. */
const GRAIN_FAR_LINEAR = /* glsl */`
  float lunaSpread = fwidth( lunaUv.x );
  vec4 lunaFar = texture2D( lunaGrainMap, lunaUv * vec2( 0.21, 0.37 ) + 0.53 );
`;
const GRAIN_FAR_CIRCULAR = /* glsl */`
  float lunaSpread = abs( lunaUvDx.x ) + abs( lunaUvDy.x );
  vec4 lunaFar = textureGrad( lunaGrainMap, lunaUv * vec2( 0.21, 0.37 ) + 0.53, lunaUvDx * vec2( 0.21, 0.37 ), lunaUvDy * vec2( 0.21, 0.37 ) );
`;

/** Single scratches tilt the normal, vary the roughness and darken or
 * brighten the reflection a little, which keeps the grain readable inside a
 * highlight. Mip-mapping fades the fine scratches out with distance, where
 * the coarse ones and the smeared reflection below take over. */
const GRAIN_SHADE = /* glsl */`
  lunaGrain = mix( lunaGrain, mix( vec4( 0.5 ), lunaFar, 0.45 ), smoothstep( 0.012, 0.05, lunaSpread ) );
  normal = normalize( normal + lunaAcross * ( ( lunaGrain.g - 0.5 ) * 0.3 ) );
  roughnessFactor = clamp( roughnessFactor * ( 0.78 + 0.44 * lunaGrain.r ), 0.05, 1.0 );
  float lunaStreak = 0.86 + 0.28 * lunaGrain.r;
`;

/** Lookups fanned out across the scratches stretch every reflection into the
 * streak that makes brushed metal read as brushed: a softbox becomes a long
 * gradient instead of a white patch. The weights follow the wide lobe of the
 * scratches' cross-section; each lookup is blurred enough to meet the next. */
const GRAIN_IBL = /* glsl */`
  {
    float lunaBlur = max( material.roughness, 0.34 );
    vec3 lunaFan = lunaAcross * 0.17;
    vec3 lunaSmear = 0.3 * getIBLRadiance( geometryViewDir, geometryNormal, lunaBlur );
    lunaSmear += 0.22 * ( getIBLRadiance( geometryViewDir, normalize( geometryNormal + lunaFan ), lunaBlur )
      + getIBLRadiance( geometryViewDir, normalize( geometryNormal - lunaFan ), lunaBlur ) );
    lunaSmear += 0.13 * ( getIBLRadiance( geometryViewDir, normalize( geometryNormal + 2.0 * lunaFan ), lunaBlur )
      + getIBLRadiance( geometryViewDir, normalize( geometryNormal - 2.0 * lunaFan ), lunaBlur ) );
    radiance += lunaSmear * lunaStreak;
  }
`;

/** The lamps are points to the renderer. On a rough metal their highlight is
 * a wide lobe many times brighter than white, which burns flat lug and link
 * tops out in every three-quarter view. A satin surface keeps only this share
 * of it; its light comes from the studio around it. */
const LAMP_SHARE = 0.22;

type GrainDirection = 'linear' | 'circular' | 'none';

/** A standard metal with a satin finish: the grain (if any) is added to the
 * shader and the lamps are toned down. A clone keeps both. */
class SatinSteel extends THREE.MeshStandardMaterial {
  constructor(
    private grain: THREE.Texture | null = null,
    private direction: GrainDirection = 'none',
    parameters?: THREE.MeshStandardMaterialParameters,
  ) {
    super(parameters);
  }

  override copy(source: SatinSteel): this {
    super.copy(source);
    this.grain = source.grain;
    this.direction = source.direction;
    return this;
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    const lightMaps = THREE.ShaderChunk.lights_fragment_maps;
    if (shader.fragmentShader.includes('#include <lights_fragment_end>')) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
        `#include <lights_fragment_end>\nreflectedLight.directSpecular *= ${LAMP_SHARE.toFixed(3)};`);
    }
    const patchable = this.grain !== null && this.direction !== 'none'
      && shader.vertexShader.includes('#include <project_vertex>')
      && shader.fragmentShader.includes('#include <normal_fragment_maps>')
      && shader.fragmentShader.includes('#include <lights_fragment_maps>')
      && lightMaps.includes(STOCK_IBL);
    // An unexpected three.js shader layout leaves a plain satin metal.
    if (!patchable) return;
    const linear = this.direction === 'linear';
    shader.uniforms.lunaGrainMap = { value: this.grain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRAIN_VARYINGS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${GRAIN_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D lunaGrainMap;\n${GRAIN_VARYINGS}`)
      .replace('#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${linear ? GRAIN_LINEAR + GRAIN_FAR_LINEAR : GRAIN_CIRCULAR + GRAIN_FAR_CIRCULAR}${GRAIN_SHADE}`)
      .replace('#include <lights_fragment_maps>', lightMaps.replace(STOCK_IBL, GRAIN_IBL));
  }

  override customProgramCacheKey(): string {
    return `luna-satin-${this.grain ? this.direction : 'none'}`;
  }
}
