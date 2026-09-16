# bb-plugin-exec-trace

Transparent exec profiler for BB: measures subprocesses and file/network I/O
inside Python, Bash, and Node scripts without any model opt-in.

- `server.ts` — backend: trace ingestion, `profile` RPC, `bb exec-trace profile` CLI,
  and provider env contributions (`PYTHONPATH` / `BASH_ENV` / `NODE_OPTIONS`).
- `app.tsx` — frontend: an **Exec profiler** page in the left sidebar with the
  per-operation breakdown.
- `shim/` — the transparent tracers: `sitecustomize.py` + `bb_trace.py`,
  `shim.sh`, `bb_trace.cjs` / `bb_trace.mjs`.
- `engine/profile.ts` — NDJSON parsing and breakdown (pure, testable).
