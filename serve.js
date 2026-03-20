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
};

const server = http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const range = req.headers.range;
  if (range && ext === '.mp4') {
    const size = stat.size;
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size });
    fs.createReadStream(filePath).pipe(res);
  }
});

// --- Chat WebSocket ---
const wss = new WebSocketServer({ server });
const chatHistory = []; // keep last 100 messages
const MAX_HISTORY = 100;

wss.on('connection', (ws) => {
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
