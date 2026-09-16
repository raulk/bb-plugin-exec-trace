// Transparent Node tracer, CJS entry (loaded via NODE_OPTIONS --require).
// Patches child_process + fs.open + dns + http(s) to log spans as NDJSON.
// Never throws: any failure disables tracing silently.
'use strict';

if (process.env.BB_TRACE_ACTIVE_NODE) return;
process.env.BB_TRACE_ACTIVE_NODE = '1';

const fs = require('fs');
const os = require('os');
const path = require('path');

const TRACE_DIR = process.env.BB_TRACE_DIR || '';
const THREAD = process.env.BB_THREAD_ID || '';
let FD = null;
let inHook = false;

function trunc(s, n) {
  try { s = String(s); } catch { return '<unrepr>'; }
  return s.length <= n ? s : s.slice(0, n) + `…<${s.length}>`;
}

function emit(ev, fields) {
  if (FD === null || inHook) return;
  inHook = true;
  try {
    const rec = Object.assign(
      { ts_ns: Date.now() * 1e6, pid: process.pid, ppid: process.ppid || -1, rt: 'node', ev, thread: THREAD },
      fields || {}
    );
    let line = JSON.stringify(rec) + '\n';
    if (line.length > 8192) line = line.slice(0, 8192) + '\n';
    fs.writeSync(FD, line);
  } catch { /* never break user code */ }
  inHook = false;
}

function openLog() {
  if (!TRACE_DIR) return;
  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    const p = path.join(TRACE_DIR, `node-${process.pid}.ndjson`);
    FD = fs.openSync(p, 'a', 0o600);
  } catch { FD = null; }
}

function reinject(env) {
  // If script cleared env for a child, restore tracing vars so grandchildren stay visible.
  try {
    if (!env || typeof env !== 'object') return env;
    if (!env.PYTHONPATH && process.env.PYTHONPATH) env.PYTHONPATH = process.env.PYTHONPATH;
    if (!env.NODE_OPTIONS && process.env.NODE_OPTIONS) env.NODE_OPTIONS = process.env.NODE_OPTIONS;
    if (!env.BASH_ENV && process.env.BASH_ENV) env.BASH_ENV = process.env.BASH_ENV;
    if (!env.BB_TRACE_DIR && process.env.BB_TRACE_DIR) env.BB_TRACE_DIR = process.env.BB_TRACE_DIR;
    if (!env.BB_THREAD_ID && process.env.BB_THREAD_ID) env.BB_THREAD_ID = process.env.BB_THREAD_ID;
  } catch {}
  return env;
}

function patchChild() {
  let cp;
  try { cp = require('child_process'); } catch { return; }
  if (cp.__bb_traced) return;
  cp.__bb_traced = true;
  for (const m of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
    const orig = cp[m];
    if (typeof orig !== 'function' || orig.__bb_traced) continue;
    const SYNC = m === 'spawnSync' || m === 'execSync' || m === 'execFileSync';
    const w = function (...a) {
      let cmd = '';
      try {
        if (m === 'spawn' || m === 'spawnSync' || m === 'execFile' || m === 'execFileSync' || m === 'fork') cmd = Array.isArray(a[0]) ? a[0].join(' ') : String(a[0] ?? '');
        else cmd = String(a[0] ?? '');
        // re-inject env into options arg
        const last = a[a.length - 1];
        if (last && typeof last === 'object' && !Array.isArray(last)) last.env = reinject(last.env || Object.assign({}, process.env));
      } catch {}
      const t0 = Date.now();
      try { emit('proc.spawn', { op: m, cmd: trunc(cmd, 2000) }); } catch {}
      let r;
      try {
        r = orig.apply(this, a);
      } catch (e) {
        try { emit('proc.done', { op: m, cmd: trunc(cmd, 2000), durMs: Date.now() - t0, error: trunc(String(e && e.message || e), 200) }); } catch {}
        throw e;
      }
      if (SYNC) {
        try { emit('proc.done', { op: m, cmd: trunc(cmd, 2000), durMs: Date.now() - t0 }); } catch {}
        return r;
      }
      try {
        if (r && typeof r.once === 'function') {
          r.once('exit', () => { try { emit('proc.done', { op: m, cmd: trunc(cmd, 2000), durMs: Date.now() - t0 }); } catch {} });
        }
      } catch {}
      return r;
    };
    w.__bb_traced = true;
    cp[m] = w;
  }
}

function patchFs() {
  let f;
  try { f = require('fs'); } catch { return; }
  if (f.__bb_traced) return;
  f.__bb_traced = true;
  const wrap = (obj, name, getPath) => {
    const orig = obj[name];
    if (typeof orig !== 'function' || orig.__bb_traced) return;
    const w = function (...a) {
      try { emit('file.open', { op: name, path: trunc(getPath(a), 1000) }); } catch {}
      return orig.apply(this, a);
    };
    w.__bb_traced = true;
    obj[name] = w;
  };
  const isSelf = (p) => { try { const s = String(p); return s.includes('bb_trace') || s.includes('sitecustomize'); } catch { return false; } };
  const wrapPath = (obj, name, getPath) => {
    const orig = obj[name];
    if (typeof orig !== 'function' || orig.__bb_traced) return;
    const w = function (...a) {
      try { const p = getPath(a); if (!isSelf(p)) emit('file.open', { op: name, path: trunc(p, 1000) }); } catch {}
      return orig.apply(this, a);
    };
    w.__bb_traced = true;
    obj[name] = w;
  };
  wrap(f, 'openSync', (a) => a[0]);
  wrap(f, 'open', (a) => a[0]);
  wrapPath(f, 'readFileSync', (a) => a[0]);
  wrapPath(f, 'writeFileSync', (a) => a[0]);
  wrapPath(f, 'appendFileSync', (a) => a[0]);
  wrapPath(f, 'readdirSync', (a) => a[0]);
  wrapPath(f, 'statSync', (a) => a[0]);
  try {
    const p = require('fs/promises');
    const orig = p.open;
    if (typeof orig === 'function' && !orig.__bb_traced) {
      const w = async function (...a) {
        try { emit('file.open', { op: 'promises.open', path: trunc(a[0], 1000) }); } catch {}
        return orig.apply(this, a);
      };
      w.__bb_traced = true;
      p.open = w;
    }
  } catch {}
}

function patchNet() {
  try {
    const dns = require('dns');
    const orig = dns.lookup;
    if (typeof orig === 'function' && !orig.__bb_traced) {
      const w = function (...a) {
        try { emit('net.lookup', { host: trunc(a[0], 500) }); } catch {}
        return orig.apply(this, a);
      };
      w.__bb_traced = true;
      dns.lookup = w;
    }
  } catch {}
  for (const mod of ['http', 'https']) {
    try {
      const h = require(mod);
      const orig = h.request;
      if (typeof orig === 'function' && !orig.__bb_traced) {
        const w = function (...a) {
          try { emit('net.request', { mod, target: trunc(a[0] && (a[0].host || a[0].hostname || a[0]), 500) }); } catch {}
          return orig.apply(this, a);
        };
        w.__bb_traced = true;
        h.request = w;
      }
    } catch {}
  }
}

openLog();
patchChild();
patchFs();
patchNet();
try {
  emit('proc.start', { argv: trunc(process.argv.slice(1).join(' '), 2000), exe: trunc(process.execPath, 500) });
} catch {}
