// Sardinian Coffee Corner — v3 Instagram outro (12 s, 1080x1920, 60 fps).
// Beans in slow motion -> burrs -> dosing & tamp -> bottomless extraction (drops on the basket floor, the cone,
// one stream into the cup) -> crema -> crane to the cup, the logo prints on it.
// Look: cafe HDRI lighting and blurred background, softbox area lights, depth of field, motion blur and
// sub-pixel jitter (sub-frame accumulation), ground-truth ambient occlusion, soft VSM shadows, espresso rendered as
// a refracting liquid with Beer-Lambert absorption, procedural crema and micro-relief, slight lens fringing.
// Every frame is a pure function of time.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const params = new URLSearchParams(location.search);
const SCALE = parseFloat(params.get('scale') || '1');
const MB = Math.max(1, parseInt(params.get('mb') || '1', 10));       // motion-blur sub-frames per frame
const DOF = params.get('dof') !== '0';
const AO = params.get('ao') !== '0';
const MSAA = parseInt(params.get('msaa') || '4', 10);
const SHADOW = parseInt(params.get('shadow') || '2048', 10);
const DOF_TAPS = parseInt(params.get('taps') || '48', 10);
const W = Math.round(1080 * SCALE), H = Math.round(1920 * SCALE);
const FPS = 60, DUR = 12, FRAMES = FPS * DUR;
const SHUTTER = 0.5; // 180° shutter

// edit points (seconds)
const T = { burrs: 1.2, dose: 2.25, tamp: 3.62, extract: 3.95, cup: 6.75, crane: [7.15, 8.25], reveal: [8.3, 9.25], tag: 9.3 };
// bottomless extraction, seconds after T.extract: drops -> sheet -> cone -> stream (slow motion: g = 30 units/s², 1 unit ≈ 1 cm)
const EX = { cone: 0.7, stream: 1.0, v0: 2.4, g: 30, coneLen: 1.2 };

/* ================================================================ utils */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeSimplex3(seed) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const k = p[i]; p[i] = p[j]; p[j] = k; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];
  const F3 = 1 / 3, G3 = 1 / 6;
  return (x, y, z) => {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    const c = (gi, xx, yy, zz) => {
      let tt = 0.6 - xx * xx - yy * yy - zz * zz;
      if (tt < 0) return 0;
      tt *= tt; return tt * tt * (g[gi] * xx + g[gi + 1] * yy + g[gi + 2] * zz);
    };
    return 32 * (
      c(pm12[ii + perm[jj + perm[kk]]] * 3, x0, y0, z0) +
      c(pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3, x1, y1, z1) +
      c(pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3, x2, y2, z2) +
      c(pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3, x3, y3, z3));
  };
}
const N3 = makeSimplex3(21);
const fbm = (x, y, z, oct = 4) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += a * N3(x * f, y * f, z * f); a *= 0.5; f *= 2.03; } return s; };
function hermite(keys, t, get) {
  const n = keys.length;
  if (t >= keys[n - 1][0]) return get(keys[n - 1]).slice();
  if (t <= keys[0][0]) return get(keys[0]).slice();
  let i = 0; while (t > keys[i + 1][0]) i++;
  const t0 = keys[i][0], t1 = keys[i + 1][0], h = t1 - t0, s = (t - t0) / h;
  const tan = k => {
    if (k === 0 || k === n - 1) return get(keys[k]).map(() => 0);
    const a = keys[k - 1], b = keys[k + 1];
    return get(b).map((v, d) => (v - get(a)[d]) / (b[0] - a[0]));
  };
  const m0 = tan(i), m1 = tan(i + 1), p0 = get(keys[i]), p1 = get(keys[i + 1]);
  const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s;
  return p0.map((v, d) => h00 * v + h10 * h * m0[d] + h01 * p1[d] + h11 * h * m1[d]);
}
function interp(profile, y) { // [[r, y], ...] sorted by y
  if (y <= profile[0][1]) return profile[0][0];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if (y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  return profile[profile.length - 1][0];
}

/* ================================================================ renderer */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.25, 3000);

/* ================================================================ procedural micro-relief (GPU bump from 3D noise) */
const GLSL_NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;
const HEIGHTS = {
  // fine wrinkles of a roasted bean
  bean: 'float procHeight(vec3 p){ return 0.6*snoise(p*uBF) + 0.3*snoise(p*uBF*2.3+3.1) + 0.15*abs(snoise(p*uBF*5.1)); }',
  // glaze "orange peel"
  glaze: 'float procHeight(vec3 p){ return snoise(p*uBF) + 0.4*snoise(p*uBF*2.7); }',
  // micro bubbles: small round pits
  bubbles: 'float procHeight(vec3 p){ float n = snoise(p*uBF); float b = smoothstep(0.55, 0.85, snoise(p*uBF*2.2+7.0)); return 0.4*n - b - 0.5*smoothstep(0.6,0.9,snoise(p*uBF*4.3+2.0)); }',
  // coffee grounds: granular
  grain: 'float procHeight(vec3 p){ return abs(snoise(p*uBF)) + 0.6*abs(snoise(p*uBF*2.1+5.0)) + 0.35*snoise(p*uBF*4.7); }',
  // cork pores
  pores: 'float procHeight(vec3 p){ return 0.5*snoise(p*uBF) - pow(max(snoise(p*uBF*1.7+4.0),0.0),2.0)*1.6; }',
  // brushed metal: stretched noise along y
  brushed: 'float procHeight(vec3 p){ return snoise(vec3(p.x*uBF*6.0, p.y*uBF*0.3, p.z*uBF*6.0)); }'
};
const DUMMY = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); DUMMY.needsUpdate = true;
const NO_RELIEF = params.get('debug') === 'norelief';
function microRelief(mat, kind, freq, amp) {
  if (NO_RELIEF) return mat;
  mat.bumpMap = DUMMY; mat.bumpScale = amp;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev.call(mat, sh, r);
    sh.uniforms.uBF = { value: freq };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vObjPos;\nuniform float uBF;\n${GLSL_NOISE}\n${HEIGHTS[kind]}`)
      .replace('#include <bumpmap_pars_fragment>', `
        uniform float bumpScale;
        // slope of the procedural height per world unit along the screen axes
        vec2 dHdxy_fwd() {
          float h = bumpScale * procHeight(vObjPos);
          vec3 px = dFdx(-vViewPosition), py = dFdy(-vViewPosition);
          return vec2(dFdx(h) / max(length(px), 1e-6), dFdy(h) / max(length(py), 1e-6));
        }
        vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
          vec3 vSigmaX = normalize(dFdx(surf_pos.xyz)); vec3 vSigmaY = normalize(dFdy(surf_pos.xyz)); vec3 vN = surf_norm;
          vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX);
          float fDet = dot(vSigmaX, R1) * faceDirection;
          vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
          float gl = length(vGrad); if (gl > 0.7) vGrad *= 0.7 / gl;   // never tilt more than ~35°
          return normalize(max(abs(fDet), 0.3) * surf_norm - vGrad);
        }`);
  };
  mat.customProgramCacheKey = () => `relief-${kind}-${mat.uuid}`;
  return mat;
}

/* ================================================================ espresso as a liquid: refraction + Beer-Lambert absorption */
// Espresso lets deep red-orange light through a few tenths of a millimetre and is nearly black through 2-3 mm:
// attenuationColor is what survives 0.5 mm. The crema carried by the flow scatters light instead of letting it through.
const LIQ = { uTime: { value: 0 }, uFoam: { value: 0 } };
function liquidMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.035, ior: 1.34, transmission: 1, thickness: 0.2, attenuationColor: new THREE.Color(0.5, 0.23, 0.075), attenuationDistance: 0.05, envMapIntensity: 1.0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, LIQ);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFlow;\nvarying vec3 vFlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlow = aFlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFlow;\nuniform float uTime, uFoam;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // hazelnut crema streaks ride the flow: vFlow.x = when this liquid left the cone (s), vFlow.y = turn around the stream
        float fa = vFlow.y * 6.2831853;
        vec3 fq = vec3(cos(fa) * 0.45, sin(fa) * 0.45, vFlow.x * 6.5);
        float fn = 0.6 * snoise(fq) + 0.28 * snoise(fq * vec3(2.2, 2.2, 2.7) + 4.1) + 0.13 * snoise(fq * vec3(5.0, 5.0, 6.1) + 9.7);
        float foam = smoothstep(0.1, 0.62, fn + uFoam);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 0.33, 0.15), foam);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.3, foam);')
      .replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - 0.8 * foam);')
      // light crosses a chord of the stream: long through the core, short at the edges
      .replace('material.thickness = thickness;', 'material.thickness = max(2.0 * vFlow.z * abs(dot(normal, normalize(vViewPosition))), 0.003);');
  };
  m.customProgramCacheKey = () => 'espresso-liquid';
  return m;
}
// Thin sheet under the basket floor: drops appear at the holes, grow, join into a sheet that drains into the cone.
// The drops are a metaball field (one gaussian per drop, wet where phi > 1) evaluated on the GPU.
const FILM = { uBeadTex: { value: null }, uBeadN: { value: 0 }, uRad: { value: 2.12 }, uCov: { value: 0 }, uDrain: { value: 0 }, uPool: { value: 0 }, uTime: { value: 0 }, uHb: { value: 0.032 }, uHs: { value: 0.085 } };
function filmMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, ior: 1.34, transmission: 1, thickness: 0.05, attenuationColor: new THREE.Color(0.5, 0.23, 0.075), attenuationDistance: 0.04, envMapIntensity: 1.0 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, FILM);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uBeadTex; uniform int uBeadN; uniform float uRad, uCov, uDrain, uPool, uTime, uHb, uHs;
        varying float vFilmH; varying vec2 vFilmP;
        ${GLSL_NOISE}
        float filmSheet(vec2 p) {   // wet patches that spread and join; thickest where the sheet drains into the cone
          float r = length(p);
          float n = 0.55 + 0.32 * snoise(vec3(p * 1.5, 3.1)) + 0.13 * snoise(vec3(p * 3.9, 7.7));
          return uCov * n * (1.0 - smoothstep(1.75, 2.05, r)) + uDrain * exp(-r * r / 0.6);
        }
        float filmPhi(vec2 p, out vec2 g) {
          float phi = 0.0; g = vec2(0.0);
          for (int i = 0; i < 256; i++) {
            if (i >= uBeadN) break;
            vec4 b = texelFetch(uBeadTex, ivec2(i, 0), 0);
            vec2 d = p - b.xy; float s2 = b.w * b.w, q = dot(d, d) / s2;
            if (q > 14.0 || b.z <= 0.0) continue;
            float e = b.z * exp(-q);
            phi += e; g -= e * 2.0 / s2 * d;
          }
          float e0 = 0.008, s0 = filmSheet(p);
          g += vec2(filmSheet(p + vec2(e0, 0.0)) - s0, filmSheet(p + vec2(0.0, e0)) - s0) / e0;
          return phi + s0;
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec2 fP = position.xz * uRad, fG; float fPhi = filmPhi(fP, fG), fH, fdH;
        if (fPhi > 1.0) { float sq = sqrt(fPhi - 1.0), th = tanh(uHb * sq / uHs); fH = uHs * th; fdH = uHb * (1.0 - th * th) * 0.5 / max(sq, 0.03); }
        else { fH = -0.012 * clamp((1.0 - fPhi) * 8.0, 0.0, 1.0); fdH = fPhi > 0.875 ? 0.096 : 0.0; }
        vec2 fGrad = fdH * fG; float fGl = length(fGrad); if (fGl > 4.0) fGrad *= 4.0 / fGl;
        // the liquid gathers into a thicker pool in the middle, the cone hangs from it
        float fPw = smoothstep(1.0, 1.4, fPhi), fPe = uPool * exp(-dot(fP, fP) / 0.45);
        fH += fPw * fPe; fGrad += fPw * fPe * (-2.0 / 0.45) * fP;
        vFilmH = max(fH, 0.0); vFilmP = fP;
        vec3 objectNormal = vec3(-uRad * fGrad.x, 1.0, -uRad * fGrad.y);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position.x, fH, position.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vFilmH; varying vec2 vFilmP;\nuniform float uTime, uCov;\n${GLSL_NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // crema streaks drifting towards the cone
        float fr = length(vFilmP);
        vec3 fq = vec3(vFilmP / max(fr, 1e-3) * 2.4, (fr + uTime * 0.55) * 3.2);
        float fs = 0.6 * snoise(fq) + 0.3 * snoise(fq * 2.3 + 5.0);
        float foam = smoothstep(0.3, 0.75, fs) * smoothstep(0.035, 0.075, vFilmH) * clamp(uCov, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.3, 0.13), foam * 0.85);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, foam);')
      .replace('material.transmission = transmission;', 'material.transmission = transmission * (1.0 - 0.75 * foam);')
      // light goes through the sheet to the steel and back
      .replace('material.thickness = thickness;', 'material.thickness = max(2.0 * vFilmH / max(abs(dot(normal, normalize(vViewPosition))), 0.3), 0.002);');
  };
  m.customProgramCacheKey = () => 'espresso-film';
  return m;
}
// Crema in the cup: log-spiral swirl drifting out from where the coffee lands, tiger flecks, leopard spots,
// pale new foam around the stream, a dark ring against the porcelain. Height: crater under the stream,
// capillary rings and the meniscus, all on the GPU.
const CREMA = { uTime: { value: 0 }, uImp: { value: new THREE.Vector2() }, uImpK: { value: 0 }, uR: { value: 3 }, uDrift: { value: 0.05 }, uTwist: { value: 1.2 } };
function cremaMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, specularIntensity: 0.55, sheen: 0.3, sheenColor: new THREE.Color(0xc88850), sheenRoughness: 0.6, envMapIntensity: 0.3 });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, CREMA);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uImpK, uR; uniform vec2 uImp; varying vec2 vCP;
        float cremaH(vec2 p) {
          vec2 d = p - uImp; float d2 = dot(d, d), dd = sqrt(d2);
          float h = -0.17 * uImpK * exp(-d2 / 0.05);
          h += 0.01 * uImpK * sin(dd * 24.0 - uTime * 30.0) * exp(-dd * 1.6) * smoothstep(0.05, 0.3, dd);
          return h + 0.045 * pow(length(p) / uR, 12.0);
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec2 cP = position.xz * uR; float cH = cremaH(cP);
        vec2 cG = vec2(cremaH(cP + vec2(0.01, 0.0)) - cH, cremaH(cP + vec2(0.0, 0.01)) - cH) / 0.01;
        vec3 objectNormal = vec3(-uR * cG.x, 1.0, -uR * cG.y); vCP = cP;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += cH;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uImpK, uR, uDrift, uTwist; uniform vec2 uImp; varying vec2 vCP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 cq = vCP - uImp;
        float cr = length(cq), cR = length(vCP) / uR;
        float cang = atan(cq.y, cq.x), clr = log(cr + 0.09);
        vec2 csp = vec2(cang + clr * uTwist, clr - uTime * uDrift);   // gentle swirl drifting outwards
        vec3 cs3 = vec3(cos(csp.x) * 1.1, sin(csp.x) * 1.1, csp.y * 2.0);
        vec2 wp = vCP * 1.1;
        float w1 = snoise(vec3(wp, 1.7)), w2 = snoise(vec3(wp + 5.2, 3.3));
        float mott = 0.55 * snoise(vec3(wp * 1.3 + vec2(w1, w2) * 0.7, 0.5)) + 0.2 * snoise(vec3(wp * 3.1, 2.9)) + 0.3 * snoise(cs3);
        // tiger flecks: fine dark specks stretched along the swirl
        vec3 fs3 = vec3(cos(csp.x) * 9.0, sin(csp.x) * 9.0, csp.y * 5.0);
        float fleck = smoothstep(0.5, 0.85, snoise(fs3 + vec3(w1, w2, 0.0) * 0.5) + 0.35 * snoise(vec3(vCP * 22.0, 7.3)));
        float leo = smoothstep(0.7, 0.95, snoise(vec3(vCP * 3.6, 11.1)) + 0.25 * snoise(vec3(vCP * 10.0, 4.0)));  // a few leopard spots
        vec3 cc = mix(vec3(0.3, 0.115, 0.03), vec3(0.47, 0.21, 0.065), smoothstep(-0.65, 0.75, mott));
        cc = mix(cc, vec3(0.13, 0.042, 0.011), fleck * 0.4 + leo * 0.3);
        cc = mix(cc, vec3(0.47, 0.21, 0.065), (1.0 - smoothstep(0.0, 0.6, cR)) * 0.2);                                // paler middle
        cc = mix(cc, vec3(0.13, 0.045, 0.012), smoothstep(0.78, 0.98, cR) * 0.75);                                     // dark ring at the cup
        float cHole = uImpK * (1.0 - smoothstep(0.05, 0.15, cr));
        cc = mix(cc, vec3(0.62, 0.3, 0.1), uImpK * smoothstep(0.09, 0.17, cr) * (1.0 - smoothstep(0.2, 0.45, cr)) * 0.55);
        cc = mix(cc, vec3(0.07, 0.02, 0.005), cHole);
        diffuseColor.rgb = cc;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.1, cHole);');
  };
  return microRelief(m, 'bubbles', 60, 0.0016);
}
// Underside of the basket: 0.3 mm holes on a 1.3 mm hexagonal pitch over a 40 mm circle.
function basketFloorMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xd4cfc8, metalness: 1, roughness: 0.3, envMapIntensity: 1.0 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFloor;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloor = position.xy;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        vec2 hp = vFloor / 0.13, hr = vec2(1.0, 1.7320508), hh = hr * 0.5;
        vec2 ha = mod(hp, hr) - hh, hb = mod(hp - hh, hr) - hh;
        float hd = length(dot(ha, ha) < dot(hb, hb) ? ha : hb) * 0.13, rr = length(vFloor);
        float inside = 1.0 - smoothstep(2.0, 2.04, rr), hw = fwidth(hd) + 2e-4;
        float hole = (1.0 - smoothstep(0.0155 - hw, 0.0155 + hw, hd)) * inside;
        float lip = smoothstep(0.013, 0.02, hd) * (1.0 - smoothstep(0.02, 0.03, hd)) * inside;
        roughnessFactor = clamp(roughnessFactor + 0.2 * lip, 0.08, 1.0);
        diffuseColor.rgb *= 1.0 - 0.95 * hole;`);
  };
  m.customProgramCacheKey = () => 'basket-floor';
  return m;
}

/* ================================================================ procedural textures */
function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function pixelTex(w, h, fn, srgb = true) {
  return canvasTex(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = fn(x / w, y / h); const i = (y * w + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3] ?? 255;
    }
    g.putImageData(img, 0, 0);
  }, srgb);
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function graniteTexture() { // Gallura granite: pink feldspar, white quartz, black biotite
  const R = mulberry32(3);
  return canvasTex(2048, 2048, (g, w, h) => {
    g.fillStyle = '#857670'; g.fillRect(0, 0, w, h);
    const blob = (n, rmin, rmax, cols, alpha) => {
      for (let i = 0; i < n; i++) {
        g.globalAlpha = alpha * (0.55 + 0.45 * R());
        g.fillStyle = cols[Math.floor(R() * cols.length)];
        const x = R() * w, y = R() * h, r = rmin + R() * (rmax - rmin);
        g.beginPath();
        const k = 5 + Math.floor(R() * 3);
        for (let j = 0; j < k; j++) { const a = (j / k) * 6.283 + R() * 0.6, rr = r * (0.6 + 0.5 * R()); j ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        g.closePath(); g.fill();
      }
    };
    blob(2600, 8, 26, ['#ad8778', '#c09583', '#9a7064', '#b88f80'], 0.8);
    blob(3800, 5, 16, ['#d7d0c9', '#e6e1db', '#bdb3aa', '#cfc6be'], 0.75);
    blob(7000, 2, 7, ['#1a1513', '#29221f', '#3a2f2a'], 0.85);
    blob(16000, 0.6, 2.2, ['#f2ece6', '#14100f', '#8c6a5c'], 0.55);
    g.globalAlpha = 1;
  });
}
function corkTexture() {
  const R = mulberry32(8);
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#b5845a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 12000; i++) {
      g.globalAlpha = 0.22 + R() * 0.5;
      const dark = R() < 0.55;
      g.fillStyle = dark ? (R() < 0.5 ? '#6e4627' : '#8a5a34') : (R() < 0.5 ? '#d3a77a' : '#c69465');
      const x = R() * w, y = R() * h, r = 1 + R() * (dark ? 4 : 2.6);
      g.beginPath(); g.ellipse(x, y, r, r * (0.4 + R() * 0.8), R() * 3.14, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  });
}
function groundsTexture() {
  const R = mulberry32(13);
  return pixelTex(512, 512, (u, v) => {
    const n = R(), clump = fbm(u * 18, v * 18, 3, 3);
    const c = mix3([30, 16, 8], [92, 56, 30], clamp(n * 0.75 + clump * 0.6 + 0.1));
    return n > 0.988 ? [140, 96, 60] : c;
  });
}
function puffTexture(seed) {
  return pixelTex(128, 128, (u, v) => {
    const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y) * 2;
    const n = fbm(x * 3 + seed * 3.1, y * 3, seed, 5);
    const a = clamp((0.55 + 0.6 * n) * Math.pow(clamp(1 - r), 1.6));
    return [255, 255, 255, Math.round(a * 255)];
  });
}

/* ================================================================ materials */
const TEX = {}, MAT = {};
async function buildMaterials() {
  const tl = new THREE.TextureLoader();
  const [wd, wn, wr] = await Promise.all(['walnut_diffuse_1k.jpg', 'walnut_nor_gl_1k.jpg', 'walnut_rough_1k.jpg'].map(f => tl.loadAsync(`/v3/assets/${f}`)));
  wd.colorSpace = THREE.SRGBColorSpace;
  [wd, wn, wr].forEach(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2.5); t.anisotropy = 8; });
  TEX.granite = graniteTexture(); TEX.granite.wrapS = TEX.granite.wrapT = THREE.RepeatWrapping; TEX.granite.repeat.set(3, 3);
  TEX.cork = corkTexture(); TEX.cork.wrapS = TEX.cork.wrapT = THREE.RepeatWrapping;
  TEX.grounds = groundsTexture(); TEX.grounds.wrapS = TEX.grounds.wrapT = THREE.RepeatWrapping; TEX.grounds.repeat.set(3, 3);
  TEX.puffs = [0, 1, 2, 3].map(puffTexture);

  MAT.steel = new THREE.MeshPhysicalMaterial({ color: 0xcdc8c2, metalness: 1, roughness: 0.3, anisotropy: 0.7, envMapIntensity: 1.0 });
  MAT.steelDark = new THREE.MeshPhysicalMaterial({ color: 0x5a554f, metalness: 1, roughness: 0.42, anisotropy: 0.6, envMapIntensity: 0.6, side: THREE.DoubleSide });
  // basket: satin steel without anisotropy, highlights capped so no single pixel can blow up into a bokeh disc
  MAT.basket = new THREE.MeshPhysicalMaterial({ color: 0xcdc8c2, metalness: 1, roughness: 0.34, envMapIntensity: 1.0 });
  MAT.basket.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = min(outgoingLight, vec3(4.0));\n#include <opaque_fragment>'); };
  MAT.chrome = new THREE.MeshPhysicalMaterial({ color: 0xf0ece6, metalness: 1, roughness: 0.06, envMapIntensity: 1.2 });
  MAT.copper = new THREE.MeshPhysicalMaterial({ color: 0xc8845a, metalness: 1, roughness: 0.27, clearcoat: 0.35, clearcoatRoughness: 0.12, envMapIntensity: 1.15 });
  MAT.wood = new THREE.MeshPhysicalMaterial({ map: wd, normalMap: wn, roughnessMap: wr, roughness: 0.9, clearcoat: 0.55, clearcoatRoughness: 0.22, color: 0xb98b6a, envMapIntensity: 0.8 });
  MAT.porcelain = microRelief(new THREE.MeshPhysicalMaterial({ color: 0xf3efe7, roughness: 0.13, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.12, sheenColor: new THREE.Color(0xfff2dc), envMapIntensity: 0.9 }), 'glaze', 2.2, 0.0025);
  MAT.granite = microRelief(new THREE.MeshPhysicalMaterial({ map: TEX.granite, roughness: 0.3, clearcoat: 0.75, clearcoatRoughness: 0.08, envMapIntensity: 0.7 }), 'glaze', 0.6, 0.004);
  MAT.corkTop = microRelief(new THREE.MeshStandardMaterial({ map: TEX.cork, roughness: 0.93, envMapIntensity: 0.4 }), 'pores', 3.2, 0.02);
  MAT.corkSide = microRelief(new THREE.MeshStandardMaterial({ color: 0x9a6c45, roughness: 0.95 }), 'pores', 3.2, 0.02);
  const gl = f => tl.loadAsync(`/v3/assets/${f}`);
  const [gc, gn, gr, ga, gd] = await Promise.all(['grounds_color_2k.jpg', 'grounds_normal_2k.jpg', 'grounds_rough_1k.jpg', 'grounds_ao_1k.jpg', 'grounds_disp_1k.jpg'].map(gl));
  gc.colorSpace = THREE.SRGBColorSpace;
  [gc, gn, gr, ga, gd].forEach(t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.5, 1.5); t.anisotropy = 16; });
  TEX.groundsColor = gc;
  MAT.grounds = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.74, 0.66, 0.6), map: gc, normalMap: gn, normalScale: new THREE.Vector2(1.5, 1.5), roughnessMap: gr, roughness: 1, aoMap: ga, aoMapIntensity: 1, displacementMap: gd, displacementScale: 0.075, displacementBias: -0.04, envMapIntensity: 0.45 });
  MAT.crema = cremaMaterial();
  MAT.liquid = liquidMaterial();
  MAT.film = filmMaterial();
  MAT.basketFloor = basketFloorMaterial();
  // machine front behind the cup: polished steel, it mirrors the warm room and the backlight
  MAT.backsplash = new THREE.MeshPhysicalMaterial({ color: 0x67625d, metalness: 1, roughness: 0.2, envMapIntensity: 0.9 });
  MAT.bean = microRelief(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.35, envMapIntensity: 0.75 }), 'bean', 7, 0.012);
  MAT.chunk = microRelief(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.75, envMapIntensity: 0.5 }), 'grain', 3, 0.04);
  // falling grounds: matte grains with tiny oily glints, mottled with the same scanned colour
  MAT.grain = new THREE.MeshStandardMaterial({ color: 0xffffff, map: gc, roughness: 0.62, envMapIntensity: 0.9 });
  MAT.leaf = new THREE.MeshPhysicalMaterial({ color: 0x2c4a22, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, sheen: 0.3, sheenColor: new THREE.Color(0x8aa070) });
  MAT.berry = new THREE.MeshPhysicalMaterial({ color: 0x2a1534, roughness: 0.42, clearcoat: 0.4, sheen: 1, sheenColor: new THREE.Color(0x8a7aa8), sheenRoughness: 0.6 });
  MAT.twig = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.8 });
}

/* ================================================================ geometry helpers */
const lathe = (pts, segs = 128) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const shadowed = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };
function beanGeometry() {
  let g = new THREE.SphereGeometry(1, 48, 32);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 0.7, y = p.getY(i), z = p.getZ(i) * 0.52;
    if (z > 0) z *= 0.62;
    const cx = 0.07 * Math.sin(y * 2.4), ends = 1 - Math.pow(Math.abs(y), 5);
    const groove = Math.exp(-Math.pow((x - cx) / 0.05, 2)) * ends;
    if (z > -0.05) z -= groove * 0.2 * smooth(-0.05, 0.25, z);
    const lump = 1 + 0.035 * N3(x * 4, y * 4, z * 4);
    p.setXYZ(i, x * lump, y * lump, z * lump);
  }
  g.computeVertexNormals();
  return g;
}
function chunkGeometry() {
  let g = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.7 + 0.45 * N3(p.getX(i) * 2.1, p.getY(i) * 2.1, p.getZ(i) * 2.1); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}
function taperTube(points, radii, radial = 14) {
  const n = points.length;
  const pos = new Float32Array(n * (radial + 1) * 3), uv = new Float32Array(n * (radial + 1) * 2);
  const idx = [];
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(n - 1, false);
  for (let i = 0; i < n; i++) {
    const p = curve.getPointAt(i / (n - 1));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, nx = Math.cos(a), ny = Math.sin(a), k = i * (radial + 1) + j;
      pos[k * 3] = p.x + radii[i] * (nx * frames.normals[i].x + ny * frames.binormals[i].x);
      pos[k * 3 + 1] = p.y + radii[i] * (nx * frames.normals[i].y + ny * frames.binormals[i].y);
      pos[k * 3 + 2] = p.z + radii[i] * (nx * frames.normals[i].z + ny * frames.binormals[i].z);
      uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / radial;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) { const a = i * (radial + 1) + j, b = a + radial + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function polarDisk(rings, segs) {
  const pos = [0, 0, 0], uv = [0.5, 0.5], idx = [];
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
    const rr = r / rings, a = (s / segs) * Math.PI * 2;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5);
  }
  const id = (r, s) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
  for (let s = 0; s < segs; s++) idx.push(0, id(1, s + 1), id(1, s));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) { const a = id(r, s), b = id(r, s + 1), c = id(r + 1, s), d = id(r + 1, s + 1); idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/* ================================================================ objects */
const CUP_OUTER = [[2.2, 0.6], [2.55, 0.9], [2.85, 1.6], [3.05, 2.6], [3.2, 3.8], [3.28, 5.0], [3.32, 5.8], [3.335, 6.0]];
const CUP_INNER = [[0.001, 0.84], [1.3, 0.88], [2.05, 1.07], [2.48, 1.6], [2.75, 2.6], [2.92, 3.8], [3.01, 5.0], [3.07, 5.8]];
const LOGO_D = 4.6, LOGO_Y = 3.45, FILL = 4.85;
function buildCup(logoTex) {
  const group = new THREE.Group();
  const prof = [[0.001, 0.0], [1.55, 0.0], [1.72, 0.04], [1.8, 0.2], [1.82, 0.38], [1.95, 0.5], ...CUP_OUTER,
    [3.32, 6.1], [3.26, 6.16], [3.18, 6.15], [3.12, 6.08], ...CUP_INNER.slice().reverse()];
  group.add(shadowed(new THREE.Mesh(lathe(prof, 192), MAT.porcelain)));
  const hc = new THREE.CatmullRomCurve3([V3(3.1, 5.15, 0), V3(4.35, 5.3, 0), V3(5.2, 4.6, 0), V3(5.25, 3.35, 0), V3(4.5, 2.35, 0), V3(2.8, 2.0, 0)]);
  const handle = shadowed(new THREE.Mesh(new THREE.TubeGeometry(hc, 100, 0.36, 24), MAT.porcelain));
  handle.scale.z = 0.8; handle.rotation.y = 0.62; group.add(handle);
  // logo decal following the tapered wall; UVs by arc length keep the round logo round
  const NA = 120, NY = 90, half = LOGO_D / 2 + 0.05;
  const pos = [], nor = [], uv = [], idx = [];
  const amax = (half + 0.05) / interp(CUP_OUTER, LOGO_Y - half);
  for (let j = 0; j <= NY; j++) {
    const y = LOGO_Y - half + (2 * half * j) / NY, r = interp(CUP_OUTER, y) + 0.012;
    const dr = (interp(CUP_OUTER, y + 0.01) - interp(CUP_OUTER, y - 0.01)) / 0.02;
    for (let i = 0; i <= NA; i++) {
      const a = -amax + (2 * amax * i) / NA;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      const n = V3(Math.sin(a), -dr, Math.cos(a)).normalize(); nor.push(n.x, n.y, n.z);
      uv.push(0.5 + (a * r) / LOGO_D, 0.5 + (y - LOGO_Y) / LOGO_D);
    }
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const dg = new THREE.BufferGeometry();
  dg.setIndex(idx); dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const U = { uReveal: { value: 0 }, uTime: { value: 0 } };
  const dm = new THREE.MeshPhysicalMaterial({ map: logoTex, transparent: true, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
  dm.onBeforeCompile = sh => {
    sh.uniforms.uReveal = U.uReveal; sh.uniforms.uTime = U.uTime;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal; uniform float uTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 dc = vMapUv - 0.5; float rr = length(dc) * 2.0; float ang = atan(dc.y, dc.x);
        float front = uReveal * 1.3 - 0.12;
        float rw = rr + 0.03 * sin(ang * 7.0 + uTime * 3.0) + 0.018 * sin(ang * 13.0 - uTime * 5.0);
        float revealMask = 1.0 - smoothstep(front - 0.025, front + 0.005, rw);
        float edgeGlow = smoothstep(front - 0.16, front - 0.05, rw) * (1.0 - smoothstep(front - 0.05, front - 0.01, rw));
        edgeGlow *= sampledDiffuseColor.a * (1.0 - smoothstep(0.9, 1.0, uReveal));
        diffuseColor.a *= revealMask;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.66, 0.26) * edgeGlow * 2.2;`);
  };
  const decal = new THREE.Mesh(dg, dm); decal.renderOrder = 2; group.add(decal);
  const crema = new THREE.Mesh(polarDisk(110, 256), MAT.crema); crema.receiveShadow = true;
  group.add(crema);
  return { group, decal, decalU: U, crema };
}
function buildSaucer() {
  const prof = [[0.001, 0.0], [3.5, 0.0], [3.7, 0.06], [3.8, 0.28], [4.3, 0.34], [6.2, 0.56], [7.05, 0.9], [7.25, 1.08], [7.22, 1.17], [7.05, 1.12], [6.2, 0.82], [4.4, 0.66], [3.9, 0.7], [3.3, 0.64], [0.001, 0.64]];
  return shadowed(new THREE.Mesh(lathe(prof, 192), MAT.porcelain));
}
const FLOOR_Y = -2.4; // underside of the basket floor
function buildPortafilter() {
  const g = new THREE.Group();
  // bottomless: the copper body is a ring with a lip, the perforated basket floor shows from below
  g.add(shadowed(new THREE.Mesh(lathe([[2.4, -2.34], [2.4, -2.5], [2.5, -2.82], [2.74, -2.97], [3.06, -2.82], [3.25, -2.3], [3.45, -1.2], [3.55, -0.2], [3.62, 0.0], [3.62, 0.18], [3.45, 0.26], [3.1, 0.22]], 160), MAT.copper)));
  g.add(shadowed(new THREE.Mesh(lathe([[3.09, 0.24], [2.98, 0.12], [2.93, -0.5], [2.86, -1.8], [2.76, -2.25], [2.5, -2.32], [0.001, -2.33]], 160), MAT.basket)));
  const floor = shadowed(new THREE.Mesh(new THREE.CircleGeometry(2.62, 192), MAT.basketFloor), false, true);
  floor.rotation.x = Math.PI / 2; floor.position.y = FLOOR_Y; g.add(floor);
  for (const s of [-1, 1]) { const lug = shadowed(new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.42, 1.0, 4, 0.18), MAT.copper)); lug.position.set(0, -0.32, s * 3.9); g.add(lug); }
  const arm = new THREE.Group(); arm.position.set(3.2, -1.3, 0); arm.rotation.z = -0.12; g.add(arm);
  const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 3.2, 48), MAT.copper)); neck.rotation.z = -Math.PI / 2; neck.position.x = 1.6; arm.add(neck);
  const ferrule = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.18, 16, 64), MAT.copper)); ferrule.rotation.y = Math.PI / 2; ferrule.position.x = 3.25; arm.add(ferrule);
  const grip = shadowed(new THREE.Mesh(lathe([[0.001, 0], [0.78, 0], [0.98, 0.6], [1.16, 3.4], [1.22, 6.0], [1.08, 8.4], [0.82, 9.3], [0.001, 9.5]], 64), MAT.wood));
  grip.rotation.z = -Math.PI / 2; grip.position.x = 3.3; arm.add(grip);
  return g;
}
function buildGroupHead() {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(lathe([[0.001, 0.28], [3.35, 0.28], [3.72, 0.38], [3.86, 0.7], [3.86, 2.6], [4.3, 3.0], [4.55, 3.4], [4.55, 12]], 160), MAT.chrome)));
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.12, 12, 96), new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.7 })); gasket.rotation.x = Math.PI / 2; gasket.position.y = 0.3; g.add(gasket);
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(34, 14, 18), MAT.steelDark)); body.position.set(0, 17, -4); g.add(body);
  const splash = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(40, 30), MAT.backsplash), false, true); splash.position.set(0, -6, -9); g.add(splash);
  const tray = shadowed(new THREE.Mesh(new THREE.BoxGeometry(30, 1, 16), MAT.steelDark), false, true); tray.position.set(0, -16.0, 0); g.add(tray);
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.8 });
  for (let i = -7; i <= 7; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 14), slotMat); s.position.set(i * 1.9, -15.46, 0); g.add(s); }
  return g;
}
function buildTamper() {
  const g = new THREE.Group();
  const base = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.8, 128), MAT.chrome)); base.position.y = 0.4; g.add(base);
  const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 2.2, 48), MAT.copper)); neck.position.y = 1.9; g.add(neck);
  const knob = shadowed(new THREE.Mesh(lathe([[0.001, 0], [0.9, 0.05], [1.5, 0.9], [1.75, 2.2], [1.55, 3.4], [0.9, 4.0], [0.001, 4.1]], 64), MAT.wood)); knob.position.y = 2.9; g.add(knob);
  return g;
}
function buildGrinder() {
  const g = new THREE.Group();
  const coneProf = [[0.001, -1.3], [2.85, -1.3], [2.85, -0.9], [2.55, -0.2], [2.1, 0.6], [1.5, 1.5], [0.9, 2.4], [0.45, 3.0], [0.001, 3.15]];
  const coneR = y => interp(coneProf.slice(2), y);
  const cone = new THREE.Group();
  cone.add(shadowed(new THREE.Mesh(lathe(coneProf, 160), MAT.steel)));
  const ridges = [];
  for (let b = 0; b < 11; b++) {
    const pts = [];
    for (let k = 0; k <= 16; k++) { const s = k / 16, y = lerp(2.85, -0.95, s), r = coneR(y) + 0.04, a = (b / 11) * Math.PI * 2 + s * 1.7; pts.push(V3(Math.cos(a) * r, y, Math.sin(a) * r)); }
    ridges.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.12, 8));
  }
  cone.add(shadowed(new THREE.Mesh(mergeGeometries(ridges), MAT.chrome)));
  g.add(cone);
  g.add(shadowed(new THREE.Mesh(lathe([[3.9, -1.4], [3.9, 1.05], [3.0, 1.05], [3.0, -1.4]], 160), MAT.steel)));
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 2.1, 0.3), MAT.chrome, 60);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2; q.setFromEuler(new THREE.Euler(0, -a, 0.38, 'YXZ')); m.compose(V3(Math.cos(a) * 2.98, -0.25, Math.sin(a) * 2.98), q, V3(1, 1, 1)); teeth.setMatrixAt(i, m); }
  teeth.castShadow = true; teeth.receiveShadow = true; g.add(teeth);
  g.add(shadowed(new THREE.Mesh(lathe([[3.9, 1.05], [6.4, 5.2]], 160), MAT.steelDark)));
  return { group: g, cone, coneR };
}
function buildMyrtle() {
  const g = new THREE.Group();
  const R = mulberry32(31);
  const curve = new THREE.CatmullRomCurve3([V3(-4.6, 0.12, 9.8), V3(-3.0, 0.2, 8.6), V3(-1.6, 0.16, 9.2), V3(-0.3, 0.14, 8.4)]);
  g.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.07, 8), MAT.twig)));
  const leafGeo = new THREE.SphereGeometry(1, 20, 12); leafGeo.scale(0.42, 0.06, 1.05); leafGeo.translate(0, 0, 0.95);
  for (let i = 0; i < 18; i++) {
    const s = 0.05 + (i / 18) * 0.9, p = curve.getPointAt(s), tg = curve.getTangentAt(s), side = i % 2 ? 1 : -1;
    const leaf = shadowed(new THREE.Mesh(leafGeo, MAT.leaf));
    leaf.position.copy(p); leaf.rotation.set(-0.15 + R() * 0.3, Math.atan2(tg.x, tg.z) + side * (1.0 + R() * 0.4), side * 0.3); leaf.scale.setScalar(0.75 + R() * 0.35);
    g.add(leaf);
  }
  for (const [x, z] of [[0.1, 8.0], [0.5, 8.6], [-0.25, 8.9], [-1.0, 7.9]]) { const b = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.36, 32, 20), MAT.berry)); b.position.set(x, 0.36, z); b.scale.y = 0.92; g.add(b); }
  return g;
}

/* ================================================================ particles */
function pointsMaterial(additive) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uPx: { value: H * 0.0012 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uPx; varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = clamp(aSize*uPx*30.0/max(-mv.z,0.5), 0.0, 48.0); vA = aAlpha; vC = aColor; }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 c = gl_PointCoord-0.5; float r = length(c)*2.0; float a = exp(-r*r*4.0)*vA; if (a < 0.004) discard; gl_FragColor = vec4(vC, a); }`
  });
}
function makePoints(count, additive) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(count), 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const p = new THREE.Points(geo, pointsMaterial(additive)); p.frustumCulled = false;
  return p;
}

/* ================================================================ post: DOF, accumulation, overlay */
const sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: MSAA });
sceneRT.depthTexture = new THREE.DepthTexture(W, H); sceneRT.depthTexture.type = THREE.UnsignedIntType;
const aoRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const dofRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const accumRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const dofQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  defines: { TAPS: DOF_TAPS },
  uniforms: { tColor: { value: null }, tDepth: { value: sceneRT.depthTexture }, uRes: { value: new THREE.Vector2(W, H) }, uFocus: { value: 20 }, uAperture: { value: 0 }, uMaxBlur: { value: 34 * SCALE }, uSeed: { value: 0 }, uNear: { value: camera.near }, uFar: { value: camera.far } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `#include <packing>
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uFocus, uAperture, uMaxBlur, uNear, uFar, uSeed; varying vec2 vUv;
    float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
    float viewZ(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    float coc(float z){ return clamp(uAperture * abs(z - uFocus) / max(z, 0.01), 0.0, uMaxBlur); }
    vec3 fetch(vec2 uv, float lim){ vec3 c = texture2D(tColor, uv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); float m = max(max(c.r, c.g), c.b); return m > lim ? c * (lim / m) : c; }
    void main(){
      vec3 base = fetch(vUv, 16.0);
      float z0 = viewZ(vUv), c0 = coc(z0);
      if (c0 < 0.6) { gl_FragColor = vec4(base, 1.0); return; }
      vec3 acc = min(base, vec3(4.0)); float wsum = 1.0;
      float rot = ign(gl_FragCoord.xy + uSeed * 17.31) * 6.2831853;
      for (int i = 1; i < TAPS; i++) {
        float fi = float(i);
        float r = sqrt((fi + ign(gl_FragCoord.yx + uSeed * 5.7)) / float(TAPS)) * c0, a = fi * 2.39996323 + rot;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
        float zs = viewZ(uv), cs = coc(zs);
        float w = zs < z0 - 0.5 ? smoothstep(r - 1.0, r + 1.0, cs) : 1.0;
        vec3 s = fetch(uv, 4.0);
        w *= 1.0 + 0.8 * smoothstep(1.0, 4.0, dot(s, vec3(0.2126, 0.7152, 0.0722)));
        acc += s * w; wsum += w;
      }
      gl_FragColor = vec4(acc / wsum, 1.0);
    }`
}));
const accumQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uW: { value: 1 } },
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: 'uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uW, uW); }'
}));
// lens: a touch of lateral chromatic aberration towards the corners
const lensRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
const lensQuad = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tSrc: { value: null }, uK: { value: 0.0016 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D tSrc; uniform float uK; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; vec2 o = d * uK * dot(d, d) * 4.0;
      gl_FragColor = vec4(texture2D(tSrc, vUv + o).r, texture2D(tSrc, vUv).g, texture2D(tSrc, vUv - o).b, 1.0); }`
}));
// sub-pixel camera jitter per sub-frame: the accumulation doubles as supersampling
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
let gtao, bloom, outputPass;
const DOF_STATE = { focus: 20, aperture: 0 };

const overlay = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -1, 1);
function textPlane(lines, opts) {
  const cv = document.createElement('canvas');
  const g0 = cv.getContext('2d');
  const widths = lines.map(l => { g0.letterSpacing = `${l.ls}px`; g0.font = `${l.size}px ${opts.family}`; return g0.measureText(l.text).width; });
  const pad = lines[0].size * 1.2;
  cv.width = Math.ceil(Math.max(...widths) + pad * 2 + 300 * SCALE);
  cv.height = Math.ceil(lines.reduce((s, l) => s + l.size * 1.55, 0) + pad);
  const g = cv.getContext('2d');
  let y = pad * 0.5;
  lines.forEach((l, i) => {
    y += l.size * 1.15;
    g.font = `${l.size}px ${opts.family}`; g.letterSpacing = `${l.ls}px`; g.textAlign = 'center';
    const grd = g.createLinearGradient(0, y - l.size, 0, y); grd.addColorStop(0, l.c1); grd.addColorStop(1, l.c2);
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = l.size * 0.4; g.shadowOffsetY = l.size * 0.06;
    g.fillStyle = grd; g.fillText(l.text, cv.width / 2, y);
    if (i === 0) {
      g.shadowBlur = 0; g.strokeStyle = l.c2; g.lineWidth = Math.max(1, l.size * 0.04); g.globalAlpha = 0.8;
      const w2 = widths[i] / 2 + l.size * 0.8, len = 110 * SCALE;
      g.beginPath(); g.moveTo(cv.width / 2 - w2 - len, y - l.size * 0.36); g.lineTo(cv.width / 2 - w2, y - l.size * 0.36);
      g.moveTo(cv.width / 2 + w2, y - l.size * 0.36); g.lineTo(cv.width / 2 + w2 + len, y - l.size * 0.36); g.stroke(); g.globalAlpha = 1;
    }
    y += l.size * 0.4;
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(cv.width, cv.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
  overlay.add(m);
  return m;
}
const shade = (() => {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, 'rgba(6,3,2,0)'); gr.addColorStop(0.5, 'rgba(6,3,2,0.55)'); gr.addColorStop(1, 'rgba(6,3,2,0.8)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.42), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  m.position.y = -H / 2 + H * 0.21; m.renderOrder = -1; overlay.add(m);
  return m;
})();
const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
fadeQuad.renderOrder = 10; overlay.add(fadeQuad);

/* ================================================================ scene assembly */
const SET = { beans: new THREE.Group(), burrs: new THREE.Group(), dose: new THREE.Group(), machine: new THREE.Group(), table: new THREE.Group() };
Object.values(SET).forEach(s => scene.add(s));
const L = {};
let cup, portafilter, grinder, tamper, tagline;
let heroBeans, grindBeans, fragsI, groundsI, clumpsI, haze, puff, steam = [], sparks, tableBeans;
const BEANS = [], GRIND = { beans: [], frags: [] }, DOSE = { parts: [] };

async function build() {
  const fontR = new FontFace('CinzelR', 'url(/assets/Cinzel-Regular.ttf)');
  await fontR.load(); document.fonts.add(fontR);
  await buildMaterials();
  const hdr = await new RGBELoader().loadAsync('/v3/assets/comfy_cafe_2k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdr; scene.environmentIntensity = 0.7;
  // visible background: the same HDRI on a far sphere, warm-tinted and darkened; the lens DOF does the blurring
  OBJ.bg = new THREE.Mesh(new THREE.SphereGeometry(1500, 96, 48), new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, fog: false }));
  scene.add(OBJ.bg);
  const logoTex = await new THREE.TextureLoader().loadAsync('/v3/assets/logo.png');
  logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 16;

  L.key = new THREE.SpotLight(0xffe0bc, 0, 0, 0.5, 0.9, 2);
  L.key.castShadow = true; L.key.shadow.mapSize.set(SHADOW, SHADOW); L.key.shadow.radius = 9; L.key.shadow.blurSamples = 20; L.key.shadow.bias = -0.0002;
  L.key.shadow.camera.near = 4; L.key.shadow.camera.far = 160;
  scene.add(L.key, L.key.target);
  L.rim = new THREE.PointLight(0xffa458, 0, 0, 2); scene.add(L.rim);
  L.fill = new THREE.PointLight(0xffd6b0, 0, 0, 2); scene.add(L.fill);
  L.back = new THREE.PointLight(0xff8a30, 0, 0, 2); scene.add(L.back);
  L.glint = new THREE.PointLight(0xfff1dc, 0, 0, 2); scene.add(L.glint);
  // softboxes for the liquid shots: broad, photographic highlights instead of point-light dots
  RectAreaLightUniformsLib.init();
  L.soft = new THREE.RectAreaLight(0xfff1e2, 0, 5, 9); scene.add(L.soft);
  L.strip = new THREE.RectAreaLight(0xffc996, 0, 1.4, 14); scene.add(L.strip);

  const beanGeo = beanGeometry();
  const R = mulberry32(5), c = new THREE.Color();
  const beanColor = () => c.setRGB(0.15 + R() * 0.09, 0.07 + R() * 0.035, 0.03 + R() * 0.018, THREE.SRGBColorSpace);

  /* shot 1: roasted beans falling in slow motion */
  const NH = 48;
  heroBeans = new THREE.InstancedMesh(beanGeo, MAT.bean, NH); heroBeans.castShadow = true; heroBeans.frustumCulled = false;
  for (let i = 0; i < NH; i++) {
    heroBeans.setColorAt(i, beanColor());
    const hero = i === 0;
    BEANS.push({
      x: hero ? 0.25 : (R() * 2 - 1) * 6, z: hero ? 0.3 : -16 + R() * 25, y0: hero ? 2.5 : -6 + R() * 18, v: hero ? 3.0 : 2.4 + R() * 2.6,
      s: hero ? 0.8 : 0.62 + R() * 0.16, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: hero ? 0.9 : 0.5 + R() * 1.6,
      q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(hero ? 0.4 : R() * 6, hero ? -0.3 : R() * 6, hero ? 0.2 : R() * 6))
    });
  }
  SET.beans.add(heroBeans);

  /* shot 2: conical burrs */
  grinder = buildGrinder(); SET.burrs.add(grinder.group);
  const NB = 70;
  grindBeans = new THREE.InstancedMesh(beanGeo, MAT.bean, NB); grindBeans.castShadow = true; grindBeans.receiveShadow = true; grindBeans.frustumCulled = false;
  for (let i = 0; i < NB; i++) {
    grindBeans.setColorAt(i, beanColor());
    GRIND.beans.push({ phi: R() * Math.PI * 2, r0: 1.6 + R() * 2.4, y0: 0.6 + R() * 5.6, v: 0.8 + R() * 1.1, w: 0.45 + R() * 0.5, s: 0.52 + R() * 0.16, crushY: 0.25 + R() * 0.5, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 1 + R() * 2.5, q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)) });
  }
  SET.burrs.add(grindBeans);
  fragsI = new THREE.InstancedMesh(chunkGeometry(), MAT.chunk, NB * 6); fragsI.castShadow = true; fragsI.frustumCulled = false;
  for (let i = 0; i < NB * 6; i++) {
    const inner = R() < 0.4; c.setRGB(inner ? 0.34 : 0.15, inner ? 0.19 : 0.075, inner ? 0.09 : 0.035, THREE.SRGBColorSpace); fragsI.setColorAt(i, c);
    GRIND.frags.push({ dir: V3(R() - 0.5, -0.4 - R() * 0.6, R() - 0.5).normalize(), sp: 1.0 + R() * 1.8, s: 0.16 + R() * 0.16, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 2 + R() * 4 });
  }
  SET.burrs.add(fragsI);

  /* shot 3: dosing and tamp */
  portafilter = buildPortafilter();
  const mound = new THREE.Mesh(polarDisk(120, 300), MAT.grounds); mound.receiveShadow = true; mound.castShadow = true;
  OBJ.mound = mound; OBJ.moundBase = mound.geometry.attributes.position.array.slice();
  portafilter.add(mound);
  tamper = buildTamper(); SET.dose.add(tamper);
  const NG = 16000, NC = 160;
  const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-6)) * Math.cos(6.283 * R());
  groundsI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), MAT.grain, NG); groundsI.frustumCulled = false; groundsI.castShadow = true;
  clumpsI = new THREE.InstancedMesh(chunkGeometry(), MAT.grain, NC); clumpsI.frustumCulled = false; clumpsI.castShadow = true;
  for (let i = 0; i < NG + NC; i++) {
    const clump = i >= NG, k = R();
    c.setRGB(lerp(0.7, 1.45, k), lerp(0.66, 1.35, k), lerp(0.62, 1.28, k)); (clump ? clumpsI : groundsI).setColorAt(clump ? i - NG : i, c); // tints the scanned colour map
    DOSE.parts.push({
      ts: lerp(T.dose - 1.1, T.tamp - 0.45, R()), gx: gauss(), gz: gauss(), clump, idx: clump ? i - NG : i,
      s: clump ? 0.035 + Math.pow(R(), 1.5) * 0.04 : 0.008 + Math.pow(R(), 2) * 0.016,
      v0: clump ? 12.5 + R() * 2 : 10 + R() * 2.5, g: clump ? 21 : 17,
      sx: 0.7 + R() * 0.6, sy: 0.6 + R() * 0.5, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: (clump ? 3 : 12) * R(), seed: R() * 100
    });
  }
  SET.dose.add(groundsI, clumpsI);
  haze = makePoints(1800, false);
  haze.userData.seed = Array.from({ length: 1800 }, () => [gauss(), gauss(), R(), R()]);
  SET.dose.add(haze);
  puff = makePoints(300, false);
  puff.userData.seed = Array.from({ length: 300 }, () => [R() * 6.283, R(), R()]);
  SET.dose.add(puff);

  /* shot 4: bottomless extraction */
  SET.machine.add(buildGroupHead());
  OBJ.film = new THREE.Mesh(polarDisk(200, 720), MAT.film); // child of the portafilter, hanging under the basket floor
  OBJ.film.rotation.x = Math.PI; OBJ.film.scale.set(FILM.uRad.value, 1, FILM.uRad.value); OBJ.film.position.y = FLOOR_Y - 0.003;
  OBJ.film.frustumCulled = false; OBJ.film.receiveShadow = true; portafilter.add(OBJ.film);
  buildBeads(mulberry32(77));
  OBJ.stream = buildStreamMesh(); SET.machine.add(OBJ.stream);

  cup = buildCup(logoTex); scene.add(cup.group);
  scene.add(portafilter);

  /* shot 5: table (Gallura granite, cork, saucer, myrtle, beans) */
  const granite = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(90, 60, 1, 1), MAT.granite), false, true);
  granite.rotation.x = -Math.PI / 2; granite.position.set(0, 0, 8); SET.table.add(granite);
  const edge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(90, 3, 0.6), MAT.granite), false, true); edge.position.set(0, -1.5, -22); SET.table.add(edge);
  const cork = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 0.55, 160), [MAT.corkSide, MAT.corkTop, MAT.corkTop])); cork.position.y = 0.275; SET.table.add(cork);
  const saucer = buildSaucer(); saucer.position.y = 0.55; SET.table.add(saucer);
  SET.table.add(buildMyrtle());
  tableBeans = new THREE.InstancedMesh(beanGeo, MAT.bean, 8); tableBeans.castShadow = true; tableBeans.receiveShadow = true;
  [[2.4, 9.2, 0.4], [3.4, 10.2, 2.1], [1.5, 10.8, 4.0], [4.1, 8.6, 5.1], [-4.4, 11.6, 1.2], [2.8, 12.0, 2.8], [4.8, 11.3, 0.9], [-2.6, 12.4, 3.6]].forEach(([x, z, a], i) => {
    tableBeans.setMatrixAt(i, new THREE.Matrix4().compose(V3(x, 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.05, a, 0.1 * i, 'YXZ')), V3(0.62, 0.62, 0.62)));
    tableBeans.setColorAt(i, beanColor());
  });
  SET.table.add(tableBeans);
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.puffs[i % 4], color: 0xc9b396, transparent: true, depthWrite: false, opacity: 0 }));
    sp.userData = { x: (R() - 0.5) * 3.2, z: (R() - 0.5) * 3.2, ph: R(), sp: 0.5 + R() * 0.4, rot: (R() - 0.5) * 0.7, size: 2.4 + R() * 2.6, seed: R() * 40 };
    steam.push(sp); SET.table.add(sp);
  }
  sparks = makePoints(1100, true);
  sparks.userData.seed = Array.from({ length: 1100 }, () => {
    let u, v; do { u = R() - 0.5; v = R() - 0.5; } while (u * u + v * v > 0.23);
    return { u, v, rho: Math.hypot(u, v) / 0.48, phi: R() * 6.283, r0: 6 + R() * 6, y0: 0.5 + R() * 11, dur: 0.75 + R() * 0.55, size: 0.6 + R() * 1.6, tw: R() * 30 };
  });
  SET.table.add(sparks);

  tagline = textPlane([
    { text: 'SU CAFÈ DE SARDIGNA', size: 74 * SCALE, ls: 10 * SCALE, c1: '#fff1cf', c2: '#d9a35a' },
    { text: 'SARDINIAN COFFEE CORNER', size: 30 * SCALE, ls: 15 * SCALE, c1: '#f0dcb6', c2: '#c08a4c' }
  ], { family: 'CinzelR' });

  if (AO) {
    gtao = new GTAOPass(scene, camera, W, H);
    gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.5, scale: 1.1, samples: 16 });
    gtao.blendIntensity = 0.9;
  }
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.5, 0.92);
  outputPass = new OutputPass();
}
const OBJ = {};

/* ================================================================ cameras */
function lookCam(pos, tgt, roll, fov) {
  const m = new THREE.Matrix4().lookAt(pos, tgt, V3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), roll));
  return { pos, quat: q, fov };
}
function orbitCam(tgt, d, el, az, roll, fov) {
  const pos = V3(tgt.x + d * Math.cos(el) * Math.sin(az), tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(el) * Math.cos(az));
  return { pos, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-el, az, roll, 'YXZ')), fov };
}
function handheld(cam, t, amp, freq = 1.6) { // gentle camera-operator float
  const n = k => N3(t * freq + k * 9.7, k * 3.1, 0.5);
  cam.pos.add(V3(n(1), n(2), n(3)).multiplyScalar(amp));
  cam.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(n(4) * amp * 0.04, n(5) * amp * 0.04, n(6) * amp * 0.05)));
  return cam;
}
// Point the cafe HDRI so the equirect column u (0..1) sits behind a camera looking from `from` to `to`.
// Columns of interest in comfy_cafe: 0.13 and 0.93 wall lamps on grey panels, 0.29 lamp on brick, 0.585 brick wall with lamp and frames.
function envFacing(u, from, to) {
  const d = V3(...to).sub(V3(...from));
  return 2 * Math.PI * (u - 0.5) - Math.atan2(d.z, d.x);
}
const WARM = new THREE.Color(1.0, 0.72, 0.5);
function bgFacing(u, from, to) { // rotation of the background sphere that puts column u behind the camera's line of sight
  const d = V3(...to).sub(V3(...from));
  return Math.PI - 2 * Math.PI * u - Math.atan2(d.z, d.x);
}
function setEnv(env, bg, bgIntensity, envIntensity) {
  scene.environmentRotation.set(0, env, 0); scene.environmentIntensity = envIntensity;
  OBJ.bg.rotation.y = bg; OBJ.bg.material.color.copy(WARM).multiplyScalar(bgIntensity); OBJ.bg.visible = bgIntensity > 0.001;
}

/* ================================================================ shot: beans */
function shotBeans(t) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  BEANS.forEach((b, i) => {
    p.set(b.x + 0.15 * N3(i, t * 0.4, 1), b.y0 - b.v * t, b.z);
    q.copy(b.q0).multiply(new THREE.Quaternion().setFromAxisAngle(b.ax, b.spin * t));
    m.compose(p, q, s.setScalar(b.s)); heroBeans.setMatrixAt(i, m);
  });
  heroBeans.instanceMatrix.needsUpdate = true;
  const k = smoother(0, T.burrs, t);
  const cam = lookCam(V3(lerp(0.9, 0.3, k), lerp(1.4, 0.6, k), lerp(16.5, 14.6, k)), V3(0.15, lerp(0.8, 0.0, k), 0), lerp(-0.04, 0.02, k), 30);
  const hero = V3(BEANS[0].x, BEANS[0].y0 - BEANS[0].v * t, BEANS[0].z);
  DOF_STATE.focus = cam.pos.distanceTo(hero); DOF_STATE.aperture = 26;
  L.key.position.set(-10, 14, 10); L.key.target.position.set(0, 0, 0); L.key.intensity = 900; L.key.angle = 0.5;
  L.rim.position.set(7, 4, -6); L.rim.intensity = 520;
  L.fill.position.set(4, -3, 12); L.fill.intensity = 50;
  L.back.position.set(-6, -2, -8); L.back.intensity = 140;
  setEnv(envFacing(0.135, [0.6, 1.0, 15.5], [0.15, 0.4, 0]), bgFacing(0.135, [0.6, 1.0, 15.5], [0.15, 0.4, 0]), 0.3, 0.55);
  renderer.toneMappingExposure = 1.0;
  return handheld(cam, t, 0.05);
}

/* ================================================================ shot: burrs */
const burrAngle = lt => 1.3 * lt + (lt > 0.62 ? 9.0 * Math.pow(lt - 0.62, 2) : 0);
const grindWarp = lt => lt + (lt > 0.62 ? 1.6 * Math.pow(lt - 0.62, 2) : 0);
const BURR_KEYS = [[0.0, [-1.9, 8.6, 6.6], [1.4, 0.2, 0.5]], [0.66, [0.0, 7.0, 5.6], [1.8, 0.0, 0.4]], [0.9, [1.3, 5.9, 4.9], [2.1, -0.3, 0.1]], [T.dose - T.burrs, [2.5, 4.6, 3.2], [2.6, -1.1, -0.6]]];
function shotBurrs(t) {
  const lt = t - T.burrs + 0.25; // start a little into the grinding
  const th = burrAngle(lt), tw = grindWarp(lt);
  grinder.cone.rotation.y = -th;
  const kt = t - T.burrs;
  const camPos = V3(...hermite(BURR_KEYS, kt, k => k[1])), camTgt = V3(...hermite(BURR_KEYS, kt, k => k[2]));
  const keep = lerp(2.2, 3.2, smooth(0.5, 1.0, kt));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  GRIND.beans.forEach((b, i) => {
    const y = b.y0 - b.v * tw - 0.35 * tw * tw;
    const twc = (-b.v + Math.sqrt(Math.max(0, b.v * b.v + 4 * 0.35 * (b.y0 - b.crushY)))) / (2 * 0.35);
    const yc = Math.max(y, b.crushY), twEff = Math.min(tw, twc);
    const coneR = grinder.coneR(yc), wallR = yc > 1.05 ? lerp(3.9, 6.4, (yc - 1.05) / 4.15) : 3.0;
    const r = clamp(b.r0, coneR + 0.62, wallR - 0.62);
    const phi = b.phi + 0.33 * b.w * th + 0.2 * twEff;
    p.set(Math.cos(phi) * r, yc, Math.sin(phi) * r);
    const d = p.distanceTo(camPos); if (d < keep) p.add(p.clone().sub(camPos).normalize().multiplyScalar(keep - d));
    q.copy(b.q0).multiply(new THREE.Quaternion().setFromAxisAngle(b.ax, b.spin * tw));
    m.compose(p, q, s.setScalar(b.s * (1 - smooth(twc, twc + 0.12, tw)))); grindBeans.setMatrixAt(i, m);
    for (let k = 0; k < 6; k++) {
      const f = GRIND.frags[i * 6 + k], age = tw - twc;
      let fs = 0; const fp = V3(Math.cos(phi) * r, b.crushY, Math.sin(phi) * r);
      if (age > 0) {
        fs = f.s * b.s * smooth(0, 0.06, age) * (1 - smooth(0.6, 1.0, age));
        fp.addScaledVector(f.dir, f.sp * age).addScaledVector(V3(Math.cos(phi), 0, Math.sin(phi)), 0.25 * age);
        fp.applyAxisAngle(V3(0, 1, 0), -0.5 * (burrAngle(lt) - burrAngle(Math.max(0, lt - age))));
      }
      const fd = fp.distanceTo(camPos); if (fd < keep) fp.add(fp.clone().sub(camPos).normalize().multiplyScalar(keep - fd));
      q.setFromAxisAngle(f.ax, f.spin * Math.max(age, 0));
      m.compose(fp, q, s.setScalar(fs)); fragsI.setMatrixAt(i * 6 + k, m);
    }
  });
  grindBeans.instanceMatrix.needsUpdate = true; fragsI.instanceMatrix.needsUpdate = true;
  DOF_STATE.focus = camPos.distanceTo(V3(2.0, 0.2, 0.4)); DOF_STATE.aperture = 18;
  L.key.position.set(1.5, 15, 5); L.key.target.position.set(1.5, 0, 0); L.key.intensity = 650; L.key.angle = 0.45;
  L.rim.position.set(-4.5, 2.2, -2.5); L.rim.intensity = 70;
  L.fill.position.set(4, 5, 6); L.fill.intensity = 30;
  L.back.position.set(2.6, -0.4, -2.4); L.back.intensity = 12;
  setEnv(0.6, 0, 0, 0.55);
  renderer.toneMappingExposure = 1.05;
  const cam = lookCam(camPos, camTgt, 0.25 * Math.sin(kt * 1.1) + 0.5 * smooth(0.8, T.dose - T.burrs, kt), lerp(42, 54, smooth(0.75, T.dose - T.burrs, kt)));
  return handheld(cam, t, 0.03 + 0.05 * smooth(0.7, 1.05, kt), 3);
}

/* ================================================================ shot: dosing & tamp */
const BASKET_R = 2.82;
function preTampSurface(t) { const f = smoother(T.dose - 0.15, T.tamp - 0.35, t); return { base: lerp(-2.25, -1.0, f), peak: lerp(0.05, 1.55, Math.pow(f, 0.9)) }; }
function moundHeight(rho, ang, t) {
  const tampK = smooth(T.tamp - 0.025, T.tamp + 0.02, t), s = preTampSurface(Math.min(t, T.tamp - 0.025)), u = clamp(rho / BASKET_R);
  const pre = s.base + s.peak * Math.pow(1 - u * u, 1.25) + 0.06 * N3(Math.cos(ang) * rho * 2.2, Math.sin(ang) * rho * 2.2, 1.7) * (1 - u * 0.5);
  const post = -0.62 + 0.012 * N3(Math.cos(ang) * rho * 6, Math.sin(ang) * rho * 6, 3.3) + 0.05 * Math.pow(u, 12);
  return lerp(pre, post, tampK);
}
function updateMound(t) {
  const pos = OBJ.mound.geometry.attributes.position, base = OBJ.moundBase;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3] * BASKET_R, z = base[i * 3 + 2] * BASKET_R;
    pos.setXYZ(i, x, moundHeight(Math.hypot(x, z), Math.atan2(z, x), t), z);
  }
  pos.needsUpdate = true; OBJ.mound.geometry.computeVertexNormals();
}
const DOSE_KEYS = [[0.0, [-7.6, 7.8, 13.2], [0.2, -0.2, 0.0]], [0.95, [-5.6, 6.0, 11.2], [0.3, -0.3, 0.0]], [T.extract - T.dose, [-4.8, 4.0, 10.4], [0.4, -0.6, 0.0]]];
function shotDose(t) {
  const lt = t - T.dose;
  portafilter.position.set(0, 0, 0); portafilter.rotation.set(0, 0, 0);
  updateMound(t);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  DOSE.parts.forEach((g, i) => {
    const age = t - g.ts; let sc = 0;
    if (age > 0) {
      const y = 9.5 - g.v0 * age - 0.5 * g.g * age * age, spread = 0.15 + 0.3 * age;
      p.set(0.25 + g.gx * spread + 0.12 * age * N3(g.seed, age * 1.5, 0), y, g.gz * spread + 0.12 * age * N3(g.seed, age * 1.5, 4));
      const rho = Math.hypot(p.x, p.z), surf = rho < BASKET_R ? moundHeight(rho, Math.atan2(p.z, p.x), t) : -3;
      if (y > surf + 0.01 && t < T.tamp) sc = g.s;
      q.setFromAxisAngle(g.ax, g.spin * age);
    }
    m.compose(p, q, s.set(sc * g.sx, sc * g.sy, sc)); (g.clump ? clumpsI : groundsI).setMatrixAt(g.idx, m);
  });
  groundsI.instanceMatrix.needsUpdate = true; clumpsI.instanceMatrix.needsUpdate = true;
  // fine powder haze around the stream while it pours
  const pour = smooth(T.dose - 0.2, T.dose + 0.1, t) * (1 - smooth(T.tamp - 0.6, T.tamp - 0.3, t));
  const ha = haze.geometry.attributes;
  haze.userData.seed.forEach(([gx, gz, ky, k], i) => {
    const y = 9 - ((ky * 11 + t * 6 * (0.6 + k)) % 11);
    const r = 0.35 + 0.5 * (9 - y) / 11;
    ha.position.setXYZ(i, 0.25 + gx * r + 0.2 * N3(i, t * 0.5, 1), y, gz * r + 0.2 * N3(i, t * 0.5, 5));
    ha.aSize.setX(i, 0.35 + k * 0.5); ha.aAlpha.setX(i, 0.16 * pour * (0.4 + 0.6 * k)); ha.aColor.setXYZ(i, 0.16, 0.1, 0.065);
  });
  ha.position.needsUpdate = ha.aSize.needsUpdate = ha.aAlpha.needsUpdate = ha.aColor.needsUpdate = true;
  const tampK = smooth(T.tamp - 0.025, T.tamp + 0.02, t);
  MAT.grounds.displacementScale = lerp(0.075, 0.014, tampK); MAT.grounds.displacementBias = lerp(-0.04, -0.007, tampK);
  MAT.grounds.normalScale.setScalar(lerp(1.5, 0.7, tampK)); MAT.grounds.roughness = lerp(1.0, 0.85, tampK);
  const drop = smoother(T.tamp - 0.34, T.tamp - 0.02, t), pre = preTampSurface(T.tamp - 0.025);
  let ty = lerp(15, pre.base + pre.peak, Math.pow(drop, 2.2));
  ty = lerp(ty, -0.62, smooth(T.tamp - 0.025, T.tamp + 0.02, t));
  ty += t > T.tamp ? 0.05 * Math.sin((t - T.tamp) * 40) * Math.exp(-(t - T.tamp) * 18) : 0;
  ty += 9 * Math.pow(smoother(T.tamp + 0.1, T.extract - 0.02, t), 1.6);
  tamper.position.set(0, ty, 0); tamper.rotation.y = 0.6 * (1 - drop);
  const pa = puff.geometry.attributes;
  puff.userData.seed.forEach(([a, k, j], i) => {
    const age = t - T.tamp, r = BASKET_R + 0.1 + (age > 0 ? (1.4 + k * 2.2) * age : 0);
    pa.position.setXYZ(i, Math.cos(a) * r, 0.25 + (age > 0 ? (0.4 + j * 1.2) * age : 0), Math.sin(a) * r);
    pa.aSize.setX(i, 1.2 + k * 2.4); pa.aAlpha.setX(i, age > 0 ? 0.5 * Math.exp(-age * 4) : 0); pa.aColor.setXYZ(i, 0.33, 0.21, 0.12);
  });
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;
  L.key.position.set(-9, 18, 11); L.key.target.position.set(0, -0.5, 0); L.key.intensity = 1500; L.key.angle = 0.42;
  L.rim.position.set(7, 6, -8); L.rim.intensity = 380;
  L.fill.position.set(8, 3, 10); L.fill.intensity = 60;
  L.back.position.set(-3, 9, -6); L.back.intensity = 110;
  setEnv(envFacing(0.29, [-5.6, 6.0, 11.2], [0.3, -0.3, 0]), bgFacing(0.29, [-5.6, 6.0, 11.2], [0.3, -0.3, 0]), 0.3, 0.6);
  renderer.toneMappingExposure = 1.0;
  const cam = lookCam(V3(...hermite(DOSE_KEYS, lt, k => k[1])), V3(...hermite(DOSE_KEYS, lt, k => k[2])), -0.04, 30);
  DOF_STATE.focus = cam.pos.distanceTo(V3(0.2, -0.3, 0)); DOF_STATE.aperture = 22;
  const imp = t > T.tamp ? 0.4 * Math.exp(-(t - T.tamp) * 9) : 0;
  handheld(cam, t, 0.04);
  if (imp > 0) { const n = k => N3(t * 26 + k * 9.7, k * 3.1, 0.5); cam.pos.add(V3(n(1), n(2), n(3)).multiplyScalar(imp)); }
  return cam;
}

/* ================================================================ shot: bottomless extraction */
const CUP_IN_MACHINE = V3(0, -15.36, 0);
const CUP_FLOOR = 0.86; // inside bottom of the cup (local y)
// a parcel of espresso leaves the cone tip at v0 and falls under g (slow motion)
const fallDist = tau => EX.v0 * tau + 0.5 * EX.g * tau * tau;
const fallTime = d => (-EX.v0 + Math.sqrt(EX.v0 * EX.v0 + 2 * EX.g * Math.max(d, 0))) / EX.g;
const coneK = lt => smoother(EX.cone, EX.cone + 0.5, lt);
const tipRadius = lt => lerp(0.05, 0.12, smooth(EX.stream - 0.15, EX.stream + 0.6, lt));
const tipPos = lt => V3(0.05 * N3(lt * 0.6, 1.3, 0.2), FLOOR_Y - 0.004 - EX.coneLen * Math.pow(coneK(lt), 0.85), 0.05 * N3(lt * 0.6, 4.1, 0.7));
const HIT = EX.stream + fallTime(tipPos(EX.stream).y - (CUP_IN_MACHINE.y + CUP_FLOOR)); // first coffee reaches the cup
const cupLevel = lt => CUP_FLOOR + 2.2 * Math.pow(smooth(HIT, HIT + 1.4, lt), 0.8);

// drops on the basket floor, one per chosen hole of the hexagonal pattern (film coordinates = floor x, -floor y)
function buildBeads(R) {
  const sites = [];
  for (let n = -12; n <= 12; n++) for (let m = -16; m <= 16; m++) for (const k of [0, 0.5]) {
    const x = 0.13 * (m + k), y = 0.13 * Math.sqrt(3) * (n + k), r = Math.hypot(x, y);
    if (r < 1.9) sites.push({ x, z: -y, r, o: R() });
  }
  sites.sort((a, b) => a.o - b.o);
  OBJ.beads = sites.slice(0, 230).map(b => ({
    x: b.x, z: b.z, s: 0.045 + 0.025 * R(),
    te: -0.3 + 1.0 * Math.pow(R(), 0.9) * (0.6 + 0.4 * b.r / 1.9), // a few already out when the shot opens, the centre goes first
    k: 4 + 6 * R()
  }));
  const tex = new THREE.DataTexture(new Float32Array(256 * 4), 256, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  FILM.uBeadTex.value = tex; FILM.uBeadN.value = OBJ.beads.length;
}
function updateFilm(t, lt) {
  const d = FILM.uBeadTex.value.image.data;
  OBJ.beads.forEach((b, i) => {
    const age = lt - b.te;
    d[i * 4] = b.x; d[i * 4 + 1] = b.z; d[i * 4 + 2] = age <= 0 ? 0 : 1 + b.k * Math.pow(age, 0.8); d[i * 4 + 3] = b.s;
  });
  FILM.uBeadTex.value.needsUpdate = true;
  FILM.uCov.value = 2.6 * smoother(0.3, 0.95, lt); // by the time the cone hangs the floor is all wet
  FILM.uDrain.value = 2.6 * smooth(0.45, 0.95, lt);
  FILM.uHs.value = lerp(0.07, 0.09, smooth(0.3, 1.2, lt));
  FILM.uPool.value = 0.16 * smooth(0.5, 1.0, lt);
  FILM.uTime.value = t;
}

// cone + stream as one tube around a falling centreline
const SR = { radial: 48, cone: 72, body: 220, cap: 14 };
function buildStreamMesh() {
  const rings = SR.cone + SR.body + SR.cap, n = rings * (SR.radial + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aFlow', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const idx = [];
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < SR.radial; j++) {
    const a = i * (SR.radial + 1) + j, b = a + SR.radial + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, MAT.liquid); m.frustumCulled = false; m.receiveShadow = true;
  return m;
}
function updateStream(t, lt, surfY) {
  const rings = [];
  const ck = coneK(lt), Lc = EX.coneLen * Math.pow(ck, 0.85), Rb = lerp(0.25, 0.6, ck), rs = tipRadius(lt);
  const base = V3(0, FLOOR_Y + 0.03, 0), tip = tipPos(lt);
  // the cone: a hanging teat, flat where it meets the sheet, vertical where it turns into the stream
  for (let k = 0; k < SR.cone; k++) {
    const s = Math.pow(k / (SR.cone - 1), 2), r = rs + (Rb - rs) * Math.pow(1 - Math.sqrt(s), 2);
    // never perfectly round: slow lobes, stronger near the top
    const w = 0.03 + 0.07 * Math.sqrt(1 - s), wob = { a2: w * N3(t * 0.7, 1.1, 0.3), p2: 2.0 * N3(t * 0.4, 2.2, 0.9), a3: 0.6 * w * N3(t * 0.9, 3.3, 1.7), p3: 3.0 * N3(t * 0.5, 4.4, 2.1) };
    rings.push({ c: base.clone().lerp(tip, s), r, lab: t - 0.6 * (1 - s), tw: 0.8 * (1 - s), eq: Math.min(r, Math.max(s * (Lc + 0.03) - 0.03, 0) + 0.02), wob });
  }
  // the stream: each ring is the liquid that left the tip tau seconds ago
  const tauFront = lt - EX.stream, tauSurf = fallTime(tip.y - surfY + 0.3);
  const reached = tauFront >= tauSurf, tauEnd = tauFront > 0 ? Math.min(tauFront, tauSurf) : 0;
  if (tauFront <= 0) { // before the stream: a drop swelling at the tip
    const R0 = rs * (1 + 0.8 * smooth(EX.stream - 0.35, EX.stream, lt)) * smooth(EX.cone, EX.cone + 0.3, lt);
    for (let k = 0; k < SR.body; k++) {
      const u = k / (SR.body - 1);
      rings.push({ c: tip.clone().add(V3(0, -1.5 * R0 * u, 0)), r: rs + (R0 - rs) * Math.sin(Math.PI / 2 * u), lab: t, tw: 0, eq: R0 });
    }
  } else {
    for (let k = 0; k < SR.body; k++) {
      const tau = tauEnd * Math.pow(k / (SR.body - 1), 1.1), lab = t - tau, ltd = lt - tau;
      const tp = tipPos(ltd), d = fallDist(tau);
      // it keeps the tip's position and a small sideways velocity from when it left
      const vx = 0.13 * N3(ltd * 1.3, 7.1, 0.4), vz = 0.13 * N3(ltd * 1.3, 2.6, 5.3);
      const thin = Math.sqrt(EX.v0 / (EX.v0 + EX.g * tau)); // continuity: faster means thinner
      const bead = (0.025 * smooth(0, 0.1, tau) + 0.11 * smooth(0.2, 0.7, tau)) * Math.sin(lab * 2 * Math.PI * 24 + 1.7 * N3(lab * 3, 1, 1)); // Rayleigh-Plateau
      let r = tipRadius(ltd) * thin * (1 + bead);
      if (!reached) r *= 1 + 0.55 * smooth(tauEnd - 0.07, tauEnd, tau); // the first drop leads the stream
      // just below the tip the stream still oscillates between oval shapes, damped within a few tenths of a second
      const ov = 0.07 * Math.exp(-tau / 0.12);
      rings.push({ c: V3(tp.x + vx * tau, tp.y - d, tp.z + vz * tau), r, lab, tw: 0.9 * tau, eq: r, wob: { a2: ov, p2: lab * 14, a3: 0, p3: 0 } });
    }
  }
  // rounded end
  const last = rings[rings.length - 1], prev = rings[rings.length - 2];
  const axis = last.c.clone().sub(prev.c); if (axis.lengthSq() < 1e-10) axis.set(0, -1, 0); axis.normalize();
  for (let k = 1; k <= SR.cap; k++) {
    const ph = (k / SR.cap) * Math.PI / 2;
    rings.push({ c: last.c.clone().addScaledVector(axis, last.r * Math.sin(ph)), r: last.r * Math.cos(ph), lab: last.lab, tw: last.tw, eq: last.r, ph, axis });
  }
  // write the tube
  const g = OBJ.stream.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array, F = g.attributes.aFlow.array;
  const Tg = V3(), B1 = V3(), B2 = V3(), u = V3(), ut = V3(), nn = V3(), Z = V3(0, 0, 1);
  rings.forEach((ri, i) => {
    const a = rings[Math.max(i - 1, 0)], b = rings[Math.min(i + 1, rings.length - 1)];
    Tg.copy(b.c).sub(a.c); const len = Tg.length();
    if (len < 1e-6) Tg.copy(ri.axis || V3(0, -1, 0)); else Tg.divideScalar(len);
    const dr = ri.ph !== undefined ? 0 : clamp(len < 1e-6 ? 0 : (b.r - a.r) / len, -25, 25);
    B1.crossVectors(Tg, Z).normalize(); B2.crossVectors(Tg, B1);
    for (let j = 0; j <= SR.radial; j++) {
      const th = (j / SR.radial) * Math.PI * 2, o = (i * (SR.radial + 1) + j) * 3;
      u.copy(B1).multiplyScalar(Math.cos(th)).addScaledVector(B2, Math.sin(th));
      const wb = ri.wob, A = wb ? wb.a2 * Math.sin(2 * th + wb.p2) + wb.a3 * Math.sin(3 * th + wb.p3) : 0;
      const dA = wb ? 2 * wb.a2 * Math.cos(2 * th + wb.p2) + 3 * wb.a3 * Math.cos(3 * th + wb.p3) : 0, rr = ri.r * (1 + A);
      P[o] = ri.c.x + rr * u.x; P[o + 1] = ri.c.y + rr * u.y; P[o + 2] = ri.c.z + rr * u.z;
      if (ri.ph !== undefined) nn.copy(u).multiplyScalar(Math.cos(ri.ph)).addScaledVector(ri.axis, Math.sin(ri.ph));
      else { // n ~ u - (dr/dtheta / r) u_theta - dr/ds T
        ut.copy(B2).multiplyScalar(Math.cos(th)).addScaledVector(B1, -Math.sin(th));
        nn.copy(u).addScaledVector(ut, -dA / (1 + A)).addScaledVector(Tg, -dr * (1 + A)).normalize();
      }
      Nn[o] = nn.x; Nn[o + 1] = nn.y; Nn[o + 2] = nn.z;
      F[o] = ri.lab; F[o + 1] = j / SR.radial + ri.tw / (2 * Math.PI); F[o + 2] = ri.eq;
    }
  });
  g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.aFlow.needsUpdate = true;
  // where the stream meets the coffee in the cup
  for (let i = SR.cone; i < rings.length - 1; i++) if (rings[i].c.y >= surfY && rings[i + 1].c.y < surfY) {
    const k = (rings[i].c.y - surfY) / (rings[i].c.y - rings[i + 1].c.y);
    return rings[i].c.clone().lerp(rings[i + 1].c, k);
  }
  return null;
}

const EXTRACT_KEYS = [
  [0.0, [-3.6, -7.6, 4.6], [0.15, -2.75, 0.1]],
  [0.95, [-3.1, -7.2, 5.5], [0.1, -3.0, 0.0]],
  [1.55, [-2.4, -6.6, 9.0], [0.0, -5.0, 0.0]],
  [2.2, [-1.4, -6.4, 12.4], [0.0, -7.7, 0.0]],
  [T.cup - T.extract, [-0.7, -3.4, 7.4], [0.0, -11.4, 0.0]]
];
function shotExtract(t) {
  const lt = t - T.extract;
  portafilter.position.set(0, 0, 0); portafilter.rotation.set(0, 0.35, 0);
  cup.group.position.copy(CUP_IN_MACHINE); cup.group.rotation.set(0, 0.9, 0); cup.decalU.uReveal.value = 0;
  updateFilm(t, lt);
  const L0 = cupLevel(lt), surfY = CUP_IN_MACHINE.y + L0, rIn = interp(CUP_INNER, L0) - 0.02;
  OBJ.stream.visible = lt > EX.cone - 0.05;
  const hit = OBJ.stream.visible ? updateStream(t, lt, surfY) : null;
  LIQ.uTime.value = t; LIQ.uFoam.value = lerp(-0.1, 0.25, smooth(EX.cone, 2.4, lt)); // more crema streaks as the shot runs
  MAT.liquid.attenuationDistance = lerp(0.045, 0.06, smooth(EX.stream, 2.6, lt)); // first coffee is darker, then it turns golden
  // crema
  cup.crema.visible = lt > HIT;
  cup.crema.position.y = L0; cup.crema.rotation.y = 0; cup.crema.scale.set(rIn, 1, rIn);
  cup.crema.updateMatrixWorld(true);
  if (hit) { const lp = cup.crema.worldToLocal(hit.clone()); CREMA.uImp.value.set(lp.x * rIn, lp.z * rIn); }
  CREMA.uImpK.value = smooth(HIT, HIT + 0.15, lt); CREMA.uR.value = rIn; CREMA.uTime.value = t; CREMA.uDrift.value = 0.55; CREMA.uTwist.value = 0.8;
  // lights: a softbox below the portafilter, a strip behind on the right, a warm backlight on the steel behind the stream
  L.key.position.set(-9, -3, 10); L.key.target.position.set(0, -7, 0); L.key.intensity = 300; L.key.angle = 0.5;
  L.soft.position.set(-3, -10.5, 7); L.soft.lookAt(0, -2.6, 0); L.soft.intensity = 2.2;
  L.strip.position.set(5.5, -6, -3.5); L.strip.lookAt(0, -6, 0); L.strip.intensity = 6;
  L.rim.position.set(4, -1.5, -3); L.rim.intensity = 120;
  L.fill.position.set(6, -9, 10); L.fill.intensity = 40;
  L.back.position.set(0.6, -6.5, -8.5); L.back.intensity = 70; // hot spot on the steel behind the stream
  const camPos = V3(...hermite(EXTRACT_KEYS, lt, k => k[1])), camTgt = V3(...hermite(EXTRACT_KEYS, lt, k => k[2]));
  setEnv(envFacing(0.13, camPos.toArray(), camTgt.toArray()), bgFacing(0.13, camPos.toArray(), camTgt.toArray()), 0.15, 0.3);
  renderer.toneMappingExposure = 1.0;
  // focus: the basket floor, then the cone tip, the falling stream and finally the coffee in the cup
  const f1 = V3(0.1, FLOOR_Y - 0.05, 0), f2 = tipPos(lt), f3 = V3(0, -7.5, 0), f4 = hit || V3(0, surfY, 0);
  const fp = f1.clone().lerp(f2, smooth(0.85, 1.4, lt)).lerp(f3, smooth(1.4, 2.0, lt)).lerp(f4, smooth(2.1, 2.6, lt));
  DOF_STATE.focus = camPos.distanceTo(fp); DOF_STATE.aperture = lerp(26, 20, smooth(1.0, 2.0, lt));
  const fov = lerp(30, 31, smooth(1.2, 2.2, lt));
  return handheld(lookCam(camPos, camTgt, 0.03 * Math.sin(lt * 1.3), fov), t, 0.03);
}

/* ================================================================ shot: crema, crane, logo */
const CUP_ON_TABLE = V3(0, 1.21, 0);
const CREMA_Y = 1.21 + FILL;
function shotCup(t) {
  const lt = t - T.cup;
  cup.group.position.copy(CUP_ON_TABLE); cup.group.rotation.set(0, 0, 0);
  // settled crema, turning slowly
  const rIn = interp(CUP_INNER, FILL) - 0.02;
  cup.crema.visible = true; cup.crema.position.y = FILL; cup.crema.rotation.y = -0.12 * lt; cup.crema.scale.set(rIn, 1, rIn);
  CREMA.uImp.value.set(0.25, -0.15); CREMA.uImpK.value = 0; CREMA.uR.value = rIn; CREMA.uTime.value = t; CREMA.uDrift.value = 0.04; CREMA.uTwist.value = 0.3;

  const rv = smooth(T.reveal[0], T.reveal[1], t);
  cup.decalU.uReveal.value = rv; cup.decalU.uTime.value = t;
  const pa = sparks.geometry.attributes;
  sparks.userData.seed.forEach((s, i) => {
    const arrive = T.reveal[0] - 0.05 + s.rho * (T.reveal[1] - T.reveal[0]) * 0.85, start = arrive - s.dur, u = clamp((t - start) / s.dur);
    const yT = LOGO_Y + s.v * LOGO_D, rT = interp(CUP_OUTER, yT) + 0.05, aT = (s.u * LOGO_D) / rT;
    const target = V3(rT * Math.sin(aT), yT, rT * Math.cos(aT)).add(CUP_ON_TABLE);
    const e = 1 - Math.pow(1 - u, 2.4), ang = s.phi + (1 - e) * 2.4;
    const p = V3(Math.cos(ang) * s.r0, s.y0, Math.sin(ang) * s.r0 + 2.5).lerp(target, e);
    pa.position.setXYZ(i, p.x, p.y, p.z);
    const life = t < start ? 0 : (t < arrive ? smooth(0, 0.15, u) : Math.exp(-(t - arrive) * 2.2) * (0.6 + 0.4 * Math.sin((t - arrive) * 9 + s.tw)));
    pa.aSize.setX(i, s.size * (0.7 + 0.3 * Math.sin(t * 25 + s.tw)) * 0.5); pa.aAlpha.setX(i, life * 0.85); pa.aColor.setXYZ(i, 2.4, 1.5, 0.55);
  });
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;
  steam.forEach(sp => {
    const d = sp.userData, life = 3.2 / d.sp, age = ((t / life + d.ph) % 1);
    sp.position.set(d.x + N3(d.seed, t * 0.3, 0) * 0.8 * age, CREMA_Y + 0.3 + age * 9.5, d.z + N3(d.seed + 5, t * 0.3, 1) * 0.6 * age);
    const sc = d.size * (0.5 + age * 1.4); sp.scale.set(sc, sc, 1);
    sp.material.rotation = d.rot * t + d.seed;
    sp.material.opacity = 0.03 * Math.sin(Math.PI * age) * lerp(0.15, 1, smooth(T.crane[0], T.crane[1], t));
  });

  const k1 = smoother(T.crane[0], T.crane[1], t);
  const hold = smooth(T.crane[1], DUR, t);
  const tgt = V3(0, lerp(CREMA_Y, 2.4, k1), 0);
  const d = Math.exp(lerp(Math.log(lerp(17, 15, smooth(T.cup, T.crane[0], t))), Math.log(42), k1)) - 2.6 * hold;
  const el = lerp(Math.PI / 2 - 0.004, 0.19, k1) - 0.03 * hold;
  const az = lerp(0.9 - 0.45 * smooth(T.cup, T.crane[0], t), 0.0, k1) - 0.06 * hold;
  const cam = orbitCam(tgt, d, el, az, lt < 0.6 ? 0.15 * lt : 0.09 * (1 - k1), lerp(36, 26, k1));
  const gs = smooth(9.7, 10.7, t);
  L.glint.position.set(lerp(-12, 12, gs), 6.5, 9); L.glint.intensity = 450 * Math.sin(Math.PI * gs);
  L.key.position.set(lerp(-5, -16, k1), lerp(40, 26, k1), lerp(6, 20, k1)); L.key.target.position.set(0, lerp(5, 2, k1), 0); L.key.intensity = lerp(1000, 2100, k1); L.key.angle = 0.42;
  L.rim.position.set(9, 13, -14); L.rim.intensity = 700;
  L.fill.position.set(17, 6, 18); L.fill.intensity = 110;
  L.back.position.set(-7, 9, -12); L.back.intensity = 300;
  setEnv(envFacing(0.575, [0, 9, 42], [0, 2.4, 0]), bgFacing(0.575, [0, 9, 42], [0, 2.4, 0]), lerp(0.0, 0.34, k1), 0.65);
  renderer.toneMappingExposure = lerp(0.8, 1.0, k1);
  DOF_STATE.focus = cam.pos.distanceTo(k1 < 0.5 ? V3(0, CREMA_Y, 0) : V3(0, 1.21 + LOGO_Y, 3.25)); DOF_STATE.aperture = lerp(14, 32, k1);
  return handheld(cam, t, 0.03 * k1);
}

/* ================================================================ per sub-frame */
function shotOf(t) { return t < T.burrs ? 'beans' : t < T.dose ? 'burrs' : t < T.extract ? 'dose' : t < T.cup ? 'extract' : 'cup'; }
const SHOT_RANGE = { beans: [0, T.burrs], burrs: [T.burrs, T.dose], dose: [T.dose, T.extract], extract: [T.extract, T.cup], cup: [T.cup, DUR] };
function update(t) {
  const shot = shotOf(t);
  SET.beans.visible = shot === 'beans';
  SET.burrs.visible = shot === 'burrs';
  SET.dose.visible = shot === 'dose';
  SET.machine.visible = shot === 'extract';
  SET.table.visible = shot === 'cup';
  portafilter.visible = shot === 'dose' || shot === 'extract';
  OBJ.film.visible = shot === 'extract';
  cup.group.visible = shot === 'extract' || shot === 'cup';
  L.glint.intensity = 0; L.soft.intensity = 0; L.strip.intensity = 0;
  const cam = { beans: shotBeans, burrs: shotBurrs, dose: shotDose, extract: shotExtract, cup: shotCup }[shot](t);
  camera.position.copy(cam.pos); camera.quaternion.copy(cam.quat);
  camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  bloom.strength = 0.28 + 0.22 * Math.exp(-Math.pow((t - T.tamp) / 0.06, 2)) + 0.2 * smooth(T.reveal[0], T.reveal[0] + 0.3, t) * (1 - smooth(T.reveal[1], T.reveal[1] + 0.6, t));
}
function renderSub() {
  renderer.setRenderTarget(sceneRT); renderer.clear(); renderer.render(scene, camera);
  let src = sceneRT;
  if (gtao) {
    // sprites would pollute the normal buffer; the liquids are shaped on the GPU, the AO pass would see them undisplaced
    const hide = [...steam, OBJ.film, OBJ.stream], vis = hide.map(o => o.visible); hide.forEach(o => (o.visible = false));
    gtao.render(renderer, aoRT, sceneRT); src = aoRT;
    hide.forEach((o, i) => (o.visible = vis[i]));
  }
  const u = dofQuad.material.uniforms;
  u.tColor.value = src.texture; u.uFocus.value = DOF_STATE.focus; u.uAperture.value = DOF ? DOF_STATE.aperture * SCALE : 0;
  u.uNear.value = camera.near; u.uFar.value = camera.far;
  renderer.setRenderTarget(dofRT); dofQuad.render(renderer);
  bloom.render(renderer, null, dofRT, 0, false);
}
function renderFrame(i) {
  const t0 = i / FPS, [a, b] = SHOT_RANGE[shotOf(t0)];
  renderer.setRenderTarget(accumRT); renderer.setClearColor(0x000000, 0); renderer.clear();
  for (let k = 0; k < MB; k++) {
    const off = MB === 1 ? 0 : ((k + 0.5) / MB - 0.5) * SHUTTER / FPS;
    const t = clamp(t0 + off, a, b - 1e-4);
    update(t);
    if (MB > 1) { const h = (i * MB + k) % 64 + 1; camera.setViewOffset(W, H, halton(h, 2) - 0.5, halton(h, 3) - 0.5, W, H); }
    dofQuad.material.uniforms.uSeed.value = (i * 13 + k * 7) % 997;
    renderSub();
    accumQuad.material.uniforms.tSrc.value = dofRT.texture; accumQuad.material.uniforms.uW.value = 1 / MB;
    renderer.setRenderTarget(accumRT); renderer.autoClear = false; accumQuad.render(renderer); renderer.autoClear = true;
  }
  lensQuad.material.uniforms.tSrc.value = accumRT.texture;
  renderer.setRenderTarget(lensRT); lensQuad.render(renderer);
  outputPass.renderToScreen = true;
  outputPass.render(renderer, null, lensRT);
  // overlay at the frame's centre time
  tagline.material.opacity = smooth(T.tag, T.tag + 0.45, t0);
  tagline.position.set(0, -H / 2 + H * 0.255 + 16 * SCALE * (1 - smooth(T.tag, T.tag + 0.6, t0)), 0);
  shade.material.opacity = smooth(T.tag - 0.5, T.tag + 0.3, t0);
  fadeQuad.material.opacity = Math.max(1 - smooth(0, 0.25, t0), smoother(DUR - 1.2, DUR, t0));
  renderer.setRenderTarget(null); renderer.autoClear = false; renderer.render(overlay, overlayCam); renderer.autoClear = true;
}
function readPixels() {
  const gl = renderer.getContext(), buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}
window.RENDER = {
  W, H, FPS, FRAMES, DUR,
  ready: build().then(() => { renderFrame(0); return true; }),
  async frame(i) { renderFrame(i); },
  async post(i, url) { renderFrame(i); const r = await fetch(url, { method: 'POST', body: readPixels() }); return r.status; }
};
