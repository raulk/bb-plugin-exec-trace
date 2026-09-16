/** Profiler: parse transparent-tracer NDJSON into a per-operation breakdown. */
export interface Span {
  rt: string;
  ev: string;
  pid: number;
  tsNs?: number;
  tsSec?: number;
  /** Normalized epoch milliseconds for timeline rendering. */
  tMs?: number;
  file?: string;
  cmd?: string;
  path?: string;
  op?: string;
  thread?: string;
}

export interface OpRow {
  op: string;
  runtime: string;
  count: number;
  sample: string;
}

export interface SpanView {
  tMs: number | null;
  rt: string;
  op: string;
  label: string;
  pid: number;
}

export interface ProcessRow {
  rt: string;
  pid: number;
  count: number;
}

export interface ProfileSummary {
  totalSpans: number;
  byRuntime: { runtime: string; count: number }[];
  byOp: OpRow[];
  files: { file: string; lines: number }[];
  processes: ProcessRow[];
  /** Earliest / latest span timestamps (epoch ms) for the timeline window. */
  startMs: number | null;
  endMs: number | null;
  /** Most recent spans by time (capped), oldest first. */
  recent: SpanView[];
  notes: string[];
}

/** Cap on spans shipped to the frontend timeline. */
export const MAX_RECENT = 500;

function parseTsNs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

/** Parse one NDJSON line from any of the three shims. Returns null when ignorable. */
export function parseLine(line: string): Span | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith("+TRACE")) {
    // bash: +TRACE ts=... pid=... sub=... thread=... :: <cmd>
    const m = t.match(/ts=([0-9.]+)\s+pid=([0-9]+).*?::\s?(.*)$/);
    if (!m) return null;
    const sec = Number(m[1]);
    return {
      rt: "bash",
      ev: "cmd",
      pid: Number(m[2]),
      tsSec: Number.isFinite(sec) ? sec : undefined,
      tMs: Number.isFinite(sec) ? sec * 1000 : undefined,
      cmd: (m[3] ?? "").slice(0, 500),
    };
  }
  try {
    const r = JSON.parse(t) as Record<string, unknown>;
    if (typeof r.ev !== "string") return null;
    // Filter stdlib noise so the profiler shows user operations.
    const p = typeof r.path === "string" ? r.path : "";
    if (p.includes("__pycache__") || p.endsWith(".pyc")) return null;
    if (p.includes("/lib/python") && p.includes("site-packages")) return null;
    if (p === "<input>" || p === "<string>") return null;
    if (typeof r.path === "string" && r.path.match(/^[0-9]+$/)) return null; // pipe fds
    if (r.ev === "file.os_listdir" && p !== "/data" && !p.startsWith("/tmp")) return null;
    const tsNs = parseTsNs(r.ts_ns);
    return {
      rt: String(r.rt ?? "unknown"),
      ev: String(r.ev),
      pid: typeof r.pid === "number" ? r.pid : -1,
      tsNs,
      tMs: tsNs !== undefined ? tsNs / 1e6 : undefined,
      cmd: typeof r.cmd === "string" ? r.cmd.slice(0, 300) : undefined,
      path: typeof r.path === "string" ? r.path.slice(0, 300) : undefined,
      op: typeof r.op === "string" ? r.op : undefined,
      thread: typeof r.thread === "string" ? r.thread : undefined,
    };
  } catch {
    return null;
  }
}

export function classify(s: Span): string {
  if (s.rt === "bash") return "bash:command";
  if (s.ev === "proc.start") return `${s.rt}:start`;
  if (s.ev === "proc.spawn" || s.ev === "proc.popen" || s.ev === "proc.system" || s.ev === "proc.exec")
    return `${s.rt}:subprocess`;
  if (s.ev.startsWith("file.")) return `${s.rt}:file-io`;
  if (s.ev.startsWith("net.")) return `${s.rt}:network`;
  return `${s.rt}:${s.ev}`;
}

export function summarize(files: { name: string; content: string }[]): ProfileSummary {
  const spans: Span[] = [];
  const fileRows: { file: string; lines: number }[] = [];
  for (const f of files) {
    let n = 0;
    for (const line of f.content.split("\n")) {
      const s = parseLine(line);
      if (s) {
        s.file = f.name;
        spans.push(s);
        n++;
      }
    }
    fileRows.push({ file: f.name, lines: n });
  }
  const byRt = new Map<string, number>();
  const byOp = new Map<string, { count: number; example: string; rt: string }>();
  const byProc = new Map<string, { rt: string; pid: number; count: number }>();
  for (const s of spans) {
    const pk = `${s.rt}:${s.pid}`;
    const pe = byProc.get(pk);
    if (!pe) byProc.set(pk, { rt: s.rt, pid: s.pid, count: 1 });
    else pe.count++;
    byRt.set(s.rt, (byRt.get(s.rt) ?? 0) + 1);
    const k = classify(s);
    const e = byOp.get(k);
    const ex = s.cmd ?? s.path ?? s.op ?? s.ev;
    if (!e) byOp.set(k, { count: 1, example: ex, rt: s.rt });
    else {
      e.count++;
      if (e.example.length < 10 && ex.length > 10) e.example = ex;
    }
  }
  const timed = spans.filter((s) => s.tMs !== undefined) as (Span & { tMs: number })[];
  timed.sort((a, b) => a.tMs - b.tMs);
  const recent = timed.slice(-MAX_RECENT).map((s) => ({
    tMs: s.tMs,
    rt: s.rt,
    op: classify(s),
    label: (s.cmd ?? s.path ?? s.op ?? s.ev).slice(0, 120),
    pid: s.pid,
  }));
  return {
    totalSpans: spans.length,
    byRuntime: [...byRt.entries()]
      .map(([runtime, count]) => ({ runtime, count }))
      .sort((a, b) => b.count - a.count),
    byOp: [...byOp.entries()]
      .map(([op, v]) => ({ op, runtime: v.rt, count: v.count, sample: v.example }))
      .sort((a, b) => b.count - a.count),
    files: fileRows,
    processes: [...byProc.values()].sort((a, b) => b.count - a.count),
    startMs: timed.length > 0 ? timed[0].tMs : null,
    endMs: timed.length > 0 ? timed[timed.length - 1].tMs : null,
    recent,
    notes: [
      "Bash commands render as bars spanning to the next command in the same process; python/node markers are point events.",
      "python -S bypasses sitecustomize: outer tool time still measured, inner spans absent (by design).",
    ],
  };
}
