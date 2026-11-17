import * as THREE from 'three';

/**
 * Faces looking towards the caseback see the studio mirrored top to bottom,
 * as if the watch had been turned over under the same lights; without this
 * the rotor side, seen from below, would only reflect the dark floor. Shared
 * by every material of the movement that has faces on the rotor side.
 */
export function patchUndersideEnvironment(shader: THREE.WebGLProgramParametersWithUniforms): void {
  const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
  const irr = 'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );';
  const rad = 'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );';
  if (!chunk.includes(irr) || !chunk.includes(rad) || !shader.fragmentShader.includes('#include <envmap_physical_pars_fragment>')) return;
  const lookup = /* glsl */`
    #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
      vec4 lunaEnv( vec3 dir, float lod, float facing ) {
        float flip = smoothstep( -0.15, -0.55, facing );
        vec4 c = vec4( 0.0 );
        if ( flip < 0.999 ) c = textureCubeUV( envMap, envMapRotation * dir, lod );
        if ( flip > 0.001 ) c = mix( c, textureCubeUV( envMap, envMapRotation * vec3( dir.x, - dir.y, dir.z ), lod ), flip );
        return c;
      }
    #endif
  `;
  const patched = chunk
    .replace(irr, 'vec4 envMapColor = lunaEnv( worldNormal, 1.0, worldNormal.y );')
    .replace(rad, 'vec4 envMapColor = lunaEnv( reflectVec, roughness, inverseTransformDirection( normal, viewMatrix ).y );');
  shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', lookup + patched);
}

/** Adds the underside patch to a material, after whatever hook it already has. */
export function withUnderside<T extends THREE.Material>(material: T, key: string): T {
  const own = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    own(shader, renderer);
    patchUndersideEnvironment(shader);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
