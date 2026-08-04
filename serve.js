const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT, 10) || 3457;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.glb': 'model/gltf-binary',
};

const server = http.createServer((req, res) => {
  // Strip the query BEFORE anything else — `/?utm_source=x` used to fall into
  // the non-root branch and 404, which broke every link shared from Instagram.
  const rawPath = req.url.split('?')[0].split('#')[0];

  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch {
    // A malformed escape (`/%zz`) throws URIError. Uncaught, that killed the
    // whole process — one bad request took the site down.
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (urlPath === '/' || urlPath.endsWith('/')) urlPath += 'index.html';

  // Resolve, then confirm the result is still inside DIR. `%2e%2e%2f` survives
  // browser normalization and only becomes `../` after decodeURIComponent.
  const filePath = path.resolve(DIR, '.' + path.posix.normalize(urlPath));
  if (filePath !== DIR && !filePath.startsWith(DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const range = req.headers.range;
  // Range must be honored for audio too, not just .mp4 — Safari refuses to
  // play media when the server answers a Range request with a plain 200.
  if (range) {
    const size = stat.size;
    const parts = range.replace(/bytes=/, '').split('-');
    let start = parseInt(parts[0], 10);
    let end = parts[1] ? parseInt(parts[1], 10) : size - 1;
    if (Number.isNaN(start)) start = 0;
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// The static handler is defensive now, but a stray throw anywhere in the
// request path shouldn't take the chat server down with it.
process.on('uncaughtException', (err) => console.error('uncaught:', err));

// --- Chat WebSocket ---
const wss = new WebSocketServer({ noServer: true });
const chatHistory = []; // keep last 100 messages
const MAX_HISTORY = 100;

// Explicit upgrade handling for Render's proxy
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Ping clients every 30s to keep connections alive through proxy
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let screenName = null;

  // Send chat history to new connection
  ws.send(JSON.stringify({ type: 'history', messages: chatHistory }));

  // Broadcast online count
  function broadcastOnline() {
    const names = [];
    wss.clients.forEach(c => { if (c.screenName) names.push(c.screenName); });
    const msg = JSON.stringify({ type: 'online', users: names });
    wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  }

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    if (data.type === 'join') {
      screenName = (data.screenName || '').trim().slice(0, 20);
      if (!screenName) return;
      ws.screenName = screenName;

      const joinMsg = { type: 'system', text: `${screenName} has entered the chat.`, ts: Date.now() };
      chatHistory.push(joinMsg);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(joinMsg)); });
      broadcastOnline();
    }

    if (data.type === 'message' && screenName) {
      const text = (data.text || '').trim().slice(0, 500);
      if (!text) return;
      const chatMsg = { type: 'message', screenName, text, ts: Date.now() };
      chatHistory.push(chatMsg);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(chatMsg)); });
    }
  });

  ws.on('close', () => {
    if (screenName) {
      const leaveMsg = { type: 'system', text: `${screenName} has left the chat.`, ts: Date.now() };
      chatHistory.push(leaveMsg);
      if (chatHistory.length > MAX_HISTORY) chatHistory.shift();
      wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(leaveMsg)); });
      broadcastOnline();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Serving on http://localhost:${PORT}`));
