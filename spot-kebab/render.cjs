// Renders the spot frame by frame through window.ANIMATION and pipes PNGs into ffmpeg.
// Usage: NODE_PATH=$(npm root -g) node render.cjs index.html spot-kebab.mp4  (needs playwright + ffmpeg)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
(async () => {
  const [file, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('file://' + path.resolve(file) + '?clean&autoplay=0');
  await page.evaluate(() => window.ANIMATION.ready);
  const { duration, fps } = await page.evaluate(() => ({ duration: ANIMATION.duration, fps: ANIMATION.fps }));
  const frames = Math.round(duration * fps);
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < frames; i++) {
    const t = Math.min(i / fps, duration);
    const data = await page.evaluate(t => { ANIMATION.seek(t); return ANIMATION.canvas.toDataURL('image/png'); }, t);
    if (!ff.stdin.write(Buffer.from(data.slice(22), 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 120 === 0) console.log(`frame ${i}/${frames}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();
  console.log('done', out);
})();
