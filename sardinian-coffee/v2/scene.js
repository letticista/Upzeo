// Sardinian Coffee Corner — v2 "dal chicco alla tazza" edit.
// Shots: grinding burrs -> dosing & tamp -> extraction -> crema top-down -> crane to the cup, logo prints on it.
// Every frame is a pure function of time (frames can render in any order, on any worker).
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const params = new URLSearchParams(location.search);
const SCALE = parseFloat(params.get('scale') || '1');
const W = Math.round(1080 * SCALE), H = Math.round(1920 * SCALE);
const FPS = 60, DUR = 8, FRAMES = FPS * DUR;

// edit points (seconds)
const CUT_DOSE = 1.35, CUT_EXTRACT = 2.62, CUT_CUP = 4.7;
const TAMP = 2.42;
const REVEAL = [6.2, 7.15];

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
function interp(profile, y) { // profile: [[r, y], ...] sorted by y
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0604, 0.008);
const camera = new THREE.PerspectiveCamera(35, W / H, 0.2, 2000);

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
      const c = fn(x / w, y / h, x, y); const i = (y * w + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3] ?? 255;
    }
    g.putImageData(img, 0, 0);
  }, srgb);
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Gallura granite: pinkish feldspar, white quartz, black biotite specks
function graniteTexture() {
  const R = mulberry32(3);
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#8a7a72'; g.fillRect(0, 0, w, h);
    const blob = (n, rmin, rmax, cols, alpha) => {
      for (let i = 0; i < n; i++) {
        g.globalAlpha = alpha * (0.6 + 0.4 * R());
        g.fillStyle = cols[Math.floor(R() * cols.length)];
        g.beginPath();
        const x = R() * w, y = R() * h, r = rmin + R() * (rmax - rmin);
        g.ellipse(x, y, r, r * (0.5 + R() * 0.6), R() * 3.14, 0, Math.PI * 2); g.fill();
      }
    };
    blob(900, 5, 16, ['#b08a7c', '#c49a88', '#9c7468'], 0.75);
    blob(1400, 3, 9, ['#d9d2cb', '#e8e3dd', '#bfb6ae'], 0.7);
    blob(2600, 1, 4, ['#1b1614', '#2b2421', '#3a302b'], 0.85);
    blob(5000, 0.5, 1.5, ['#f4efe9', '#151110'], 0.6);
    g.globalAlpha = 1;
  });
}
function corkTexture() {
  const R = mulberry32(8);
  return canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#b5845a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.globalAlpha = 0.25 + R() * 0.5;
      const dark = R() < 0.55;
      g.fillStyle = dark ? (R() < 0.5 ? '#6e4627' : '#8a5a34') : (R() < 0.5 ? '#d3a77a' : '#c69465');
      const x = R() * w, y = R() * h, r = 1 + R() * (dark ? 4.5 : 3);
      g.beginPath(); g.ellipse(x, y, r, r * (0.4 + R() * 0.8), R() * 3.14, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = 0.55; g.fillStyle = '#3e2412';
      g.beginPath(); g.ellipse(R() * w, R() * h, 1.5 + R() * 3, 1 + R() * 2, R() * 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  });
}
// olive-wood grain running along v
function woodTexture() {
  return pixelTex(256, 1024, (u, v) => {
    const warp = fbm(u * 3, v * 1.2, 4.2, 3) * 2.2;
    const ring = 0.5 + 0.5 * Math.sin((u * 26 + warp * 3 + fbm(u * 8, v * 30, 1, 2) * 0.6) * Math.PI);
    const fleck = Math.max(0, fbm(u * 40, v * 6, 9, 2)) * 0.6;
    const c = mix3([58, 34, 19], [112, 70, 38], Math.pow(ring, 1.6) * 0.85 + fleck * 0.3);
    return mix3(c, [34, 19, 10], clamp(fbm(u * 2, v * 3, 7, 2) * 0.8));
  });
}
function groundsTexture() {
  const R = mulberry32(13);
  return pixelTex(512, 512, (u, v) => {
    const n = R(), clump = fbm(u * 18, v * 18, 3, 3);
    const c = mix3([34, 18, 9], [96, 58, 30], clamp(n * 0.75 + clump * 0.6 + 0.1));
    return n > 0.985 ? [150, 102, 62] : c;
  });
}
// espresso crema: domain-warped swirl with "tiger" flecks and a darker rim
function cremaTexture() {
  return pixelTex(512, 512, (u, v) => {
    const x = u * 2 - 1, y = v * 2 - 1, r = Math.hypot(x, y);
    const a = Math.atan2(y, x) + r * 1.2; // gentle swirl
    const sx = Math.cos(a) * r, sy = Math.sin(a) * r;
    const qx = fbm(sx * 1.6, sy * 1.6, 1.3, 3), qy = fbm(sx * 1.6 + 5.2, sy * 1.6, 2.1, 3);
    const f = fbm(sx * 2.4 + qx * 0.6, sy * 2.4 + qy * 0.6, 0.7, 4);
    let c = mix3([150, 92, 46], [196, 138, 80], clamp(0.5 + f * 1.1));
    c = mix3(c, [214, 164, 104], clamp((f - 0.25) * 2.0) * 0.35);
    const fleck = fbm(sx * 26, sy * 26, 4.4, 2);
    if (fleck > 0.38) c = mix3(c, [104, 56, 24], clamp((fleck - 0.38) * 6) * 0.55);
    c = mix3(c, [208, 158, 98], (1 - smooth(0.0, 0.45, r)) * 0.25);
    c = mix3(c, [104, 58, 26], smooth(0.8, 1.0, r) * 0.75);
    return c;
  });
}
function stripeTexture() { // tiger-striped espresso stream, u = along the stream
  return pixelTex(512, 64, (u, v) => {
    const n = fbm(u * 9, v * 2.2, 0.5, 3);
    const band = 0.5 + 0.5 * Math.sin((u * 14 + n * 3) * Math.PI);
    return mix3([46, 14, 4], [196, 112, 44], clamp(Math.pow(band, 3) * 0.9 + n * 0.4));
  });
}
// blurred studio backdrop with Sardinian rug motifs (a pibiones) and warm bokeh
function backdropTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    const base = document.createElement('canvas'); base.width = w; base.height = h;
    const b = base.getContext('2d');
    const grd = b.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#060302'); grd.addColorStop(0.5, '#1a0d07'); grd.addColorStop(1, '#070403');
    b.fillStyle = grd; b.fillRect(0, 0, w, h);
    // rows of diamond motifs, like a Sardinian tapestry
    const cols = ['#7a1c14', '#c9b48a', '#3a1f12', '#a3301f'];
    for (let row = 0; row < 7; row++) {
      const y = h * 0.28 + row * 64;
      for (let x = 0; x < w + 80; x += 80) {
        const c = cols[(row + Math.floor(x / 80)) % cols.length];
        b.globalAlpha = 0.55;
        b.fillStyle = c;
        b.beginPath(); b.moveTo(x, y - 26); b.lineTo(x + 26, y); b.lineTo(x, y + 26); b.lineTo(x - 26, y); b.closePath(); b.fill();
        b.fillStyle = '#e2d2ad'; b.globalAlpha = 0.35;
        b.beginPath(); b.moveTo(x, y - 8); b.lineTo(x + 8, y); b.lineTo(x, y + 8); b.lineTo(x - 8, y); b.closePath(); b.fill();
      }
    }
    b.globalAlpha = 1;
    g.filter = 'blur(22px)'; g.drawImage(base, 0, 0); g.filter = 'none';
    g.fillStyle = 'rgba(8,4,2,0.55)'; g.fillRect(0, 0, w, h);
    const R = mulberry32(17);
    g.filter = 'blur(6px)';
    for (let i = 0; i < 70; i++) {
      const x = R() * w, y = h * (0.25 + R() * 0.45), r = 8 + R() * 34;
      g.globalAlpha = 0.12 + R() * 0.28;
      g.fillStyle = R() < 0.7 ? '#ffb15a' : '#ffd9a0';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.filter = 'none'; g.globalAlpha = 1;
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

/* ================================================================ environment */
function buildEnvironment(backdrop) {
  const env = new THREE.Scene();
  const bgm = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ map: backdrop, side: THREE.BackSide, color: new THREE.Color(0.6, 0.6, 0.6) }));
  env.add(bgm);
  const panel = (w, h, col, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...col), side: THREE.DoubleSide }));
    m.position.set(...pos); m.rotation.set(...rot); env.add(m);
  };
  panel(26, 14, [4.2, 3.3, 2.4], [-14, 22, 18], [-0.9, -0.5, 0]);   // big warm key softbox
  panel(3, 30, [2.6, 1.3, 0.5], [30, 4, -8], [0, -Math.PI / 2, 0]);  // orange strip right
  panel(3, 30, [1.6, 1.0, 0.6], [-30, 4, -6], [0, Math.PI / 2, 0]);  // strip left
  panel(40, 2.2, [1.5, 0.9, 0.45], [0, 9, -36], [0, 0, 0]);          // back rim strip
  panel(18, 18, [2.4, 2.0, 1.6], [0, 32, 0], [Math.PI / 2, 0, 0]);   // top
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.025, 0.1, 200);
  pm.dispose();
  return rt.texture;
}

/* ================================================================ materials */
const TEX = {};
const MAT = {};
function buildMaterials() {
  TEX.granite = graniteTexture(); TEX.granite.wrapS = TEX.granite.wrapT = THREE.RepeatWrapping; TEX.granite.repeat.set(5, 5);
  TEX.cork = corkTexture(); TEX.cork.wrapS = TEX.cork.wrapT = THREE.RepeatWrapping;
  TEX.wood = woodTexture(); TEX.wood.wrapS = TEX.wood.wrapT = THREE.RepeatWrapping;
  TEX.grounds = groundsTexture(); TEX.grounds.wrapS = TEX.grounds.wrapT = THREE.RepeatWrapping; TEX.grounds.repeat.set(3, 3);
  TEX.groundsBump = TEX.grounds.clone(); TEX.groundsBump.colorSpace = THREE.NoColorSpace;
  TEX.crema = cremaTexture(); TEX.crema.center.set(0.5, 0.5);
  TEX.stripe = stripeTexture(); TEX.stripe.wrapS = TEX.stripe.wrapT = THREE.RepeatWrapping;
  TEX.backdrop = backdropTexture();
  TEX.puffs = [0, 1, 2, 3].map(puffTexture);
  MAT.steel = new THREE.MeshPhysicalMaterial({ color: 0xd9d4ce, metalness: 1, roughness: 0.24, envMapIntensity: 1.1 });
  MAT.steelDark = new THREE.MeshPhysicalMaterial({ color: 0x5e5852, metalness: 1, roughness: 0.42, envMapIntensity: 0.4, side: THREE.DoubleSide });
  MAT.chrome = new THREE.MeshPhysicalMaterial({ color: 0xf1ede8, metalness: 1, roughness: 0.07, envMapIntensity: 1.3 });
  MAT.copper = new THREE.MeshPhysicalMaterial({ color: 0xd38b58, metalness: 1, roughness: 0.22, envMapIntensity: 1.25, clearcoat: 0.4, clearcoatRoughness: 0.15 });
  MAT.wood = new THREE.MeshPhysicalMaterial({ map: TEX.wood, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.8 });
  MAT.porcelain = new THREE.MeshPhysicalMaterial({ color: 0xf3eee5, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.15, sheenColor: new THREE.Color(0xfff2dc), envMapIntensity: 0.75 });
  MAT.granite = new THREE.MeshPhysicalMaterial({ map: TEX.granite, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12, envMapIntensity: 0.6 });
  MAT.corkTop = new THREE.MeshStandardMaterial({ map: TEX.cork, roughness: 0.92, envMapIntensity: 0.4 });
  MAT.grounds = new THREE.MeshStandardMaterial({ map: TEX.grounds, bumpMap: TEX.groundsBump, bumpScale: 2.0, roughness: 0.95, envMapIntensity: 0.35 });
  MAT.crema = new THREE.MeshPhysicalMaterial({ map: TEX.crema, roughness: 0.62, sheen: 0.6, sheenColor: new THREE.Color(0xe8b47a), sheenRoughness: 0.5, envMapIntensity: 0.3 });
  MAT.espresso = new THREE.MeshPhysicalMaterial({ map: TEX.stripe, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, emissive: new THREE.Color(0x3a1406), emissiveMap: TEX.stripe, emissiveIntensity: 0.9, envMapIntensity: 1.2 });
  MAT.drop = new THREE.MeshPhysicalMaterial({ color: 0x5a2208, roughness: 0.05, clearcoat: 1, emissive: new THREE.Color(0x4a1a06), emissiveIntensity: 0.6, envMapIntensity: 1.2 });
  MAT.bean = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3, envMapIntensity: 0.6 });
  MAT.leaf = new THREE.MeshPhysicalMaterial({ color: 0x2c4a22, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
  MAT.berry = new THREE.MeshPhysicalMaterial({ color: 0x2a1534, roughness: 0.4, clearcoat: 0.5, sheen: 1, sheenColor: new THREE.Color(0x8a7aa8), sheenRoughness: 0.6 });
  MAT.twig = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.8 });
}

/* ================================================================ geometry helpers */
const lathe = (pts, segs = 128) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
const shadowed = (m, cast = true, recv = true) => { m.castShadow = cast; m.receiveShadow = recv; return m; };

function beanGeometry() {
  let g = new THREE.SphereGeometry(1, 40, 28);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 0.7, y = p.getY(i), z = p.getZ(i) * 0.52;
    if (z > 0) z *= 0.62;
    const cx = 0.07 * Math.sin(y * 2.4), ends = 1 - Math.pow(Math.abs(y), 5);
    const groove = Math.exp(-Math.pow((x - cx) / 0.05, 2)) * ends;
    if (z > -0.05) z -= groove * 0.2 * smooth(-0.05, 0.25, z);
    const lump = 1 + 0.03 * N3(x * 4, y * 4, z * 4);
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
// tube with per-point radius (the espresso stream thins as it falls)
function taperTube(points, radii, radial = 12) {
  const n = points.length;
  const pos = new Float32Array(n * (radial + 1) * 3), uv = new Float32Array(n * (radial + 1) * 2);
  const idx = [];
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(n - 1, false);
  for (let i = 0; i < n; i++) {
    const p = curve.getPointAt(i / (n - 1));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const nx = Math.cos(a), ny = Math.sin(a);
      const k = (i * (radial + 1) + j);
      pos[k * 3] = p.x + radii[i] * (nx * frames.normals[i].x + ny * frames.binormals[i].x);
      pos[k * 3 + 1] = p.y + radii[i] * (nx * frames.normals[i].y + ny * frames.binormals[i].y);
      pos[k * 3 + 2] = p.z + radii[i] * (nx * frames.normals[i].z + ny * frames.binormals[i].z);
      uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = j / radial;
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
// polar grid disk (unit radius) for surfaces we displace on the CPU
function polarDisk(rings, segs) {
  const pos = [], uv = [], idx = [];
  pos.push(0, 0, 0); uv.push(0.5, 0.5);
  for (let r = 1; r <= rings; r++) for (let s = 0; s < segs; s++) {
    const rr = r / rings, a = (s / segs) * Math.PI * 2;
    pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); uv.push(0.5 + Math.cos(a) * rr * 0.5, 0.5 + Math.sin(a) * rr * 0.5);
  }
  const id = (r, s) => (r === 0 ? 0 : 1 + (r - 1) * segs + (s % segs));
  for (let s = 0; s < segs; s++) idx.push(0, id(1, s + 1), id(1, s));
  for (let r = 1; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = id(r, s), b = id(r, s + 1), c = id(r + 1, s), d = id(r + 1, s + 1);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/* ================================================================ objects */
const OBJ = {};

// --- espresso cup (cm). Outer wall profile used for the logo decal.
const CUP_OUTER = [[2.2, 0.6], [2.55, 0.9], [2.85, 1.6], [3.05, 2.6], [3.2, 3.8], [3.28, 5.0], [3.32, 5.8], [3.335, 6.0]];
const CUP_INNER = [[0.001, 0.84], [1.3, 0.88], [2.05, 1.07], [2.48, 1.6], [2.75, 2.6], [2.92, 3.8], [3.01, 5.0], [3.07, 5.8]];
const LOGO_D = 4.6, LOGO_Y = 3.45;
function buildCup(logoTex) {
  const group = new THREE.Group();
  const prof = [[0.001, 0.0], [1.55, 0.0], [1.72, 0.04], [1.8, 0.2], [1.82, 0.38], [1.95, 0.5], ...CUP_OUTER,
    [3.32, 6.1], [3.26, 6.16], [3.18, 6.15], [3.12, 6.08], ...CUP_INNER.slice().reverse()];
  const body = shadowed(new THREE.Mesh(lathe(prof, 160), MAT.porcelain));
  group.add(body);
  const handleCurve = new THREE.CatmullRomCurve3([V3(3.1, 5.15, 0), V3(4.35, 5.3, 0), V3(5.2, 4.6, 0), V3(5.25, 3.35, 0), V3(4.5, 2.35, 0), V3(2.8, 2.0, 0)]);
  const handle = shadowed(new THREE.Mesh(new THREE.TubeGeometry(handleCurve, 90, 0.36, 20), MAT.porcelain));
  handle.scale.z = 0.8;
  handle.rotation.y = 0.62;
  group.add(handle);
  // logo decal shell: hugs the tapered wall, UVs laid out by arc length so the round logo stays round
  const NA = 110, NY = 80, half = LOGO_D / 2 + 0.05;
  const pos = [], nor = [], uv = [], idx = [];
  const amax = (half + 0.05) / interp(CUP_OUTER.map(([r, y]) => [r, y]), LOGO_Y - half);
  for (let j = 0; j <= NY; j++) {
    const y = LOGO_Y - half + (2 * half * j) / NY;
    const r = interp(CUP_OUTER, y) + 0.012;
    const dr = (interp(CUP_OUTER, y + 0.01) - interp(CUP_OUTER, y - 0.01)) / 0.02;
    for (let i = 0; i <= NA; i++) {
      const a = -amax + (2 * amax * i) / NA;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      const n = V3(Math.sin(a), -dr, Math.cos(a)).normalize(); nor.push(n.x, n.y, n.z);
      uv.push(0.5 + (a * r) / LOGO_D, 0.5 + (y - LOGO_Y) / LOGO_D);
    }
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + NA + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const dg = new THREE.BufferGeometry();
  dg.setIndex(idx);
  dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  dg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const U = { uReveal: { value: 0 }, uTime: { value: 0 } };
  const dm = new THREE.MeshPhysicalMaterial({ map: logoTex, transparent: true, roughness: 0.17, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false, emissive: 0x000000 });
  dm.onBeforeCompile = sh => {
    sh.uniforms.uReveal = U.uReveal; sh.uniforms.uTime = U.uTime;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uReveal; uniform float uTime;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 dc = vMapUv - 0.5; float rr = length(dc) * 2.0; float ang = atan(dc.y, dc.x);
        float front = uReveal * 1.3 - 0.12;
        float wob = 0.03 * sin(ang * 7.0 + uTime * 3.0) + 0.018 * sin(ang * 13.0 - uTime * 5.0);
        float rw = rr + wob;
        float revealMask = 1.0 - smoothstep(front - 0.025, front + 0.005, rw);
        float edgeGlow = smoothstep(front - 0.16, front - 0.05, rw) * (1.0 - smoothstep(front - 0.05, front - 0.01, rw));
        edgeGlow *= sampledDiffuseColor.a * (1.0 - smoothstep(0.9, 1.0, uReveal));
        diffuseColor.a *= revealMask;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.66, 0.26) * edgeGlow * 2.6;`);
  };
  const decal = new THREE.Mesh(dg, dm);
  decal.renderOrder = 2;
  group.add(decal);
  // crema surface (unit disk scaled to the inner radius at the fill level)
  const crema = new THREE.Mesh(polarDisk(48, 128), MAT.crema);
  crema.receiveShadow = true;
  group.add(crema);
  return { group, decal, decalU: U, crema, base: crema.geometry.attributes.position.array.slice() };
}

function buildSaucer() {
  const prof = [[0.001, 0.0], [3.5, 0.0], [3.7, 0.06], [3.8, 0.28], [4.3, 0.34], [6.2, 0.56], [7.05, 0.9], [7.25, 1.08], [7.22, 1.17], [7.05, 1.12], [6.2, 0.82], [4.4, 0.66], [3.9, 0.7], [3.3, 0.64], [0.001, 0.64]];
  return shadowed(new THREE.Mesh(lathe(prof, 160), MAT.porcelain));
}

function buildPortafilter() {
  const g = new THREE.Group();
  const body = [[0.001, -3.6], [1.25, -3.6], [1.32, -3.3], [2.6, -2.9], [3.25, -2.3], [3.45, -1.2], [3.55, -0.2], [3.62, 0.0], [3.62, 0.18], [3.45, 0.26], [3.1, 0.22]];
  g.add(shadowed(new THREE.Mesh(lathe(body, 128), MAT.copper)));
  const basket = [[3.09, 0.24], [2.98, 0.12], [2.93, -0.5], [2.86, -1.8], [2.76, -2.25], [2.5, -2.32], [0.001, -2.33]];
  g.add(shadowed(new THREE.Mesh(lathe(basket, 128), MAT.steel)));
  for (const s of [-1, 1]) {
    const lug = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), MAT.copper));
    lug.position.set(0, -0.35, s * 3.75); g.add(lug);
  }
  const arm = new THREE.Group();
  arm.position.set(3.2, -1.3, 0); arm.rotation.z = -0.12; g.add(arm);
  const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 3.2, 32), MAT.copper));
  neck.rotation.z = -Math.PI / 2; neck.position.x = 1.6; arm.add(neck);
  const ferrule = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.18, 16, 48), MAT.copper));
  ferrule.rotation.y = Math.PI / 2; ferrule.position.x = 3.25; arm.add(ferrule);
  const grip = shadowed(new THREE.Mesh(lathe([[0.001, 0], [0.78, 0], [0.98, 0.6], [1.16, 3.4], [1.22, 6.0], [1.08, 8.4], [0.82, 9.3], [0.001, 9.5]], 64), MAT.wood));
  grip.rotation.z = -Math.PI / 2; grip.position.x = 3.3; arm.add(grip);
  return g;
}

function buildSpouts() {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(lathe([[0.001, -3.55], [1.05, -3.55], [1.05, -3.85], [0.7, -4.1], [0.001, -4.12]], 64), MAT.copper)));
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([V3(s * 0.25, -3.95, 0), V3(s * 0.48, -4.35, 0), V3(s * 0.62, -4.78, 0)]);
    g.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.2, 16), MAT.copper)));
    const tip = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 8, 24), MAT.copper));
    tip.rotation.x = Math.PI / 2; tip.position.set(s * 0.62, -4.8, 0); g.add(tip);
  }
  return g;
}

function buildGroupHead() {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(lathe([[0.001, 0.28], [3.35, 0.28], [3.72, 0.38], [3.86, 0.7], [3.86, 2.6], [4.3, 3.0], [4.55, 3.4], [4.55, 12]], 128), MAT.chrome)));
  const gasket = new THREE.Mesh(new THREE.TorusGeometry(3.45, 0.12, 12, 96), new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.7 }));
  gasket.rotation.x = Math.PI / 2; gasket.position.y = 0.3; g.add(gasket);
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(34, 14, 18), MAT.steelDark));
  body.position.set(0, 17, -4); g.add(body);
  const splash = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(40, 30), MAT.steelDark), false, true);
  splash.position.set(0, -6, -9); g.add(splash);
  const tray = shadowed(new THREE.Mesh(new THREE.BoxGeometry(30, 1, 16), MAT.steelDark), false, true);
  tray.position.set(0, -16.0, 0); g.add(tray);
  const slots = new THREE.Group();
  for (let i = -7; i <= 7; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x0c0a09, roughness: 0.8 }));
    s.position.set(i * 1.9, -15.46, 0); slots.add(s);
  }
  g.add(slots);
  return g;
}

function buildTamper() {
  const g = new THREE.Group();
  g.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.8, 96), MAT.chrome)));
  g.children[0].position.y = 0.4;
  const neck = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 2.2, 32), MAT.copper)); neck.position.y = 1.9; g.add(neck);
  const knob = shadowed(new THREE.Mesh(lathe([[0.001, 0], [0.9, 0.05], [1.5, 0.9], [1.75, 2.2], [1.55, 3.4], [0.9, 4.0], [0.001, 4.1]], 64), MAT.wood)); knob.position.y = 2.9; g.add(knob);
  return g;
}

function buildGrinder() {
  const g = new THREE.Group();
  const coneProf = [[0.001, -1.3], [2.85, -1.3], [2.85, -0.9], [2.55, -0.2], [2.1, 0.6], [1.5, 1.5], [0.9, 2.4], [0.45, 3.0], [0.001, 3.15]];
  const coneR = y => interp(coneProf.slice(2).map(([r, yy]) => [r, yy]), y);
  const cone = new THREE.Group();
  cone.add(shadowed(new THREE.Mesh(lathe(coneProf, 128), MAT.steel)));
  const ridges = [];
  for (let b = 0; b < 11; b++) {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const s = k / 16, y = lerp(2.85, -0.95, s), r = coneR(y) + 0.04, a = (b / 11) * Math.PI * 2 + s * 1.7;
      pts.push(V3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    ridges.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.12, 6));
  }
  cone.add(shadowed(new THREE.Mesh(mergeGeometries(ridges), MAT.chrome)));
  g.add(cone);
  g.add(shadowed(new THREE.Mesh(lathe([[3.9, -1.4], [3.9, 1.05], [3.0, 1.05], [3.0, -1.4]], 128), MAT.steel)));
  const teeth = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 2.1, 0.3), MAT.chrome, 60);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    q.setFromEuler(new THREE.Euler(0, -a, 0.38, 'YXZ'));
    m.compose(V3(Math.cos(a) * 2.98, -0.25, Math.sin(a) * 2.98), q, V3(1, 1, 1));
    teeth.setMatrixAt(i, m);
  }
  teeth.castShadow = true; teeth.receiveShadow = true;
  g.add(teeth);
  g.add(shadowed(new THREE.Mesh(lathe([[3.9, 1.05], [6.4, 5.2]], 128), MAT.steelDark)));
  return { group: g, cone, coneR };
}

function buildMyrtle() {
  const g = new THREE.Group();
  const R = mulberry32(31);
  const curve = new THREE.CatmullRomCurve3([V3(-4.2, 0.12, 10.2), V3(-2.6, 0.2, 9.0), V3(-1.2, 0.16, 9.6), V3(0.2, 0.14, 8.8)]);
  g.add(shadowed(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.07, 8), MAT.twig)));
  const leafGeo = new THREE.SphereGeometry(1, 16, 10); leafGeo.scale(0.42, 0.06, 1.05); leafGeo.translate(0, 0, 0.95);
  for (let i = 0; i < 18; i++) {
    const s = 0.05 + (i / 18) * 0.9, p = curve.getPointAt(s), tg = curve.getTangentAt(s);
    const side = i % 2 ? 1 : -1;
    const leaf = shadowed(new THREE.Mesh(leafGeo, MAT.leaf));
    leaf.position.copy(p);
    leaf.rotation.set(-0.15 + R() * 0.3, Math.atan2(tg.x, tg.z) + side * (1.0 + R() * 0.4), side * 0.3);
    leaf.scale.setScalar(0.75 + R() * 0.35);
    g.add(leaf);
  }
  for (const [x, z] of [[0.5, 8.4], [0.9, 9.0], [0.15, 9.3], [-0.6, 8.3]]) {
    const b = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), MAT.berry));
    b.position.set(x, 0.36, z); b.scale.y = 0.92; g.add(b);
  }
  return g;
}

/* ================================================================ particles & fx */
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
  const p = new THREE.Points(geo, pointsMaterial(additive));
  p.frustumCulled = false;
  return p;
}

/* ================================================================ screen overlay (labels, flash, flare) */
const overlay = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -1, 1);
function textPlane(lines, opts) {
  const cv = document.createElement('canvas');
  const fs = opts.size, pad = fs * 1.4;
  const g0 = cv.getContext('2d');
  g0.font = `${fs}px ${opts.family}`;
  const widths = lines.map(l => { g0.letterSpacing = `${l.ls ?? opts.ls}px`; g0.font = `${l.size ?? fs}px ${opts.family}`; return g0.measureText(l.text).width; });
  cv.width = Math.ceil(Math.max(...widths) + pad * 2 + (opts.rule ? 260 : 0));
  cv.height = Math.ceil(lines.reduce((s, l) => s + (l.size ?? fs) * 1.5, 0) + pad);
  const g = cv.getContext('2d');
  let y = pad * 0.5;
  lines.forEach((l, i) => {
    const sz = l.size ?? fs; y += sz * 1.15;
    g.font = `${sz}px ${opts.family}`; g.letterSpacing = `${l.ls ?? opts.ls}px`; g.textAlign = 'center';
    const grd = g.createLinearGradient(0, y - sz, 0, y);
    grd.addColorStop(0, l.c1 ?? opts.c1); grd.addColorStop(1, l.c2 ?? opts.c2);
    g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = sz * 0.35; g.shadowOffsetY = sz * 0.06;
    g.fillStyle = grd; g.fillText(l.text, cv.width / 2, y);
    if (opts.rule && i === 0) {
      g.shadowBlur = 0; g.strokeStyle = l.c2 ?? opts.c2; g.lineWidth = Math.max(1, sz * 0.045); g.globalAlpha = 0.85;
      const w2 = widths[i] / 2 + sz * 0.9;
      g.beginPath(); g.moveTo(cv.width / 2 - w2 - 110, y - sz * 0.36); g.lineTo(cv.width / 2 - w2, y - sz * 0.36);
      g.moveTo(cv.width / 2 + w2, y - sz * 0.36); g.lineTo(cv.width / 2 + w2 + 110, y - sz * 0.36); g.stroke();
      g.globalAlpha = 1;
    }
    y += sz * 0.35;
  });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(cv.width, cv.height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }));
  overlay.add(m);
  return m;
}
const shadeTex = (() => { const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256; const g = cv.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(6,3,2,0)'); gr.addColorStop(0.55, 'rgba(6,3,2,0.62)'); gr.addColorStop(1, 'rgba(6,3,2,0.88)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const lowerShade = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.34), new THREE.MeshBasicMaterial({ map: shadeTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
lowerShade.position.y = -H / 2 + H * 0.17; lowerShade.renderOrder = -1;
overlay.add(lowerShade);
const flashQuad = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
flashQuad.renderOrder = 10;
overlay.add(flashQuad);
function flareMaterial(kind, color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying vec2 vUv;
      void main(){ vec2 p = (vUv-0.5)*2.0; float a;
        ${kind === 'streak' ? 'a = exp(-abs(p.y)*8.0)*pow(max(1.0-abs(p.x),0.0),3.0) + 2.0*exp(-abs(p.y)*34.0)*pow(max(1.0-abs(p.x),0.0),6.0);' : 'float r = length(p); a = exp(-r*r*7.0) + 0.5*exp(-r*r*50.0);'}
        gl_FragColor = vec4(uColor*a*uI, 1.0); }`
  });
}
const glintStreak = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMaterial('streak', 0xffcf8a));
const glintGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flareMaterial('glow', 0xffd7a0));
overlay.add(glintStreak, glintGlow);

/* ================================================================ scene assembly */
const SET = { grind: new THREE.Group(), dose: new THREE.Group(), machine: new THREE.Group(), table: new THREE.Group() };
Object.values(SET).forEach(s => scene.add(s));
const L = {};
let composer, bloom, cup, portafilter, grinder, tamper, LABELS = {};
let beansI, fragsI, grindDust, groundsI, puff, streams = [], dripsI, crownI, steam = [], sparks, tableBeans;
const GRIND = { beans: [], frags: [] };
const DOSE = { parts: [] };

async function build() {
  const fontR = new FontFace('CinzelR', 'url(/assets/Cinzel-Regular.ttf)');
  const fontB = new FontFace('CinzelB', 'url(/assets/Cinzel-Black.ttf)');
  await Promise.all([fontR.load(), fontB.load()]).then(fs => fs.forEach(f => document.fonts.add(f)));
  buildMaterials();
  scene.environment = buildEnvironment(TEX.backdrop);
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(900, 64, 32), new THREE.MeshBasicMaterial({ map: TEX.backdrop, side: THREE.BackSide, fog: false, color: new THREE.Color(2.4, 2.2, 2.0) }));
  scene.add(backdrop);
  OBJ.backdrop = backdrop;
  const logoTex = await new THREE.TextureLoader().loadAsync('/v2/logo.png');
  logoTex.colorSpace = THREE.SRGBColorSpace; logoTex.anisotropy = 16;

  /* lights: one rig, repositioned per shot (keeps shader programs stable) */
  scene.add(new THREE.HemisphereLight(0x4a3020, 0x070302, 0.25));
  L.key = new THREE.SpotLight(0xffe2c0, 0, 0, 0.5, 0.75, 2);
  L.key.castShadow = true; L.key.shadow.mapSize.set(2048, 2048); L.key.shadow.bias = -0.0004; L.key.shadow.normalBias = 0.02;
  L.key.shadow.camera.near = 4; L.key.shadow.camera.far = 160;
  scene.add(L.key, L.key.target);
  L.rim = new THREE.PointLight(0xff9a48, 0, 0, 2); scene.add(L.rim);
  L.fill = new THREE.PointLight(0xffd2a8, 0, 0, 2); scene.add(L.fill);
  L.back = new THREE.PointLight(0xff8a30, 0, 0, 2); scene.add(L.back);
  L.glint = new THREE.PointLight(0xfff1dc, 0, 0, 2); scene.add(L.glint);

  /* ---- shot 1: burrs */
  grinder = buildGrinder();
  SET.grind.add(grinder.group);
  const beanGeo = beanGeometry();
  const R = mulberry32(5);
  const NB = 70;
  beansI = new THREE.InstancedMesh(beanGeo, MAT.bean, NB); beansI.castShadow = true; beansI.receiveShadow = true;
  const c = new THREE.Color();
  for (let i = 0; i < NB; i++) {
    c.setRGB(0.15 + R() * 0.1, 0.07 + R() * 0.04, 0.03 + R() * 0.02, THREE.SRGBColorSpace); beansI.setColorAt(i, c);
    const b = { phi: R() * Math.PI * 2, r0: 1.6 + R() * 2.4, y0: 0.6 + R() * 5.6, v: 0.8 + R() * 1.1, w: 0.45 + R() * 0.5, s: 0.52 + R() * 0.16, crushY: 0.25 + R() * 0.5, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 1 + R() * 2.5, q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 6, R() * 6, R() * 6)) };
    GRIND.beans.push(b);
  }
  beansI.frustumCulled = false; SET.grind.add(beansI);
  const NF = 6;
  fragsI = new THREE.InstancedMesh(chunkGeometry(), MAT.bean, NB * NF); fragsI.castShadow = true;
  for (let i = 0; i < NB * NF; i++) {
    c.setRGB(R() < 0.4 ? 0.36 : 0.16, R() < 0.4 ? 0.2 : 0.08, 0.05, THREE.SRGBColorSpace); fragsI.setColorAt(i, c);
    GRIND.frags.push({ dir: V3(R() - 0.5, -0.4 - R() * 0.6, R() - 0.5).normalize(), sp: 1.0 + R() * 1.8, s: 0.16 + R() * 0.16, ax: V3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), spin: 2 + R() * 4 });
  }
  fragsI.frustumCulled = false; SET.grind.add(fragsI);
  grindDust = makePoints(2600, false);
  grindDust.userData.seed = Array.from({ length: 2600 }, () => [R() * 6.283, 2.25 + R() * 0.9, -1.0 + R() * 1.9, 0.6 + R() * 0.8, R()]);
  SET.grind.add(grindDust);

  /* ---- shot 2: dosing + tamp */
  portafilter = buildPortafilter();
  const mound = new THREE.Mesh(polarDisk(60, 160), MAT.grounds);
  mound.receiveShadow = true; mound.castShadow = true;
  OBJ.mound = mound; OBJ.moundBase = mound.geometry.attributes.position.array.slice();
  portafilter.add(mound);
  tamper = buildTamper();
  SET.dose.add(tamper);
  const NG = 2600;
  groundsI = new THREE.InstancedMesh(chunkGeometry(), MAT.bean, NG);
  for (let i = 0; i < NG; i++) {
    const k = R(); c.setRGB(lerp(0.12, 0.34, k), lerp(0.06, 0.19, k), lerp(0.03, 0.09, k), THREE.SRGBColorSpace); groundsI.setColorAt(i, c);
    const g1 = Math.sqrt(-2 * Math.log(R() + 1e-6)) * Math.cos(6.283 * R()), g2 = Math.sqrt(-2 * Math.log(R() + 1e-6)) * Math.cos(6.283 * R());
    DOSE.parts.push({ ts: lerp(CUT_DOSE - 1.1, 2.2, R()), gx: g1, gz: g2, s: 0.035 + Math.pow(R(), 2) * 0.07, ax: V3(R(), R(), R()).normalize(), spin: R() * 8 });
  }
  groundsI.frustumCulled = false; SET.dose.add(groundsI);
  puff = makePoints(260, false);
  puff.userData.seed = Array.from({ length: 260 }, () => [R() * 6.283, R(), R()]);
  SET.dose.add(puff);

  /* ---- shot 3: machine */
  SET.machine.add(buildGroupHead());
  OBJ.spouts = buildSpouts(); SET.machine.add(OBJ.spouts);
  for (let i = 0; i < 2; i++) { const m = new THREE.Mesh(new THREE.BufferGeometry(), MAT.espresso); m.frustumCulled = false; streams.push(m); SET.machine.add(m); }
  dripsI = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), MAT.drop, 24); dripsI.frustumCulled = false; scene.add(dripsI);

  /* ---- shared cup */
  cup = buildCup(logoTex);
  scene.add(cup.group);
  scene.add(portafilter);
  crownI = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), MAT.drop, 40); crownI.frustumCulled = false; scene.add(crownI);

  /* ---- table set (Gallura granite, cork, saucer, myrtle, beans) */
  const granite = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(90, 70), MAT.granite), false, true);
  granite.rotation.x = -Math.PI / 2; granite.position.set(0, 0, 10); SET.table.add(granite);
  const edge = shadowed(new THREE.Mesh(new THREE.BoxGeometry(90, 3, 0.6), MAT.granite), false, true); edge.position.set(0, -1.5, -25); SET.table.add(edge);
  const cork = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 0.55, 128), [new THREE.MeshStandardMaterial({ color: 0x9a6c45, roughness: 0.95 }), MAT.corkTop, MAT.corkTop]));
  cork.position.y = 0.275; SET.table.add(cork);
  const saucer = buildSaucer(); saucer.position.y = 0.55; SET.table.add(saucer);
  SET.table.add(buildMyrtle());
  tableBeans = new THREE.InstancedMesh(beanGeo, MAT.bean, 7); tableBeans.castShadow = true; tableBeans.receiveShadow = true;
  const TB = [[2.6, 9.6, 0.4], [3.6, 10.6, 2.1], [1.7, 11.2, 4.0], [4.3, 8.9, 5.1], [-4.6, 12.2, 1.2], [3.0, 12.4, 2.8], [5.0, 11.7, 0.9]];
  TB.forEach(([x, z, a], i) => {
    const m = new THREE.Matrix4().compose(V3(x, 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.05, a, 0.1 * i, 'YXZ')), V3(0.62, 0.62, 0.62));
    tableBeans.setMatrixAt(i, m); c.setRGB(0.18, 0.085, 0.04, THREE.SRGBColorSpace); tableBeans.setColorAt(i, c);
  });
  SET.table.add(tableBeans);
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.puffs[i % 4], color: 0xc9b396, transparent: true, depthWrite: false, opacity: 0, fog: false }));
    sp.userData = { x: (R() - 0.5) * 3.2, z: (R() - 0.5) * 3.2, ph: R(), sp: 0.5 + R() * 0.4, rot: (R() - 0.5) * 0.7, size: 2.4 + R() * 2.6, seed: R() * 40 };
    steam.push(sp); scene.add(sp);
  }
  sparks = makePoints(1100, true);
  sparks.userData.seed = Array.from({ length: 1100 }, () => {
    let u, v; do { u = R() - 0.5; v = R() - 0.5; } while (u * u + v * v > 0.23);
    return { u, v, rho: Math.hypot(u, v) / 0.48, phi: R() * 6.283, r0: 6 + R() * 6, y0: 0.5 + R() * 11, dur: 0.75 + R() * 0.55, size: 0.6 + R() * 1.6, tw: R() * 30 };
  });
  scene.add(sparks);

  /* ---- overlay typography */
  LABELS.grind = textPlane([{ text: 'MACINATURA' }], { family: 'CinzelR', size: 46 * SCALE, ls: 14 * SCALE, c1: '#f6e6c8', c2: '#c99b5c', rule: true });
  LABELS.extract = textPlane([{ text: 'ESTRAZIONE' }], { family: 'CinzelR', size: 46 * SCALE, ls: 14 * SCALE, c1: '#f6e6c8', c2: '#c99b5c', rule: true });
  LABELS.tag = textPlane([
    { text: 'SU CAFÈ DE SARDIGNA', size: 76 * SCALE, ls: 10 * SCALE, c1: '#fff1cf', c2: '#d9a35a' },
    { text: 'SARDINIAN COFFEE CORNER', size: 32 * SCALE, ls: 15 * SCALE, c1: '#f0dcb6', c2: '#c08a4c' }
  ], { family: 'CinzelR', size: 70 * SCALE, ls: 10 * SCALE, c1: '#ffe9be', c2: '#c8914a', rule: true });

  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.0); float m = max(max(c.r, c.g), c.b); if (m > 16.0) c.rgb *= 16.0 / m; gl_FragColor = vec4(c.rgb, 1.0); }'
  }));
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.45, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

/* ================================================================ camera rigs */
function lookCam(pos, tgt, roll, fov) {
  const m = new THREE.Matrix4().lookAt(pos, tgt, V3(0, 1, 0));
  const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), roll));
  return { pos, quat: q, fov };
}
function orbitCam(tgt, d, el, az, roll, fov) {
  const pos = V3(tgt.x + d * Math.cos(el) * Math.sin(az), tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(el) * Math.cos(az));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-el, az, roll, 'YXZ'));
  return { pos, quat: q, fov };
}
function shake(cam, t, amp, freq = 22) {
  if (amp <= 0) return cam;
  const n = k => N3(t * freq + k * 9.7, k * 3.1, 0.5);
  cam.pos.add(V3(n(1), n(2), n(3)).multiplyScalar(amp));
  cam.quat.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(n(4) * amp * 0.06, n(5) * amp * 0.06, n(6) * amp * 0.08)));
  return cam;
}

/* ================================================================ shot 1 — grinding */
// burr angle with a speed ramp: slow-mo, then the motor kicks to full speed into the cut
const burrAngle = t => 1.3 * t + (t > 0.82 ? 9.0 * Math.pow(t - 0.82, 2) : 0);
const grindWarp = t => t + (t > 0.82 ? 1.6 * Math.pow(t - 0.82, 2) : 0);
const GRIND_KEYS = [
  [0.0, [-1.9, 8.6, 6.6], [1.4, 0.2, 0.5]],
  [0.85, [0.0, 7.0, 5.6], [1.8, 0.0, 0.4]],
  [1.15, [1.3, 5.9, 4.9], [2.1, -0.3, 0.1]],
  [CUT_DOSE, [2.5, 4.6, 3.2], [2.6, -1.1, -0.6]]
];
function shotGrind(t) {
  const th = burrAngle(t), tw = grindWarp(t);
  grinder.cone.rotation.y = -th;
  const camPos = V3(...hermite(GRIND_KEYS, t, k => k[1])), camTgt = V3(...hermite(GRIND_KEYS, t, k => k[2]));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  GRIND.beans.forEach((b, i) => {
    const y = b.y0 - b.v * tw - 0.35 * tw * tw;
    // time it reaches the crush height
    const disc = b.v * b.v + 4 * 0.35 * (b.y0 - b.crushY);
    const twc = (-b.v + Math.sqrt(Math.max(0, disc))) / (2 * 0.35);
    const yc = Math.max(y, b.crushY);
    const twEff = Math.min(tw, twc);
    const coneR = grinder.coneR(yc), wallR = yc > 1.05 ? lerp(3.9, 6.4, (yc - 1.05) / 4.15) : 3.0;
    const r = clamp(b.r0, coneR + 0.62, wallR - 0.62);
    const phi = b.phi + 0.33 * b.w * burrAngle(Math.min(t, t)) + 0.2 * twEff;
    p.set(Math.cos(phi) * r, yc, Math.sin(phi) * r);
    const d = p.distanceTo(camPos);
    const keep = lerp(2.2, 3.2, smooth(0.6, 1.0, t));
    if (d < keep) p.add(p.clone().sub(camPos).normalize().multiplyScalar(keep - d));
    const crushed = smooth(twc, twc + 0.12, tw);
    q.copy(b.q0).multiply(new THREE.Quaternion().setFromAxisAngle(b.ax, b.spin * tw));
    s.setScalar(b.s * (1 - crushed));
    m.compose(p, q, s); beansI.setMatrixAt(i, m);
    // fragments
    for (let k = 0; k < 6; k++) {
      const f = GRIND.frags[i * 6 + k];
      const age = tw - twc;
      let fs = 0;
      const fp = V3(Math.cos(phi) * r, b.crushY, Math.sin(phi) * r);
      if (age > 0) {
        fs = f.s * b.s * smooth(0, 0.06, age) * (1 - smooth(0.6, 1.0, age));
        const out = V3(Math.cos(phi), 0, Math.sin(phi));
        fp.addScaledVector(f.dir, f.sp * age).addScaledVector(out, 0.25 * age);
        const a2 = 0.5 * (burrAngle(t) - burrAngle(Math.max(0, t - age)));
        fp.applyAxisAngle(V3(0, 1, 0), -a2);
      }
      const fd = fp.distanceTo(camPos);
      if (fd < keep) fp.add(fp.clone().sub(camPos).normalize().multiplyScalar(keep - fd));
      q.setFromAxisAngle(f.ax, f.spin * Math.max(age, 0));
      m.compose(fp, q, s.setScalar(fs)); fragsI.setMatrixAt(i * 6 + k, m);
    }
  });
  beansI.instanceMatrix.needsUpdate = true; fragsI.instanceMatrix.needsUpdate = true;
  const pa = grindDust.geometry.attributes;
  grindDust.userData.seed.forEach(([ph, r, y, sz, k], i) => {
    const a = ph - 0.8 * th;
    pa.position.setXYZ(i, Math.cos(a) * r, y + 0.15 * Math.sin(th * 2 + k * 9), Math.sin(a) * r);
    pa.aSize.setX(i, sz * 0.9); pa.aAlpha.setX(i, 0.55 * smooth(0.0, 0.4, t + k * 0.3));
    pa.aColor.setXYZ(i, 0.09 + k * 0.08, 0.045 + k * 0.04, 0.02);
  });
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;

  L.key.position.set(1.5, 15, 5); L.key.target.position.set(1.5, 0, 0); L.key.intensity = 650; L.key.angle = 0.45;
  L.rim.position.set(-4.5, 2.2, -2.5); L.rim.intensity = 70;
  L.fill.position.set(4, 5, 6); L.fill.intensity = 30;
  L.back.position.set(2.6, -0.4, -2.4); L.back.intensity = 12;
  const cam = lookCam(camPos, camTgt, 0.25 * Math.sin(t * 1.1) + 0.5 * smooth(1.05, CUT_DOSE, t), lerp(42, 54, smooth(1.0, CUT_DOSE, t)));
  return shake(cam, t, 0.02 + 0.06 * smooth(0.9, CUT_DOSE, t));
}

/* ================================================================ shot 2 — dosing & tamp */
const BASKET_R = 2.82;
function preTampSurface(t) {
  const f = smoother(1.15, 2.25, t);
  return { base: lerp(-2.25, -1.0, f), peak: lerp(0.05, 1.55, Math.pow(f, 0.9)) };
}
function moundHeight(rho, ang, t) {
  const tampK = smooth(TAMP - 0.025, TAMP + 0.02, t);
  const s = preTampSurface(Math.min(t, TAMP - 0.025));
  const u = clamp(rho / BASKET_R);
  const pre = s.base + s.peak * Math.pow(1 - u * u, 1.25) + 0.06 * N3(Math.cos(ang) * rho * 2.2, Math.sin(ang) * rho * 2.2, 1.7) * (1 - u * 0.5);
  const post = -0.62 + 0.012 * N3(Math.cos(ang) * rho * 6, Math.sin(ang) * rho * 6, 3.3) + 0.05 * Math.pow(u, 12);
  return lerp(pre, post, tampK);
}
function updateMound(t) {
  const pos = OBJ.mound.geometry.attributes.position, base = OBJ.moundBase;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3] * BASKET_R, z = base[i * 3 + 2] * BASKET_R;
    const rho = Math.hypot(x, z), ang = Math.atan2(z, x);
    pos.setXYZ(i, x, moundHeight(rho, ang, t), z);
  }
  pos.needsUpdate = true;
  OBJ.mound.geometry.computeVertexNormals();
}
const DOSE_KEYS = [
  [0.0, [-7.6, 7.8, 13.2], [0.2, -0.2, 0.0]],
  [0.8, [-5.6, 6.0, 11.2], [0.3, -0.3, 0.0]],
  [CUT_EXTRACT - CUT_DOSE, [-4.8, 4.0, 10.4], [0.4, -0.6, 0.0]]
];
function shotDose(t) {
  const lt = t - CUT_DOSE;
  portafilter.position.set(0, 0, 0); portafilter.rotation.set(0, 0, 0);
  updateMound(t);
  // falling grounds (slow motion physics)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = V3(), s = V3();
  DOSE.parts.forEach((g, i) => {
    const age = t - g.ts;
    let sc = 0;
    if (age > 0) {
      const y = 10 - 13 * age - 9 * age * age;
      const spread = 0.22 * (1 + age * 1.6);
      p.set(0.25 + g.gx * spread, y, g.gz * spread);
      const rho = Math.hypot(p.x, p.z);
      const surf = rho < BASKET_R ? moundHeight(rho, Math.atan2(p.z, p.x), t) : -3;
      if (y > surf + 0.02 && t < TAMP) sc = g.s;
      q.setFromAxisAngle(g.ax, g.spin * age);
    }
    m.compose(p, q, s.setScalar(sc)); groundsI.setMatrixAt(i, m);
  });
  groundsI.instanceMatrix.needsUpdate = true;
  // tamper: drops in fast (real time) after the slow-mo pour
  const drop = smoother(2.08, TAMP - 0.02, t);
  const pre = preTampSurface(TAMP - 0.025);
  const contactY = pre.base + pre.peak;
  let ty = lerp(15, contactY, Math.pow(drop, 2.2));
  ty = lerp(ty, -0.62, smooth(TAMP - 0.025, TAMP + 0.02, t));
  ty += 0.05 * Math.sin((t - TAMP) * 40) * Math.exp(-Math.max(0, t - TAMP) * 18) * (t > TAMP ? 1 : 0);
  tamper.position.set(0, ty, 0);
  tamper.rotation.y = 0.6 * (1 - drop);
  // dust puff from the rim on impact
  const pa = puff.geometry.attributes;
  puff.userData.seed.forEach(([a, k, j], i) => {
    const age = t - TAMP;
    const r = BASKET_R + 0.1 + (age > 0 ? (1.4 + k * 2.2) * age : 0);
    pa.position.setXYZ(i, Math.cos(a) * r, 0.25 + (age > 0 ? (0.4 + j * 1.2) * age : 0), Math.sin(a) * r);
    pa.aSize.setX(i, 1.2 + k * 2.4); pa.aAlpha.setX(i, age > 0 ? 0.5 * Math.exp(-age * 4) : 0);
    pa.aColor.setXYZ(i, 0.35, 0.22, 0.12);
  });
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;

  L.key.position.set(-9, 18, 11); L.key.target.position.set(0, -0.5, 0); L.key.intensity = 1700; L.key.angle = 0.42;
  L.rim.position.set(7, 6, -8); L.rim.intensity = 380;
  L.fill.position.set(8, 3, 10); L.fill.intensity = 70;
  L.back.position.set(-3, 9, -6); L.back.intensity = 110;
  OBJ.backdrop.rotation.y = 0.3;
  const camPos = V3(...hermite(DOSE_KEYS, lt, k => k[1])), camTgt = V3(...hermite(DOSE_KEYS, lt, k => k[2]));
  const cam = lookCam(camPos, camTgt, -0.04, 30);
  const imp = t > TAMP ? 0.45 * Math.exp(-(t - TAMP) * 9) : 0;
  return shake(cam, t, 0.02 + imp, 26);
}

/* ================================================================ shot 3 — extraction */
const CUP_IN_MACHINE = V3(0, -15.36, 0);
const SPOUT_TIP = [V3(-0.62, -4.86, 0), V3(0.62, -4.86, 0)];
const level = t => lerp(0.95, 4.85, smoother(2.9, 4.6, t)); // cup-local liquid height
const flow = t => smooth(3.08, 3.32, t) * (1 - 0.65 * smooth(4.2, 4.48, t)) * (t < 4.5 ? 1 : 0);
const EXTRACT_KEYS = [
  [0.0, [3.1, -4.1, 8.6], [0.0, -4.55, 0.0]],
  [0.6, [3.5, -5.8, 10.2], [0.0, -6.3, 0.0]],
  [1.3, [2.7, -6.9, 13.2], [0.0, -9.7, 0.0]],
  [1.72, [1.3, -6.7, 9.2], [0.0, -10.3, 0.0]],
  [CUT_CUP - CUT_EXTRACT, [0.35, -7.4, 4.3], [0.0, -11.0, 0.0]]
];
// drips at the spout tips: [spout, start time]
const DRIPS = [[0, 2.7], [1, 2.84], [0, 2.95], [1, 3.03], [0, 4.5], [1, 4.53], [0, 4.6], [1, 4.66]];
function updateCrema(t, impacts) {
  const L0 = level(t), rIn = interp(CUP_INNER.map(([r, y]) => [r, y]), L0) - 0.02;
  cup.crema.position.y = L0;
  cup.crema.scale.set(rIn, 1, rIn);
  const pos = cup.crema.geometry.attributes.position, base = cup.base;
  for (let i = 0; i < pos.count; i++) {
    const ux = base[i * 3], uz = base[i * 3 + 2];
    const x = ux * rIn, z = uz * rIn;
    let h = 0;
    for (const im of impacts) {
      const age = t - im.t;
      if (age < 0) continue;
      const d = Math.hypot(x - im.x, z - im.z);
      if (im.steady) { h += -im.a * Math.exp(-d * d * 18) + 0.012 * im.a * 12 * Math.sin(d * 14 - t * 30) * Math.exp(-d * 1.5); continue; }
      const front = 4.2 * age;
      h += im.a * Math.exp(-age * 2.2) * Math.sin((d - front) * 12) * Math.exp(-Math.pow((d - front) / 0.7, 2));
      h += -im.a * 1.6 * Math.exp(-d * d * 30) * Math.exp(-age * 9);
    }
    const rr = Math.hypot(ux, uz);
    h += 0.04 * Math.pow(rr, 8); // meniscus
    pos.setY(i, h);
  }
  pos.needsUpdate = true;
  cup.crema.geometry.computeVertexNormals();
  TEX.crema.rotation = -0.35 * t;
}
function placeDrops(t, list) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let i = 0; i < dripsI.count; i++) {
    const d = list[i];
    if (!d) { m.compose(V3(0, -999, 0), q, V3(0, 0, 0)); dripsI.setMatrixAt(i, m); continue; }
    m.compose(d.p, q.setFromUnitVectors(V3(0, 1, 0), d.dir || V3(0, 1, 0)), V3(d.r, d.r * (d.stretch || 1), d.r));
    dripsI.setMatrixAt(i, m);
  }
  dripsI.instanceMatrix.needsUpdate = true;
}
function shotExtract(t) {
  const lt = t - CUT_EXTRACT;
  portafilter.position.set(0, 0, 0); portafilter.rotation.set(0, 0.35, 0);
  cup.group.position.copy(CUP_IN_MACHINE); cup.group.rotation.set(0, 0.9, 0);
  cup.decalU.uReveal.value = 0;
  const surfY = CUP_IN_MACHINE.y + level(t);
  const fl = flow(t);
  streams.forEach((m, i) => {
    if (fl <= 0.002) { m.visible = false; return; }
    m.visible = true;
    const pts = [], radii = [], tip = SPOUT_TIP[i], N = 26;
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1);
      const y = lerp(tip.y, surfY + 0.02, s);
      const x = lerp(tip.x, Math.sign(tip.x) * 0.14, Math.pow(s, 0.65)) + 0.035 * N3(i * 7, y * 0.8, t * 2.2) * s;
      const z = 0.035 * N3(i * 7 + 3, y * 0.8, t * 2.0) * s;
      pts.push(V3(x, y, z));
      radii.push(0.105 * fl * (1 - 0.42 * Math.pow(s, 0.7)) * (1 + 0.08 * Math.sin(y * 9 + t * 25)));
    }
    m.geometry.dispose();
    m.geometry = taperTube(pts, radii, 14);
  });
  TEX.stripe.offset.x = -t * 1.6;
  // drips
  const list = [];
  for (const [si, t0] of DRIPS) {
    const age = t - t0; if (age < 0 || age > 0.9) continue;
    const tip = SPOUT_TIP[si];
    const form = 0.16, g = 70;
    if (age < form) { const r = 0.13 * smooth(0, form, age); list.push({ p: V3(tip.x, tip.y - r * 0.9, 0), r, stretch: 1.25 }); continue; }
    const fa = age - form, y = tip.y - 0.12 - 0.5 * g * fa * fa - 1.2 * fa;
    if (y < surfY) continue;
    list.push({ p: V3(tip.x * (1 - 0.3 * fa), y, 0), r: 0.11, stretch: 1.0 + Math.min(0.9, fa * 6), dir: V3(0, 1, 0) });
  }
  placeDrops(t, list);
  const impacts = [
    { t: 2.7 + 0.16 + 0.35, x: -0.4, z: 0.1, a: 0.06 }, { t: 2.84 + 0.16 + 0.35, x: 0.4, z: -0.1, a: 0.06 },
    ...(fl > 0 ? [{ t: 3.1, x: -0.14, z: 0, a: 0.05 * fl, steady: true }, { t: 3.1, x: 0.14, z: 0, a: 0.05 * fl, steady: true }] : [])
  ];
  updateCrema(t, impacts.map(im => ({ ...im, x: im.x, z: im.z })));

  L.key.position.set(-10, 6, 12); L.key.target.position.set(0, -8, 0); L.key.intensity = 1100; L.key.angle = 0.5;
  L.rim.position.set(5, -6, -6); L.rim.intensity = 260;
  L.fill.position.set(8, -10, 10); L.fill.intensity = 70;
  L.back.position.set(-1.0, -7.0, -6.5); L.back.intensity = 110; // backlights the stream so it glows amber
  OBJ.backdrop.rotation.y = 1.1;
  const camPos = V3(...hermite(EXTRACT_KEYS, lt, k => k[1])), camTgt = V3(...hermite(EXTRACT_KEYS, lt, k => k[2]));
  const fov = lerp(26, 40, smooth(1.72, CUT_CUP - CUT_EXTRACT, lt));
  return shake(lookCam(camPos, camTgt, 0.03 * Math.sin(lt * 1.5), fov), t, 0.012, 14);
}

/* ================================================================ shot 4/5 — crema, crane, logo */
const CUP_ON_TABLE = V3(0, 1.21, 0);
const CREMA_Y = 1.21 + 4.85;
const CROWNS = [{ t: CUT_CUP + 0.06, x: 0.45, z: 0.25 }, { t: CUT_CUP + 0.42, x: -0.75, z: -0.45 }];
function shotCup(t) {
  const lt = t - CUT_CUP;
  cup.group.position.copy(CUP_ON_TABLE); cup.group.rotation.set(0, 0, 0);
  // crema: last drops land in slow motion
  const impacts = CROWNS.map(c => ({ t: c.t, x: c.x, z: c.z, a: 0.07 }));
  updateCrema(t, impacts);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion();
  let k = 0;
  CROWNS.forEach((c, ci) => {
    const age = (t - c.t) * 0.7;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + ci, sp = 3.2 + ((i * 7) % 5) * 0.4, vy = 7.5 + ((i * 3) % 4);
      let s = 0; const p = V3(0, -999, 0);
      if (age > 0) {
        const y = CREMA_Y + vy * age - 0.5 * 52 * age * age;
        if (y > CREMA_Y - 0.05) { s = 0.034 * (1 - smooth(0.25, 0.4, age)) + 0.012; p.set(c.x + Math.cos(a) * sp * age * 0.32 + 0.0, y, c.z + Math.sin(a) * sp * age * 0.32); }
      }
      m.compose(p, q, V3(s, s * 1.3, s)); crownI.setMatrixAt(k++, m);
    }
    // central jet rising after the crown
    const ja = age - 0.12; let js = 0; const jp = V3(0, -999, 0);
    if (ja > 0) { const y = CREMA_Y + 9 * ja - 26 * ja * ja; if (y > CREMA_Y) { js = 0.07; jp.set(c.x, y, c.z); } }
    m.compose(jp, q, V3(js, js * 2.2, js)); crownI.setMatrixAt(k++, m);
  });
  for (; k < crownI.count; k++) { m.compose(V3(0, -999, 0), q, V3(0, 0, 0)); crownI.setMatrixAt(k, m); }
  crownI.instanceMatrix.needsUpdate = true;
  placeDrops(t, []);

  // logo prints itself onto the cup
  const rv = smooth(REVEAL[0], REVEAL[1], t);
  cup.decalU.uReveal.value = rv; cup.decalU.uTime.value = t;
  // gold dust converging on the decal
  const pa = sparks.geometry.attributes;
  sparks.userData.seed.forEach((s, i) => {
    const arrive = REVEAL[0] - 0.05 + s.rho * (REVEAL[1] - REVEAL[0]) * 0.85;
    const start = arrive - s.dur;
    const u = clamp((t - start) / s.dur);
    const yT = LOGO_Y + s.v * LOGO_D, rT = interp(CUP_OUTER, yT) + 0.05, aT = (s.u * LOGO_D) / rT;
    const target = V3(rT * Math.sin(aT), yT, rT * Math.cos(aT)).add(CUP_ON_TABLE);
    const e = 1 - Math.pow(1 - u, 2.4);
    const ang = s.phi + (1 - e) * 2.4;
    const startP = V3(Math.cos(ang) * s.r0, s.y0, Math.sin(ang) * s.r0 + 2.5);
    const p = startP.lerp(target, e);
    pa.position.setXYZ(i, p.x, p.y, p.z);
    const life = t < start ? 0 : (t < arrive ? smooth(0, 0.15, u) : Math.exp(-(t - arrive) * 7));
    pa.aSize.setX(i, s.size * (0.7 + 0.3 * Math.sin(t * 25 + s.tw)) * 0.5);
    pa.aAlpha.setX(i, life * 0.9);
    pa.aColor.setXYZ(i, 2.4, 1.5, 0.55);
  });
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aColor.needsUpdate = true;

  // steam off the crema
  steam.forEach(sp => {
    const d = sp.userData, life = 3.2 / d.sp, age = ((t / life + d.ph) % 1);
    sp.position.set(d.x + N3(d.seed, t * 0.3, 0) * 0.8 * age, CREMA_Y + 0.3 + age * 9.5, d.z + N3(d.seed + 5, t * 0.3, 1) * 0.6 * age);
    const sc = d.size * (0.5 + age * 1.4); sp.scale.set(sc, sc, 1);
    sp.material.rotation = d.rot * t + d.seed;
    sp.material.opacity = 0.026 * Math.sin(Math.PI * age) * lerp(0.15, 1, smooth(5.5, 6.4, t));
  });

  // camera: top-down on the crema, crane up and around to the hero angle
  const k1 = smoother(5.25, 6.3, t);
  const tgt = V3(0, lerp(CREMA_Y, 1.7, k1), 0);
  const d = Math.exp(lerp(Math.log(lerp(17, 15, smooth(CUT_CUP, 5.25, t))), Math.log(41), k1)) - 1.8 * smooth(6.3, DUR, t);
  const el = lerp(Math.PI / 2 - 0.004, 0.2, k1) - 0.035 * smooth(6.3, DUR, t);
  const az = lerp(0.9 - 0.45 * smooth(CUT_CUP, 5.3, t), 0.0, k1) - 0.05 * smooth(6.3, DUR, t);
  const fov = lerp(36, 26, k1);

  // light sweep glint across the porcelain
  const gs = smooth(7.0, 7.7, t);
  L.glint.position.set(lerp(-12, 12, gs), 6.5, 9); L.glint.intensity = 500 * Math.sin(Math.PI * gs);
  L.key.position.set(lerp(-5, -16, k1), lerp(40, 26, k1), lerp(6, 20, k1)); L.key.target.position.set(0, lerp(5, 2, k1), 0); L.key.intensity = lerp(1750, 2300, k1); L.key.angle = 0.42;
  L.rim.position.set(9, 13, -14); L.rim.intensity = 700;
  L.fill.position.set(17, 6, 18); L.fill.intensity = 120;
  L.back.position.set(-7, 9, -12); L.back.intensity = 320;
  OBJ.backdrop.rotation.y = 0;
  return orbitCam(tgt, d, el, az, lt < 0.6 ? 0.15 * lt : 0.09, fov);
}

/* ================================================================ per-frame */
function shotOf(t) { return t < CUT_DOSE ? 'grind' : t < CUT_EXTRACT ? 'dose' : t < CUT_CUP ? 'extract' : 'cup'; }
function update(t) {
  const shot = shotOf(t);
  SET.grind.visible = shot === 'grind';
  SET.dose.visible = shot === 'dose';
  SET.machine.visible = shot === 'extract';
  SET.table.visible = shot === 'cup';
  portafilter.visible = shot === 'dose' || shot === 'extract';
  cup.group.visible = shot === 'extract' || shot === 'cup';
  crownI.visible = shot === 'cup';
  dripsI.visible = shot === 'extract';
  sparks.visible = shot === 'cup';
  steam.forEach(s => (s.visible = shot === 'cup'));
  L.glint.intensity = 0;
  const cam = shot === 'grind' ? shotGrind(t) : shot === 'dose' ? shotDose(t) : shot === 'extract' ? shotExtract(t) : shotCup(t);
  camera.position.copy(cam.pos); camera.quaternion.copy(cam.quat);
  camera.fov = cam.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  scene.fog.density = shot === 'cup' ? 0.012 : shot === 'grind' ? 0.02 : 0.008;
  renderer.toneMappingExposure = shot === 'grind' ? 1.05 : 1.0;
  bloom.strength = 0.32 + 0.25 * Math.exp(-Math.pow((t - TAMP) / 0.06, 2)) + 0.25 * smooth(REVEAL[0], REVEAL[0] + 0.3, t) * (1 - smooth(REVEAL[1], REVEAL[1] + 0.6, t));

  // overlay: phase labels, tagline, transitions, glint flare
  const lab = (m, a, b, y) => {
    const o = smooth(a, a + 0.25, t) * (1 - smooth(b - 0.2, b, t));
    m.material.opacity = o; m.position.set(0, y + 18 * SCALE * (1 - smooth(a, a + 0.35, t)), 0);
    m.scale.set(1 + 0.05 * (1 - smooth(a, a + 0.5, t)), 1, 1);
  };
  lab(LABELS.grind, 0.18, 2.4, -H / 2 + 300 * SCALE);
  lab(LABELS.extract, 2.85, 4.5, -H / 2 + 300 * SCALE);
  lab(LABELS.tag, 7.05, 99, -H / 2 + 250 * SCALE);
  lowerShade.material.opacity = smooth(6.6, 7.2, t);
  let flash = 0, col = 0xffffff;
  if (Math.abs(t - CUT_DOSE) < 0.06) { flash = 0.85 * (1 - Math.abs(t - CUT_DOSE) / 0.06); col = 0x0a0503; }
  if (t >= CUT_EXTRACT && t < CUT_EXTRACT + 0.12) { flash = 0.55 * (1 - (t - CUT_EXTRACT) / 0.12); col = 0xffe2b8; }
  if (Math.abs(t - CUT_CUP) < 0.07) { flash = 1.0 * (1 - Math.abs(t - CUT_CUP) / 0.07); col = 0x050302; }
  if (t < 0.12) { flash = 1 - t / 0.12; col = 0x000000; }
  flashQuad.material.opacity = flash; flashQuad.material.color.set(col);
  const gl = L.glint.intensity / 500;
  if (gl > 0.01) {
    const v = L.glint.position.clone().project(camera);
    glintStreak.position.set(v.x * W / 2, v.y * H / 2, 0); glintStreak.scale.set(W * 1.8, 60 * SCALE, 1);
    glintGlow.position.copy(glintStreak.position); glintGlow.scale.set(300 * SCALE, 300 * SCALE, 1);
  }
  glintStreak.material.uniforms.uI.value = 0.35 * gl; glintGlow.material.uniforms.uI.value = 0.3 * gl;
  glintStreak.visible = glintGlow.visible = gl > 0.01;
}

function renderFrame(i) {
  update(i / FPS);
  renderer.autoClear = true;
  composer.render();
  renderer.autoClear = false;
  renderer.setRenderTarget(null);
  renderer.render(overlay, overlayCam);
  renderer.autoClear = true;
}
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
  async post(i, url) { renderFrame(i); const r = await fetch(url, { method: 'POST', body: readPixels() }); return r.status; }
};
