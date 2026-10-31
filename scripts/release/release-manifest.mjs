#!/usr/bin/env node
// ============================================================
// scripts/release/release-manifest.mjs — the release-lane manifest law
// ============================================================
//
// The operator addendum (2026-10-31, issue #23): "The release manifest must
// record version, tag, source SHA, architecture, OS, packaging target,
// toolchain versions, and each asset's SHA-256." This tool assembles that
// manifest from the dist directory + the build's identity facts.
//
// Usage:
//   node scripts/release/release-manifest.mjs --dist <dir> --tag vX.Y.Z --sha <sha> \
//     --target win-x64 --node v24.x --pnpm 10.33.2 --out <file>

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const out = { dist: null, tag: "", sha: "", target: "", node: "", pnpm: "", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") out.dist = argv[i + 1];
    else if (argv[i] === "--tag") out.tag = argv[i + 1];
    else if (argv[i] === "--sha") out.sha = argv[i + 1];
    else if (argv[i] === "--target") out.target = argv[i + 1];
    else if (argv[i] === "--node") out.node = argv[i + 1];
    else if (argv[i] === "--pnpm") out.pnpm = argv[i + 1];
    else if (argv[i] === "--out") out.out = argv[i + 1];
  }
  for (const key of ["dist", "tag", "sha", "target", "out"]) {
    if (!out[key]) {
      console.error("usage: release-manifest.mjs --dist <dir> --tag <t> --sha <s> --target <t> [--node <n>] [--pnpm <p>] --out <file>");
      process.exit(1);
    }
  }
  return out;
}

function listFiles(distRoot) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "UNPACKED" || name === "SHA256SUMS" || name === "release-manifest.json") continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(distRoot);
  return files;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const args = parseArgs(process.argv.slice(2));
const distRoot = resolve(args.dist);
const assets = listFiles(distRoot).map((full) => {
  const rel = full.slice(distRoot.length + 1);
  const st = statSync(full);
  return {
    name: rel,
    bytes: st.size,
    sha256: sha256File(full),
  };
});

const manifest = {
  product: "UNiCOM",
  generatedAt: new Date().toISOString(),
  tag: args.tag,
  sourceSha: args.sha,
  target: args.target,
  toolchain: {
    node: args.node || null,
    pnpm: args.pnpm || null,
  },
  assetCount: assets.length,
  assets,
  notes: [
    "Windows installers are UNSIGNED until a signing certificate is configured — labelled accurately, never claimed signed.",
    "ARM64 is BLOCKED pending its own runner/native-dependency proof (docs/DESKTOP-RELEASE-2026-10-31.md).",
  ],
};

writeFileSync(resolve(args.out), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`release-manifest: wrote ${assets.length} asset(s) -> ${args.out}`);
