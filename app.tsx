import { useEffect, useMemo, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

interface SpanView {
  tMs: number | null;
  rt: string;
  op: string;
  label: string;
  pid: number;
  durMs: number | null;
}

interface ProfileData {
  dir: string;
  totalSpans: number;
  byRuntime: { runtime: string; count: number }[];
  byOp: { op: string; runtime: string; count: number; sample: string; totalMs: number }[];
  processes: { rt: string; pid: number; count: number }[];
  startMs: number | null;
  endMs: number | null;
  recent: SpanView[];
  notes: string[];
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function colorFor(op: string): string {
  if (op.endsWith(":subprocess")) return "#f97316";
  if (op.endsWith(":file-io")) return "#3b82f6";
  if (op.endsWith(":network")) return "#22c55e";
  if (op.endsWith(":command")) return "#a855f7";
  return "#9ca3af";
}

/** Waterfall of spans over wall time, one lane per process. */
function Timeline({ recent, startMs, endMs }: { recent: SpanView[]; startMs: number | null; endMs: number | null }) {
  const lanes = useMemo(() => {
    const seen: { rt: string; pid: number }[] = [];
    for (const s of recent) {
      if (s.tMs === null) continue;
      if (!seen.some((l) => l.pid === s.pid)) seen.push({ rt: s.rt, pid: s.pid });
      if (seen.length >= 10) break;
    }
    return seen;
  }, [recent]);

  if (startMs === null || endMs === null || lanes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        No timed spans yet.
      </div>
    );
  }
  const W = 720;
  const GUTTER = 118;
  const ROW = 30;
  const H = 26 + lanes.length * ROW + 8;
  const span = Math.max(1, endMs - startMs);
  const x = (t: number) => GUTTER + ((t - startMs) / span) * (W - GUTTER - 10);
  const byLane = new Map<number, SpanView[]>();
  for (const s of recent) {
    if (s.tMs === null) continue;
    const lane = lanes.findIndex((l) => l.pid === s.pid);
    if (lane < 0) continue;
    const arr = byLane.get(lane) ?? [];
    arr.push(s);
    byLane.set(lane, arr);
  }
  for (const arr of byLane.values()) arr.sort((a, b) => (a.tMs ?? 0) - (b.tMs ?? 0));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Span timeline">
      {lanes.map((l, i) => {
        const y = 26 + i * ROW;
        return (
          <g key={`${l.rt}-${l.pid}`}>
            <text x={4} y={y + 15} fontSize={11} fill="currentColor" opacity={0.7}>
              {l.rt}·{l.pid}
            </text>
            <line x1={GUTTER} x2={W - 10} y1={y + 11} y2={y + 11} stroke="currentColor" opacity={0.12} />
            {(byLane.get(i) ?? []).map((s, j, arr) => {
              const t = s.tMs ?? startMs;
              if (s.op === "bash:command") {
                const next = arr[j + 1];
                const end = s.durMs !== null ? t + s.durMs : (next && next.tMs !== null ? next.tMs : endMs);
                const x2 = x(end);
                return (
                  <g key={j}>
                    <rect x={x(t)} y={y + 5} width={Math.max(3, x2 - x(t))} height={12} rx={3} fill={colorFor(s.op)} opacity={0.85}>
                      <title>{s.durMs !== null ? `${s.label} — ${fmtMs(s.durMs)}` : s.label}</title>
                    </rect>
                    {s.durMs !== null && x2 - x(t) > 34 ? (
                      <text x={x(t) + 4} y={y + 14} fontSize={9} fill="#fff">{fmtMs(s.durMs)}</text>
                    ) : null}
                  </g>
                );
              }
              return (
                <g key={j}>
                  <circle cx={x(t)} cy={y + 11} r={4} fill={colorFor(s.op)}>
                    <title>{s.durMs !== null ? `${s.label} — ${fmtMs(s.durMs)}` : s.label}</title>
                  </circle>
                  {s.op.endsWith(":subprocess") && s.durMs !== null ? (
                    <text x={x(t) + 7} y={y + 14} fontSize={9} fill="currentColor" opacity={0.65}>{fmtMs(s.durMs)}</text>
                  ) : null}
                </g>
              );
            })}
          </g>
        );
      })}
      <text x={GUTTER} y={H - 2} fontSize={10} fill="currentColor" opacity={0.55}>+0.0s</text>
      <text x={W - 10} y={H - 2} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.55}>
        +{((span / 1000).toFixed(1))}s
      </text>
    </svg>
  );
}

function ProfilerPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("profile", {}).then(
      (r) => setData(r as ProfileData),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [rpc]);

  const maxCount = data?.byOp.reduce((m, r) => Math.max(m, r.count), 1) ?? 1;
  const maxMs = data?.byOp.reduce((m, r) => Math.max(m, r.totalMs), 0) ?? 0;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-3 md:px-5 md:pt-4">
        <h1 className="text-lg font-semibold">Exec profiler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subprocesses and file opens inside Python, Bash, and Node scripts — no model opt-in.
        </p>
        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        {data === null && !error ? (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Loading profile…
          </div>
        ) : data ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
              <span className="font-medium">{data.totalSpans} spans</span>
              <span className="text-muted-foreground"> from {data.dir}</span>
              <div className="mt-1 text-xs text-muted-foreground">
                {data.byRuntime.map((r) => `${r.runtime}: ${r.count}`).join(" · ")}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="mb-2 text-sm font-medium">Timeline</div>
              <Timeline recent={data.recent} startMs={data.startMs} endMs={data.endMs} />
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="mb-2 text-sm font-medium">Operations</div>
              <div className="space-y-2">
                {data.byOp.map((r) => (
                  <div key={r.op} title={r.sample}>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono">{r.op}</span>
                      <span className="text-muted-foreground">{r.count} · {fmtMs(r.totalMs)}</span>
                    </div>
                    <div className="mt-0.5 h-2 overflow-hidden rounded bg-muted">
                      <div
                        className="h-full rounded"
                        style={{ width: `${maxMs > 0 ? Math.max(r.totalMs > 0 ? 2 : 0, (r.totalMs / maxMs) * 100) : Math.max(2, (r.count / maxCount) * 100)}%`, background: colorFor(r.op) }}
                      />
                    </div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{r.sample}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Processes</div>
              {data.processes.length === 0 ? (
                <div>—</div>
              ) : (
                data.processes.map((p) => (
                  <div key={`${p.rt}-${p.pid}`} className="font-mono">
                    {p.rt}·{p.pid} — {p.count} spans
                  </div>
                ))
              )}
              <div className="mt-2 space-y-1">
                {data.notes.map((n) => <div key={n}>• {n}</div>)}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "profiler",
    title: "Exec profiler",
    icon: "Zap",
    path: "profiler",
    component: ProfilerPage,
  });
});
