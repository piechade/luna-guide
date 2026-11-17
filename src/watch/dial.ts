import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  APERTURE_CENTER, APERTURE_R, CLOUD_DROP, CLOUD_GAP_R, CLOUD_OFFSET, CLOUD_R, DATE_CENTER_X, DATE_H,
  DATE_POSITIONS, DATE_RING_INNER_R, DATE_RING_OUTER_R, DATE_RING_Y, DATE_W, DIAL_R, DIAL_Y, MOON_DISC_CENTER_Z,
  MOON_DISC_R, MOON_DISC_STEPS, MOON_DISC_Y, MOON_ORBIT_R, MOON_R,
} from './dimensions';
import type { WatchMaterials } from './materials';
import { makeDialOcclusionTexture, makeFrostedGrain, makeLetteringSheet, type Silhouette } from './textures';
import numeralData from './numerals.json';

export interface DialParts {
  /** Everything of the dial side: `face` plus the calendar discs beneath it. */
  group: THREE.Group;
  /** Dial plate with its applied furniture and overlays. An exploded view lifts
   * this sub-group, the cloud plate of the moon window included; the moon
   * disc, the date ring and the pipes that carry the hands stay where they
   * are, on the movement. */
  face: THREE.Group;
  /** Moon-disc position in daily steps, 59 to a revolution: a moon stands
   * centred in the window at 0 and again every 29.5 steps. */
  setMoon(days: number): void;
  /** Date in the window, 1..31. Fractional values are positions mid-jump. */
  setDate(value: number): void;
  /** Opacity (0..1) of the 20:00–04:00 switching-window sector drawn over the minute track. */
  setDanger(opacity: number): void;
}

// All flat artwork is laid out in "plan" coordinates: millimetres, x towards
// three o'clock, y towards twelve. In the model a plan point (x, y) sits at
// (x, height, -y).

/** The plate continues a little under the foot of the rehaut, so no gap can open at the rim. */
const PLATE_R = DIAL_R + 0.12;
const PLATE_THICKNESS = 0.4;
/** Pitch circle of the minute track. */
const TRACK_R = 14.3;
/** Applied numerals: centre radius and height above the dial. */
const NUMERAL_R = 11.75;
const NUMERAL_HEIGHT = 0.3;
/** All arrow indices are cropped from one taper that would end in a point at the apex radius. */
const INDEX_APEX_R = 10.35;
const INDEX_OUTER_R = 13.5;
const INDEX_HALF_WIDTH = 0.475;
const INDEX_EAVE = 0.06;
const INDEX_RIDGE = 0.3;
/** The short index at six starts here, clear of the moon window. */
const SIX_INDEX_INNER_R = 12.72;
/** Moon window: width and depth of the polished bevel around its bore. */
const WINDOW_BEVEL = 0.22;
const WINDOW_BEVEL_DEPTH = 0.11;
/** Cloud plate: seated in the bore of the moon window, its face this far below
 * the dial surface. Its underside stays clear of the moons on the disc. */
const CLOUD_PLATE_DEPTH = 0.27;
const CLOUD_PLATE_THICKNESS = 0.11;
/** Cutter radius in the notches between the clouds. */
const CLOUD_NOTCH_R = 0.035;
/** Corner radius of the date window and height of the date numerals. */
const DATE_CORNER_R = 0.22;
const DATE_DIGIT_H = 1.5;
/** Centre hole of the dial, and the pipes of the hands that come up through it. */
const CENTRE_HOLE_R = 0.42;

const TAU = Math.PI * 2;
type Vec2 = THREE.Vector2;
const vec2 = (x: number, y: number): Vec2 => new THREE.Vector2(x, y);

export function makeDial(m: WatchMaterials): DialParts {
  const group = new THREE.Group();
  group.name = 'Dial';
  const face = new THREE.Group();
  face.name = 'Dial face';
  group.add(face);
  const onDial = <T extends THREE.Object3D>(part: T, name: string): T => {
    part.name = name;
    part.position.y = DIAL_Y;
    face.add(part);
    return part;
  };

  // --- Openings ------------------------------------------------------------
  const moonWindow = circlePath(0, -APERTURE_CENTER, APERTURE_R, 160);
  const dateWindow = roundedRectPath(DATE_CENTER_X, 0, DATE_W, DATE_H, DATE_CORNER_R, 7);
  // The plate ends at the top of the moon window's bevel. At the date window
  // it is cut a little wider than the opening; the frame covers the cut.
  const plateOutline = [
    circlePath(0, 0, PLATE_R, 256),
    insetPath(moonWindow, true, WINDOW_BEVEL),
    roundedRectPath(DATE_CENTER_X, 0, DATE_W + 0.34, DATE_H + 0.34, DATE_CORNER_R + 0.17, 7),
    circlePath(0, 0, CENTRE_HOLE_R, 40),
  ];

  // --- Applied furniture: one polished-steel mesh --------------------------
  const steel = new MeshBuilder();
  const shadows: Silhouette[] = [];
  // The moon window reaches down to six o'clock: no numeral there.
  for (const hour of [12, 2, 4, 8, 10]) {
    const angle = hour / 12 * TAU;
    for (const outline of numeralOutlines(String(hour), Math.sin(angle) * NUMERAL_R, Math.cos(angle) * NUMERAL_R)) {
      steel.plate(outline, { top: NUMERAL_HEIGHT, base: -0.08, bevel: 0.075, segments: 4 });
      shadows.push(outline);
    }
  }
  for (const hour of [1, 5, 7, 9, 11]) shadows.push(addArrowIndex(steel, hour, INDEX_APEX_R + 0.2, INDEX_OUTER_R));
  // The stubs at three and six only keep the wide end of the taper, beside
  // the date window and below the moon window.
  shadows.push(addArrowIndex(steel, 3, DATE_CENTER_X + DATE_W / 2 + 0.55, INDEX_OUTER_R));
  shadows.push(addArrowIndex(steel, 6, SIX_INDEX_INNER_R, INDEX_OUTER_R));

  // Moon window: a polished bevel, flush with the dial, down to the bore.
  steel.sweep(moonWindow, true, [{ a: 0, y: -WINDOW_BEVEL_DEPTH }, { a: -WINDOW_BEVEL, y: 0 }]);
  // Date window frame: a deep wall down to the date ring, chamfer and bead.
  steel.sweep(dateWindow, true, [
    { a: 0, y: DATE_RING_Y - DIAL_Y + 0.05 }, { a: 0, y: -0.12 }, { a: -0.13, y: 0.025 },
    ...beadProfile(-0.17, 0.025, 0.04), { a: -0.21, y: -0.03 },
  ]);
  shadows.push([roundedRectPath(DATE_CENTER_X, 0, DATE_W + 0.42, DATE_H + 0.42, DATE_CORNER_R + 0.21, 7), dateWindow]);
  onDial(new THREE.Mesh(steel.build(), m.steel), 'Applied numerals, indices and window frames');

  // --- Dial plate ----------------------------------------------------------
  // Sunray-brushed metal under blue lacquer. Half of the plate is the deep
  // blue itself, the other half mirrors in a pale steel blue (ior and
  // specularColor): the ray sectors that catch the key lamp or a softbox stand
  // bright against the deep sectors between them. Metalness stays below 0.9,
  // so the plate also receives the shadows of the hands (scene.ts).
  const lacquer = new THREE.MeshPhysicalMaterial({
    color: 0x0d3f79, metalness: 0.5, roughness: 0.4, anisotropy: 0.8, ior: 2.8, specularColor: 0xc4edff,
    // A thin, soft lacquer coat: glossier and it would veil the blue with studio reflections.
    clearcoat: 0.12, clearcoatRoughness: 0.34,
    aoMap: makeDialOcclusionTexture(shadows, PLATE_R, DIAL_R - 1),
  });
  brushedFinish(lacquer, 0.18);
  const front = new MeshBuilder((x, y) => [x / (2 * PLATE_R) + 0.5, y / (2 * PLATE_R) + 0.5]);
  front.cap(plateOutline, 0, 0, true);
  onDial(new THREE.Mesh(front.build(), lacquer), 'Sunray dial plate');

  const back = new MeshBuilder();
  back.sweep(plateOutline[0], false, [{ a: 0, y: -PLATE_THICKNESS }, { a: 0, y: 0 }]);
  back.sweep(plateOutline[3], true, [{ a: 0, y: -PLATE_THICKNESS }, { a: 0, y: 0 }]);
  back.cap(plateOutline, 0, -PLATE_THICKNESS, false);
  onDial(new THREE.Mesh(back.build(), m.brushed), 'Dial plate underside');

  // --- Print: minute track and lettering -----------------------------------
  const print = new THREE.MeshStandardMaterial({ color: 0xe9edf3, metalness: 0, roughness: 0.42 });
  const track = new MeshBuilder();
  for (let minute = 0; minute < 60; minute++) {
    const angle = minute / 60 * TAU;
    const five = minute % 5 === 0;
    track.plate([circlePath(Math.sin(angle) * TRACK_R, Math.cos(angle) * TRACK_R, five ? 0.235 : 0.125, five ? 18 : 12)],
      { top: 0.036, base: -0.02, bevel: 0.022, segments: 1 });
  }
  onDial(new THREE.Mesh(track.build(), print), 'Minute track');

  const sheet = makeLetteringSheet();
  const lettering = new MeshBuilder();
  for (const { rect: [x0, y0, x1, y1], uv: [u0, v0, u1, v1] } of sheet.decals) {
    lettering.quad(
      lettering.vertex(x0, 0.02, -y0, 0, 1, 0, u0, v0), lettering.vertex(x1, 0.02, -y0, 0, 1, 0, u1, v0),
      lettering.vertex(x1, 0.02, -y1, 0, 1, 0, u1, v1), lettering.vertex(x0, 0.02, -y1, 0, 1, 0, u0, v1),
    );
  }
  const letteringMesh = onDial(new THREE.Mesh(lettering.build(), new THREE.MeshStandardMaterial({
    color: 0xe9edf3, metalness: 0, roughness: 0.42, alphaMap: sheet.texture, transparent: true,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  })), 'Dial lettering');
  letteringMesh.renderOrder = 1;

  // --- Moon phase ----------------------------------------------------------
  // Frosted silver of the cloud plate and the moons: bright and neutral, with
  // a grain fine enough to sparkle in a close-up.
  const grain = makeFrostedGrain();
  const grainUv = (x: number, y: number): [number, number] => [x / grain.tile, y / grain.tile];
  const frostedSilver = (color: number, vertexColors = false): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({
    color, metalness: 0.5, roughness: 0.5, map: grain.map, normalMap: grain.normalMap, normalScale: vec2(0.35, 0.35), vertexColors,
  });

  // The cloud plate is fixed in the bore of the window and leaves with the
  // dial. The wall of the bore above and below it is part of the same mesh,
  // tinted dark: it is only ever seen in the shadow of the dial.
  const cloudPlate = new MeshBuilder(grainUv);
  cloudPlate.plate([cloudPlatePath()], {
    top: -CLOUD_PLATE_DEPTH, base: -CLOUD_PLATE_DEPTH - CLOUD_PLATE_THICKNESS, bevel: 0.025, segments: 2,
  });
  const bore = new MeshBuilder(grainUv);
  bore.sweep(moonWindow, true, [{ a: 0, y: -PLATE_THICKNESS - 0.03 }, { a: 0, y: -WINDOW_BEVEL_DEPTH }]);
  onDial(new THREE.Mesh(
    mergeGeometries([tinted(cloudPlate.build(), 0xffffff), tinted(bore.build(), 0x27314a)]),
    underDialMaterial(frostedSilver(0xe0e3e7, true), {
      turn: { value: vec2(1, 0) }, shade: { value: 1 }, centreZ: 0, opening: WINDOW_OPENING, depth: CLOUD_PLATE_DEPTH / (DIAL_Y - MOON_DISC_Y),
    }),
  ), 'Cloud plate and bore of the moon window');

  // The disc turns under the dial, concentric with the window. Its materials
  // draw the soft shadows that the dial and the cloud plate throw onto it.
  const dialShade = { value: 1 };
  const discTurn = { value: vec2(1, 0) };
  const moonDisc = new THREE.Group();
  moonDisc.name = 'Two-moon calendar disc';
  moonDisc.position.set(0, MOON_DISC_Y, MOON_DISC_CENTER_Z);
  group.add(moonDisc);
  const onDisc = (builder: MeshBuilder, name: string, material: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(builder.build(), underDialMaterial(material, {
      turn: discTurn, shade: dialShade, centreZ: MOON_DISC_CENTER_Z, opening: MOON_OPENING,
    }));
    mesh.name = name;
    moonDisc.add(mesh);
    return mesh;
  };

  const sky = new MeshBuilder();
  sky.sweep(circlePath(0, 0, MOON_DISC_R, 128), false, [{ a: 0, y: -0.1 }, { a: 0, y: -0.02 }, { a: -0.02, y: 0 }]);
  sky.cap([circlePath(0, 0, MOON_DISC_R, 128)], 0.02, 0, true);
  // Night-blue enamel: its reflections are kept weak and blue, so the sky never washes out to grey.
  const skyMesh = onDisc(sky, 'Night sky', new THREE.MeshPhysicalMaterial({
    color: 0x061440, roughness: 0.38, specularIntensity: 0.5, specularColor: 0x4f78e0,
  }));
  // The shadow belongs to the dial: it fades as an exploded view lifts the face off.
  const followFace = (): void => { dialShade.value = THREE.MathUtils.clamp(1 - face.position.y / 2, 0, 1); };
  skyMesh.onBeforeRender = followFace;

  const stars = new MeshBuilder();
  for (const star of starField()) addStar(stars, star.x, star.y, star.size, star.turn);
  // The screw that holds the disc on its arbor; the cloud plate hides it, the opened
  // watch shows its slot turning. Two halves stand on the enamel: the gap is the slot.
  for (const half of screwHeadHalves(0.62, 0.075)) stars.plate([half], { top: 0.04, base: -0.01, bevel: 0.015, segments: 2 });
  onDisc(stars, 'Stars and disc screw', new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 0.5, roughness: 0.45 }));

  // Two flat moons, half a turn apart, in the frosted silver of the clouds but a shade lighter.
  const moons = new MeshBuilder(grainUv);
  for (const side of [1, -1]) {
    moons.plate([circlePath(0, side * MOON_ORBIT_R, MOON_R, 72)], { top: 0.035, base: -0.01, bevel: 0.012, segments: 2 });
  }
  onDisc(moons, 'Moons', frostedSilver(0xf2f4f7));

  // --- Date ring -----------------------------------------------------------
  // Matt print: a glossy ring would wash the black numerals out to grey under the studio panels.
  const ringTurn = { value: vec2(1, 0) };
  const dateRing = new THREE.Mesh(dateRingGeometry(), underDialMaterial(new THREE.MeshPhysicalMaterial({
    vertexColors: true, metalness: 0, roughness: 0.85, specularIntensity: 0.25,
  }), { turn: ringTurn, shade: dialShade, centreZ: 0, opening: DATE_OPENING }));
  dateRing.name = 'Date ring';
  dateRing.position.y = DATE_RING_Y;
  // The ring lies deep in a narrow well, where the shadow map of the key light
  // breaks up into steps. The soft shadow of the window is drawn by its material.
  dateRing.userData.lunaShadow = false;
  dateRing.onBeforeRender = followFace;
  group.add(dateRing);

  // The three concentric pipes of the hands come up through the centre hole:
  // hour wheel, cannon pinion and seconds arbor. Each is slimmer than the hub
  // of its hand (hands.ts), so they only show once the hands are lifted off.
  // They stand on the movement's hour-wheel and cannon-pinion pipes, which end
  // just under the dial.
  const pipes = new MeshBuilder();
  const pipeRing = circlePath(0, 0, CENTRE_HOLE_R - 0.03, 32);
  const pipeFoot = DIAL_Y - PLATE_THICKNESS - 0.05;
  pipes.sweep(pipeRing, false, [
    { a: 0, y: pipeFoot }, { a: 0, y: DIAL_Y + 0.33 }, { a: -0.09, y: DIAL_Y + 0.33 }, { a: -0.09, y: DIAL_Y + 0.67 },
    { a: -0.28, y: DIAL_Y + 0.67 }, { a: -0.28, y: DIAL_Y + 0.91 }, { a: -0.3, y: DIAL_Y + 0.93 },
  ]);
  pipes.cap([pipeRing], 0.3, DIAL_Y + 0.93, true);
  const arbor = new THREE.Mesh(pipes.build(), m.steel);
  arbor.name = 'Hand arbor post';
  group.add(arbor);

  // --- Lock-out sector -----------------------------------------------------
  const dangerMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  });
  const dangerSector = onDial(new THREE.Mesh(dangerSectorGeometry(), dangerMaterial), 'Lock-out sector overlay');
  dangerSector.renderOrder = 2;
  dangerSector.visible = false;

  return {
    group,
    face,
    // Forward steps turn the disc clockwise seen from the dial: the moon travels left to right.
    setMoon: days => {
      const turn = -days * TAU / MOON_DISC_STEPS;
      moonDisc.rotation.y = turn;
      discTurn.value.set(Math.cos(turn), Math.sin(turn));
    },
    // Advancing the date turns the ring clockwise: the next numeral comes down into the window.
    setDate: value => {
      const turn = -(value - 1) * TAU / DATE_POSITIONS;
      dateRing.rotation.y = turn;
      ringTurn.value.set(Math.cos(turn), Math.sin(turn));
    },
    // Amber only stays warm over the blue lacquer when it covers well, hence the gain.
    setDanger: opacity => { dangerMaterial.opacity = Math.min(1, opacity * 1.5); dangerSector.visible = opacity > 0.001; },
  };
}

// ---------------------------------------------------------------------------
// Materials

/**
 * Gives a physical material the sunray finish: brushing grooves that run
 * radially from the mesh origin. The anisotropic highlight is aligned to them
 * per pixel, so the bright sectors sweep around as the camera orbits, and
 * every groove is tilted a little (`depth`) to break the sectors into rays.
 */
function brushedFinish(material: THREE.MeshPhysicalMaterial, depth: number): void {
  material.onBeforeCompile = shader => {
    shader.uniforms.brushDepth = { value: depth };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBrushAxis;
        varying vec2 vBrushPlan;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Both are linear in the position, so they interpolate exactly across large triangles.
        vBrushPlan = position.xz;
        vBrushAxis = ( modelViewMatrix * vec4( position.x, 0.0, position.z, 0.0 ) ).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float brushDepth;
        varying vec3 vBrushAxis;
        varying vec2 vBrushPlan;
        float brushHash( float p ) {
          p = fract( p * 0.1031 );
          p *= p + 33.33;
          p *= p + p;
          return fract( p );
        }
        // Brush lines around the turn: four octaves of periodic 1-D noise, from
        // broad rays to hairlines, each faded out before its lines get thinner
        // than a pixel.
        float brushLines( float turn, float footprint ) {
          float sum = 0.0;
          float cells = 75.0;
          for ( int octave = 0; octave < 4; octave ++ ) {
            float x = turn * cells;
            float cell = floor( x );
            float t = fract( x );
            t = t * t * ( 3.0 - 2.0 * t );
            float line = mix( brushHash( mod( cell, cells ) + 7.0 ), brushHash( mod( cell + 1.0, cells ) + 7.0 ), t );
            float gain = octave == 0 ? 0.3 : ( octave == 1 ? 0.5 : 0.36 );
            sum += gain * smoothstep( 0.7, 2.4, 1.0 / ( cells * footprint ) ) * ( line * 2.0 - 1.0 );
            cells *= 4.0;
          }
          return sum;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 brushAlong = normalize( vBrushAxis - dot( vBrushAxis, normal ) * normal );
        vec3 brushAcross = cross( normal, brushAlong );
        float brushTurn = atan( vBrushPlan.y, vBrushPlan.x ) / 6.28318530718 + 0.5;
        float brushFootprint = length( fwidth( vBrushPlan ) ) / ( 6.28318530718 * max( length( vBrushPlan ), 0.001 ) );
        normal = normalize( normal + brushAcross * ( brushDepth * brushLines( brushTurn, brushFootprint ) ) );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.anisotropyB = normalize( brushAlong - dot( brushAlong, normal ) * normal );
        material.anisotropyT = cross( normal, material.anisotropyB );`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #ifdef USE_AOMAP
          // The baked contact shadows dim the direct light as well.
          reflectedLight.directDiffuse *= ambientOcclusion;
          reflectedLight.directSpecular *= ambientOcclusion;
        #endif`);
    // An unexpected three.js shader layout leaves the stock reflection.
    const lightMaps = THREE.ShaderChunk.lights_fragment_maps;
    if (lightMaps.includes(STOCK_ANISOTROPY_IBL)) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_fragment_maps>', lightMaps.replace(STOCK_ANISOTROPY_IBL, SUNRAY_IBL));
    }
  };
}

/** The single, bent environment lookup of the stock anisotropic material. */
const STOCK_ANISOTROPY_IBL = 'radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );';

/** Brushing grooves scatter light across their run only. A fan of lookups
 * across the grooves draws every softbox of the studio out into a bright ray
 * sector that points at right angles to it; between them the plate stays deep.
 * The weights add up to one half: the lacquer swallows the rest, and
 * `envMapIntensity` could not dim it (three.js ignores it for a scene environment). */
const SUNRAY_IBL = /* glsl */`
  {
    vec3 sunrayFan = material.anisotropyT;
    float sunrayBlur = max( material.roughness, 0.34 );
    vec3 sunray = vec3( 0.0 );
    for ( int i = 0; i < 3; i ++ ) {
      float tilt = i == 0 ? 0.3 : ( i == 1 ? 0.55 : 0.8 );
      float weight = i == 1 ? 0.1 : 0.075;
      sunray += weight * ( getIBLRadiance( geometryViewDir, normalize( geometryNormal + tilt * sunrayFan ), sunrayBlur )
        + getIBLRadiance( geometryViewDir, normalize( geometryNormal - tilt * sunrayFan ), sunrayBlur ) );
    }
    radiance += sunray;
  }
`;

/** Where a turning calendar part lies under the dial, and what the dial does to it there. */
interface UnderDial {
  /** (cos, sin) of the part's rotation about its own centre. */
  turn: THREE.IUniform<Vec2>;
  /** Strength of the dial's shadow on the part, 0..1; shared by all parts. */
  shade: THREE.IUniform<number>;
  /** Distance of the part's centre from the dial axis towards six o'clock. */
  centreZ: number;
  /** GLSL body of `float dialOpening( vec2 p )`: how far the plan position p
   * (x, z towards six) lies inside the opening above the part, in millimetres. */
  opening: string;
  /** How far the part lies below the dial surface, as a share of the depth of
   * the moon disc: reach and softness of the shadow follow it. Default 1. */
  depth?: number;
}

const glsl = (n: number): string => n.toFixed(4);

/** Inside of the moon window as its disc sees it: clear of the rim and of the
 * cloud plate. The plate lies close above the disc, so its shadow is drawn
 * half as wide as that of the dial edge. `q` is measured from the line of
 * the cloud centres. */
const MOON_OPENING = `
  vec2 q = vec2( abs( p.x ), ${glsl(APERTURE_CENTER + CLOUD_DROP)} - p.y );
  float rim = ${glsl(APERTURE_R)} - length( q - vec2( 0.0, ${glsl(CLOUD_DROP)} ) );
  float cloud = length( q - vec2( ${glsl(CLOUD_OFFSET)}, 0.0 ) ) - ${glsl(CLOUD_R)};
  float rise = length( q ) - ${glsl(CLOUD_GAP_R)};
  return min( rim, 2.0 * min( q.y, min( cloud, rise ) ) );`;

/** Inside of the moon window as the cloud plate in its bore sees it. */
const WINDOW_OPENING = `
  return ${glsl(APERTURE_R)} - length( p - vec2( 0.0, ${glsl(APERTURE_CENTER)} ) );`;

/** Inside of the date window, a rounded rectangle. */
const DATE_OPENING = `
  vec2 q = abs( p - vec2( ${glsl(DATE_CENTER_X)}, 0.0 ) ) - vec2( ${glsl(DATE_W / 2 - DATE_CORNER_R)}, ${glsl(DATE_H / 2 - DATE_CORNER_R)} );
  return ${glsl(DATE_CORNER_R)} - length( max( q, 0.0 ) ) - min( max( q.x, q.y ), 0.0 );`;

/**
 * Prepares a material of a part that turns under the dial. Each fragment
 * knows its place under the dial, whatever the rotation, and the edge of the
 * opening above throws a soft shadow onto it, offset for a key light from the
 * eight o'clock side.
 */
function underDialMaterial<T extends THREE.Material>(material: T, { turn, shade, centreZ, opening, depth = 1 }: UnderDial): T {
  material.onBeforeCompile = shader => {
    shader.uniforms.partTurn = turn;
    shader.uniforms.dialShade = shade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 partTurn;
        varying vec2 vDialPlan;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDialPlan = vec2( partTurn.x * position.x + partTurn.y * position.z,
          partTurn.x * position.z - partTurn.y * position.x + ${glsl(centreZ)} );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float dialShade;
        varying vec2 vDialPlan;
        float dialOpening( vec2 p ) {${opening}
        }`)
      .replace('#include <opaque_fragment>', `
        float dialLight = smoothstep( -0.08, ${glsl(0.4 * depth)}, dialOpening( vDialPlan - vec2( ${glsl(0.1 * depth)}, ${glsl(-0.12 * depth)} ) ) );
        outgoingLight *= mix( 1.0, 0.38 + 0.62 * dialLight, dialShade );
        #include <opaque_fragment>`);
  };
  // The injected code differs between parts although the callback is the same function.
  material.customProgramCacheKey = () => `${opening}|${depth}`;
  return material;
}

// ---------------------------------------------------------------------------
// Parts

interface AppliedGlyph { width: number; strokes: { closed: boolean; points: number[][] }[] }

/** Outlines of an applied numeral ("12", "8", ...) centred on a plan position, one per stroke. */
function numeralOutlines(text: string, centreX: number, centreY: number): Silhouette[] {
  const { capHeight, stroke } = numeralData.applied;
  const glyphs: Record<string, AppliedGlyph> = numeralData.applied.glyphs;
  // A bar and a round figure sit closer together than the raw outlines suggest.
  const gap = 0.32;
  const width = [...text].reduce((sum, ch) => sum + glyphs[ch].width, 0) + gap * (text.length - 1);
  const outlines: Silhouette[] = [];
  let x = centreX - width / 2;
  for (const ch of text) {
    for (const { closed, points } of glyphs[ch].strokes) {
      const line = filletPath(points, closed).map(p => p.add(vec2(x, centreY - capHeight / 2)));
      outlines.push(strokeOutline(line, stroke / 2, closed));
    }
    x += glyphs[ch].width + gap;
  }
  return outlines;
}

/**
 * Faceted arrow index on the radius of `hour`, cut from the common taper
 * between two radii. Ridge height follows the width, so both roof facets are
 * flat mirrors. Returns its footprint.
 */
function addArrowIndex(builder: MeshBuilder, hour: number, innerR: number, outerR: number): Silhouette {
  const angle = hour / 12 * TAU;
  const taper = (r: number): number => (r - INDEX_APEX_R) / (INDEX_OUTER_R - INDEX_APEX_R);
  const point = (r: number, side: number, y: number): THREE.Vector3 => {
    const across = side * INDEX_HALF_WIDTH * taper(r);
    return new THREE.Vector3(Math.sin(angle) * r + Math.cos(angle) * across, y, -(Math.cos(angle) * r - Math.sin(angle) * across));
  };
  const ridge = (r: number): THREE.Vector3 => point(r, 0, INDEX_EAVE + (INDEX_RIDGE - INDEX_EAVE) * taper(r));
  const base = -0.06;
  const inside = point((innerR + outerR) / 2, 0, 0);
  for (const side of [-1, 1]) {
    builder.facet([point(innerR, side, INDEX_EAVE), ridge(innerR), ridge(outerR), point(outerR, side, INDEX_EAVE)], inside);
    builder.facet([point(innerR, side, base), point(innerR, side, INDEX_EAVE), point(outerR, side, INDEX_EAVE), point(outerR, side, base)], inside);
  }
  for (const r of [innerR, outerR]) {
    builder.facet([point(r, -1, base), point(r, -1, INDEX_EAVE), ridge(r), point(r, 1, INDEX_EAVE), point(r, 1, base)], inside);
  }
  return [[point(innerR, -1, 0), point(innerR, 1, 0), point(outerR, 1, 0), point(outerR, -1, 0)].map(p => vec2(p.x, -p.z))];
}

/** Half-round bead of a window frame as sweep profile, from the opening side over the top. */
function beadProfile(centreA: number, y: number, r: number): ProfilePoint[] {
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 * Math.PI;
    points.push({ a: centreA + Math.cos(t) * r, y: y + Math.sin(t) * r, na: Math.cos(t), ny: Math.sin(t) });
  }
  return points;
}

/**
 * Outline of the cloud plate in the moon window. Its upper edge runs from rim
 * to rim over the left cloud, the small rise on the axis and the right cloud;
 * below, it follows the bore. A cutter cannot leave a sharp inside corner, so
 * the notches beside the rise are rounded.
 */
function cloudPlatePath(): Vec2[] {
  // The plate reaches a little into the wall of the bore, so no gap can open there.
  const seat: Circle = { x: 0, y: 0, r: APERTURE_R + 0.03 };
  const rise: Circle = { x: 0, y: -CLOUD_DROP, r: CLOUD_GAP_R };
  const cloud: Circle = { x: CLOUD_OFFSET, y: -CLOUD_DROP, r: CLOUD_R };
  const grown = (c: Circle, by: number): Circle => ({ ...c, r: c.r + by });
  const notchAt = upperCrossing(grown(rise, CLOUD_NOTCH_R), grown(cloud, CLOUD_NOTCH_R));
  const notch: Circle = { x: notchAt.x, y: notchAt.y, r: CLOUD_NOTCH_R };
  // Where the cloud runs out into the rim.
  const tip = upperCrossing(seat, cloud);
  const towards = (from: Circle, to: { x: number; y: number }): number => Math.atan2(to.y - from.y, to.x - from.x);

  // Right half, clockwise from the top of the rise round to the lowest point of the bore.
  const half = [
    ...arcPath(rise, Math.PI / 2, towards(rise, notch), false),
    ...arcPath(notch, towards(notch, rise), towards(notch, cloud), true),
    ...arcPath(cloud, towards(cloud, notch), towards(cloud, tip), false),
    ...arcPath(seat, towards(seat, tip), -Math.PI / 2, false),
  ];
  const mirrored = half.slice(1).map(p => vec2(-p.x, p.y)).reverse();
  return [...half, vec2(0, -seat.r), ...mirrored].map(p => vec2(p.x, p.y - APERTURE_CENTER));
}

interface Circle { x: number; y: number; r: number }

/** The higher of the two intersection points of two circles. */
function upperCrossing(c0: Circle, c1: Circle): Vec2 {
  const d = Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const along = (c0.r ** 2 - c1.r ** 2 + d ** 2) / (2 * d);
  const off = Math.sqrt(Math.max(0, c0.r ** 2 - along ** 2));
  const ux = (c1.x - c0.x) / d;
  const uy = (c1.y - c0.y) / d;
  const a = vec2(c0.x + ux * along - uy * off, c0.y + uy * along + ux * off);
  const b = vec2(c0.x + ux * along + uy * off, c0.y + uy * along - ux * off);
  return a.y > b.y ? a : b;
}

/** Points on a circle from one angle to another, the end point left out. The
 * steps are fine enough that the chords stay within a micrometre of the arc. */
function arcPath(c: Circle, from: number, to: number, counterClockwise: boolean): Vec2[] {
  let sweep = to - from;
  if (counterClockwise) while (sweep <= 0) sweep += TAU; else while (sweep >= 0) sweep -= TAU;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / Math.min(0.26, Math.sqrt(0.0064 / c.r))));
  const points: Vec2[] = [];
  for (let i = 0; i < steps; i++) {
    const a = from + sweep * i / steps;
    points.push(vec2(c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r));
  }
  return points;
}

/** A closed contour moved by `distance` into the solid it bounds (the solid lies outside a hole). */
function insetPath(contour: Vec2[], hole: boolean, distance: number): Vec2[] {
  return stationsOf(contour, hole).map(s => s.p.clone().addScaledVector(s.mitre, -distance));
}

/** The two halves of a slotted screw head of radius r, either side of a slot of the given half-width. */
function screwHeadHalves(r: number, slotHalf: number): Vec2[][] {
  const from = Math.asin(slotHalf / r);
  const upper: Vec2[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = from + (Math.PI - 2 * from) * i / 20;
    upper.push(vec2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return [upper, upper.map(p => vec2(-p.x, -p.y))];
}

interface Star { x: number; y: number; size: number; turn: number }

/**
 * Stars of the night sky in disc coordinates. The two halves of the disc are
 * alike; stars keep clear of the moons, of the screw in the centre and of each
 * other, and stay inside the circle that the window shows.
 */
function starField(): Star[] {
  let seed = 7;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const half: Star[] = [];
  for (let tries = 0; tries < 6000 && half.length < 13; tries++) {
    const angle = (8 + random() * 164) / 180 * Math.PI;
    const big = half.length % 4 === 0;
    const size = big ? 0.3 + random() * 0.08 : 0.16 + random() * 0.1;
    const radius = 1.25 + Math.sqrt(random()) * (APERTURE_R - 0.2 - size - 1.25);
    const star = { x: Math.sin(angle) * radius, y: Math.cos(angle) * radius, size, turn: (random() - 0.5) * 0.5 };
    const clearOfMoons = [1, -1].every(side => Math.hypot(star.x, star.y - side * MOON_ORBIT_R) > MOON_R + 0.15 + star.size);
    if (clearOfMoons && half.every(other => Math.hypot(star.x - other.x, star.y - other.y) > 0.25 + star.size + other.size)) half.push(star);
  }
  return [...half, ...half.map(s => ({ ...s, x: -s.x, y: -s.y }))];
}

/** Four-pointed sparkle with concave sides: a flat applied star with a hint of a point. */
function addStar(builder: MeshBuilder, x: number, y: number, size: number, turn: number): void {
  const rim: THREE.Vector3[] = [];
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = i / steps * TAU;
    // Superellipse with concave sides: tips on the axes, waist on the diagonals.
    const r = size / (Math.abs(Math.cos(a)) ** 0.62 + Math.abs(Math.sin(a)) ** 0.62) ** (1 / 0.62);
    rim.push(new THREE.Vector3(x + Math.cos(a + turn) * r, 0.014, -(y + Math.sin(a + turn) * r)));
  }
  // Everything on the disc stays below the underside of the cloud plate, 0.07 mm above it.
  const tip = new THREE.Vector3(x, 0.014 + size * 0.03, -y);
  const inside = new THREE.Vector3(x, -0.2, -y);
  for (let i = 0; i < steps; i++) builder.facet([tip, rim[i], rim[(i + 1) % steps]], inside);
}

/** Silver-white date ring with all 31 numerals; numeral 1 sits in the window at rotation 0. */
function dateRingGeometry(): THREE.BufferGeometry {
  const ring = new MeshBuilder();
  ring.plate([circlePath(0, 0, DATE_RING_OUTER_R, 160), circlePath(0, 0, DATE_RING_INNER_R, 128)],
    { top: 0, base: -0.14, bevel: 0.03, segments: 1 });

  const font = new FontLoader().parse(numeralData);
  const digits = new Map<string, { outlines: Silhouette[]; min: number; max: number }>();
  for (const ch of '0123456789') {
    const outlines = font.generateShapes(ch, DATE_DIGIT_H).map(shape => {
      const { shape: outline, holes } = shape.extractPoints(8);
      return [outline, ...holes].map(distinctPoints);
    });
    const xs = outlines.flat(2).map(p => p.x);
    digits.set(ch, { outlines, min: Math.min(...xs), max: Math.max(...xs) });
  }
  const ink = new MeshBuilder();
  const tracking = 0.13;
  for (let value = 1; value <= DATE_POSITIONS; value++) {
    const glyphs = [...String(value)].map(ch => digits.get(ch)!);
    const width = glyphs.reduce((sum, g) => sum + g.max - g.min, 0) + tracking * (glyphs.length - 1);
    // Upright in the window at three o'clock, then carried counter-clockwise to the numeral's own
    // place: the numerals run counter-clockwise round the ring.
    const turn = (value - 1) * TAU / DATE_POSITIONS;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    let x = DATE_CENTER_X - width / 2;
    for (const glyph of glyphs) {
      for (const outline of glyph.outlines) {
        ink.cap(outline.map(contour => contour.map(p => {
          const px = p.x - glyph.min + x;
          const py = p.y - DATE_DIGIT_H / 2;
          return vec2(px * cos - py * sin, px * sin + py * cos);
        })), 0, 0.03, true);
      }
      x += glyph.max - glyph.min + tracking;
    }
  }
  return mergeGeometries([tinted(ring.build(), 0xe4e7eb), tinted(ink.build(), 0x121419)]);
}

/** Adds a constant vertex colour. */
function tinted(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) color.toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Warm translucent band over the minute track from eight o'clock clockwise
 * through twelve to four: the hours in which the calendar must not be set.
 * It ends in round caps around the two hour dots; the vertex alpha feathers
 * its outline.
 */
function dangerSectorGeometry(): THREE.BufferGeometry {
  const from = 8 / 12 * TAU;
  const sweep = 8 / 12 * TAU;
  const halfWidth = 0.44;
  const feather = 0.07;
  const height = 0.07;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color(0xf7693a);
  const vertex = (x: number, z: number, alpha: number): number => {
    positions.push(x, height, z);
    colors.push(color.r, color.g, color.b, alpha);
    return positions.length / 3 - 1;
  };
  // Cross-section of the band: transparent, solid, solid, transparent.
  const offsets: [number, number][] = [[-halfWidth - feather, 0], [-halfWidth, 1], [halfWidth, 1], [halfWidth + feather, 0]];
  const segments = 168;
  for (let i = 0; i <= segments; i++) {
    const angle = from + sweep * i / segments;
    for (const [offset, alpha] of offsets) vertex(Math.sin(angle) * (TRACK_R + offset), -Math.cos(angle) * (TRACK_R + offset), alpha);
    if (i === segments) break;
    for (let row = 0; row < offsets.length - 1; row++) {
      const a = i * offsets.length + row;
      const b = a + offsets.length;
      indices.push(a, b + 1, a + 1, a, b, b + 1);
    }
  }
  // Half-round caps centred on the hour dots at both ends.
  const capSteps = 20;
  for (const [angle, direction] of [[from, -1], [from + sweep, 1]]) {
    const centreX = Math.sin(angle) * TRACK_R;
    const centreZ = -Math.cos(angle) * TRACK_R;
    const centre = vertex(centreX, centreZ, 1);
    let previous: [number, number] | undefined;
    for (let step = 0; step <= capSteps; step++) {
      const t = (step / capSteps - 0.5) * Math.PI;
      // Unit vector from the cap centre: along the track at t = 0, across it at ±90°.
      const ux = Math.cos(t) * direction * Math.cos(angle) + Math.sin(t) * Math.sin(angle);
      const uz = Math.cos(t) * direction * Math.sin(angle) - Math.sin(t) * Math.cos(angle);
      const rim: [number, number] = [
        vertex(centreX + ux * halfWidth, centreZ + uz * halfWidth, 1),
        vertex(centreX + ux * (halfWidth + feather), centreZ + uz * (halfWidth + feather), 0),
      ];
      if (previous) indices.push(centre, previous[0], rim[0], previous[0], previous[1], rim[1], previous[0], rim[1], rim[0]);
      previous = rim;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  return geometry;
}

// ---------------------------------------------------------------------------
// Plan geometry

/** Counter-clockwise circle. */
function circlePath(x: number, y: number, r: number, segments: number): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i / segments * TAU;
    points.push(vec2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  return points;
}

/** Counter-clockwise rectangle with rounded corners. */
function roundedRectPath(x: number, y: number, w: number, h: number, r: number, cornerSegments: number): Vec2[] {
  const points: Vec2[] = [];
  const corners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  corners.forEach(([sx, sy], corner) => {
    for (let i = 0; i <= cornerSegments; i++) {
      const a = (corner - 1 + i / cornerSegments) * Math.PI / 2;
      points.push(vec2(x + sx * (w / 2 - r) + Math.cos(a) * r, y + sy * (h / 2 - r) + Math.sin(a) * r));
    }
  });
  return points;
}

/** Samples a polyline whose corners [x, y, radius] are rounded with the given radius. */
function filletPath(points: number[][], closed: boolean): Vec2[] {
  const path: Vec2[] = [];
  const push = (p: Vec2): void => {
    if (path.length === 0 || path[path.length - 1].distanceTo(p) > 1e-6) path.push(p);
  };
  const count = points.length;
  points.forEach(([x, y, r = 0], i) => {
    const corner = vec2(x, y);
    if (r <= 0 || (!closed && (i === 0 || i === count - 1))) {
      push(corner);
      return;
    }
    const before = points[(i - 1 + count) % count];
    const after = points[(i + 1) % count];
    const dirIn = vec2(x - before[0], y - before[1]).normalize();
    const dirOut = vec2(after[0] - x, after[1] - y).normalize();
    const turn = Math.atan2(dirIn.cross(dirOut), dirIn.dot(dirOut));
    const start = corner.clone().addScaledVector(dirIn, -r * Math.tan(Math.abs(turn) / 2));
    const centre = start.clone().addScaledVector(vec2(-dirIn.y, dirIn.x), Math.sign(turn) * r);
    const startAngle = Math.atan2(start.y - centre.y, start.x - centre.x);
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / (Math.PI / 2) * (6 + 7 * Math.sqrt(r))));
    for (let s = 0; s <= steps; s++) {
      const a = startAngle + turn * s / steps;
      push(vec2(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r));
    }
  });
  if (closed && path.length > 1 && path[0].distanceTo(path[path.length - 1]) < 1e-6) path.pop();
  return path;
}

/** Outline of a line drawn with a flat-ended pen: one contour, or outer and inner contour of a closed line. */
function strokeOutline(line: Vec2[], halfWidth: number, closed: boolean): Silhouette {
  const count = line.length;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  line.forEach((p, i) => {
    const before = line[closed ? (i - 1 + count) % count : Math.max(i - 1, 0)];
    const after = line[closed ? (i + 1) % count : Math.min(i + 1, count - 1)];
    const dirIn = p.clone().sub(before);
    const dirOut = after.clone().sub(p);
    if (dirIn.lengthSq() < 1e-12) dirIn.copy(dirOut);
    if (dirOut.lengthSq() < 1e-12) dirOut.copy(dirIn);
    const normalIn = vec2(-dirIn.y, dirIn.x).normalize();
    const mitre = normalIn.clone().add(vec2(-dirOut.y, dirOut.x).normalize()).normalize();
    const reach = halfWidth / Math.max(0.3, mitre.dot(normalIn));
    left.push(p.clone().addScaledVector(mitre, reach));
    right.push(p.clone().addScaledVector(mitre, -reach));
  });
  if (!closed) return [[...left, ...right.reverse()]];
  return Math.abs(THREE.ShapeUtils.area(left)) > Math.abs(THREE.ShapeUtils.area(right)) ? [left, right] : [right, left];
}

/** Drops repeated neighbours and a repeated closing point. */
function distinctPoints(contour: Vec2[]): Vec2[] {
  const points = contour.filter((p, i) => i === 0 || p.distanceTo(contour[i - 1]) > 1e-6);
  if (points.length > 1 && points[0].distanceTo(points[points.length - 1]) < 1e-6) points.pop();
  return points;
}

// ---------------------------------------------------------------------------
// Mesh building

/** One point of a sweep profile: `a` is the distance from the contour towards
 * the open side (negative: into the solid), `y` the height. A given normal
 * (na, ny) keeps the shading round; without it, creases stay sharp. */
interface ProfilePoint { a: number; y: number; na?: number; ny?: number }

interface PlateOptions { top: number; base: number; bevel: number; segments: number }

/** A contour point with the directions needed to offset and shade it. */
interface Station { p: Vec2; mitre: Vec2; smooth: Vec2; normalIn: Vec2; normalOut: Vec2; sharp: boolean }

/** Stations of a closed contour. Normals point from the solid to the open side: outwards for an outline, into a hole. */
function stationsOf(contour: Vec2[], hole: boolean): Station[] {
  const points = contour.slice();
  if ((THREE.ShapeUtils.area(points) > 0) === hole) points.reverse();
  const count = points.length;
  return points.map((p, i) => {
    const dirIn = p.clone().sub(points[(i - 1 + count) % count]).normalize();
    const dirOut = points[(i + 1) % count].clone().sub(p).normalize();
    const normalIn = vec2(dirIn.y, -dirIn.x);
    const normalOut = vec2(dirOut.y, -dirOut.x);
    const smooth = normalIn.clone().add(normalOut).normalize();
    const mitre = smooth.clone().multiplyScalar(1 / Math.max(0.3, smooth.dot(normalIn)));
    return { p, mitre, smooth, normalIn, normalOut, sharp: normalIn.dot(normalOut) < 0.8 };
  });
}

/** Collects indexed triangles with explicit normals; winding always follows the normals. */
class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  /** `planUv` gives every vertex without its own uv one from its plan position. */
  constructor(private readonly planUv?: (x: number, y: number) => [number, number]) {}

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u?: number, v?: number): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    if (u !== undefined && v !== undefined) this.uvs.push(u, v);
    else if (this.planUv) this.uvs.push(...this.planUv(x, -z));
    else this.uvs.push(0, 0);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number): void {
    const p = this.positions;
    const n = this.normals;
    const abx = p[b * 3] - p[a * 3], aby = p[b * 3 + 1] - p[a * 3 + 1], abz = p[b * 3 + 2] - p[a * 3 + 2];
    const acx = p[c * 3] - p[a * 3], acy = p[c * 3 + 1] - p[a * 3 + 1], acz = p[c * 3 + 2] - p[a * 3 + 2];
    const gx = aby * acz - abz * acy, gy = abz * acx - abx * acz, gz = abx * acy - aby * acx;
    if (gx * gx + gy * gy + gz * gz < 1e-18) return;
    const facing = gx * (n[a * 3] + n[b * 3] + n[c * 3]) + gy * (n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1])
      + gz * (n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2]);
    if (facing >= 0) this.indices.push(a, b, c); else this.indices.push(a, c, b);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  /** Flat convex polygon that faces away from a point inside the solid. */
  facet(corners: THREE.Vector3[], inside: THREE.Vector3): void {
    const normal = new THREE.Vector3().subVectors(corners[1], corners[0])
      .cross(new THREE.Vector3().subVectors(corners[2], corners[0])).normalize();
    if (normal.dot(new THREE.Vector3().subVectors(corners[0], inside)) < 0) normal.negate();
    const ids = corners.map(c => this.vertex(c.x, c.y, c.z, normal.x, normal.y, normal.z));
    for (let i = 1; i < ids.length - 1; i++) this.triangle(ids[0], ids[i], ids[i + 1]);
  }

  /** Sweeps a profile around a closed contour (mitred corners, sharp corners stay sharp). */
  sweep(contour: Vec2[], hole: boolean, profile: ProfilePoint[]): void {
    const stations = stationsOf(contour, hole);
    const count = stations.length;
    // A repeated profile point is a deliberate crease: it has no segment of its own.
    const segmentNormal = (k: number): [number, number] | undefined => {
      const da = profile[k + 1].a - profile[k].a;
      const dy = profile[k + 1].y - profile[k].y;
      const length = Math.hypot(da, dy);
      return length > 1e-9 ? [dy / length, -da / length] : undefined;
    };
    // Rows of vertices along the contour; a crease in the profile gets two rows.
    const rows: Required<ProfilePoint>[] = [];
    const startRow: number[] = [];
    const endRow: number[] = [];
    profile.forEach((point, k) => {
      const before = k > 0 ? segmentNormal(k - 1) : undefined;
      const after = k < profile.length - 1 ? segmentNormal(k) : undefined;
      const row = (na: number, ny: number): number => rows.push({ a: point.a, y: point.y, na, ny }) - 1;
      let shared: number | undefined;
      if (point.na !== undefined && point.ny !== undefined) shared = row(point.na, point.ny);
      else if (before && after && before[0] * after[0] + before[1] * after[1] > 0.7) {
        const length = Math.hypot(before[0] + after[0], before[1] + after[1]);
        shared = row((before[0] + after[0]) / length, (before[1] + after[1]) / length);
      }
      if (before) endRow[k - 1] = shared ?? row(before[0], before[1]);
      if (after) startRow[k] = shared ?? row(after[0], after[1]);
    });
    const arriving: number[][] = [];
    const leaving: number[][] = [];
    rows.forEach((row, r) => {
      arriving[r] = [];
      leaving[r] = [];
      stations.forEach((s, i) => {
        const x = s.p.x + s.mitre.x * row.a;
        const y = s.p.y + s.mitre.y * row.a;
        const make = (n: Vec2): number => this.vertex(x, row.y, -y, n.x * row.na, row.ny, -n.y * row.na);
        if (s.sharp) {
          arriving[r][i] = make(s.normalIn);
          leaving[r][i] = make(s.normalOut);
        } else arriving[r][i] = leaving[r][i] = make(s.smooth);
      });
    });
    for (let k = 0; k < profile.length - 1; k++) {
      if (!segmentNormal(k)) continue;
      const lower = startRow[k];
      const upper = endRow[k];
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        this.quad(leaving[lower][i], arriving[lower][next], arriving[upper][next], leaving[upper][i]);
      }
    }
  }

  /** Flat face over an outline with holes at height y, each contour moved `inset` into the solid. */
  cap(contours: Vec2[][], inset: number, y: number, up: boolean): void {
    const rings = inset === 0 ? contours : contours.map((contour, i) =>
      stationsOf(contour, i > 0).map(s => s.p.clone().addScaledVector(s.mitre, -inset)));
    const ids = rings.flat().map(p => this.vertex(p.x, y, -p.y, 0, up ? 1 : -1, 0));
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) this.triangle(ids[a], ids[b], ids[c]);
  }

  /** Raised plate over an outline with holes: vertical wall, rounded bevel, flat top. */
  plate(contours: Vec2[][], { top, base, bevel, segments }: PlateOptions): void {
    const profile: ProfilePoint[] = [{ a: 0, y: base }, { a: 0, y: top - bevel, na: 1, ny: 0 }];
    for (let s = 1; s <= segments; s++) {
      const t = s / segments * Math.PI / 2;
      profile.push({ a: -bevel * (1 - Math.cos(t)), y: top - bevel + bevel * Math.sin(t), na: Math.cos(t), ny: Math.sin(t) });
    }
    contours.forEach((contour, i) => this.sweep(contour, i > 0, profile));
    this.cap(contours, bevel, top, true);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setIndex(this.indices);
    return geometry;
  }
}
