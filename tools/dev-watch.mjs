#!/usr/bin/env node
// Lightweight dev watcher that writes a version file for client auto-reload
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root (parent of ./tools)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT = path.resolve(__dirname, '..');
const WATCH_DIRS = [path.join(PROJECT, 'src'), path.join(PROJECT, 'index.html')];
const OUT_FILE = path.join(PROJECT, 'live-reload.json');

function listFiles(dir) {
  try {
    const st = fs.statSync(dir);
    if (st.isFile()) return [dir];
  } catch { return []; }
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out.sort();
}

function computeVersion() {
  const files = WATCH_DIRS.flatMap(listFiles);
  let acc = 0 >>> 0;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      // Mix size and mtime into a simple rolling hash (deterministic unless files change)
      const m = (st.mtimeMs | 0) >>> 0;
      const sz = (st.size | 0) >>> 0;
      acc = ((acc ^ ((m << 5) - m + sz)) >>> 0);
    } catch {}
  }
  return acc.toString(16);
}

let last = '';
function writeVersion(ver) {
  const payload = JSON.stringify({ version: ver, time: Date.now() });
  try { fs.writeFileSync(OUT_FILE, payload); } catch {}
}

// Prime version file
last = computeVersion();
writeVersion(last);
console.log('[dev-watch] live reload active. Writing', path.relative(PROJECT, OUT_FILE));

setInterval(() => {
  const v = computeVersion();
  if (v !== last) {
    last = v;
    writeVersion(v);
    console.log('[dev-watch] change detected ->', v);
  }
}, 700);
