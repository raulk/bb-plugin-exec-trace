// ESM entry: re-export CJS tracer so --import covers ESM programs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
await import(require.resolve('./bb_trace.cjs')).catch(() => {});
