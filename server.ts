import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { summarize } from "./engine/profile.ts";

const opRow = z.object({
  op: z.string(),
  runtime: z.string(),
  count: z.number(),
  sample: z.string(),
});

export const rpcContract = defineRpcContract({
  profile: {
    input: z.object({ dir: z.string().optional() }).strict(),
    output: z.object({
      dir: z.string(),
      totalSpans: z.number(),
      byRuntime: z.array(z.object({ runtime: z.string(), count: z.number() })),
      byOp: z.array(opRow),
      files: z.array(z.object({ file: z.string(), lines: z.number() })),
      notes: z.array(z.string()),
    }),
  },
});

function loadDir(dir: string) {
  const files: { name: string; content: string }[] = [];
  if (!existsSync(dir)) return { dir, files };
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ndjson")) continue;
    try {
      files.push({ name, content: readFileSync(join(dir, name), "utf8") });
    } catch {
      // unreadable file: skip, still report the rest
    }
  }
  return { dir, files };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("exec-trace loaded");

  bb.settings.define({
    traceDir: {
      type: "string",
      label: "Trace spool directory",
      default: "/tmp/exec-trace-verify",
    },
  });
  const settings = bb.settings.define({
    traceDirDefault: {
      type: "string",
      label: "Default trace dir",
      default: "/tmp/exec-trace-verify",
    },
  });
  void settings;

  function profile(dir?: string) {
    const d = dir ?? process.env.BB_TRACE_DIR ?? "/tmp/exec-trace-verify";
    const { files } = loadDir(d);
    const s = summarize(files);
    return { dir: d, ...s };
  }

  bb.rpc.register(rpcContract, {
    profile: ({ dir }) => profile(dir ?? undefined),
  });

  bb.cli.register({
    name: "exec-trace",
    summary: "Transparent exec profiler (python/bash/node)",
    commands: [
      { name: "profile", summary: "Show operation breakdown", usage: "bb exec-trace profile [--dir <path>] [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const di = argv.indexOf("--dir");
      const dir = di >= 0 ? argv[di + 1] : undefined;
      const p = profile(dir);
      if (json) return { exitCode: 0, stdout: JSON.stringify(p, null, 2) };
      const lines = [
        `trace dir: ${p.dir} — ${p.totalSpans} spans`,
        ...p.byOp.map((r) => `${r.op.padEnd(20)} ${String(r.count).padStart(3)}  sample: ${r.sample}`),
      ];
      return { exitCode: 0, stdout: lines.join("\n") };
    },
  });

  // Transparent tracing env for every provider turn. Shim files ship in
  // shim/ and are deployed per-host by the host entry (host.ts).
  // Kept minimal here so `bb plugin build` passes without a host bundle;
  // full per-host deploy follows once the breakdown is verified.
  try {
    const providers = await bb.sdk.providers.list();
    for (const p of providers as { id: string }[]) {
      bb.providers.experimental_contributeEnv(p.id, async (ctx) => [
        { name: "BB_THREAD_ID", value: ctx.threadId, reason: "correlate exec spans" },
        { name: "BB_TRACE_DIR", value: "/tmp/exec-trace-verify", reason: "span spool" },
      ]);
    }
  } catch (cause) {
    bb.log.warn(`provider env skipped: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  bb.onDispose(() => bb.log.info("exec-trace disposed"));
}
