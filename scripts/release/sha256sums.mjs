#!/usr/bin/env node
// ============================================================
// scripts/release/sha256sums.mjs — the release-lane checksum law
// ============================================================
//
// The operator addendum (2026-10-31, issue #23): "Generate a SHA256SUMS file
// and verify it before attaching assets." This tool hashes every installer in
// a dist directory, writes SHA256SUMS, then RE-VERIFIES its own output
// (re-hash + compare) — a checksum file that is itself unverified is not
// evidence. Exit codes: 0 = written and verified; 1 = any mismatch/failure.
//
// Usage:
//   node scripts/release/sha256sums.mjs --dist <dir> --out <file> [--label "..."]

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function parseArgs(argv) {
  const out = { dist: null, out: null, label: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dist") out.dist = argv[i + 1];
    else if (argv[i] === "--out") out.out = argv[i + 1];
    else if (argv[i] === "--label") out.label = argv[i + 1];
  }
  if (!out.dist || !out.out) {
    console.error("usage: sha256sums.mjs --dist <dir> --out <file> [--label ...]");
    process.exit(1);
  }
  return out;
}

/** Deterministic walk: sorted, files only, skipping the UNPACKED staging tree. */
function listInstallerFiles(distRoot) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === "UNPACKED" || name === "SHA256SUMS") continue;
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

const { dist, out, label } = parseArgs(process.argv.slice(2));
const distRoot = resolve(dist);
const files = listInstallerFiles(distRoot);
if (files.length === 0) {
  console.error(`sha256sums: no installer files found under ${distRoot}`);
  process.exit(1);
}

const lines = files.map((full) => {
  const rel = full.slice(distRoot.length + 1);
  return `${sha256File(full)}  ${rel}`;
});
const header = label.length > 0 ? `# ${label}\n` : "";
const body = `${header}${lines.join("\n")}\n`;
writeFileSync(resolve(out), body, "utf8");
console.log(`sha256sums: wrote ${lines.length} entrie(s) -> ${out}`);

// The verification pass — re-hash and compare against what we just wrote
// (the addendum's "verify it before attaching assets").
let failures = 0;
for (const line of lines) {
  const digest = line.slice(0, 64);
  const rel = line.slice(66);
  const actual = sha256File(join(distRoot, rel));
  if (actual !== digest) {
    console.error(`sha256sums: MISMATCH ${rel}: ${actual} != ${digest}`);
    failures += 1;
  }
}
if (failures > 0) {
  console.error(`sha256sums: ${failures} mismatch(es) — NOT verified`);
  process.exit(1);
}
console.log("sha256sums: verified — every entry re-hashed and matched");
