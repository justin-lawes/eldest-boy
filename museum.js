// ============================================================================
// MODE 10: THE MUSEUM
// ----------------------------------------------------------------------------
// A first-person 19th-century painting gallery. Walk around, lean in to read a
// wall label, get yelled at by a guard who has been doing this for 22 years.
//
// Loaded lazily by index.html on first activation — nothing here touches first
// paint. Everything you'd want to change lives in museum-data.js.
// ============================================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import DATA from './museum-data.js';

// --- Quality -----------------------------------------------------------------
const IS_TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const TEX = IS_TOUCH ? 256 : 512;

const EYE = 1.65;
const WALK = 3.2;
const RUN = 5.6;
const LOOK_SENS = 0.0022;

// --- Module state ------------------------------------------------------------
let renderer, scene, camera, canvas;
let built = false, running = false, rafId = null, lastT = 0;
let container, elCaption, elEnter, elJoy, elJoyThumb, elMute, elCrosshair;

const keys = new Set();
let yaw = 0, pitch = 0, bobT = 0;
const pos = new THREE.Vector3(0, EYE, 5.2);

const obstacles = { circles: [], boxes: [] };   // collision
const zones = [];                                // guard trigger volumes
let guardLevel = 0, lastShout = 0, muted = false, guardVoice = null, speechPrimed = false;
let guardAudio = null;   // recorded VO handle, so stop()/mute can kill it
let captionTimer = null;

const listeners = [];   // [target, type, fn, opts] — all removed on stop()
const disposables = []; // textures/geometries we own

let joyActive = false, joyId = null, joyVec = { x: 0, y: 0 };
let lookId = null, lookLast = { x: 0, y: 0 };
let dragging = false, dragLast = { x: 0, y: 0 }, wasLocked = false;

// =============================================================================
// Small utilities
// =============================================================================

function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  listeners.push([target, type, fn, opts]);
}

function offAll() {
  for (const [t, ty, fn, o] of listeners) t.removeEventListener(ty, fn, o);
  listeners.length = 0;
}

// The scene is static, so matrix and shadow updates are switched off after the
// build. Anything that lands later (GLTF models, painting textures) must call
// this or it will render unlit, unshadowed, and at the wrong transform.
function sceneChanged() {
  if (!scene) return;
  scene.updateMatrixWorld(true);
  if (renderer) renderer.shadowMap.needsUpdate = true;
}

// Deterministic RNG so the placeholder paintings don't reshuffle on reload.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function texFrom(cv, { repeat = null, srgb = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  if (aniso && renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  disposables.push(t);
  return t;
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 99) {
  const words = String(text).split(/\s+/);
  let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); y += lineH; line = words[i];
      if (++n >= maxLines - 1) break;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

// =============================================================================
// Procedural textures
// =============================================================================

// Herringbone parquet — the floor of every gallery of this period.
function parquetTexture() {
  const S = TEX * 2, cv = makeCanvas(S, S), c = cv.getContext('2d');
  const rnd = mulberry32(7);
  c.fillStyle = DATA.room.floorTint; c.fillRect(0, 0, S, S);

  const plank = S / 8, pw = plank * 0.42;
  for (let row = -1; row < 9; row++) {
    for (let col = -1; col < 9; col++) {
      const cx = col * plank, cy = row * plank;
      const flip = (row + col) % 2 === 0;
      c.save();
      c.translate(cx + plank / 2, cy + plank / 2);
      c.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
      // Plank body, tinted a little differently each time.
      const l = 0.72 + rnd() * 0.5;
      c.fillStyle = `rgb(${Math.min(255, 150 * l) | 0},${Math.min(255, 96 * l) | 0},${Math.min(255, 52 * l) | 0})`;
      c.fillRect(-plank * 0.62, -pw / 2, plank * 1.24, pw);
      // Grain.
      c.strokeStyle = 'rgba(60,32,14,0.30)'; c.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gy = -pw / 2 + pw * (g + 0.5) / 5 + (rnd() - 0.5) * 2;
        c.beginPath(); c.moveTo(-plank * 0.62, gy); c.lineTo(plank * 0.62, gy + (rnd() - 0.5) * 3); c.stroke();
      }
      // Seam.
      c.strokeStyle = 'rgba(30,16,6,0.55)'; c.lineWidth = 1.5;
      c.strokeRect(-plank * 0.62, -pw / 2, plank * 1.24, pw);
      c.restore();
    }
  }
  // Wax sheen.
  const g = c.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, 'rgba(255,230,180,0.06)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.10)');
  g.addColorStop(1, 'rgba(255,230,180,0.05)');
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return cv;
}

// Damask wall silk — a diamond lattice with a small motif, barely there.
function damaskTexture() {
  const S = TEX, cv = makeCanvas(S, S), c = cv.getContext('2d');
  c.fillStyle = DATA.room.wallColor; c.fillRect(0, 0, S, S);
  c.strokeStyle = 'rgba(255,225,200,0.055)';
  c.fillStyle = 'rgba(255,225,200,0.045)';
  c.lineWidth = S / 180;

  const step = S / 2;
  for (let i = -1; i < 3; i++) {
    for (let j = -1; j < 3; j++) {
      const x = i * step + (j % 2 ? step / 2 : 0), y = j * step;
      // Diamond lattice.
      c.beginPath();
      c.moveTo(x + step / 2, y); c.lineTo(x + step, y + step / 2);
      c.lineTo(x + step / 2, y + step); c.lineTo(x, y + step / 2);
      c.closePath(); c.stroke();
      // Motif in the middle of each diamond.
      c.beginPath();
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        const r = step * (a % 2 ? 0.05 : 0.11);
        const px = x + step / 2 + Math.cos(th) * r, py = y + step / 2 + Math.sin(th) * r;
        a ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath(); c.fill();
    }
  }
  // Vertical silk streaks.
  c.globalAlpha = 0.5;
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * S;
    c.strokeStyle = i % 2 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)';
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke();
  }
  c.globalAlpha = 1;
  return cv;
}

// Acanthus scrollwork, used as a BUMP map on the gold. This is what sells the
// frames as carved gilt gesso rather than flat plastic.
function giltBumpTexture() {
  const S = 256, cv = makeCanvas(S, S), c = cv.getContext('2d');
  c.fillStyle = '#808080'; c.fillRect(0, 0, S, S);
  c.lineCap = 'round';

  const scroll = (x, y, s, dir) => {
    c.save(); c.translate(x, y); c.scale(dir * s, s);
    // Raised ridge.
    c.strokeStyle = '#e8e8e8'; c.lineWidth = 7;
    c.beginPath(); c.moveTo(-20, 12);
    c.bezierCurveTo(-6, 12, 2, 2, 0, -10);
    c.bezierCurveTo(-2, -20, -14, -20, -14, -11);
    c.bezierCurveTo(-14, -4, -6, -2, 0, -6);
    c.stroke();
    // Shadow side, offset a touch.
    c.strokeStyle = '#3a3a3a'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-20, 16);
    c.bezierCurveTo(-6, 16, 4, 5, 2, -8);
    c.stroke();
    // Leaf tips.
    c.fillStyle = '#dcdcdc';
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.ellipse(-16 + i * 7, 16 - i * 3, 4, 2.2, -0.5 + i * 0.3, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  };

  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      scroll(x * 64 + 32, y * 64 + 32, 1, (x + y) % 2 ? 1 : -1);
    }
  }
  // Beading between the scroll rows.
  c.fillStyle = '#d0d0d0';
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 32; x++) {
      c.beginPath(); c.arc(x * 8 + 4, y * 64 + 62, 2.4, 0, Math.PI * 2); c.fill();
    }
  }
  return cv;
}

// A dark, varnished portrait of two boys. Not a good painting — it needs to
// read as "1800s, oil, two boys" from across the room, and then get replaced
// by a real file the moment one exists.
function paintingTexture(seed, w, h) {
  const rnd = mulberry32(seed);
  const W = TEX, H = Math.round(TEX * (h / w));
  const cv = makeCanvas(W, H), c = cv.getContext('2d');

  // 1. Ground.
  c.fillStyle = '#241a12'; c.fillRect(0, 0, W, H);

  // 2. The light, coming from upper left as it always does.
  const gl = c.createRadialGradient(W * 0.38, H * 0.28, 10, W * 0.5, H * 0.45, H * 0.85);
  gl.addColorStop(0, 'rgba(146,116,70,0.62)');
  gl.addColorStop(0.55, 'rgba(78,58,36,0.30)');
  gl.addColorStop(1, 'rgba(20,13,8,0)');
  c.fillStyle = gl; c.fillRect(0, 0, W, H);

  // 3. Loose background strokes — drapery, or a landscape, or nothing.
  for (let i = 0; i < 220; i++) {
    const x = rnd() * W, y = rnd() * H, len = 12 + rnd() * 60;
    const v = 0.55 + rnd() * 0.6;
    c.save(); c.translate(x, y); c.rotate((rnd() - 0.5) * 1.4);
    c.globalAlpha = 0.05 + rnd() * 0.09;
    c.fillStyle = `rgb(${(88 * v) | 0},${(66 * v) | 0},${(40 * v) | 0})`;
    c.fillRect(-len / 2, -3 - rnd() * 4, len, 4 + rnd() * 6);
    c.restore();
  }
  c.globalAlpha = 1;

  // Painterly blob: many jittered ellipses so nothing reads as vector.
  const blob = (x, y, rx, ry, col, n = 26, jit = 0.22) => {
    for (let i = 0; i < n; i++) {
      c.globalAlpha = 0.10 + rnd() * 0.22;
      c.fillStyle = col;
      c.beginPath();
      c.ellipse(
        x + (rnd() - 0.5) * rx * jit * 2,
        y + (rnd() - 0.5) * ry * jit * 2,
        rx * (0.72 + rnd() * 0.42), ry * (0.72 + rnd() * 0.42),
        (rnd() - 0.5) * 0.6, 0, Math.PI * 2
      );
      c.fill();
    }
    c.globalAlpha = 1;
  };

  // 4. Two boys. One is taller. That is the entire subject of the collection.
  const drawBoy = (cx, footY, scale, skin, coat) => {
    const bh = H * 0.52 * scale;
    const headR = bh * 0.115;
    const headY = footY - bh + headR;

    // Coat.
    c.beginPath();
    c.moveTo(cx - bh * 0.13, headY + headR * 1.9);
    c.quadraticCurveTo(cx - bh * 0.34, headY + bh * 0.5, cx - bh * 0.30, footY);
    c.lineTo(cx + bh * 0.30, footY);
    c.quadraticCurveTo(cx + bh * 0.34, headY + bh * 0.5, cx + bh * 0.13, headY + headR * 1.9);
    c.closePath();
    c.fillStyle = coat; c.fill();
    blob(cx, headY + bh * 0.55, bh * 0.26, bh * 0.34, coat, 34, 0.3);
    // Lit edge on the coat.
    c.save(); c.clip();
    blob(cx - bh * 0.18, headY + bh * 0.45, bh * 0.09, bh * 0.3, 'rgba(190,155,105,0.5)', 22, 0.5);
    c.restore();

    // Collar.
    blob(cx, headY + headR * 1.85, headR * 0.85, headR * 0.34, 'rgba(226,214,190,0.92)', 16, 0.25);
    // Neck.
    blob(cx, headY + headR * 1.35, headR * 0.34, headR * 0.44, skin, 12, 0.2);
    // Head.
    blob(cx, headY, headR * 0.82, headR, skin, 30, 0.14);
    // Shading down the right of the face.
    blob(cx + headR * 0.34, headY + headR * 0.1, headR * 0.34, headR * 0.72, 'rgba(70,44,26,0.5)', 16, 0.2);
    // Hair.
    c.beginPath();
    c.ellipse(cx, headY - headR * 0.42, headR * 0.9, headR * 0.62, 0, Math.PI, Math.PI * 2);
    c.fillStyle = 'rgba(38,25,15,0.95)'; c.fill();
    blob(cx - headR * 0.5, headY - headR * 0.2, headR * 0.4, headR * 0.4, 'rgba(38,25,15,0.9)', 12, 0.3);
    // Features — barely there, which is what keeps it from looking like a cartoon.
    c.globalAlpha = 0.75; c.fillStyle = '#2a1a10';
    c.beginPath(); c.ellipse(cx - headR * 0.32, headY - headR * 0.02, headR * 0.11, headR * 0.07, 0, 0, 7); c.fill();
    c.beginPath(); c.ellipse(cx + headR * 0.30, headY - headR * 0.02, headR * 0.11, headR * 0.07, 0, 0, 7); c.fill();
    c.globalAlpha = 0.45;
    c.fillRect(cx - headR * 0.16, headY + headR * 0.44, headR * 0.32, headR * 0.06);
    c.globalAlpha = 1;
    // Hands.
    blob(cx - bh * 0.24, headY + bh * 0.62, headR * 0.32, headR * 0.26, skin, 10, 0.2);
    blob(cx + bh * 0.23, headY + bh * 0.66, headR * 0.30, headR * 0.24, skin, 10, 0.2);
  };

  const tallLeft = rnd() > 0.5;
  const footY = H * 0.97;
  drawBoy(W * 0.36, footY, tallLeft ? 1.0 : 0.84, 'rgb(206,164,122)', 'rgb(34,26,20)');
  drawBoy(W * 0.64, footY, tallLeft ? 0.84 : 1.0, 'rgb(212,172,130)', 'rgb(28,24,26)');

  // 5. Varnish — a century and a half of it.
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = 'rgba(140,102,52,0.20)'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'overlay';
  c.fillStyle = 'rgba(224,178,84,0.20)'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';

  // 6. Craquelure.
  for (let i = 0; i < 150; i++) {
    let x = rnd() * W, y = rnd() * H;
    c.strokeStyle = rnd() > 0.25 ? 'rgba(24,14,6,0.20)' : 'rgba(232,214,180,0.07)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, y);
    for (let s = 0; s < 3 + (rnd() * 4 | 0); s++) {
      x += (rnd() - 0.5) * 26; y += (rnd() - 0.5) * 26;
      c.lineTo(x, y);
    }
    c.stroke();
  }

  // 7. Canvas weave.
  c.globalAlpha = 0.05;
  c.strokeStyle = '#000'; c.lineWidth = 1;
  for (let x = 0; x < W; x += 3) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  for (let y = 0; y < H; y += 3) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.globalAlpha = 1;

  // 8. Vignette.
  const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(16,9,4,0.52)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);

  return cv;
}

// Wall label. Deliberately small — you have to walk up to it, which is the
// entire point of the mode.
function labelTexture(item) {
  const W = 512, H = 350, cv = makeCanvas(W, H), c = cv.getContext('2d');
  c.fillStyle = '#efe9dc'; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(60,48,32,0.35)'; c.lineWidth = 3;
  c.strokeRect(7, 7, W - 14, H - 14);

  c.fillStyle = '#241c12';
  c.textBaseline = 'top';

  c.font = 'bold 27px Georgia, serif';
  let y = wrapText(c, item.title, 30, 32, W - 60, 32, 3);

  y += 4;
  c.font = 'italic 22px Georgia, serif';
  c.fillStyle = '#4b3d29';
  c.fillText(item.artist, 30, y); y += 28;
  c.fillText(item.year, 30, y); y += 34;

  c.strokeStyle = 'rgba(60,48,32,0.4)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(30, y); c.lineTo(W - 30, y); c.stroke();
  y += 18;

  c.font = '20px Georgia, serif';
  c.fillStyle = '#3a2f1f';
  wrapText(c, item.caption, 30, y, W - 60, 26, 6);

  return cv;
}

// A cheap equirect environment. Without this, metalness ~0.9 gold renders
// almost black — metals need something to reflect.
function environmentTexture() {
  const cv = makeCanvas(256, 128), c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.00, '#fffaf0');   // skylight
  g.addColorStop(0.22, '#e8d9b8');
  g.addColorStop(0.42, '#8c5a4a');   // upper wall
  g.addColorStop(0.62, DATA.room.wallColor);
  g.addColorStop(0.80, '#4a3226');
  g.addColorStop(1.00, '#241812');   // floor
  c.fillStyle = g; c.fillRect(0, 0, 256, 128);
  // A hot band for the skylight so gold gets a highlight to catch.
  c.fillStyle = 'rgba(255,252,240,0.85)';
  c.fillRect(0, 0, 256, 14);
  return cv;
}

// =============================================================================
// Geometry builders
// =============================================================================

function mouldingBand(ow, oh, iw, ih, depth, mat) {
  const s = new THREE.Shape();
  s.moveTo(-ow / 2, -oh / 2); s.lineTo(ow / 2, -oh / 2);
  s.lineTo(ow / 2, oh / 2); s.lineTo(-ow / 2, oh / 2); s.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-iw / 2, -ih / 2); hole.lineTo(-iw / 2, ih / 2);
  hole.lineTo(iw / 2, ih / 2); hole.lineTo(iw / 2, -ih / 2); hole.closePath();
  s.holes.push(hole);

  const bev = Math.min(0.035, depth * 0.4);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - bev, bevelEnabled: true,
    bevelThickness: bev, bevelSize: bev * 1.5, bevelSegments: 2, curveSegments: 6,
  });
  disposables.push(g);
  return new THREE.Mesh(g, mat);
}

function ellipseBand(ow, oh, rx, ry, depth, mat) {
  const s = new THREE.Shape();
  s.moveTo(-ow / 2, -oh / 2); s.lineTo(ow / 2, -oh / 2);
  s.lineTo(ow / 2, oh / 2); s.lineTo(-ow / 2, oh / 2); s.closePath();
  const hole = new THREE.Path();
  hole.absellipse(0, 0, rx, ry, 0, Math.PI * 2, true, 0);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - 0.03, bevelEnabled: true,
    bevelThickness: 0.03, bevelSize: 0.045, bevelSegments: 2, curveSegments: 24,
  });
  disposables.push(g);
  return new THREE.Mesh(g, mat);
}

function cartouche(r, depth, mat) {
  const s = new THREE.Shape();
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * Math.PI * 2;
    const rr = r * (1 + 0.34 * Math.cos(th * 5));
    const x = Math.cos(th) * rr, y = Math.sin(th) * rr;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth * 0.55, bevelEnabled: true,
    bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 2, curveSegments: 4,
  });
  disposables.push(g);
  return new THREE.Mesh(g, mat);
}

// A framed painting, built in the XY plane facing +Z. Caller rotates it.
function buildFramedPainting(item, goldMat, idx) {
  const g = new THREE.Group();
  const { w, h } = item;
  const variant = item.frame || 'ogee';

  // Canvas.
  const artCv = item.image ? null : paintingTexture(item.seed || (idx + 1) * 137, w, h);
  // The brass picture lights above each frame are emissive geometry, not real
  // lights — so lift the canvas itself instead. Same read, no extra light cost.
  // Start black so an image-backed painting doesn't flash white before its
  // file arrives; the lift is applied together with the texture.
  const artMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.86, metalness: 0.0,
    emissive: 0x000000, emissiveIntensity: 0.34,
  });
  const applyArt = (t) => {
    artMat.color.setHex(0xffffff);
    artMat.emissive.setHex(0xffffff);
    artMat.map = artMat.emissiveMap = t;
    artMat.needsUpdate = true;
  };
  if (artCv) {
    applyArt(texFrom(artCv));
  } else {
    // Real file supplied — load it and swap in when it lands.
    new THREE.TextureLoader().load(item.image, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      // These are the textures most often seen at a grazing angle, and they
      // were the only ones not getting anisotropic filtering.
      if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      disposables.push(t);
      applyArt(t);
      sceneChanged();
    }, undefined, () => {
      // Without this a 404 — or a filename case mismatch, which is exactly what
      // GitHub Pages punishes — leaves a black rectangle in a gilt frame
      // forever, and the ~130-line procedural painting fallback never runs.
      console.warn('[museum] painting failed to load:', item.image);
      applyArt(texFrom(paintingTexture(item.seed || (idx + 1) * 137, w, h)));
      sceneChanged();
    });
  }
  const artGeo = new THREE.PlaneGeometry(w, h);
  disposables.push(artGeo);
  const art = new THREE.Mesh(artGeo, artMat);
  art.position.z = 0.035;
  g.add(art);

  // Backing board so you never see through the frame's opening.
  const backGeo = new THREE.PlaneGeometry(w + 0.5, h + 0.5);
  disposables.push(backGeo);
  const back = new THREE.Mesh(backGeo, new THREE.MeshStandardMaterial({ color: 0x1a1310, roughness: 0.95 }));
  back.position.z = 0.012;
  g.add(back);

  // Stacked mouldings, deepest on the outside — that's how these are actually built.
  const bands = {
    fillet: [[0.20, 0.02, 0.075]],
    ogee: [[0.34, 0.19, 0.135], [0.19, -0.02, 0.075]],
    heavy: [[0.50, 0.33, 0.175], [0.34, 0.18, 0.120], [0.19, -0.03, 0.065]],
    tondo: [[0.42, 0.26, 0.155], [0.27, 0.10, 0.100]],
  }[variant] || [[0.34, 0.19, 0.135], [0.19, -0.02, 0.075]];

  let outerMost = w;
  bands.forEach(([outAdd, inAdd, depth], i) => {
    const isInner = i === bands.length - 1;
    let band;
    if (variant === 'tondo' && isInner) {
      band = ellipseBand(w + outAdd, h + outAdd, w * 0.46, h * 0.46, depth, goldMat);
    } else {
      band = mouldingBand(w + outAdd, h + outAdd, w + inAdd, h + inAdd, depth, goldMat);
    }
    band.position.z = 0.012;
    band.castShadow = !IS_TOUCH;
    g.add(band);
    if (i === 0) outerMost = w + outAdd;
  });

  // Corner rosettes on the ornate variants.
  if (variant === 'heavy' || variant === 'tondo') {
    const oh = h + bands[0][0];
    const r = Math.min(0.085, bands[0][0] * 0.22);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cz = cartouche(r, 0.16, goldMat);
      cz.position.set(sx * (outerMost / 2 - r * 0.9), sy * (oh / 2 - r * 0.9), 0.012 + bands[0][2] * 0.75);
      g.add(cz);
    }
  }

  // Brass picture light. Emissive geometry only — no real light, no cost.
  const armGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.26, 6);
  const shadeGeo = new THREE.CylinderGeometry(0.05, 0.075, 0.13, 10, 1, true);
  disposables.push(armGeo, shadeGeo);
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.85, roughness: 0.34 });
  const arm = new THREE.Mesh(armGeo, brass);
  arm.position.set(0, h / 2 + bands[0][0] / 2 + 0.14, 0.16);
  arm.rotation.x = Math.PI / 2.6;
  g.add(arm);
  const shade = new THREE.Mesh(shadeGeo, new THREE.MeshStandardMaterial({
    color: 0xb08d3f, metalness: 0.8, roughness: 0.35,
    emissive: 0xffe6a8, emissiveIntensity: 0.55, side: THREE.DoubleSide,
  }));
  shade.position.set(0, h / 2 + bands[0][0] / 2 + 0.24, 0.30);
  shade.rotation.x = Math.PI / 2.2;
  g.add(shade);

  return { group: g, outerW: outerMost };
}

function buildLabel(item) {
  const geo = new THREE.PlaneGeometry(0.46, 0.315);
  disposables.push(geo);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: texFrom(labelTexture(item)), roughness: 0.9, metalness: 0,
  }));
}

// --- Statues -----------------------------------------------------------------

// Deliberately built from cylinders + spheres rather than CapsuleGeometry,
// whose argument meaning has shifted between three.js releases.
function limb(rTop, rBot, len, mat) {
  const g = new THREE.Group();
  const cg = new THREE.CylinderGeometry(rTop, rBot, len, 10);
  const sgT = new THREE.SphereGeometry(rTop, 10, 8);
  const sgB = new THREE.SphereGeometry(rBot, 10, 8);
  disposables.push(cg, sgT, sgB);
  const cyl = new THREE.Mesh(cg, mat); cyl.position.y = -len / 2;
  const capT = new THREE.Mesh(sgT, mat);
  const capB = new THREE.Mesh(sgB, mat); capB.position.y = -len;
  g.add(cyl, capT, capB);
  return g;
}

// Returns a rig whose joints can be posed by the caller.
function buildBoy(mat, scale = 1) {
  const S = scale;
  const root = new THREE.Group();
  const j = {};

  const torso = new THREE.Group(); torso.position.y = 0.72 * S; root.add(torso);
  j.torso = torso;

  // limb() hangs downward from its origin, so flip it to run pelvis -> shoulders.
  // Origin stays at 0 or the chest overshoots the head.
  const chest = limb(0.135 * S, 0.115 * S, 0.40 * S, mat);
  chest.rotation.z = Math.PI;
  torso.add(chest);

  const neck = new THREE.Group(); neck.position.y = 0.44 * S; torso.add(neck);
  j.neck = neck;
  const neckM = limb(0.045 * S, 0.05 * S, 0.07 * S, mat); neckM.position.y = 0.07 * S;
  neck.add(neckM);
  const headGeo = new THREE.SphereGeometry(0.105 * S, 16, 12);
  disposables.push(headGeo);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 0.155 * S; head.scale.set(0.92, 1.12, 1);
  neck.add(head);
  j.head = head;

  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const sh = new THREE.Group();
    sh.position.set(s * 0.145 * S, 0.40 * S, 0);
    torso.add(sh);
    sh.add(limb(0.05 * S, 0.042 * S, 0.27 * S, mat));
    const el = new THREE.Group(); el.position.y = -0.27 * S; sh.add(el);
    el.add(limb(0.042 * S, 0.034 * S, 0.25 * S, mat));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045 * S, 8, 6), mat);
    hand.position.y = -0.25 * S; hand.scale.set(1, 1.25, 0.6);
    el.add(hand);
    j['shoulder' + side] = sh; j['elbow' + side] = el; j['hand' + side] = hand;

    const hip = new THREE.Group();
    hip.position.set(s * 0.085 * S, 0, 0);
    torso.add(hip);
    hip.add(limb(0.075 * S, 0.058 * S, 0.36 * S, mat));
    const kn = new THREE.Group(); kn.position.y = -0.36 * S; hip.add(kn);
    kn.add(limb(0.056 * S, 0.042 * S, 0.34 * S, mat));
    const footGeo = new THREE.BoxGeometry(0.09 * S, 0.055 * S, 0.19 * S);
    disposables.push(footGeo);
    const foot = new THREE.Mesh(footGeo, mat);
    foot.position.set(0, -0.36 * S, 0.04 * S);
    kn.add(foot);
    j['hip' + side] = hip; j['knee' + side] = kn;
  }

  root.traverse(o => { if (o.isMesh) { o.castShadow = !IS_TOUCH; o.receiveShadow = !IS_TOUCH; } });
  // shoulderY: pelvis (0.72) + chest (0.40). height: to the crown.
  return { root, j, scale: S, shoulderY: 1.12 * S, height: 1.42 * S };
}

function poseStatue(pose, mat) {
  const g = new THREE.Group();
  const a = buildBoy(mat, 1.05);
  const b = buildBoy(mat, 0.90);
  g.add(a.root, b.root);

  const set = (rig, name, x, y, z) => {
    const o = rig.j[name]; if (!o) return;
    o.rotation.set(x || 0, y || 0, z || 0);
  };

  if (pose === 'shoulders') {
    // The elder bears the younger. The younger has not come down.
    a.root.position.set(0, 0, 0);
    set(a, 'shoulderL', 0, 0, 2.5); set(a, 'shoulderR', 0, 0, -2.5);
    set(a, 'elbowL', 0, 0, -0.9); set(a, 'elbowR', 0, 0, 0.9);
    set(a, 'hipL', -0.06, 0, 0.05); set(a, 'hipR', 0.04, 0, -0.05);
    // Seat B's pelvis exactly on A's shoulders.
    b.root.position.set(0, a.shoulderY - 0.72 * b.scale, 0.02);
    set(b, 'hipL', -1.5, 0, 0.25); set(b, 'hipR', -1.5, 0, -0.25);
    set(b, 'kneeL', 1.1, 0, 0); set(b, 'kneeR', 1.1, 0, 0);
    set(b, 'shoulderL', 0, 0, 2.7); set(b, 'shoulderR', 0, 0, -2.7);
    set(b, 'elbowL', 0, 0, -0.5); set(b, 'elbowR', 0, 0, 0.5);
    set(b, 'neck', -0.15, 0, 0);
  } else if (pose === 'wrestle') {
    a.root.position.set(-0.40, 0, 0.05); a.root.rotation.y = 0.5;
    b.root.position.set(0.40, 0, -0.05); b.root.rotation.y = Math.PI - 0.5;
    for (const [r, s] of [[a, 1], [b, -1]]) {
      set(r, 'torso', 0.18, 0, 0);
      set(r, 'shoulderL', -1.35, 0, 0.42); set(r, 'shoulderR', -1.35, 0, -0.42);
      set(r, 'elbowL', 0, 0, -0.7); set(r, 'elbowR', 0, 0, 0.7);
      set(r, 'hipL', -0.42, 0, 0.1); set(r, 'kneeL', 0.62, 0, 0);
      set(r, 'hipR', 0.30 * s, 0, -0.1); set(r, 'kneeR', 0.18, 0, 0);
      set(r, 'neck', -0.2, 0, 0);
    }
  } else if (pose === 'handshake') {
    // Spread so the extended arms meet rather than passing through each other.
    a.root.position.set(-0.62, 0, 0); a.root.rotation.y = Math.PI / 2;
    b.root.position.set(0.62, 0, 0); b.root.rotation.y = -Math.PI / 2;
    set(a, 'shoulderR', -1.42, 0, -0.30); set(a, 'elbowR', 0, 0, 0.62);
    set(b, 'shoulderR', -1.42, 0, -0.30); set(b, 'elbowR', 0, 0, 0.62);
    set(a, 'shoulderL', 0, 0, 0.16); set(b, 'shoulderL', 0, 0, 0.16);
    set(a, 'neck', 0.1, 0, 0); set(b, 'neck', 0.1, 0, 0);
  } else if (pose === 'telescope') {
    // One points. The other has been looking since 1849.
    a.root.position.set(-0.42, 0, 0.06); a.root.rotation.y = 0.35;
    b.root.position.set(0.42, 0, -0.02); b.root.rotation.y = -0.2;
    set(a, 'shoulderR', -1.62, 0, -0.22); set(a, 'elbowR', 0, 0, 0.06);
    set(a, 'shoulderL', 0, 0, 0.2); set(a, 'neck', -0.12, 0.2, 0);
    set(b, 'shoulderR', -2.25, 0, -0.5); set(b, 'elbowR', 0, 0, 1.15);
    set(b, 'shoulderL', -1.75, 0, 0.42); set(b, 'elbowL', 0, 0, -0.75);
    set(b, 'neck', -0.25, 0, 0);
    const tg = new THREE.CylinderGeometry(0.036, 0.05, 0.5, 10);
    disposables.push(tg);
    const scope = new THREE.Mesh(tg, mat);
    scope.position.set(0.42 + 0.17, b.shoulderY + 0.17, 0.28);
    scope.rotation.set(Math.PI / 2.15, 0, -0.25);
    g.add(scope);
  } else { // 'listening'
    a.root.position.set(-0.40, 0, 0); a.root.rotation.y = 0.25;
    b.root.position.set(0.40, 0, 0.05); b.root.rotation.y = -0.4;
    set(a, 'shoulderR', -2.5, 0, -0.85); set(a, 'elbowR', 0, 0, 1.5);
    set(a, 'neck', 0, -0.45, 0.12); set(a, 'shoulderL', 0, 0, 0.12);
    set(b, 'neck', 0.42, 0.1, 0);
    set(b, 'shoulderL', 0, 0, 0.1); set(b, 'shoulderR', 0, 0, -0.1);
  }

  return g;
}

function buildPlinth(stoneMat) {
  const g = new THREE.Group();
  const parts = [
    [1.34, 0.13, 1.34, 0.065],
    [1.14, 0.70, 1.14, 0.48],
    [1.32, 0.12, 1.32, 0.89],
  ];
  for (const [w, h, d, y] of parts) {
    const geo = new THREE.BoxGeometry(w, h, d);
    disposables.push(geo);
    const m = new THREE.Mesh(geo, stoneMat);
    m.position.y = y;
    m.castShadow = !IS_TOUCH; m.receiveShadow = !IS_TOUCH;
    g.add(m);
  }
  return g;
}

function buildBench() {
  const g = new THREE.Group();
  const topGeo = new THREE.BoxGeometry(1.85, 0.16, 0.52);
  const legGeo = new THREE.BoxGeometry(0.10, 0.40, 0.44);
  disposables.push(topGeo, legGeo);
  const velvet = new THREE.MeshStandardMaterial({ color: 0x5c1a20, roughness: 0.95, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.7, metalness: 0 });
  const top = new THREE.Mesh(topGeo, velvet);
  top.position.y = 0.48; top.castShadow = !IS_TOUCH;
  g.add(top);
  for (const x of [-0.76, 0.76]) {
    const l = new THREE.Mesh(legGeo, wood);
    l.position.set(x, 0.20, 0);
    g.add(l);
  }
  return g;
}

// Posts + rope. Intentionally NOT collidable — walking through the rope is how
// you get shouted at, so it has to be possible.
function buildStanchions(points, brassMat, ropeMat) {
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.032, 0.05, 0.92, 10);
  const baseGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.05, 12);
  const finGeo = new THREE.SphereGeometry(0.052, 10, 8);
  disposables.push(postGeo, baseGeo, finGeo);

  for (const p of points) {
    const post = new THREE.Mesh(postGeo, brassMat); post.position.set(p.x, 0.49, p.z);
    const base = new THREE.Mesh(baseGeo, brassMat); base.position.set(p.x, 0.025, p.z);
    const fin = new THREE.Mesh(finGeo, brassMat); fin.position.set(p.x, 0.96, p.z);
    post.castShadow = !IS_TOUCH;
    g.add(post, base, fin);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0.62, (a.z + b.z) / 2);
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, 0.88, a.z), mid, new THREE.Vector3(b.x, 0.88, b.z)
    );
    const tg = new THREE.TubeGeometry(curve, 12, 0.021, 6, false);
    disposables.push(tg);
    g.add(new THREE.Mesh(tg, ropeMat));
  }
  return g;
}

// =============================================================================
// The gallery
// =============================================================================

function buildGallery() {
  const R = DATA.room;
  const W = R.width, D = R.depth, H = R.height;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x120c0a);
  scene.fog = new THREE.Fog(0x1a1210, 26, 62);

  // --- Environment (makes gold read as gold) ---
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSrc = new THREE.CanvasTexture(environmentTexture());
  envSrc.mapping = THREE.EquirectangularReflectionMapping;
  envSrc.colorSpace = THREE.SRGBColorSpace;
  const envRT = pmrem.fromEquirectangular(envSrc);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.85;
  envSrc.dispose(); pmrem.dispose();

  // --- Lights ---
  scene.add(new THREE.HemisphereLight(0xfff2d8, 0x2e1c14, 0.75));
  scene.add(new THREE.AmbientLight(0x5a4433, 0.35));
  const sun = new THREE.DirectionalLight(0xfff4dd, 2.1);
  sun.position.set(2.5, H + 6, 3);
  if (!IS_TOUCH) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -W / 2 - 2; sun.shadow.camera.right = W / 2 + 2;
    sun.shadow.camera.top = D / 2 + 2; sun.shadow.camera.bottom = -D / 2 - 2;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = H + 16;
    sun.shadow.bias = -0.0012;
  }
  scene.add(sun);

  // --- Materials ---
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a227, metalness: 0.92, roughness: 0.33,
    bumpMap: texFrom(giltBumpTexture(), { repeat: [7, 7], srgb: false }),
    bumpScale: 0.9,
  });
  const brass = new THREE.MeshStandardMaterial({ color: 0xa8863c, metalness: 0.88, roughness: 0.32 });
  const rope = new THREE.MeshStandardMaterial({ color: 0x6b1d22, roughness: 0.95, metalness: 0 });
  const marble = new THREE.MeshStandardMaterial({ color: 0xe4dfd3, roughness: 0.55, metalness: 0.02 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x8f8779, roughness: 0.72, metalness: 0.02 });
  const wood = new THREE.MeshStandardMaterial({ color: R.dadoColor, roughness: 0.6, metalness: 0.05 });

  // --- Floor ---
  const floorGeo = new THREE.PlaneGeometry(W, D);
  disposables.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    map: texFrom(parquetTexture(), { repeat: [7, 4] }), roughness: 0.42, metalness: 0.02,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = !IS_TOUCH;
  scene.add(floor);

  // --- Ceiling + coffers + skylight ---
  const ceilGeo = new THREE.PlaneGeometry(W, D);
  disposables.push(ceilGeo);
  const ceil = new THREE.Mesh(ceilGeo, new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.94 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
  scene.add(ceil);

  const beamMat = new THREE.MeshStandardMaterial({ color: 0xc0b294, roughness: 0.85 });
  const beamX = new THREE.BoxGeometry(W, 0.34, 0.30);
  const beamZ = new THREE.BoxGeometry(0.30, 0.34, D);
  disposables.push(beamX, beamZ);
  for (let i = -3; i <= 3; i++) {
    const b = new THREE.Mesh(beamX, beamMat);
    b.position.set(0, H - 0.17, i * (D / 7));
    scene.add(b);
  }
  for (let i = -4; i <= 4; i++) {
    const b = new THREE.Mesh(beamZ, beamMat);
    b.position.set(i * (W / 9), H - 0.17, 0);
    scene.add(b);
  }

  const skyGeo = new THREE.PlaneGeometry(W * 0.44, D * 0.46);
  disposables.push(skyGeo);
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ color: 0xfffaee }));
  sky.rotation.x = Math.PI / 2; sky.position.y = H - 0.02;
  scene.add(sky);

  // --- Walls ---
  const damask = texFrom(damaskTexture(), { repeat: [6, 3] });
  const wallMat = new THREE.MeshStandardMaterial({ map: damask, roughness: 0.92, metalness: 0 });
  const wallDefs = [
    { w: W, x: 0, z: -D / 2, ry: 0 },
    { w: W, x: 0, z: D / 2, ry: Math.PI },
    { w: D, x: -W / 2, z: 0, ry: Math.PI / 2 },
    { w: D, x: W / 2, z: 0, ry: -Math.PI / 2 },
  ];
  for (const wd of wallDefs) {
    const g = new THREE.PlaneGeometry(wd.w, H);
    disposables.push(g);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set(wd.x, H / 2, wd.z);
    m.rotation.y = wd.ry;
    m.receiveShadow = !IS_TOUCH;
    scene.add(m);

    // Dado, chair rail, baseboard, cornice.
    const dadoGeo = new THREE.BoxGeometry(wd.w, 1.02, 0.07);
    const railGeo = new THREE.BoxGeometry(wd.w, 0.10, 0.13);
    const baseGeo = new THREE.BoxGeometry(wd.w, 0.20, 0.11);
    const cornGeo = new THREE.BoxGeometry(wd.w, 0.30, 0.16);
    disposables.push(dadoGeo, railGeo, baseGeo, cornGeo);
    const nx = Math.sin(wd.ry), nz = Math.cos(wd.ry);
    const place = (mesh, y, off) => {
      mesh.position.set(wd.x + nx * off, y, wd.z + nz * off);
      mesh.rotation.y = wd.ry;
      scene.add(mesh);
    };
    place(new THREE.Mesh(dadoGeo, wood), 0.51, 0.04);
    place(new THREE.Mesh(railGeo, wood), 1.06, 0.07);
    place(new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x241710, roughness: 0.7 })), 0.10, 0.06);
    place(new THREE.Mesh(cornGeo, new THREE.MeshStandardMaterial({
      color: 0xb99a4e, metalness: 0.6, roughness: 0.42,
    })), H - 0.55, 0.08);
  }

  // --- The doorway that goes nowhere ---
  {
    const aw = 1.7, ah = 3.4;
    const s = new THREE.Shape();
    s.moveTo(-aw / 2, 0); s.lineTo(-aw / 2, ah - aw / 2);
    s.absarc(0, ah - aw / 2, aw / 2, Math.PI, 0, true);
    s.lineTo(aw / 2, 0); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 0.5, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.09, bevelSegments: 2, curveSegments: 16,
    });
    disposables.push(g);
    const arch = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1 }));
    arch.position.set(W / 2 - 0.05, 0, 0);
    arch.rotation.y = -Math.PI / 2;
    scene.add(arch);

    // Sign.
    const cv = makeCanvas(512, 128), c = cv.getContext('2d');
    c.fillStyle = '#efe9dc'; c.fillRect(0, 0, 512, 128);
    c.strokeStyle = '#3a2f1f'; c.lineWidth = 5; c.strokeRect(9, 9, 494, 110);
    c.fillStyle = '#241c12'; c.font = 'bold 46px Georgia, serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('GALLERY CLOSED', 256, 64);
    const sg = new THREE.PlaneGeometry(1.15, 0.29);
    disposables.push(sg);
    const sign = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: texFrom(cv), roughness: 0.9 }));
    sign.position.set(W / 2 - 0.9, 1.55, 0);
    sign.rotation.y = -Math.PI / 2;
    scene.add(sign);
    scene.add(buildStanchions(
      [{ x: W / 2 - 0.95, z: -1.0 }, { x: W / 2 - 0.95, z: 1.0 }], brass, rope
    ));
  }

  // --- Hang the paintings -------------------------------------------------
  // Walls weighted by length; east wall is the doorway, so it stays empty.
  const hangs = [
    { len: W - 4, mid: 0, fixed: -D / 2 + 0.08, ry: 0, axis: 'x', nx: 0, nz: 1, weight: W - 4 },
    { len: W - 4, mid: 0, fixed: D / 2 - 0.08, ry: Math.PI, axis: 'x', nx: 0, nz: -1, weight: W - 4 },
    { len: D - 4, mid: 0, fixed: -W / 2 + 0.08, ry: Math.PI / 2, axis: 'z', nx: 1, nz: 0, weight: D - 4 },
  ];
  const total = hangs.reduce((s, h) => s + h.weight, 0);
  const n = DATA.paintings.length;
  const counts = hangs.map(h => Math.floor(n * h.weight / total));
  let rem = n - counts.reduce((a, b) => a + b, 0);
  const order = hangs.map((h, i) => i).sort((a, b) =>
    (n * hangs[b].weight / total % 1) - (n * hangs[a].weight / total % 1));
  for (let i = 0; rem > 0; i++, rem--) counts[order[i % order.length]]++;

  let pi = 0;
  hangs.forEach((hw, wi) => {
    const k = counts[wi];
    for (let i = 0; i < k && pi < n; i++, pi++) {
      const item = DATA.paintings[pi];
      const t = -hw.len / 2 + hw.len * ((i + 0.5) / k);
      const cy = Math.max(2.30, 1.35 + item.h / 2);

      const { group, outerW } = buildFramedPainting(item, gold, pi);
      const px = hw.axis === 'x' ? t : hw.fixed;
      const pz = hw.axis === 'x' ? hw.fixed : t;
      group.position.set(px, cy, pz);
      group.rotation.y = hw.ry;
      scene.add(group);

      // Label, to the right as you face the wall. Offset from the FRAME's outer
      // edge, not the canvas — a heavy moulding is ~0.25m wider per side and
      // was sitting on top of the card.
      const label = buildLabel(item);
      const lo = outerW / 2 + 0.42;
      const tanX = hw.axis === 'x' ? 1 : 0, tanZ = hw.axis === 'x' ? 0 : 1;
      const dir = hw.ry === Math.PI ? -1 : 1;
      label.position.set(
        px + tanX * lo * dir + hw.nx * 0.05,
        1.52,
        pz + tanZ * lo * dir + hw.nz * 0.05
      );
      label.rotation.y = hw.ry;
      scene.add(label);

      // Ropes at exactly the guard radius, so the line you're crossing is visible.
      const r = DATA.guard.radius;
      const half = Math.max(item.w / 2 + 0.5, 1.0);
      scene.add(buildStanchions([
        { x: px + tanX * -half + hw.nx * r, z: pz + tanZ * -half + hw.nz * r },
        { x: px + tanX * half + hw.nx * r, z: pz + tanZ * half + hw.nz * r },
      ], brass, rope));

      zones.push({ x: px, z: pz, r, inside: false, kind: 'painting' });
    }
  });

  // --- Statues down the centre --------------------------------------------
  const sn = DATA.statues.length;
  DATA.statues.forEach((st, i) => {
    const x = sn === 1 ? 0 : -(W / 2 - 4) + (W - 8) * (i / (sn - 1));
    const z = 0;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(buildPlinth(stone));

    if (st.model) {
      new GLTFLoader().load(st.model, (gltf) => {
        const o = gltf.scene;
        // Auto-fit whatever units the export used onto the plinth.
        const box = new THREE.Box3().setFromObject(o);
        const size = new THREE.Vector3(), centre = new THREE.Vector3();
        box.getSize(size); box.getCenter(centre);
        const s = 1.55 / Math.max(size.y, 0.0001);
        o.scale.setScalar(s);
        o.position.set(-centre.x * s, 0.95 - box.min.y * s, -centre.z * s);
        o.traverse(m => { if (m.isMesh) { m.castShadow = !IS_TOUCH; m.receiveShadow = !IS_TOUCH; } });
        g.add(o);
        sceneChanged();
      }, undefined, () => {
        // Object3D.position is a non-writable accessor, so Object.assign on it
        // throws a TypeError in strict mode (modules are always strict) —
        // meaning the fallback statue never appeared at all.
        const fig = poseStatue(st.pose, marble);
        fig.position.y = 0.95;
        fig.rotation.y = (i % 2 ? 1 : -1) * 0.35;
        g.add(fig);
        sceneChanged();
      });
    } else {
      const fig = poseStatue(st.pose, marble);
      fig.position.y = 0.95;
      fig.rotation.y = (i % 2 ? 1 : -1) * 0.35;
      g.add(fig);
    }

    // Placard on the plinth face.
    const label = buildLabel(st);
    label.scale.setScalar(0.82);
    label.position.set(0, 0.62, 0.69);
    label.rotation.x = -0.32;
    g.add(label);

    scene.add(g);

    obstacles.circles.push({ x, z, r: 0.98 });
    zones.push({ x, z, r: 1.6, inside: false, kind: 'statue' });
  });

  // --- Benches -------------------------------------------------------------
  for (const [bx, bz] of [[-6.5, 3.6], [6.5, 3.6], [-6.5, -3.6], [6.5, -3.6]]) {
    const b = buildBench();
    b.position.set(bx, 0, bz);
    b.rotation.y = Math.PI / 2;
    scene.add(b);
    obstacles.boxes.push({ minX: bx - 0.42, maxX: bx + 0.42, minZ: bz - 1.05, maxZ: bz + 1.05 });
  }

  built = true;
}

// =============================================================================
// The guard
// =============================================================================

function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  if (!vs || !vs.length) return;
  const want = ['Daniel', 'Alex', 'Fred', 'Google UK English Male', 'Google US English', 'Microsoft David'];
  guardVoice =
    want.map(nm => vs.find(v => v.name.includes(nm))).find(Boolean) ||
    vs.find(v => /^en[-_]/i.test(v.lang)) ||
    vs[0];
}

function primeSpeech() {
  if (speechPrimed || !window.speechSynthesis) return;
  speechPrimed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* no-op */ }
  pickVoice();
}

function shout(kind) {
  // Statues get their own script; escalation level is shared across both, so
  // the guard keeps deteriorating no matter what you crowd.
  const statue = DATA.statueLines;
  const lines = (kind === 'statue' && statue && statue.length) ? statue : DATA.guardLines;
  const line = lines[Math.min(guardLevel, lines.length - 1)];
  const text = typeof line === 'string' ? line : line.text;
  const audio = typeof line === 'string' ? null : line.audio;
  guardLevel++;

  if (elCaption) {
    elCaption.textContent = text;
    elCaption.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => elCaption && elCaption.classList.remove('show'), 3400);
  }

  if (muted) return;
  if (audio) {
    // Held on a module handle so stop() can silence it — otherwise a line that
    // starts just before a mode switch plays on over whatever comes next.
    if (guardAudio) { guardAudio.pause(); guardAudio = null; }
    guardAudio = new Audio(audio);
    guardAudio.volume = 1;
    guardAudio.play().catch(() => {});
  } else if (window.speechSynthesis) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (guardVoice) u.voice = guardVoice;
      u.rate = DATA.guard.rate;
      u.pitch = DATA.guard.pitch;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch { /* no-op */ }
  }
}

function checkZones(now) {
  for (const z of zones) {
    const dx = pos.x - z.x, dz = pos.z - z.z;
    const inside = (dx * dx + dz * dz) < z.r * z.r;
    if (inside && !z.inside) {
      // Only latch once the shout actually happens. Latching unconditionally
      // burned the edge trigger whenever you entered during the 4s cooldown —
      // and north-wall paintings are 6.7m apart, i.e. ~2s at walking pace, so
      // the guard went silent for every other painting.
      if (now - lastShout > DATA.guard.cooldown) {
        lastShout = now;
        shout(z.kind);
        z.inside = true;
      }
    } else {
      z.inside = inside;
    }
  }
}

// =============================================================================
// Movement
// =============================================================================

function collide(p) {
  const R = DATA.room, m = 0.55;
  p.x = Math.max(-R.width / 2 + m, Math.min(R.width / 2 - m, p.x));
  p.z = Math.max(-R.depth / 2 + m, Math.min(R.depth / 2 - m, p.z));

  for (const c of obstacles.circles) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz), min = c.r + 0.38;
    if (d < min && d > 0.0001) {
      p.x = c.x + (dx / d) * min;
      p.z = c.z + (dz / d) * min;
    }
  }
  for (const b of obstacles.boxes) {
    const pad = 0.38;
    if (p.x > b.minX - pad && p.x < b.maxX + pad && p.z > b.minZ - pad && p.z < b.maxZ + pad) {
      // Push out along whichever axis needs the least correction.
      const dl = Math.abs(p.x - (b.minX - pad)), dr = Math.abs(p.x - (b.maxX + pad));
      const db = Math.abs(p.z - (b.minZ - pad)), df = Math.abs(p.z - (b.maxZ + pad));
      const mn = Math.min(dl, dr, db, df);
      if (mn === dl) p.x = b.minX - pad;
      else if (mn === dr) p.x = b.maxX + pad;
      else if (mn === db) p.z = b.minZ - pad;
      else p.z = b.maxZ + pad;
    }
  }
}

function update(dt, now) {
  let fwd = 0, str = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) str += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) str -= 1;
  if (joyActive) { fwd += -joyVec.y; str += joyVec.x; }

  const len = Math.hypot(fwd, str);
  if (len > 1) { fwd /= len; str /= len; }

  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? RUN : WALK;
  const sy = Math.sin(yaw), cy = Math.cos(yaw);
  const dx = (-sy * fwd + cy * str) * speed * dt;
  const dz = (-cy * fwd - sy * str) * speed * dt;

  if (dx || dz) {
    pos.x += dx; pos.z += dz;
    collide(pos);
    bobT += Math.hypot(dx, dz) * 6.5;
  } else {
    bobT += dt * 0.6;
  }

  camera.position.set(pos.x, EYE + Math.sin(bobT) * 0.032, pos.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');

  checkZones(now);
}

// =============================================================================
// Input
// =============================================================================

function onKeyDown(e) {
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
}
function onKeyUp(e) { keys.delete(e.code); }

function applyLook(dx, dy, sens) {
  yaw -= dx * sens;
  pitch -= dy * sens;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
}

function onMouseMove(e) {
  if (document.pointerLockElement === canvas) {
    applyLook(e.movementX, e.movementY, LOOK_SENS);
  } else if (dragging) {
    // Fallback for anywhere pointer lock is refused (embedded webviews, some
    // locked-down browsers) — without this you could walk but never turn.
    applyLook(e.clientX - dragLast.x, e.clientY - dragLast.y, LOOK_SENS * 1.6);
    dragLast.x = e.clientX; dragLast.y = e.clientY;
  }
}

function onMouseDown(e) {
  if (document.pointerLockElement === canvas) return;
  dragging = true;
  dragLast.x = e.clientX; dragLast.y = e.clientY;
}

function onMouseUp() { dragging = false; }

function onPointerLockChange() {
  const locked = document.pointerLockElement === canvas;
  if (locked) { wasLocked = true; return; }
  // Only re-show the entry card if we actually held the lock and lost it (esc).
  // If the lock was never granted, the drag fallback is driving and the card
  // must stay out of the way.
  if (wasLocked) {
    wasLocked = false;
    if (elEnter) elEnter.style.display = 'flex';
    if (elCrosshair) elCrosshair.style.display = 'none';
    keys.clear();
  }
}

function onCanvasClick() {
  primeSpeech();
  if (elEnter) elEnter.style.display = 'none';
  if (elCrosshair) elCrosshair.style.display = 'block';
  if (!IS_TOUCH && document.pointerLockElement !== canvas) {
    // Modern Chrome returns a Promise here, so a denial (sandboxed iframe, no
    // user gesture) escapes try/catch as an unhandled rejection.
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* drag fallback covers it */ }
  }
}

// --- Touch -------------------------------------------------------------------
function onTouchStart(e) {
  // The mute button is a child of the container this is bound to, and the
  // preventDefault() below suppresses its synthesized click. Worse, it sits on
  // the right half of the screen, so tapping mute was swinging the camera.
  // touch-action:none on #museum-container is what actually blocks scrolling,
  // so bailing here costs nothing.
  if (elMute && e.target && elMute.contains(e.target)) return;
  primeSpeech();
  if (elEnter) elEnter.style.display = 'none';
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth * 0.45 && joyId === null) {
      joyId = t.identifier; joyActive = true;
      elJoy.style.display = 'block';
      elJoy.style.left = t.clientX + 'px';
      elJoy.style.top = t.clientY + 'px';
      joyVec.x = 0; joyVec.y = 0;
      elJoyThumb.style.transform = 'translate(-50%,-50%)';
    } else if (lookId === null) {
      lookId = t.identifier;
      lookLast.x = t.clientX; lookLast.y = t.clientY;
    }
  }
  e.preventDefault();
}

function onTouchMove(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) {
      const base = elJoy.getBoundingClientRect();
      const cx = base.left + base.width / 2, cy = base.top + base.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const max = 46, d = Math.hypot(dx, dy);
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      joyVec.x = dx / max; joyVec.y = dy / max;
      elJoyThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (t.identifier === lookId) {
      yaw -= (t.clientX - lookLast.x) * 0.005;
      pitch -= (t.clientY - lookLast.y) * 0.005;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      lookLast.x = t.clientX; lookLast.y = t.clientY;
    }
  }
  e.preventDefault();
}

function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) {
      joyId = null; joyActive = false; joyVec.x = 0; joyVec.y = 0;
      elJoy.style.display = 'none';
    } else if (t.identifier === lookId) {
      lookId = null;
    }
  }
}

function onResize() {
  if (!renderer || !camera) return;
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

// =============================================================================
// Lifecycle
// =============================================================================

function loop(now) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  update(dt, now);
  renderer.render(scene, camera);
}

function start() {
  // The host currently guarantees stop() runs first, but nothing in here
  // enforced it: a second start() would double every listener and leave two
  // rAF loops rendering.
  if (running) return;
  container = document.getElementById('museum-container');
  elCaption = document.getElementById('museum-caption');
  elEnter = document.getElementById('museum-enter');
  elJoy = document.getElementById('museum-joystick');
  elJoyThumb = document.getElementById('museum-joystick-thumb');
  elMute = document.getElementById('museum-mute');
  elCrosshair = document.getElementById('museum-crosshair');

  if (!built) {
    renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = !IS_TOUCH;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    canvas = renderer.domElement;
    canvas.id = 'museum-canvas';
    container.insertBefore(canvas, container.firstChild);

    camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 120);

    buildGallery();

    // Nothing in this scene moves except the camera, so re-rendering the
    // 2048² shadow map every frame was drawing the entire object set twice
    // per frame for an identical result.
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;

    // NOT doing `scene.matrixWorldAutoUpdate = false` as well. It's valid by the
    // same "nothing moves" argument and would skip the per-frame matrix walk,
    // but the payoff is small next to the shadow fix and the failure mode if
    // anything ever does animate is corrupted geometry rather than a stale
    // shadow. Revisit with a visual A/B.
  }

  // Reset the visit. Seed each zone with whether we're already standing in it,
  // so arriving in the gallery never counts as a violation.
  pos.set(0, EYE, DATA.room.depth / 2 - 3.5);
  yaw = 0; pitch = 0; bobT = 0;
  // Without this the guard's escalation restarts at the punchline on a second
  // visit — the build-up is the entire joke.
  guardLevel = 0; lastShout = 0;
  for (const z of zones) {
    const dx = pos.x - z.x, dz = pos.z - z.z;
    z.inside = (dx * dx + dz * dz) < z.r * z.r;
  }
  camera.position.copy(pos);
  camera.rotation.set(0, 0, 0, 'YXZ');

  const loading = document.getElementById('museum-loading');
  if (loading) loading.style.display = 'none';
  if (elEnter) elEnter.style.display = 'flex';
  if (elCrosshair) elCrosshair.style.display = 'none';
  if (elJoy) elJoy.style.display = 'none';

  on(document, 'keydown', onKeyDown);
  on(document, 'keyup', onKeyUp);
  on(document, 'mousemove', onMouseMove);
  on(canvas, 'mousedown', onMouseDown);
  on(document, 'mouseup', onMouseUp);
  on(document, 'pointerlockchange', onPointerLockChange);
  on(canvas, 'click', onCanvasClick);
  on(elEnter, 'click', onCanvasClick);
  on(window, 'resize', onResize);
  on(container, 'touchstart', onTouchStart, { passive: false });
  on(container, 'touchmove', onTouchMove, { passive: false });
  on(container, 'touchend', onTouchEnd);
  on(container, 'touchcancel', onTouchEnd);
  // In the drag-fallback path wasLocked is never true, so onPointerLockChange
  // never clears keys — alt-tab while holding W and you walk into a wall until
  // you come back.
  on(window, 'blur', () => {
    keys.clear();
    dragging = false; joyActive = false; joyId = null; lookId = null;
    joyVec.x = 0; joyVec.y = 0;
  });
  on(elMute, 'click', (e) => {
    e.stopPropagation();
    muted = !muted;
    elMute.textContent = muted ? 'GUARD: MUTED' : 'GUARD: ON';
    elMute.classList.toggle('muted', muted);
    if (muted) {
      if (window.speechSynthesis) speechSynthesis.cancel();
      if (guardAudio) { guardAudio.pause(); guardAudio = null; }
    }
  });
  if (window.speechSynthesis) {
    on(window.speechSynthesis, 'voiceschanged', pickVoice);
    pickVoice();
  }

  onResize();
  running = true;
  lastT = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stop() {
  running = false;
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (guardAudio) { guardAudio.pause(); guardAudio = null; }
  clearTimeout(captionTimer);
  if (elCaption) elCaption.classList.remove('show');
  keys.clear();
  joyActive = false; joyId = null; lookId = null;
  joyVec.x = 0; joyVec.y = 0;
  dragging = false; wasLocked = false;
  offAll();
}

export default { start, stop };
