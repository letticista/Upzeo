// Sardinian Coffee Corner — full pipeline:
//   Three.js (headless Chromium, SwiftShader WebGL2) -> raw RGBA frames -> FFmpeg grade + procedural audio -> MP4
// Usage:
//   node render.mjs                         full render -> sardinian_coffee_reveal.mp4
//   node render.mjs --preview 0,90,240 0.5  stills at half resolution into ./preview
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.NODE_PATH || '/opt/node22/lib/node_modules', 'playwright'))); }

const args = process.argv.slice(2);
const preview = args[0] === '--preview';
const FRAMES_DIR = path.join(ROOT, '.frames');
const OUT = path.join(ROOT, 'sardinian_coffee_reveal.mp4');
const WORKERS = parseInt(process.env.WORKERS || '2', 10);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ttf': 'font/ttf', '.json': 'application/json' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && url.startsWith('/frame/')) {
      const name = path.join(FRAMES_DIR, `${url.slice(7)}.rgba`);
      const out = fs.createWriteStream(name);
      req.pipe(out);
      out.on('finish', () => { res.writeHead(200); res.end('ok'); });
      return;
    }
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function openPage(browser, port, scale) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.on('pageerror', e => console.error('[page]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[console]', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html?scale=${scale}`);
  await page.waitForFunction(() => window.RENDER);
  await page.evaluate(() => window.RENDER.ready);
  return page;
}

const launch = () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });

async function runPreview(server) {
  const frames = (args[1] || '0,60,120,180,240,330').split(',').map(Number);
  const scale = parseFloat(args[2] || '0.5');
  const dir = path.join(ROOT, 'preview');
  fs.mkdirSync(dir, { recursive: true });
  const browser = await launch();
  const t0 = Date.now();
  const page = await openPage(browser, server.address().port, scale);
  console.log(`init ${(Date.now() - t0) / 1000}s`);
  if (args.includes('--clearance')) console.log('clearance', await page.evaluate(() => window.RENDER.clearance()));
  for (const f of frames) {
    const t1 = Date.now();
    const data = await page.evaluate(async i => { await window.RENDER.frame(i); return document.getElementById('c').toDataURL('image/png'); }, f);
    fs.writeFileSync(path.join(dir, `p_${String(f).padStart(3, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    console.log(`frame ${f} ${(Date.now() - t1) / 1000}s`);
  }
  await browser.close();
}

async function renderAll(server) {
  fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
  const port = server.address().port;
  const total = 360;
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const browser = await launch();
    const page = await openPage(browser, port, 1);
    while (next < total) {
      const f = next++;
      const status = await page.evaluate(([i, url]) => window.RENDER.post(i, url), [f, `/frame/${String(f).padStart(4, '0')}`]);
      if (status !== 200) throw new Error(`frame ${f} upload failed`);
      done++;
      if (done % 20 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${total} frames · ${el.toFixed(0)}s elapsed · ~${(el / done * (total - done)).toFixed(0)}s left`);
      }
    }
    await browser.close();
  }));
  console.log(`render done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

/* Procedural soundtrack, built only from FFmpeg sources and filters. */
function audioGraph() {
  const T = 6, IMPACT = 3.85;
  return [
    // deep whooshes: band-passed brown noise with envelopes at the fly-through and both whip pans
    `anoisesrc=d=${T}:c=brown:r=48000:a=0.9:seed=3,highpass=f=60,lowpass=f=900,` +
      `volume='0.9*(exp(-pow((t-0.55)/0.42,2))+1.15*exp(-pow((t-1.5)/0.17,2))+1.1*exp(-pow((t-2.8)/0.17,2))+0.6*exp(-pow((t-3.45)/0.3,2)))':eval=frame[wl]`,
    `anoisesrc=d=${T}:c=pink:r=48000:a=0.5:seed=5,bandpass=f=2400:width_type=o:w=1.4,` +
      `volume='0.55*(exp(-pow((t-1.47)/0.11,2))+exp(-pow((t-2.77)/0.11,2))+0.4*exp(-pow((t-0.45)/0.3,2)))':eval=frame,aphaser=type=t:speed=1.8:decay=0.5[wh]`,
    // rising tension into the impact
    `aevalsrc='0.22*sin(2*PI*(55*t+40*pow(max(t-2.4,0),2)))*between(t,2.4,${IMPACT})*pow(max(t-2.4,0)/1.45,2)':s=48000:d=${T}[rs]`,
    // sub-bass drop + body hit exactly on the reveal
    `aevalsrc='if(gte(t,${IMPACT}),0.95*sin(2*PI*(32*(t-${IMPACT})+95*(1-exp(-5*(t-${IMPACT})))/5))*exp(-1.1*(t-${IMPACT}))*min(1,(t-${IMPACT})*60),0)':s=48000:d=${T}[sub]`,
    `anoisesrc=d=${T}:c=brown:r=48000:a=1:seed=9,lowpass=f=180,volume='if(gte(t,${IMPACT}),1.4*exp(-9*(t-${IMPACT})),0)':eval=frame[hit]`,
    // metallic shimmer for the light sweep
    `aevalsrc='0.05*(sin(2*PI*1760*t)+0.7*sin(2*PI*2637*t)+0.5*sin(2*PI*3520*t))*exp(-1.4*max(t-${IMPACT + 0.1},0))*gte(t,${IMPACT + 0.1})*(0.6+0.4*sin(2*PI*7*t))':s=48000:d=${T}[shim]`,
    // steam hiss + roasting crackle bed
    `anoisesrc=d=${T}:c=white:r=48000:a=0.06:seed=13,highpass=f=4500,lowpass=f=11000,volume='0.6+0.4*sin(2*PI*0.35*t)':eval=frame[hiss]`,
    `aevalsrc='if(lt(random(0),0.0009),(random(1)-0.5)*1.6,0)':s=48000:d=${T},highpass=f=1800,lowpass=f=7000,volume=0.55[crk]`,
    `[wl][wh][rs][sub][hit][shim][hiss][crk]amix=inputs=8:normalize=0,` +
      `biquad=b0=1.02:b1=0:b2=0:a0=1:a1=0:a2=0,acompressor=threshold=0.25:ratio=3:attack=5:release=120,` +
      `afade=t=in:st=0:d=0.08,afade=t=out:st=5.55:d=0.45,alimiter=limit=0.89,aformat=channel_layouts=stereo[aout]`
  ].join(';');
}

function testAudio() {
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'warning', '-y', '-filter_complex', audioGraph(), '-map', '[aout]', '-c:a', 'pcm_s16le', path.join(ROOT, 'preview', 'audio_test.wav')], { stdio: 'inherit' });
  return new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('audio graph failed')))));
}

function encode() {
  const files = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.rgba')).sort();
  if (files.length !== 360) throw new Error(`expected 360 frames, found ${files.length}`);
  const video = [
    '[0:v]vflip,format=rgb24',
    "curves=r='0/0 0.25/0.24 0.5/0.55 0.75/0.82 1/1':g='0/0 0.25/0.22 0.5/0.49 0.75/0.75 1/0.97':b='0/0.01 0.25/0.18 0.5/0.41 0.75/0.66 1/0.9'",
    "eq=gamma='1+0.2*max(0,1-t/2.4)':eval=frame",
    'unsharp=5:5:0.75:5:5:0.0',
    'tmix=frames=3:weights=1 3 1',
    'vignette=angle=PI/4.4:mode=forward',
    'noise=c0s=5:c0f=t',
    'fade=t=in:st=0:d=0.22',
    'format=yuv420p[vout]'
  ].join(',');
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1080x1920', '-r', '60', '-i', '-',
    '-filter_complex', `${video};${audioGraph()}`,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.2',
    '-r', '60', '-g', '120', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-t', '6', OUT
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  return new Promise((resolve, reject) => {
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    (async () => {
      for (const f of files) {
        const buf = fs.readFileSync(path.join(FRAMES_DIR, f));
        if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
    })();
  });
}

if (args[0] === '--audio-test') { await testAudio(); process.exit(0); }
const server = await serve();
try {
  if (preview) await runPreview(server);
  else {
    if (!args.includes('--encode-only')) await renderAll(server);
    console.log('encoding with ffmpeg…');
    await encode();
    console.log('wrote', OUT);
    if (!args.includes('--keep-frames')) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  }
} finally {
  server.close();
}
