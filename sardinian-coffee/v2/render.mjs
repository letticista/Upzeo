// Sardinian Coffee Corner v2 — Three.js (headless Chromium, SwiftShader) -> raw frames -> FFmpeg grade + procedural audio -> MP4
// Usage:
//   node v2/render.mjs [--gpu]                   full render -> sardinian_coffee_reveal_v2.mp4 (--gpu: use the real graphics card)
//   node v2/render.mjs --preview 0,120,300 0.5   stills into v2/preview
//   node v2/render.mjs --range=0-110             re-render only those frames, keeping the others
//   node v2/render.mjs --encode-only             re-grade/re-encode existing frames
//   node v2/render.mjs --audio-test              writes v2/preview/audio_test.wav
//   --workers=N                                  parallel browsers (default 2 on CPU, 1 with --gpu)
//   --chrome                                     like --gpu, but uses the installed Google Chrome instead of Playwright's Chromium
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE); // serves node_modules, assets and v2/
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'))); }

const args = process.argv.slice(2);
const has = f => args.includes(f);
const after = f => { const i = args.indexOf(f); return i >= 0 ? args.slice(i + 1).filter(a => !a.startsWith('--')) : []; };
const rangeArg = args.find(a => a.startsWith('--range='));
const FRAMES_DIR = path.join(HERE, '.frames');
const PREVIEW_DIR = path.join(HERE, 'preview');
const OUT = path.join(ROOT, 'sardinian_coffee_reveal_v2.mp4');
// --gpu: use the machine's real graphics card (opens a browser window). Default: SwiftShader software GL (headless).
const GPU = args.includes('--gpu') || args.includes('--chrome');
const workersArg = args.find(a => a.startsWith('--workers='));
const WORKERS = parseInt(workersArg ? workersArg.split('=')[1] : (process.env.WORKERS || (GPU ? '1' : '2')), 10);
const DUR = 8, FPS = 60, TOTAL = DUR * FPS;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && url.startsWith('/frame/')) {
      const out = fs.createWriteStream(path.join(FRAMES_DIR, `${url.slice(7)}.rgba`));
      req.pipe(out);
      out.on('finish', () => { res.writeHead(200); res.end('ok'); });
      return;
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
// --chrome: drive the Google Chrome already installed on the machine (no Playwright browser download needed)
const CHROME = has('--chrome');
const launch = () => (GPU || CHROME)
  ? chromium.launch({ headless: false, ...(CHROME ? { channel: 'chrome' } : {}), args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
  : chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const RENDERER_INFO = () => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'nessun WebGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER); };
async function openPage(browser, port, scale, tag = '') {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.setDefaultTimeout(0);
  let fail;
  const failed = new Promise((_, rej) => (fail = rej));
  page.on('pageerror', e => { console.error('[page]', e.message); fail(new Error(`the page failed to start: ${e.message}`)); });
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[console]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/v2/index.html?scale=${scale}`);
  const gpu = await page.evaluate(RENDERER_INFO);
  console.log(`${tag}scheda grafica: ${gpu}`);
  if (GPU && /swiftshader|llvmpipe|software/i.test(gpu)) console.log(`${tag}ATTENZIONE: Chromium non sta usando la GPU, il render sarà lento`);
  console.log(`${tag}preparo scena e texture…`);
  await Promise.race([failed, (async () => {
    await page.waitForFunction(() => window.RENDER, null, { timeout: 180000 });
    await page.evaluate(() => window.RENDER.ready);
  })()]);
  console.log(`${tag}pronto in ${((Date.now() - t0) / 1000).toFixed(1)}s, inizio i fotogrammi`);
  return page;
}

async function runPreview(server) {
  const [list, sc] = after('--preview');
  const frames = (list || '30,100,160,230,300,330,380,450,479').split(',').map(Number);
  const scale = parseFloat(sc || '0.5');
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const browser = await launch();
  const t0 = Date.now();
  const page = await openPage(browser, server.address().port, scale);
  for (const f of frames) {
    const t1 = Date.now();
    const data = await page.evaluate(async i => { await window.RENDER.frame(i); return document.getElementById('c').toDataURL('image/png'); }, f);
    fs.writeFileSync(path.join(PREVIEW_DIR, `p_${String(f).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`frame ${f} ${(Date.now() - t1) / 1000}s`);
  }
  await browser.close();
}

async function renderAll(server, first = 0, last = TOTAL - 1) {
  // a partial --range re-render keeps the frames already on disk
  if (!rangeArg) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const port = server.address().port;
  let next = first, done = 0;
  const count = last - first + 1;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    await new Promise(r => setTimeout(r, w * 20000)); // stagger start-up
    const tag = WORKERS > 1 ? `[worker ${w + 1}] ` : '';
    console.log(`${tag}avvio Chromium${GPU ? ' sulla GPU (si apre una finestra, lasciala aperta)' : ' (software)'}…`);
    const browser = await launch();
    const page = await openPage(browser, port, 1, tag);
    while (next <= last) {
      const f = next++;
      const status = await page.evaluate(([i, url]) => window.RENDER.post(i, url), [f, `/frame/${String(f).padStart(4, '0')}`]);
      if (status !== 200) throw new Error(`frame ${f} upload failed`);
      done++;
      if (done % 5 === 0 || done === count) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${count} frames · ${el.toFixed(0)}s elapsed · ~${(el / done * (count - done)).toFixed(0)}s left`);
      }
    }
    await browser.close();
  }));
  console.log(`render done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/* ---------------------------------------------------------------- soundtrack
   Everything is synthesised with FFmpeg sources and filters, cut to the edit:
   grinder motor + crunch, pour hiss, tamp thud, pump hum + trickle, drips,
   whooshes on the cuts, a launeddas-style reed drone and melody, chimes on the logo. */
const CUT_DOSE = 1.35, TAMP = 2.42, CUT_EXTRACT = 2.62, CUT_CUP = 4.7, REVEAL = 6.2, TAG = 7.05;
const reed = f => `(sin(2*PI*${f}*t)+0.35*sin(4*PI*${f}*t)+0.6*sin(6*PI*${f}*t)+0.2*sin(8*PI*${f}*t)+0.32*sin(10*PI*${f}*t)+0.12*sin(12*PI*${f}*t)+0.18*sin(14*PI*${f}*t))`;
function launeddasMelody() {
  const N = { A4: 440, B4: 493.88, C5s: 554.37, D5: 587.33, E5: 659.26, F5s: 739.99 };
  const seq = ['E5', 'C5s', 'D5', 'E5', 'F5s', 'E5', 'D5', 'C5s', 'E5', 'C5s', 'D5', 'E5', 'C5s', 'B4', 'A4', 'C5s', 'E5', 'F5s', 'E5', 'D5', 'C5s', 'B4'];
  const start = 4.95, step = 0.105;
  const terms = seq.map((n, i) => {
    const s = (start + i * step).toFixed(3), e = (start + i * step + step * 0.93).toFixed(3);
    return `if(between(t,${s},${e}),min(1,(t-${s})*220)*min(1,(${e}-t)*140)*${reed(N[n])},0)`;
  });
  const ls = (start + seq.length * step).toFixed(3);
  terms.push(`if(between(t,${ls},7.98),min(1,(t-${ls})*60)*min(1,(7.98-t)*6)*(${reed(440)}+0.7*${reed(659.26)}),0)`);
  return terms.join('+');
}
function audioGraph() {
  const T = DUR;
  return [
    // grinder motor with the speed ramp into the cut
    `aevalsrc='0.11*between(t,0,${CUT_DOSE})*min(1,t*20)*(sin(2*PI*(115*t+308*pow(max(t-0.82,0),3)))+0.5*sin(4*PI*(115*t+308*pow(max(t-0.82,0),3)))+0.33*sin(6*PI*(115*t+308*pow(max(t-0.82,0),3)))+0.25*sin(8*PI*(115*t+308*pow(max(t-0.82,0),3))))':s=48000:d=${T},lowpass=f=2600[motor]`,
    // beans cracking in the burrs
    `aevalsrc='between(t,0.05,${CUT_DOSE})*if(lt(random(0),0.006+0.02*max(t-0.82,0)),(random(1)-0.5)*2.2,0)':s=48000:d=${T},bandpass=f=2600:width_type=o:w=2,volume=0.9[crunch]`,
    // whooshes on the cuts and the crane
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.6:seed=4,bandpass=f=1400:width_type=o:w=2.2,` +
      `volume='0.9*exp(-pow((t-${CUT_DOSE - 0.04})/0.11,2))+0.5*exp(-pow((t-${CUT_CUP - 0.05})/0.13,2))+0.35*exp(-pow((t-5.75)/0.4,2))+0.4*exp(-pow((t-2.3)/0.08,2))':eval=frame,aphaser=type=t:speed=1.6:decay=0.45[whoosh]`,
    // grounds pouring
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.5:seed=6,highpass=f=2800,lowpass=f=9000,volume='0.32*between(t,${CUT_DOSE},2.3)*min(1,(t-${CUT_DOSE})*8)*min(1,(2.3-t)*6)*(0.7+0.3*sin(2*PI*23*t))':eval=frame[pour]`,
    // tamp: thud + click
    `aevalsrc='if(gte(t,${TAMP}),0.9*sin(2*PI*(62*(t-${TAMP})+40*(1-exp(-30*(t-${TAMP})))/30))*exp(-7*(t-${TAMP})),0)':s=48000:d=${T}[thud]`,
    `anoisesrc=d=${T}:c=white:r=48000:a=1:seed=8,bandpass=f=3200:width_type=o:w=1.5,volume='if(gte(t,${TAMP}),0.8*exp(-60*(t-${TAMP})),0)':eval=frame[click]`,
    // vibration pump hum + espresso trickle
    `aevalsrc='0.07*between(t,${CUT_EXTRACT},${CUT_CUP})*min(1,(t-${CUT_EXTRACT})*10)*min(1,(${CUT_CUP}-t)*10)*(sin(2*PI*50*t)+0.6*sin(2*PI*100*t)+0.35*sin(2*PI*150*t))':s=48000:d=${T},lowpass=f=500[pump]`,
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.7:seed=9,bandpass=f=850:width_type=o:w=1.4,volume='0.5*between(t,3.08,4.55)*min(1,(t-3.08)*5)*min(1,(4.55-t)*4)*(0.55+0.45*sin(2*PI*6.3*t)*sin(2*PI*2.7*t))':eval=frame,tremolo=f=13:d=0.35[trickle]`,
    // drips into the crema
    `aevalsrc='${[3.21, 3.35, CUT_CUP + 0.06, CUT_CUP + 0.42].map(t0 => `if(gte(t,${t0}),0.38*sin(2*PI*(820*(t-${t0})-3400*pow(t-${t0},2)))*exp(-38*(t-${t0})),0)`).join('+')}':s=48000:d=${T}[drips]`,
    // launeddas: tumbu drone (A) building through the edit, mancosa melody from the crema shot
    `aevalsrc='(0.035+0.07*min(1,t/${CUT_CUP})+0.04*between(t,${REVEAL},8))*min(1,(8-t)*4)*(${reed(110)}+0.8*${reed(110.35)}+0.45*${reed(220)})':s=48000:d=${T},lowpass=f=1800,equalizer=f=700:width_type=o:w=1.2:g=4[drone]`,
    `aevalsrc='0.085*(${launeddasMelody()})':s=48000:d=${T},highpass=f=250,equalizer=f=1250:width_type=o:w=1:g=5,lowpass=f=6500,aecho=0.6:0.35:90:0.25[melody]`,
    // chimes as the logo prints, warm hit on the tagline
    `aevalsrc='${[[REVEAL, 880], [REVEAL + 0.18, 1318.51], [REVEAL + 0.4, 1760], [REVEAL + 0.68, 2217.46], [TAG, 1318.51]].map(([t0, f]) => `if(gte(t,${t0}),0.12*(sin(2*PI*${f}*(t-${t0}))+0.4*sin(2*PI*${f * 2.76}*(t-${t0})))*exp(-2.6*(t-${t0})),0)`).join('+')}':s=48000:d=${T},aecho=0.7:0.5:120|240:0.3|0.2[chime]`,
    `aevalsrc='if(gte(t,${TAG}),0.75*(sin(2*PI*44*(t-${TAG}))+0.4*sin(2*PI*88*(t-${TAG})))*exp(-1.3*(t-${TAG}))*min(1,(t-${TAG})*40),0)':s=48000:d=${T}[hit]`,
    `[motor][crunch][whoosh][pour][thud][click][pump][trickle][drips][drone][melody][chime][hit]amix=inputs=13:normalize=0,` +
      `highpass=f=28,acompressor=threshold=0.3:ratio=2.5:attack=4:release=140,` +
      `afade=t=in:st=0:d=0.05,afade=t=out:st=7.7:d=0.3,alimiter=limit=0.9,aformat=channel_layouts=stereo[aout]`
  ].join(';');
}

function testAudio() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', audioGraph(), '-map', '[aout]', '-c:a', 'pcm_s16le', path.join(PREVIEW_DIR, 'audio_test.wav')], { stdio: 'inherit' });
  return new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('audio graph failed')))));
}

function encode() {
  const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.rgba')).sort();
  if (files.length !== TOTAL) throw new Error(`expected ${TOTAL} frames, found ${files.length}`);
  const video = [
    '[0:v]vflip,format=rgb24',
    "curves=r='0/0 0.25/0.245 0.5/0.53 0.75/0.79 1/1':g='0/0 0.25/0.235 0.5/0.5 0.75/0.76 1/0.98':b='0/0.012 0.25/0.21 0.5/0.45 0.75/0.7 1/0.93'",
    'unsharp=5:5:0.6:5:5:0.0',
    'tmix=frames=3:weights=1 4 1',
    'vignette=angle=PI/5:mode=forward',
    'noise=c0s=4:c0f=t',
    'format=yuv420p[vout]'
  ].join(',');
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1080x1920', '-r', String(FPS), '-i', '-',
    '-filter_complex', `${video};${audioGraph()}`,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-r', String(FPS), '-g', '120', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-t', String(DUR), OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  return new Promise((resolve, reject) => {
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    (async () => {
      for (const f of files) {
        if (!ff.stdin.write(fs.readFileSync(path.join(FRAMES_DIR, f)))) await new Promise(r => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
    })();
  });
}

if (has('--audio-test')) { await testAudio(); console.log('wrote', path.join(PREVIEW_DIR, 'audio_test.wav')); process.exit(0); }
const server = await serve();
try {
  if (has('--preview')) await runPreview(server);
  else if (rangeArg) {
    const [a, b] = rangeArg.split('=')[1].split('-').map(Number);
    await renderAll(server, a, b);
  } else {
    if (!has('--encode-only')) await renderAll(server);
    console.log('encoding with ffmpeg…');
    await encode();
    console.log('wrote', OUT);
    if (!has('--keep-frames')) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
} finally {
  server.close();
}
