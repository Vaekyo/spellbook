// Turns an asset reference into something the overlay can play.
// "assets/fx/a.webm" -> video, "assets/fx/a.png" -> image,
// "assets/fx/folder" or { "frames": "assets/fx/folder", "fps": 30 } -> PNG sequence.
const fs = require('fs');
const path = require('path');
const log = require('./log');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const VIDEO = /\.(webm|mp4|mov|m4v)$/i;
const IMAGE = /\.(png|apng|gif|webp|jpe?g|svg)$/i;
const AUDIO = /\.(mp3|ogg|wav|m4a|opus)$/i;

// Absolute path inside /assets, or null if outside / missing.
function assetPath(rel) {
  const abs = path.resolve(ROOT, String(rel).replace(/^\/+/, ''));
  if (abs !== ASSETS && !abs.startsWith(ASSETS + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

const toUrl = (abs) => '/' + path.relative(ROOT, abs).split(path.sep).map(encodeURIComponent).join('/');
const sortNatural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

function resolve(ref) {
  if (!ref) return null;
  const o = typeof ref === 'string' ? { src: ref } : { ...ref, src: ref.frames || ref.src };
  if (!o.src) return null;
  const abs = assetPath(o.src);
  if (!abs) { log.warn(`Asset not found (must be inside /assets): ${o.src}`); return null; }
  const loop = !!o.loop;
  if (fs.statSync(abs).isDirectory()) {
    const frames = fs.readdirSync(abs).filter((f) => IMAGE.test(f)).sort(sortNatural);
    if (!frames.length) { log.warn(`No images in PNG sequence folder: ${o.src}`); return null; }
    return { kind: 'frames', frames: frames.map((f) => toUrl(path.join(abs, f))), fps: Number(o.fps) || 30, loop };
  }
  if (VIDEO.test(abs)) return { kind: 'video', src: toUrl(abs), loop };
  if (IMAGE.test(abs)) return { kind: 'image', src: toUrl(abs) };
  if (AUDIO.test(abs)) return { kind: 'audio', src: toUrl(abs) };
  log.warn(`Unsupported asset type: ${o.src}`);
  return null;
}

// Lists files and folders under /assets (folders end with "/"); PNG-sequence frames are collapsed.
function list() {
  const out = [];
  (function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => sortNatural(a.name, b.name));
    // A folder with many images is a PNG sequence: list the folder, not every frame.
    const isSeq = entries.filter((e) => e.isFile() && IMAGE.test(e.name)).length >= 5;
    for (const e of entries) {
      if (e.name.startsWith('.') || (isSeq && e.isFile() && IMAGE.test(e.name))) continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (e.isDirectory()) { out.push(rel + '/'); walk(abs); }
      else out.push(rel);
    }
  })(ASSETS);
  return out;
}

module.exports = { resolve, list, assetPath, ASSETS };
