#!/usr/bin/env node
// Copies the cyber-brain core (pure formats of SPEC.md) from the sibling repo
// into src/vendor/cyber-brain/core.mjs, byte for byte. Exo never edits the
// copy; edit ../cyber-brain/scripts/core.mjs and rerun this script.
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "cyber-brain", "scripts", "core.mjs");
const target = join(root, "src", "vendor", "cyber-brain", "core.mjs");

if (!existsSync(source)) {
  console.error(`sync-cyber-brain: ${source} not found (clone cyber-brain next to this repo)`);
  process.exit(1);
}
copyFileSync(source, target);
console.log(`sync-cyber-brain: ${source} -> ${target}`);
