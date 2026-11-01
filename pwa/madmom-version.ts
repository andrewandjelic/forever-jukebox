import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Content hash of the madmom worker, engine and model, which are served from
// public/madmom under fixed names. The analysis worker loads them as
// worker.js?v=<hash> (and the worker passes the query on to the engine and
// model), so a browser can't keep running a cached copy from an older build.
export function madmomVersion(madmomDir: string): string {
  const hash = createHash("sha256");
  for (const file of [
    "worker.js",
    "pkg/madmom_beats_port_wasm.js",
    "pkg/madmom_beats_port_wasm_bg.wasm",
    "models/downbeats_blstm.json",
    "models/downbeats_blstm_weights.npz",
  ]) {
    hash.update(readFileSync(join(madmomDir, file)));
  }
  return hash.digest("hex").slice(0, 12);
}
