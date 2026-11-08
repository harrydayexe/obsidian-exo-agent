import type { App } from "obsidian";
import { readBrainConfig, type BrainConfig } from "../core/brain-config";

/** The vault's cyber-brain configuration, read from the frontmatter of its `AGENTS.md`. */
export function loadBrainConfig(app: App): Promise<BrainConfig> {
  return readBrainConfig((path) => app.vault.adapter.read(path).catch(() => null));
}
