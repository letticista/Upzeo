// Sardinian Coffee Corner — deterministic 3D logo reveal.
// Every frame is a pure function of time, so frames can be rendered in any order.
import * as THREE from 'three';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const params = new URLSearchParams(location.search);
const SCALE = parseFloat(params.get('scale') || '1');
const W = Math.round(1080 * SCALE), H = Math.round(1920 * SCALE);
const FPS = 60, DUR = 6, FRAMES = FPS * DUR;
const IMPACT = 3.85;

/* ---------------------------------------------------------------- utils */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D simplex noise (Gustavson), seeded.
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
const N3 = makeSimplex3(7);

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

/* ---------------------------------------------------------------- camera path */
// [time, position, look-at]; time-keyed cubic Hermite gives the speed ramp.
const CAM_KEYS = [
  [0.00, [4.6, 5.6, -8.2], [0.2, 2.2, -0.6]],
  [0.85, [1.5, 3.55, -2.4], [-1.8, 2.0, 0.4]],
  [1.55, [-4.35, 1.4, -0.5], [-0.6, 0.6, 0.6]],
  [2.25, [-2.95, -1.35, 2.75], [0.6, -0.5, 0.0]],
  [2.85, [1.4, -3.75, 3.3], [0.0, 0.4, 0.0]],
  [3.40, [3.1, -1.0, 6.6], [0.0, 0.0, 0.0]],
  [IMPACT, [0.9, -0.1, 13.2], [0.0, 0.05, 0.0]],
  [5.40, [0.0, 0.05, 18.4], [0.0, 0.05, 0.0]]
];
const ROLL_KEYS = [[0, 0.18], [0.85, -0.3], [1.55, 0.42], [2.25, -0.22], [2.85, 0.28], [3.4, 0.05], [IMPACT, 0], [6, 0]];

function hermite(keys, t, get) {
  const n = keys.length;
  if (t >= keys[n - 1][0]) return get(keys[n - 1]).slice();
  if (t <= keys[0][0]) return get(keys[0]).slice();
  let i = 0; while (t > keys[i + 1][0]) i++;
  const t0 = keys[i][0], t1 = keys[i + 1][0], h = t1 - t0, s = (t - t0) / h;
  const tan = k => {
    if (k === n - 1) return get(keys[k]).map(() => 0);
    const a = keys[Math.max(0, k - 1)], b = keys[k + 1];
    return get(b).map((v, d) => (v - get(a)[d]) / (b[0] - a[0]));
  };
  const m0 = tan(i), m1 = tan(i + 1), p0 = get(keys[i]), p1 = get(keys[i + 1]);
  const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s;
  return p0.map((v, d) => h00 * v + h10 * h * m0[d] + h01 * p1[d] + h11 * h * m1[d]);
}

function camState(t) {
  const pos = new THREE.Vector3(...hermite(CAM_KEYS, t, k => k[1]));
  const tgt = new THREE.Vector3(...hermite(CAM_KEYS, t, k => k[2]));
  pos.z -= 0.12 * Math.max(0, t - IMPACT); // slow epic push-in on the hold
  const roll = hermite(ROLL_KEYS, t, k => [k[1]])[0];
  // whip pans: the view drifts off target, then snaps back
  const whip = (tk, a) => a * smooth(tk - 0.5, tk - 0.06, t) * (1 - smooth(tk - 0.06, tk + 0.12, t));
  const yaw = whip(1.5, -0.62) + whip(2.8, 0.55);
  const pitch = whip(2.8, -0.22);
  // FPV jitter + impact shake
  const shakeAmp = 0.014 * (1 - smooth(3.6, 4.0, t)) + 0.11 * Math.exp(-Math.max(0, t - IMPACT) * 5.5) * (t >= IMPACT ? 1 : 0);
  const sh = k => N3(t * 17 + k * 13.1, k * 7.7, 0.5);
  pos.x += sh(1) * shakeAmp; pos.y += sh(2) * shakeAmp; pos.z += sh(3) * shakeAmp * 0.5;
  const fov = lerp(66, 38, smooth(3.3, 4.75, t));
  return { pos, tgt, roll: roll + sh(4) * shakeAmp * 0.35, yaw: yaw + sh(5) * shakeAmp * 0.3, pitch: pitch + sh(6) * shakeAmp * 0.3, fov };
}

/* ---------------------------------------------------------------- renderer */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030100, 0.03);
const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 200);

/* ---------------------------------------------------------------- environment */
function buildEnvironment() {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0.008, 0.005, 0.003);
  const basic = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
  // warm "sky" behind the camera with a hot horizon line: classic chrome lettering reflection
  const sky = new THREE.PlaneGeometry(140, 70, 1, 70);
  const col = [];
  const pos = sky.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + 35; // 0..70 above the horizon
    const hot = Math.exp(-Math.pow((y - 1.2) / 0.8, 2)) * 2.0;
    const k = 0.18 + 0.75 * Math.exp(-y / 14) + hot;
    col.push(1.0 * k, 0.64 * k, 0.34 * k);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const skyMesh = new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  skyMesh.position.set(0, 35 - 0.9, 40); env.add(skyMesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 40), basic(0.03, 0.014, 0.007));
  floor.position.set(0, -21, 40); env.add(floor);
  const bounce = new THREE.Mesh(new THREE.PlaneGeometry(140, 3), basic(0.55, 0.22, 0.07));
  bounce.position.set(0, -7, 39.5); env.add(bounce);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), basic(4.2, 3.2, 2.2));
  top.rotation.x = Math.PI / 2; top.position.set(0, 32, 4); env.add(top);
  for (const [x, c] of [[-36, [3.2, 1.35, 0.4]], [36, [2.4, 1.4, 0.55]]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(3, 46), basic(...c));
    s.rotation.y = Math.PI / 2; s.position.set(x, 4, 6); env.add(s);
  }
  for (const [y, k] of [[6, 1.6], [-3, 0.9]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(60, 1.6), basic(1.6 * k, 0.85 * k, 0.3 * k));
    s.position.set(0, y, -38); env.add(s);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02, 0.1, 200);
  pm.dispose();
  return rt.texture;
}
scene.environment = buildEnvironment();

/* ---------------------------------------------------------------- background abyss */
const bgMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uReveal: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: GLSL_NOISE + `
    uniform float uTime; uniform float uReveal; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float glow = pow(max(dot(d, normalize(vec3(0.0, 0.08, -1.0))), 0.0), 24.0);
      float halo = pow(max(dot(d, normalize(vec3(0.0, 0.1, -1.0))), 0.0), 40.0);
      float smoke = snoise(d*3.0 + vec3(0.0, uTime*0.06, 0.0))*0.5 + snoise(d*7.0 - vec3(uTime*0.04))*0.25;
      vec3 base = vec3(0.004, 0.002, 0.0012);
      vec3 warm = vec3(0.075, 0.028, 0.008) * (0.45 + 0.55*uReveal);
      vec3 c = base + warm*glow*(0.85 + 0.35*smoke) + vec3(0.6,0.3,0.1)*halo*0.35*uReveal;
      c += vec3(0.022,0.009,0.003)*max(smoke,0.0)*(0.3+glow);
      gl_FragColor = vec4(c, 1.0);
    }`
});
const bg = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 32), bgMat);
bg.frustumCulled = false;
scene.add(bg);

/* ---------------------------------------------------------------- lights */
scene.add(new THREE.HemisphereLight(0x5a3418, 0x060201, 0.35));
const key = new THREE.SpotLight(0xffb470, 300, 0, 0.55, 0.85, 2);
key.position.set(-6.5, 9.5, 10); key.target.position.set(0, 0, 0); scene.add(key, key.target);
const rimA = new THREE.PointLight(0xff8a2a, 70, 0, 2); rimA.position.set(2.9, 2.75, -2.2); scene.add(rimA);
const rimB = new THREE.PointLight(0xffb060, 60, 0, 2); rimB.position.set(-5.2, -3.8, -4.2); scene.add(rimB);
const under = new THREE.PointLight(0xff6a1a, 55, 0, 2); under.position.set(0, -6.2, 3.5); scene.add(under);
const sweep = new THREE.PointLight(0xfff0d6, 0, 0, 2); scene.add(sweep);
const fill = new THREE.PointLight(0xffc890, 25, 0, 2); fill.position.set(6, 1, 8); scene.add(fill);

function sweepState(t) {
  const s = smooth(IMPACT + 0.02, IMPACT + 1.25, t);
  return { x: lerp(-7.5, 7.5, s), y: 0.25, z: 2.6, k: Math.sin(Math.PI * s) };
}

/* ---------------------------------------------------------------- materials */
const MAT = {
  chrome: new THREE.MeshPhysicalMaterial({ color: 0xf6f0e8, metalness: 1, roughness: 0.055, envMapIntensity: 1.35 }),
  copper: new THREE.MeshPhysicalMaterial({ color: 0xdb8d58, metalness: 1, roughness: 0.18, envMapIntensity: 1.3 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0x1e120c, metalness: 0, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 })
};

/* ---------------------------------------------------------------- 3D type */
const logo = new THREE.Group();
scene.add(logo);
const LINES = [];

function shiftPath(path, dx) {
  for (const c of path.curves) for (const k of ['v0', 'v1', 'v2', 'v3']) if (c[k]) c[k].x += dx;
}
function lineShapes(font, text, size, tracking) {
  const data = font.data, scale = size / data.resolution;
  const shapes = [];
  let x = 0;
  for (const ch of text) {
    const glyph = data.glyphs[ch];
    const s = font.generateShapes(ch, size);
    for (const sh of s) { shiftPath(sh, x); sh.holes.forEach(hh => shiftPath(hh, x)); shapes.push(sh); }
    x += glyph.ha * scale + tracking * size;
  }
  return shapes;
}
function buildLine(font, text, width, faceMat, sideMat) {
  // measure at size 1, then rebuild at the size that fills the target width
  const probe = new THREE.ShapeGeometry(lineShapes(font, text, 1, 0.09));
  probe.computeBoundingBox();
  const size = width / (probe.boundingBox.max.x - probe.boundingBox.min.x);
  probe.dispose();
  const geo = new THREE.ExtrudeGeometry(lineShapes(font, text, size, 0.09), {
    depth: 0.46, curveSegments: 14, bevelEnabled: true, bevelThickness: 0.075, bevelSize: 0.04, bevelSegments: 7
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();
  // sliver triangles from the glyph triangulation get unstable normals: caps are planar, so set them exactly
  const nrm = geo.attributes.normal, ps = geo.attributes.position;
  const caps = geo.groups.filter(g => g.materialIndex === 0);
  for (const g of caps) for (let i = g.start; i < g.start + g.count; i++) nrm.setXYZ(i, 0, 0, ps.getZ(i) >= 0 ? 1 : -1);
  for (let i = 0; i < nrm.count; i++) {
    const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    if (!(l > 0.5)) nrm.setXYZ(i, 0, 0, ps.getZ(i) >= 0 ? 1 : -1);
  }
  const mesh = new THREE.Mesh(geo, [faceMat, sideMat]);
  return { mesh, height: bb.max.y - bb.min.y };
}

/* ---------------------------------------------------------------- coffee beans */
function beanGeometry() {
  let g = new THREE.SphereGeometry(1, 40, 28);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 0.7, y = p.getY(i), z = p.getZ(i) * 0.52;
    if (z > 0) z *= 0.62; // flat face
    const cx = 0.07 * Math.sin(y * 2.4);
    const ends = 1 - Math.pow(Math.abs(y), 5);
    const groove = Math.exp(-Math.pow((x - cx) / 0.05, 2)) * ends;
    if (z > -0.05) z -= groove * 0.2 * smooth(-0.05, 0.25, z);
    const lump = 1 + 0.03 * N3(x * 4, y * 4, z * 4);
    p.setXYZ(i, x * lump, y * lump, z * lump);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- bean physics */
function simulateBeans(N, textBoxes, seed = 11) {
  const R = mulberry32(seed);
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), rad = new Float32Array(N), scl = new Float32Array(N);
  const q = [], w = [];
  const ballistic = new Float32Array(N); // seconds of free flight for scripted collision pairs
  const inText = (x, y, z, m) => textBoxes.some(b => Math.abs(x - b.x) < b.hx + m && Math.abs(y - b.y) < b.hy + m && Math.abs(z) < 1.3 + m);
  for (let i = 0; i < N; i++) {
    const s = 0.15 + R() * 0.11;
    scl[i] = s; rad[i] = s * 0.78;
    let x, y, z, tries = 0;
    do {
      x = (R() * 2 - 1) * 7.5; y = (R() * 2 - 1) * 9.5; z = -8.5 + R() * 13.5;
      tries++;
    } while ((inText(x, y, z, 0.35) || Math.hypot(x, y, z) > 11.5) && tries < 200);
    pos.set([x, y, z], i * 3);
    const a = R() * Math.PI * 2, b = Math.acos(R() * 2 - 1), sp = 0.12 + R() * 0.3;
    vel.set([Math.sin(b) * Math.cos(a) * sp, Math.sin(b) * Math.sin(a) * sp, Math.cos(b) * sp], i * 3);
    q.push(new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6.3, R() * 6.3, R() * 6.3)));
    w.push(new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1).normalize().multiplyScalar(0.5 + R() * 1.5));
  }
  // scripted pairs that meet in front of the lens in slow motion
  const PAIRS = 26;
  for (let k = 0; k < PAIRS; k++) {
    const i = k * 2, j = k * 2 + 1;
    const tc = 0.45 + (k / PAIRS) * 3.0 + R() * 0.12;
    const cs = camState(Math.min(tc + 0.18, 5.9));
    const fwd = new THREE.Vector3().subVectors(cs.tgt, cs.pos).normalize();
    const side = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, fwd);
    const c = cs.pos.clone().addScaledVector(fwd, 1.7 + R() * 1.6).addScaledVector(side, (R() - 0.5) * 1.6).addScaledVector(up, (R() - 0.5) * 1.4);
    if (inText(c.x, c.y, c.z, 0.4)) continue;
    const dir = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
    const sp = 0.55 + R() * 0.35;
    for (const [idx, sg] of [[i, -1], [j, 1]]) {
      const off = rad[i] + rad[j];
      const p0 = c.clone().addScaledVector(dir, sg * (sp * tc + off * 0.5));
      pos.set([p0.x, p0.y, p0.z], idx * 3);
      vel.set([-dir.x * sg * sp, -dir.y * sg * sp, -dir.z * sg * sp], idx * 3);
      ballistic[idx] = tc + 0.05;
    }
  }
  const outP = new Float32Array((FRAMES + 1) * N * 3), outQ = new Float32Array((FRAMES + 1) * N * 4);
  const SUB = 2, dt = 1 / (FPS * SUB);
  const camFinal = new THREE.Vector3(0, 0.05, 18.1);
  const dq = new THREE.Quaternion(), tmp = new THREE.Vector3();
  const record = f => {
    outP.set(pos, f * N * 3);
    for (let i = 0; i < N; i++) outQ.set([q[i].x, q[i].y, q[i].z, q[i].w], (f * N + i) * 4);
  };
  record(0);
  for (let f = 1; f <= FRAMES; f++) {
    for (let s = 0; s < SUB; s++) {
      const t = (f - 1) / FPS + (s + 1) * dt;
      const cam = camState(t).pos;
      const clearK = smooth(3.0, 3.9, t);
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        let x = pos[o], y = pos[o + 1], z = pos[o + 2];
        let ax = 0, ay = 0, az = 0;
        if (t > ballistic[i]) {
          // zero-g drift through a simplex flow field
          ax += N3(x * 0.22, y * 0.22 + t * 0.12, z * 0.22) * 0.16;
          ay += N3(x * 0.22 + 31, y * 0.22, z * 0.22 + t * 0.12) * 0.16;
          az += N3(x * 0.22, y * 0.22 + 57, z * 0.22 - t * 0.1) * 0.16;
          const r = Math.hypot(x, y, z);
          if (r > 11) { ax -= x / r * (r - 11) * 0.6; ay -= y / r * (r - 11) * 0.6; az -= z / r * (r - 11) * 0.6; }
        }
        // keep clear of the letters (thicker box while the lines are still turning)
        const zHalf = lerp(1.25, 0.55, smooth(3.5, 4.0, t));
        for (const b of textBoxes) {
          const dx = x - b.x, dy = y - b.y;
          const px = b.hx + 0.25 - Math.abs(dx), py = b.hy + 0.2 - Math.abs(dy), pz = zHalf + 0.2 - Math.abs(z);
          if (px > 0 && py > 0 && pz > 0) {
            const m = Math.min(px, py, pz);
            const k = 30 * m;
            if (m === pz) az += Math.sign(z || 1) * k; else if (m === py) ay += Math.sign(dy || 1) * k; else ax += Math.sign(dx || 1) * k;
          }
        }
        // clear the sight-line of the final shot so the logo reads
        if (clearK > 0 && z > -0.9 && z < 17) {
          const f2 = camFinal.z / (camFinal.z - z);
          const sx = x * f2, sy = (y - 0.05) * f2 + 0.05;
          const ex = 3.55 - Math.abs(sx), ey = 3.0 - Math.abs(sy);
          if (ex > 0 && ey > 0) {
            const k = clearK * 2.2 * (1 + Math.min(ex, ey));
            if (ex / 3.55 < ey / 3.0) ax += Math.sign(sx || 1) * k; else ay += Math.sign(sy || 1) * k;
          }
        }
        // beans scatter away from the camera as it flies through
        tmp.set(x - cam.x, y - cam.y, z - cam.z);
        const dc = tmp.length();
        if (dc < 1.5 && t < 4.5) { const k = (1.5 - dc) * 45 / Math.max(dc, 0.05); ax += tmp.x * k; ay += tmp.y * k; az += tmp.z * k; }
        vel[o] = (vel[o] + ax * dt) * (1 - 0.35 * dt);
        vel[o + 1] = (vel[o + 1] + ay * dt) * (1 - 0.35 * dt);
        vel[o + 2] = (vel[o + 2] + az * dt) * (1 - 0.35 * dt);
        const sp = Math.hypot(vel[o], vel[o + 1], vel[o + 2]);
        if (sp > 1.6) { vel[o] *= 1.6 / sp; vel[o + 1] *= 1.6 / sp; vel[o + 2] *= 1.6 / sp; }
      }
      // collisions (elastic-ish with spin transfer)
      for (let i = 0; i < N; i++) {
        const oi = i * 3;
        for (let j = i + 1; j < N; j++) {
          const oj = j * 3;
          const dx = pos[oj] - pos[oi], dy = pos[oj + 1] - pos[oi + 1], dz = pos[oj + 2] - pos[oi + 2];
          const rr = rad[i] + rad[j];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, ov = (rr - d) * 0.5;
          pos[oi] -= nx * ov; pos[oi + 1] -= ny * ov; pos[oi + 2] -= nz * ov;
          pos[oj] += nx * ov; pos[oj + 1] += ny * ov; pos[oj + 2] += nz * ov;
          const rvx = vel[oj] - vel[oi], rvy = vel[oj + 1] - vel[oi + 1], rvz = vel[oj + 2] - vel[oi + 2];
          const vn = rvx * nx + rvy * ny + rvz * nz;
          if (vn < 0) {
            const imp = -(1 + 0.55) * vn * 0.5;
            vel[oi] -= nx * imp; vel[oi + 1] -= ny * imp; vel[oi + 2] -= nz * imp;
            vel[oj] += nx * imp; vel[oj + 1] += ny * imp; vel[oj + 2] += nz * imp;
            const spin = new THREE.Vector3(ny * rvz - nz * rvy, nz * rvx - nx * rvz, nx * rvy - ny * rvx).multiplyScalar(3.2);
            w[i].sub(spin); w[j].add(spin);
            ballistic[i] = ballistic[j] = 0;
          }
        }
      }
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
        // hard keep-out so no bean ever crosses the lens
        tmp.set(pos[o] - cam.x, pos[o + 1] - cam.y, pos[o + 2] - cam.z);
        const dcam = tmp.length(), keep = 0.62;
        if (dcam < keep) { tmp.multiplyScalar(keep / Math.max(dcam, 1e-3)); pos[o] = cam.x + tmp.x; pos[o + 1] = cam.y + tmp.y; pos[o + 2] = cam.z + tmp.z; }
        w[i].multiplyScalar(1 - 0.12 * dt);
        const ang = w[i].length() * dt;
        if (ang > 0) { dq.setFromAxisAngle(tmp.copy(w[i]).normalize(), ang); q[i].premultiply(dq).normalize(); }
      }
    }
    record(f);
  }
  return { outP, outQ, scl };
}

/* ---------------------------------------------------------------- liquid ribbons */
function makeRibbon(opts) {
  const U = 300, V = 28;
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array((U + 1) * (V + 1) * 3), Cc = new Float32Array((U + 1) * (V + 1) * 3);
  const idx = [];
  for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
    const a = u * (V + 1) + v, b = a + V + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const cA = new THREE.Color(opts.colA), cB = new THREE.Color(opts.colB), cH = new THREE.Color(opts.colH);
  for (let u = 0; u <= U; u++) for (let v = 0; v <= V; v++) {
    const phi = v / V * Math.PI * 2;
    const edge = Math.pow(Math.abs(Math.cos(phi)), 3);
    const streak = 0.5 + 0.5 * N3(u * 0.06, v * 0.3, opts.seed);
    const c = cA.clone().lerp(cB, clamp(edge * 0.9 + streak * 0.25)).lerp(cH, clamp((streak - 0.75) * 2.5) * edge);
    Cc.set([c.r, c.g, c.b], (u * (V + 1) + v) * 3);
  }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
  const mesh = new THREE.Mesh(geo, opts.material);
  mesh.frustumCulled = false;
  const tilt = new THREE.Matrix4().makeRotationX(opts.tilt).premultiply(new THREE.Matrix4().makeRotationZ(opts.roll));
  const ringN = new THREE.Vector3(0, 1, 0).applyMatrix4(tilt).normalize();
  const center = (u, t) => {
    const calm = 1 - 0.55 * smooth(3.6, 5.0, t);
    const a = opts.a0 + u * Math.PI * 2 * opts.turns + t * opts.speed;
    const r = opts.radius + 0.45 * calm * N3(u * 2.5, t * 0.35, opts.seed);
    const h = (0.32 * Math.sin(u * 9 + t * 1.6) + 0.25 * N3(u * 3, t * 0.4, opts.seed + 5)) * calm;
    return new THREE.Vector3(r * Math.cos(a), h, r * Math.sin(a)).applyMatrix4(tilt);
  };
  function update(t) {
    const calm = 1 - 0.5 * smooth(3.6, 5.0, t);
    let k = 0;
    for (let u = 0; u <= U; u++) {
      const uu = u / U;
      const c = center(uu, t), c2 = center(Math.min(1, uu + 1e-3), t), c1 = center(Math.max(0, uu - 1e-3), t);
      const T = c2.sub(c1).normalize();
      const B = new THREE.Vector3().crossVectors(T, ringN).normalize();
      const Nn = new THREE.Vector3().crossVectors(B, T).normalize();
      const tw = opts.twist * Math.sin(uu * 5.0 + t * 0.9) * calm + 0.6;
      const e1 = Nn.clone().multiplyScalar(Math.cos(tw)).addScaledVector(B, Math.sin(tw));
      const e2 = Nn.clone().multiplyScalar(-Math.sin(tw)).addScaledVector(B, Math.cos(tw));
      const taper = Math.pow(Math.sin(Math.PI * clamp(uu * 1.02 - 0.01)), 0.55);
      const wid = opts.width * taper * (0.75 + 0.45 * (0.5 + 0.5 * N3(uu * 4, t * 0.5, opts.seed + 9)) + 0.18 * Math.sin(uu * 37 + t * 2.3));
      const th = opts.thick * taper * (0.8 + 0.5 * (0.5 + 0.5 * N3(uu * 7, t * 0.7, opts.seed + 2)));
      for (let v = 0; v <= V; v++) {
        const phi = v / V * Math.PI * 2;
        const rip = 1 + 0.55 * N3(uu * 22, v * 0.5, t * 0.9 + opts.seed) * Math.abs(Math.cos(phi)) + 0.25 * N3(uu * 60, v, t * 1.4);
        const cw = Math.cos(phi) * wid, sw = Math.sin(phi) * th * rip;
        P[k++] = c.x + e1.x * cw + e2.x * sw;
        P[k++] = c.y + e1.y * cw + e2.y * sw;
        P[k++] = c.z + e1.z * cw + e2.z * sw;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { mesh, update, center };
}

/* ---------------------------------------------------------------- steam & dust */
function puffTexture(seed) {
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d'), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5, r = Math.hypot(u, v) * 2;
    let n = 0, a = 1, f = 3;
    for (let o = 0; o < 5; o++) { n += a * N3(u * f + seed * 3.1, v * f, seed); a *= 0.5; f *= 2; }
    const fall = Math.pow(clamp(1 - r), 1.6);
    const val = clamp((0.55 + 0.6 * n) * fall);
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(val * 255);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDust(count) {
  const R = mulberry32(99);
  const p = new Float32Array(count * 3), seed = new Float32Array(count), size = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    p.set([(R() * 2 - 1) * 9, (R() * 2 - 1) * 8, -9 + R() * 17], i * 3);
    seed[i] = R(); size[i] = 0.6 + Math.pow(R(), 3) * 3.2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uCamVel: { value: new THREE.Vector3() }, uPx: { value: H * 0.0055 } },
    vertexShader: GLSL_NOISE + `
      uniform float uTime; uniform vec3 uCam; uniform vec3 uCamVel; uniform float uPx;
      attribute float aSeed; attribute float aSize;
      varying float vA; varying vec3 vC;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + 8.0 + uTime*(0.22 + 0.4*fract(aSeed*7.13)), 16.0) - 8.0;
        vec3 q = p*0.32 + vec3(0.0, uTime*0.18, aSeed*9.0);
        p += vec3(snoise(q), snoise(q + 17.1), snoise(q + 31.7)) * 0.7;
        vec3 d = p - uCam; float dist = length(d);
        float infl = exp(-dist*dist*0.45);
        p += normalize(d + 1e-4) * infl * 1.1 + uCamVel * infl * 0.05;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45*sin(uTime*(2.0 + aSeed*5.0) + aSeed*40.0);
        gl_PointSize = clamp(aSize * uPx * tw / max(-mv.z, 0.1), 1.0, 64.0);
        vA = smoothstep(0.3, 1.6, -mv.z) * tw * (1.0 - smoothstep(22.0, 32.0, -mv.z));
        vC = mix(vec3(1.0, 0.55, 0.18), vec3(1.0, 0.86, 0.52), fract(aSeed*3.7));
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vC;
      void main(){ vec2 c = gl_PointCoord - 0.5; float r = length(c)*2.0; float a = exp(-r*r*5.0) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC * a * 2.2, a); }`
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

function makeShaft(color, intensity) {
  const geo = new THREE.CylinderGeometry(0.25, 3.4, 16, 48, 1, true);
  geo.translate(0, -8, 0); // apex at origin, beam goes down -y
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uI: { value: intensity } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      void main(){ vH = uv.y; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: GLSL_NOISE + `
      uniform float uTime; uniform vec3 uColor; uniform float uI;
      varying vec3 vN; varying vec3 vV; varying float vH; varying vec3 vW;
      void main(){
        float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = smoothstep(0.0, 0.5, vH) * pow(vH, 0.8);
        float n = 0.65 + 0.35*snoise(vW*0.55 + vec3(0.0, uTime*0.35, 0.0));
        float a = f * along * n * uI;
        gl_FragColor = vec4(uColor * a, a);
      }`
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/* ---------------------------------------------------------------- lens flares (screen space) */
const flareScene = new THREE.Scene();
const flareCam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -1, 1);
function flareMat(kind, color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec2 vUv;
      void main(){
        vec2 p = (vUv - 0.5) * 2.0; float a;
        ${kind === 'streak'
          ? 'a = exp(-abs(p.y)*7.0) * pow(max(1.0 - abs(p.x), 0.0), 3.0) + 2.5*exp(-abs(p.y)*30.0) * pow(max(1.0-abs(p.x),0.0), 6.0);'
          : kind === 'glow' ? 'float r = length(p); a = exp(-r*r*7.0) + 0.6*exp(-r*r*60.0);'
          : 'float r = length(p); a = smoothstep(1.0, 0.82, r) * smoothstep(0.35, 0.95, r) * 0.6 + 0.08*smoothstep(1.0,0.0,r);'}
        gl_FragColor = vec4(uColor * a * uI, 1.0);
      }`
  });
}
const FLARES = [];
function addFlare(getWorld, color, scale) {
  const g = new THREE.Group();
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMat('streak', color));
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMat('glow', color));
  const ghosts = [0.45, -0.35, -0.8].map((k, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMat('ghost', i === 1 ? 0x6fa8ff : color));
    m.userData.k = k; return m;
  });
  g.add(streak, glow, ...ghosts);
  flareScene.add(g);
  FLARES.push({ g, streak, glow, ghosts, getWorld, scale });
}

/* ---------------------------------------------------------------- build */
let beans, beanSim, droplets, ribbons = [], dust, shafts = [], steam = [], textMeshes = [];
const DROPS = 140;

async function build() {
  const ttf = await new TTFLoader().loadAsync('/assets/Cinzel-Black.ttf');
  const font = new Font(ttf);
  const defs = [
    ['SARDINIAN', MAT.copper, MAT.ceramic],
    ['COFFEE', MAT.chrome, MAT.copper],
    ['CORNER', MAT.ceramic, MAT.chrome]
  ];
  const built = defs.map(([s, a, b]) => buildLine(font, s, 6.0, a, b));
  const gap = 0.42;
  const total = built.reduce((s, l) => s + l.height, 0) + gap * 2;
  let y = total / 2;
  built.forEach((l, i) => {
    y -= l.height / 2;
    const pivot = new THREE.Group();
    pivot.position.y = y; pivot.add(l.mesh); logo.add(pivot);
    LINES.push({ pivot, y, h: l.height, i });
    textMeshes.push(l.mesh);
    y -= l.height / 2 + gap;
  });
  const boxes = LINES.map(l => ({ x: 0, y: l.y, hx: 3.15, hy: l.h / 2 + 0.08 }));

  // beans
  const N = 380;
  beanSim = simulateBeans(N, boxes);
  const beanMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.28, envMapIntensity: 0.9, sheen: 0.4, sheenColor: new THREE.Color(0x7a3a14), sheenRoughness: 0.5 });
  beans = new THREE.InstancedMesh(beanGeometry(), beanMat, N);
  const R = mulberry32(5), c = new THREE.Color();
  for (let i = 0; i < N; i++) { c.setRGB(0.16 + R() * 0.12, 0.075 + R() * 0.05, 0.035 + R() * 0.025, THREE.SRGBColorSpace); beans.setColorAt(i, c); }
  beans.frustumCulled = false;
  scene.add(beans);

  // espresso & crema waves wrapping the logo
  const espresso = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4, side: THREE.DoubleSide });
  const crema = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 1.3, sheen: 1, sheenColor: new THREE.Color(0xffc879), side: THREE.DoubleSide });
  ribbons.push(makeRibbon({ material: espresso, colA: 0x0b0301, colB: 0x3f1c08, colH: 0xd39a55, tilt: 0.9, roll: 0.1, radius: 4.6, turns: 1.08, a0: -0.6, speed: 0.42, width: 0.95, thick: 0.24, twist: 1.6, seed: 3 }));
  ribbons.push(makeRibbon({ material: crema, colA: 0x5e3010, colB: 0xc2853f, colH: 0xf3d29a, tilt: -1.0, roll: -0.14, radius: 4.9, turns: 0.92, a0: 2.2, speed: -0.36, width: 0.5, thick: 0.13, twist: 1.9, seed: 8 }));
  ribbons.forEach(r => scene.add(r.mesh));
  droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), espresso, DROPS);
  const dc = new THREE.Color();
  for (let i = 0; i < DROPS; i++) { dc.set(i % 3 === 0 ? 0xc78a45 : 0x2a1206); droplets.setColorAt(i, dc); }
  droplets.frustumCulled = false;
  scene.add(droplets);

  dust = makeDust(4200);
  scene.add(dust);

  for (const [x, z, rx, rz, col, k] of [[-2.6, -3.5, 0.0, -0.32, 0xffa04a, 0.085], [3.2, -2.8, 0.1, 0.38, 0xffc070, 0.065], [0.2, 2.0, -0.35, 0.05, 0xff9a40, 0.015]]) {
    const s = makeShaft(col, k);
    s.position.set(x, 9.5, z); s.rotation.set(rx, 0, rz);
    shafts.push(s); scene.add(s);
  }

  const tex = [0, 1, 2, 3].map(puffTexture);
  const SR = mulberry32(42);
  for (let i = 0; i < 46; i++) {
    const m = new THREE.SpriteMaterial({ map: tex[i % 4], color: 0xe8b884, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false });
    const sp = new THREE.Sprite(m);
    sp.userData = { x: (SR() * 2 - 1) * 5.0, z: -6 + SR() * 5.2, ph: SR(), speed: 0.55 + SR() * 0.5, rot: (SR() - 0.5) * 0.8, size: 2.2 + SR() * 2.4, seed: SR() * 50 };
    steam.push(sp); scene.add(sp);
  }

  addFlare(t => rimA.position, 0xffa24a, 1.0);
  addFlare(t => { const s = sweepState(t); return new THREE.Vector3(s.x, s.y, s.z); }, 0xffe2b0, 1.25);
  addFlare(t => key.position, 0xffb870, 0.8);

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // tame HDR specular spikes (half-float overflow) before they reach the bloom mips
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0); float m = max(max(c.r, c.g), c.b); if (m > 18.0) c.rgb *= 18.0 / m; gl_FragColor = vec4(c.rgb, 1.0); }'
  }));
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.4, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
let composer, bloom;

/* ---------------------------------------------------------------- per-frame update */
const ray = new THREE.Raycaster();
function visibility(world) {
  let vis = 0;
  const dir = new THREE.Vector3();
  const offsets = [[0, 0], [0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07]];
  for (const [ox, oy] of offsets) {
    const p = world.clone().add(new THREE.Vector3(ox, oy, 0));
    dir.subVectors(p, camera.position);
    const dist = dir.length();
    ray.set(camera.position, dir.normalize());
    ray.far = dist;
    const hits = ray.intersectObjects(textMeshes, false);
    if (!hits.length) vis += 1 / offsets.length;
  }
  return vis;
}

function update(t) {
  const cs = camState(t);
  camera.fov = cs.fov; camera.updateProjectionMatrix();
  camera.position.copy(cs.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(cs.tgt);
  camera.rotateY(cs.yaw); camera.rotateX(cs.pitch); camera.rotateZ(cs.roll);
  camera.updateMatrixWorld();

  // kinetic type: lines turn, then lock into place on the impact
  const lock = smooth(3.15, IMPACT, t);
  LINES.forEach(l => {
    const A = [0.3, -0.24, 0.32][l.i], B = [0.55, -0.5, 0.45][l.i];
    const wob = t > IMPACT ? 0.03 * Math.sin((t - IMPACT) * 22 + l.i) * Math.exp(-(t - IMPACT) * 6) : 0;
    l.pivot.rotation.y = A * (1 - lock) * (0.85 + 0.15 * Math.sin(t * 1.3 + l.i)) + wob;
    l.pivot.rotation.x = 0.06 * (1 - lock) * Math.sin(t * 1.1 + l.i * 2);
    l.pivot.position.x = B * (1 - lock) * (1 - lock);
  });

  // beans
  const f = clamp(t * FPS, 0, FRAMES), f0 = Math.floor(f), f1 = Math.min(FRAMES, f0 + 1), a = f - f0;
  const N = beans.count, m = new THREE.Matrix4(), q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const { outP, outQ, scl } = beanSim;
  for (let i = 0; i < N; i++) {
    const o0 = (f0 * N + i) * 3, o1 = (f1 * N + i) * 3;
    p.set(lerp(outP[o0], outP[o1], a), lerp(outP[o0 + 1], outP[o1 + 1], a), lerp(outP[o0 + 2], outP[o1 + 2], a));
    q0.fromArray(outQ, (f0 * N + i) * 4); q1.fromArray(outQ, (f1 * N + i) * 4); q0.slerp(q1, a);
    s.setScalar(scl[i]);
    m.compose(p, q0, s); beans.setMatrixAt(i, m);
  }
  beans.instanceMatrix.needsUpdate = true;

  ribbons.forEach(r => r.update(t));
  // droplets peel off the waves and drift in zero-g
  const DR = mulberry32(77);
  for (let i = 0; i < DROPS; i++) {
    const rib = ribbons[i % 2], u = DR(), life = 2.2 + DR() * 1.6, ph = DR() * life;
    const age = ((t + ph) % life) / life;
    const birth = t - age * life;
    const c = rib.center(u, birth);
    const out = c.clone().normalize();
    const n = new THREE.Vector3(N3(i, birth, 1), N3(i, birth, 2), N3(i, birth, 3));
    const pp = c.addScaledVector(out, age * (0.6 + DR() * 1.4)).addScaledVector(n, age * 0.8);
    const sz = (0.025 + DR() * 0.06) * Math.sin(Math.PI * age);
    m.compose(pp, q0.identity(), s.set(sz, sz * (1 + 0.4 * Math.sin(t * 9 + i)), sz));
    droplets.setMatrixAt(i, m);
  }
  droplets.instanceMatrix.needsUpdate = true;

  // dust reacts to the camera
  const prev = camState(Math.max(0, t - 1 / FPS)).pos;
  dust.material.uniforms.uTime.value = t;
  dust.material.uniforms.uCam.value.copy(cs.pos);
  dust.material.uniforms.uCamVel.value.copy(cs.pos).sub(prev).multiplyScalar(FPS);

  // rising steam
  steam.forEach(sp => {
    const d = sp.userData, life = 4.5 / d.speed;
    const age = ((t / life + d.ph) % 1);
    const y = -6.5 + age * 13;
    const drift = N3(d.seed, t * 0.25, age * 2);
    sp.position.set(d.x + drift * 1.2 + N3(d.seed + 3, t * 0.3, 0) * 0.5, y, d.z + N3(d.seed + 7, t * 0.2, 1) * 0.8);
    const sc = d.size * (0.7 + age * 1.3);
    sp.scale.set(sc, sc, 1);
    sp.material.rotation = d.rot * t + d.seed;
    sp.material.opacity = 0.028 * Math.sin(Math.PI * age) * (0.75 + 0.25 * smooth(3.5, 5, t));
  });

  shafts.forEach(s => (s.material.uniforms.uTime.value = t));
  bgMat.uniforms.uTime.value = t;
  bgMat.uniforms.uReveal.value = smooth(3.5, 4.6, t);

  const sw = sweepState(t);
  sweep.position.set(sw.x, sw.y, sw.z);
  sweep.intensity = 150 * sw.k;
  rimA.intensity = 70 + 90 * smooth(3.6, 4.4, t);
  bloom.strength = 0.42 + 0.3 * Math.exp(-Math.pow((t - IMPACT - 0.1) / 0.25, 2));

  // flares
  FLARES.forEach((fl, idx) => {
    const wp = fl.getWorld(t).clone();
    const v = wp.clone().project(camera);
    const inFront = v.z < 1 && v.z > -1;
    let inten = inFront ? visibility(wp) : 0;
    if (idx === 1) inten *= sw.k;
    if (idx === 0) inten *= 0.55 + 0.45 * smooth(3.6, 4.4, t);
    const edge = 1 - smooth(1.0, 1.35, Math.max(Math.abs(v.x), Math.abs(v.y)));
    inten *= edge;
    const sx = v.x * W / 2, sy = v.y * H / 2;
    fl.g.visible = inten > 0.002;
    const sc = fl.scale;
    fl.streak.position.set(sx, sy, 0); fl.streak.scale.set(W * 2.2 * sc, 70 * SCALE * sc, 1); fl.streak.material.uniforms.uI.value = 0.55 * inten;
    fl.glow.position.set(sx, sy, 0); fl.glow.scale.set(380 * SCALE * sc, 380 * SCALE * sc, 1); fl.glow.material.uniforms.uI.value = 0.6 * inten;
    fl.ghosts.forEach((gm, i) => {
      gm.position.set(sx * gm.userData.k, sy * gm.userData.k, 0);
      const r = [120, 70, 200][i] * SCALE * sc; gm.scale.set(r, r, 1);
      gm.material.uniforms.uI.value = 0.12 * inten;
    });
  });
}

function renderFrame(i) {
  update(i / FPS);
  renderer.autoClear = true;
  composer.render();
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.render(flareScene, flareCam);
  renderer.autoClear = true;
}

// read the canvas back as raw RGBA (bottom-up rows, flipped later by ffmpeg)
function readPixels() {
  const gl = renderer.getContext();
  const buf = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  return buf;
}

window.RENDER = {
  W, H, FPS, FRAMES,
  ready: build().then(() => { renderFrame(0); return true; }),
  async frame(i) { renderFrame(i); },
  async post(i, url) {
    renderFrame(i);
    const px = readPixels();
    const r = await fetch(url, { method: 'POST', body: px });
    return r.status;
  },
  clearance() {
    // min distance between the camera path and the beans / letters (sanity check)
    let minBean = 1e9, at = 0;
    for (let f = 0; f <= FRAMES; f++) {
      const c = camState(f / FPS).pos, N = beans.count;
      for (let i = 0; i < N; i++) {
        const o = (f * N + i) * 3;
        const d = Math.hypot(beanSim.outP[o] - c.x, beanSim.outP[o + 1] - c.y, beanSim.outP[o + 2] - c.z);
        if (d < minBean) { minBean = d; at = f; }
      }
    }
    return { minBean, at };
  }
};
