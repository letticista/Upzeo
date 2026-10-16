// Sardinian Coffee Corner v3 — Instagram outro (11 s, 1080x1920, 60 fps)
// Three.js in Chrome/Chromium -> frames streamed straight into FFmpeg (grade + procedural soundtrack) -> MP4
//
//   node v3/render.mjs --chrome                    final render with the installed Google Chrome (GPU)
//   node v3/render.mjs --gpu                       final render with Playwright's Chromium (GPU)
//   node v3/render.mjs --chrome --preview 0,300,600 0.5   a few stills into v3/preview
//   node v3/render.mjs --audio-test                writes v3/preview/audio_test.wav
// Quality: --mb=N (motion-blur sub-frames, default 4 on GPU), --no-dof, --no-ao, --shadow=4096, --taps=64, --msaa=4
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE); // serves node_modules, assets and v3/
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'))); }

const args = process.argv.slice(2);
const has = f => args.includes(f);
const opt = (name, def) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; };
const after = f => { const i = args.indexOf(f); return i >= 0 ? args.slice(i + 1).filter(a => !a.startsWith('--')) : []; };
const PREVIEW_DIR = path.join(HERE, 'preview');
const OUT = path.join(ROOT, 'sardinian_coffee_outro_v3.mp4');
const CHROME = has('--chrome');
const GPU = has('--gpu') || CHROME;
const DUR = 11, FPS = 60, TOTAL = DUR * FPS;
const Q = {
  mb: parseInt(opt('mb', GPU && !has('--preview') ? '4' : '1'), 10),
  dof: has('--no-dof') ? 0 : 1,
  ao: has('--no-ao') ? 0 : 1,
  msaa: parseInt(opt('msaa', '4'), 10),
  shadow: parseInt(opt('shadow', GPU ? '4096' : '2048'), 10),
  taps: parseInt(opt('taps', GPU ? '64' : '32'), 10)
};
const WORKERS = parseInt(opt('workers', GPU ? '1' : '2'), 10);

/* ---------------------------------------------------------------- local server */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream', '.json': 'application/json' };
let onFrame = null;
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && url.startsWith('/frame/')) {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try { await onFrame(parseInt(url.slice(7), 10), Buffer.concat(chunks)); res.writeHead(200); res.end('ok'); }
        catch (e) { console.error(e); res.writeHead(500); res.end(); }
      });
      return;
    }
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ---------------------------------------------------------------- browser */
const launch = () => GPU
  ? chromium.launch({ headless: false, ...(CHROME ? { channel: 'chrome' } : {}), args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader', '--disable-gpu-vsync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] })
  : chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const RENDERER_INFO = () => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'nessun WebGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : g.RENDERER); };
async function openPage(browser, port, scale, q, tag = '') {
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.setDefaultTimeout(0);
  let fail;
  const failed = new Promise((_, rej) => (fail = rej));
  page.on('pageerror', e => { console.error('[page]', e.message); fail(new Error(`the page failed to start: ${e.message}`)); });
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  const qs = `scale=${scale}&mb=${q.mb}&dof=${q.dof}&ao=${q.ao}&msaa=${q.msaa}&shadow=${q.shadow}&taps=${q.taps}`;
  await page.goto(`http://127.0.0.1:${port}/v3/index.html?${qs}`);
  const gpu = await page.evaluate(RENDERER_INFO);
  console.log(`${tag}scheda grafica: ${gpu}`);
  if (GPU && /swiftshader|llvmpipe|software/i.test(gpu)) console.log(`${tag}ATTENZIONE: il browser non sta usando la GPU, il render sarà lento`);
  console.log(`${tag}preparo scena, HDRI e texture… (motion blur ${q.mb}×, DOF ${q.dof ? 'sì' : 'no'}, AO ${q.ao ? 'sì' : 'no'})`);
  await Promise.race([failed, (async () => {
    await page.waitForFunction(() => window.RENDER, null, { timeout: 180000 });
    await page.evaluate(() => window.RENDER.ready);
  })()]);
  console.log(`${tag}pronto in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return page;
}

async function runPreview(server) {
  const [list, sc] = after('--preview');
  const frames = (list || '30,100,180,300,400,500,560,640').split(',').map(Number);
  const scale = parseFloat(sc || '0.5');
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const browser = await launch();
  const page = await openPage(browser, server.address().port, scale, Q);
  for (const f of frames) {
    const t1 = Date.now();
    const data = await page.evaluate(async i => { await window.RENDER.frame(i); return document.getElementById('c').toDataURL('image/png'); }, f);
    fs.writeFileSync(path.join(PREVIEW_DIR, `p_${String(f).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`fotogramma ${f} in ${((Date.now() - t1) / 1000).toFixed(2)}s`);
  }
  await browser.close();
  console.log(`anteprime in ${PREVIEW_DIR}`);
}

/* ---------------------------------------------------------------- soundtrack (FFmpeg sources + filters only)
   Edit points: beans 0, burrs 1.2, dosing 2.25, tamp 3.62, extraction 3.95, cup 6.45, crane 7.15-8.25, logo 8.3, tagline 9.3 */
const reed = f => `(sin(2*PI*${f}*t)+0.35*sin(4*PI*${f}*t)+0.6*sin(6*PI*${f}*t)+0.2*sin(8*PI*${f}*t)+0.32*sin(10*PI*${f}*t)+0.12*sin(12*PI*${f}*t)+0.18*sin(14*PI*${f}*t))`;
function launeddasMelody() { // mancosa line over the tumbu drone, in A
  const N = { A4: 440, B4: 493.88, C5s: 554.37, D5: 587.33, E5: 659.26, F5s: 739.99 };
  const seq = ['E5', 'C5s', 'D5', 'E5', 'F5s', 'E5', 'D5', 'C5s', 'E5', 'C5s', 'D5', 'E5', 'C5s', 'B4', 'A4', 'C5s', 'E5', 'F5s', 'E5', 'D5', 'C5s', 'B4', 'C5s', 'D5', 'E5', 'D5', 'C5s', 'B4', 'A4', 'B4'];
  const start = 6.55, step = 0.105;
  const terms = seq.map((n, i) => {
    const s = (start + i * step).toFixed(3), e = (start + i * step + step * 0.93).toFixed(3);
    return `if(between(t,${s},${e}),min(1,(t-${s})*220)*min(1,(${e}-t)*140)*${reed(N[n])},0)`;
  });
  const ls = (start + seq.length * step).toFixed(3);
  terms.push(`if(between(t,${ls},10.98),min(1,(t-${ls})*60)*min(1,(10.98-t)*3)*(${reed(440)}+0.7*${reed(659.26)}),0)`);
  return terms.join('+');
}
function audioGraph() {
  const T = DUR, BURRS = 1.2, DOSE = 2.25, TAMP = 3.62, EXTRACT = 3.95, CUP = 6.45, REVEAL = 8.3, TAG = 9.3;
  return [
    `anoisesrc=d=${T}:c=brown:r=48000:a=0.6:seed=2,lowpass=f=700,volume='0.35*exp(-pow((t-0.5)/0.6,2))':eval=frame[air]`,
    `aevalsrc='0.1*between(t,${BURRS},${DOSE})*min(1,(t-${BURRS})*20)*(sin(2*PI*(115*(t-${BURRS})+308*pow(max(t-${BURRS}-0.37,0),3)))+0.5*sin(4*PI*(115*(t-${BURRS})+308*pow(max(t-${BURRS}-0.37,0),3)))+0.33*sin(6*PI*(115*(t-${BURRS})+308*pow(max(t-${BURRS}-0.37,0),3))))':s=48000:d=${T},lowpass=f=2600[motor]`,
    `aevalsrc='between(t,${BURRS},${DOSE})*if(lt(random(0),0.006+0.02*max(t-${BURRS}-0.37,0)),(random(1)-0.5)*2.2,0)':s=48000:d=${T},bandpass=f=2600:width_type=o:w=2,volume=0.85[crunch]`,
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.6:seed=4,bandpass=f=1400:width_type=o:w=2.2,` +
      `volume='0.8*exp(-pow((t-${DOSE - 0.04})/0.11,2))+0.45*exp(-pow((t-${CUP - 0.05})/0.13,2))+0.35*exp(-pow((t-7.7)/0.45,2))+0.35*exp(-pow((t-${TAMP - 0.1})/0.08,2))+0.25*exp(-pow((t-${BURRS})/0.1,2))':eval=frame,aphaser=type=t:speed=1.6:decay=0.45[whoosh]`,
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.5:seed=6,highpass=f=2800,lowpass=f=9000,volume='0.3*between(t,${DOSE},${TAMP - 0.4})*min(1,(t-${DOSE})*8)*min(1,(${TAMP - 0.4}-t)*6)*(0.7+0.3*sin(2*PI*23*t))':eval=frame[pour]`,
    `aevalsrc='if(gte(t,${TAMP}),0.9*sin(2*PI*(62*(t-${TAMP})+40*(1-exp(-30*(t-${TAMP})))/30))*exp(-7*(t-${TAMP})),0)':s=48000:d=${T}[thud]`,
    `anoisesrc=d=${T}:c=white:r=48000:a=1:seed=8,bandpass=f=3200:width_type=o:w=1.5,volume='if(gte(t,${TAMP}),0.75*exp(-60*(t-${TAMP})),0)':eval=frame[click]`,
    `aevalsrc='0.065*between(t,${EXTRACT},${CUP})*min(1,(t-${EXTRACT})*10)*min(1,(${CUP}-t)*10)*(sin(2*PI*50*t)+0.6*sin(2*PI*100*t)+0.35*sin(2*PI*150*t))':s=48000:d=${T},lowpass=f=500[pump]`,
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.7:seed=9,bandpass=f=850:width_type=o:w=1.4,volume='0.48*between(t,${EXTRACT + 0.46},${CUP - 0.2})*min(1,(t-${EXTRACT + 0.46})*5)*min(1,(${CUP - 0.2}-t)*4)*(0.55+0.45*sin(2*PI*6.3*t)*sin(2*PI*2.7*t))':eval=frame,tremolo=f=13:d=0.35[trickle]`,
    `aevalsrc='${[EXTRACT + 0.58, EXTRACT + 0.72, CUP + 0.06, CUP + 0.42].map(t0 => `if(gte(t,${t0}),0.36*sin(2*PI*(820*(t-${t0})-3400*pow(t-${t0},2)))*exp(-38*(t-${t0})),0)`).join('+')}':s=48000:d=${T}[drips]`,
    `aevalsrc='(0.03+0.06*min(1,t/${CUP})+0.035*between(t,${REVEAL},${T}))*min(1,(${T}-t)*2.5)*(${reed(110)}+0.8*${reed(110.35)}+0.45*${reed(220)})':s=48000:d=${T},lowpass=f=1800,equalizer=f=700:width_type=o:w=1.2:g=4[drone]`,
    `aevalsrc='0.08*(${launeddasMelody()})':s=48000:d=${T},highpass=f=250,equalizer=f=1250:width_type=o:w=1:g=5,lowpass=f=6500,aecho=0.6:0.35:90:0.25[melody]`,
    `aevalsrc='${[[REVEAL, 880], [REVEAL + 0.18, 1318.51], [REVEAL + 0.4, 1760], [REVEAL + 0.68, 2217.46], [TAG, 1318.51]].map(([t0, f]) => `if(gte(t,${t0}),0.11*(sin(2*PI*${f}*(t-${t0}))+0.4*sin(2*PI*${f * 2.76}*(t-${t0})))*exp(-2.6*(t-${t0})),0)`).join('+')}':s=48000:d=${T},aecho=0.7:0.5:120|240:0.3|0.2[chime]`,
    `aevalsrc='if(gte(t,${TAG}),0.7*(sin(2*PI*44*(t-${TAG}))+0.4*sin(2*PI*88*(t-${TAG})))*exp(-1.3*(t-${TAG}))*min(1,(t-${TAG})*40),0)':s=48000:d=${T}[hit]`,
    `[air][motor][crunch][whoosh][pour][thud][click][pump][trickle][drips][drone][melody][chime][hit]amix=inputs=14:normalize=0,` +
      `highpass=f=28,acompressor=threshold=0.3:ratio=2.5:attack=4:release=140,` +
      `afade=t=in:st=0:d=0.1,afade=t=out:st=10.55:d=0.45,alimiter=limit=0.9,aformat=channel_layouts=stereo[aout]`
  ].join(';');
}
function testAudio() {
  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex', audioGraph(), '-map', '[aout]', '-c:a', 'pcm_s16le', path.join(PREVIEW_DIR, 'audio_test.wav')], { stdio: 'inherit' });
  return new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('audio graph failed')))));
}

/* ---------------------------------------------------------------- encoder fed frame by frame (no temp files) */
function startEncoder(W, H) {
  const video = [
    '[0:v]vflip,format=rgb24',
    "curves=r='0/0 0.25/0.245 0.5/0.53 0.75/0.79 1/1':g='0/0 0.25/0.235 0.5/0.5 0.75/0.76 1/0.98':b='0/0.012 0.25/0.21 0.5/0.45 0.75/0.7 1/0.93'",
    'unsharp=5:5:0.35:5:5:0.0',
    'vignette=angle=PI/5:mode=forward',
    'noise=c0s=5:c0f=t',
    'format=yuv420p[vout]'
  ].join(',');
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-filter_complex', `${video};${audioGraph()}`,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-r', String(FPS), '-g', '120', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-t', String(DUR), OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const closed = new Promise((resolve, reject) => ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  let next = 0, chain = Promise.resolve();
  const pending = new Map();
  const flush = async () => {
    while (pending.has(next)) {
      const b = pending.get(next); pending.delete(next); next++;
      if (!ff.stdin.write(b)) await new Promise(r => ff.stdin.once('drain', r));
    }
  };
  return {
    push(i, buf) { pending.set(i, buf); chain = chain.then(flush); return chain; },
    async finish() { await chain; ff.stdin.end(); await closed; }
  };
}

async function renderAll(server) {
  const port = server.address().port;
  let next = 0, done = 0, enc = null, W = 1080, H = 1920;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    await new Promise(r => setTimeout(r, w * 20000));
    const tag = WORKERS > 1 ? `[worker ${w + 1}] ` : '';
    console.log(`${tag}avvio ${CHROME ? 'Google Chrome' : 'Chromium'}${GPU ? ' sulla GPU (si apre una finestra, lasciala aperta)' : ' (software)'}…`);
    const browser = await launch();
    const page = await openPage(browser, port, 1, Q, tag);
    if (!enc) { ({ W, H } = await page.evaluate(() => ({ W: window.RENDER.W, H: window.RENDER.H }))); enc = startEncoder(W, H); onFrame = (i, buf) => enc.push(i, buf); }
    while (next < TOTAL) {
      const f = next++;
      const status = await page.evaluate(([i, url]) => window.RENDER.post(i, url), [f, `/frame/${f}`]);
      if (status !== 200) throw new Error(`frame ${f} non inviato`);
      done++;
      if (done % 5 === 0 || done === TOTAL) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${TOTAL} fotogrammi · ${el.toFixed(0)}s · mancano ~${(el / done * (TOTAL - done)).toFixed(0)}s`);
      }
    }
    await browser.close();
  }));
  console.log('chiudo la codifica…');
  await enc.finish();
  console.log(`fatto in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}`);
}

if (has('--audio-test')) { await testAudio(); console.log('scritto', path.join(PREVIEW_DIR, 'audio_test.wav')); process.exit(0); }
const server = await serve();
try {
  if (has('--preview')) await runPreview(server);
  else await renderAll(server);
} finally {
  server.close();
}
