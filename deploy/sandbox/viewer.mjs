#!/usr/bin/env node
// zcode sandbox viewer — broadcasts Xvfb :100 as an MJPEG stream on :3000.
// The sandbox gateway (Caddy) proxies the external preview port to :3000, so
// whatever runs here is what the operator sees in the preview panel.
//
// Endpoints:
//   /          HTML shell (dark, full-viewport, auto-retry stream)
//   /stream    multipart/x-mixed-replace MJPEG of the desktop
//   /shot.jpg  single-frame JPEG (for scripted verification)
//   /state     JSON ops state
//   /healthz   200 ok when the server is alive
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = Number(process.env.VIEWER_PORT || 3000);
const DISPLAY = process.env.VIEWER_DISPLAY || ':100';
const WIDTH = Number(process.env.VIEWER_W || 1280);
const HEIGHT = Number(process.env.VIEWER_H || 800);
const FPS = Number(process.env.VIEWER_FPS || 8);
const QUALITY = Number(process.env.VIEWER_Q || 5); // mjpeg qscale (2 best .. 31 worst)

const started = Date.now();
let clients = 0;
let streamsServed = 0;

const xvfbUp = () => fs.existsSync(`/tmp/.X11-unix/X${DISPLAY.replace(':', '')}`);

function ffmpegStreamArgs() {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'x11grab', '-draw_mouse', '1',
    '-video_size', `${WIDTH}x${HEIGHT}`,
    '-framerate', String(FPS),
    '-i', DISPLAY,
    '-c:v', 'mjpeg', '-q:v', String(QUALITY),
    '-an', '-f', 'mpjpeg', '-boundary_tag', 'zframe', 'pipe:1',
  ];
}

function serveStream(res) {
  if (!xvfbUp()) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Xvfb display ' + DISPLAY + ' is not up yet — the desktop is still booting.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=zframe',
    'Cache-Control': 'no-store, private, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'Connection': 'close',
  });
  const ff = spawn('ffmpeg', ffmpegStreamArgs(), { stdio: ['ignore', 'pipe', 'pipe'] });
  clients++; streamsServed++;
  let bytes = 0;
  ff.stdout.on('data', (c) => { bytes += c.length; res.write(c); });
  ff.stderr.on('data', (c) => process.stderr.write('[ffmpeg] ' + c));
  const done = () => {
    if (clients > 0) clients--;
    try { res.end(); } catch {}
  };
  ff.on('exit', done);
  ff.on('error', done);
  res.on('close', () => ff.kill('SIGKILL'));
}

function serveShot(res) {
  if (!xvfbUp()) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Xvfb display ' + DISPLAY + ' is not up.');
    return;
  }
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'x11grab', '-draw_mouse', '1',
    '-video_size', `${WIDTH}x${HEIGHT}`,
    '-i', DISPLAY,
    '-frames:v', '1',
    '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  ff.stdout.on('data', (c) => chunks.push(c));
  ff.on('exit', () => {
    const buf = Buffer.concat(chunks);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>zcode · unicom-3.0 — live sandbox view</title>
<style>
  html,body{margin:0;height:100%;background:#0b0d10;color:#e7eaee;font:13px/1.5 ui-sans-serif,system-ui,sans-serif}
  .bar{position:fixed;inset:0 0 auto 0;z-index:2;display:flex;gap:12px;align-items:center;
       padding:8px 14px;background:rgba(11,13,16,.86);border-bottom:1px solid #232830;backdrop-filter:blur(6px)}
  .dot{width:8px;height:8px;border-radius:50%;background:#e5484d;box-shadow:0 0 8px currentColor}
  .dot.live{background:#46a758}
  .title{font-weight:600;letter-spacing:.2px}
  .sub{color:#8b93a1}
  .right{margin-left:auto;display:flex;gap:10px;align-items:center}
  .btn{color:#e7eaee;background:#1a1f27;border:1px solid #2a313c;border-radius:6px;padding:4px 10px;cursor:pointer}
  .btn:hover{background:#232a35}
  .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding-top:38px;box-sizing:border-box}
  img{max-width:100%;max-height:calc(100% - 48px);image-rendering:auto;outline:1px solid #232830}
  .note{position:fixed;bottom:10px;left:14px;color:#5d6674;font-size:11px}
</style>
</head>
<body>
  <div class="bar">
    <span class="dot" id="dot"></span>
    <span class="title">zcode · unicom-3.0</span>
    <span class="sub" id="state">connecting…</span>
    <span class="right">
      <button class="btn" onclick="reloadStream()">reload</button>
      <a class="btn" style="text-decoration:none" href="/state" target="_blank">state</a>
    </span>
  </div>
  <div class="wrap"><img id="v" alt="live sandbox view of the zcode desktop app"></div>
  <div class="note">read-only live mirror · Xvfb :100 → MJPEG :3000 · repo github.com/payswapdotorg/unicom-3.0</div>
<script>
  const img = document.getElementById('v'), dot = document.getElementById('dot'), st = document.getElementById('state');
  let retry = null;
  function reloadStream(){
    if (retry) { clearTimeout(retry); retry = null; }
    dot.classList.remove('live'); st.textContent = 'connecting…';
    img.src = '/stream?' + Date.now();
  }
  img.onload = () => { dot.classList.add('live'); st.textContent = 'live · ' + location.hostname; };
  img.onerror = () => { st.textContent = 'stream dropped — retrying in 3s'; retry = setTimeout(reloadStream, 3000); };
  reloadStream();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  switch (u.pathname) {
    case '/stream': return serveStream(res);
    case '/shot.jpg': return serveShot(res);
    case '/healthz': res.writeHead(200); return res.end('ok');
    case '/state':
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({
        ok: true, display: DISPLAY, size: `${WIDTH}x${HEIGHT}`, fps: FPS,
        xvfbUp: xvfbUp(), clients, streamsServed,
        uptimeSec: Math.round((Date.now() - started) / 1000),
      }));
    case '/': case '/index.html':
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(PAGE);
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[viewer] http://127.0.0.1:${PORT} → Xvfb ${DISPLAY} (${WIDTH}x${HEIGHT}@${FPS}fps MJPEG)`);
});
