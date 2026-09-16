import { useEffect, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

type Profile = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>>;

function ProfilerPage() {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc.call("profile", {}).then(
      (r) => setData(r),
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [rpc]);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl px-4 pb-8 pt-3 md:px-5 md:pt-4">
        <h1 className="text-lg font-semibold">Exec profiler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Transparent Python / Bash / Node spans. Subprocesses and file opens inside scripts are
          attributed per operation type — no model opt-in.
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
                {data.byRuntime.map((r: any) => `${r.runtime}: ${r.count}`).join(" · ")}
              </div>
            </div>
            <table className="w-full overflow-hidden rounded-lg border border-border bg-card text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2">Operation</th>
                  <th className="px-3 py-2">Count</th>
                  <th className="px-3 py-2">Sample command</th>
                </tr>
              </thead>
              <tbody>
                {data.byOp.map((r: any) => (
                  <tr key={r.op} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{r.op}</td>
                    <td className="px-3 py-2">{r.count}</td>
                    <td className="max-w-0 truncate px-3 py-2 font-mono text-xs text-muted-foreground">{r.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              <div className="font-medium text-foreground">Per file</div>
              {data.files.map((f: any) => (
                <div key={f.file} className="font-mono">{f.file} — {f.lines}</div>
              ))}
              <div className="mt-2 space-y-1">
                {data.notes.map((n: string) => <div key={n}>• {n}</div>)}
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
