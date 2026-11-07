import { describe, it, expect } from "vitest";
import { scaffoldItems, isVaultSetUp, parentFolder, memorySetupNeeded } from "../src/core/vault-setup";
import { exoPaths } from "../src/core/paths";
import { isUnfilledAgentBlock } from "../src/core/agent-self";

// Exercise with both a legacy (_system) and a fresh (_exo) root so the scaffold
// is proven root-agnostic — the whole point of the memory-root migration.
const LEGACY = exoPaths("_system");
const FRESH = exoPaths("_exo");

describe("scaffoldItems", () => {
  it("derives every path from the given root", () => {
    for (const item of scaffoldItems(FRESH, "full")) {
      expect(item.path.startsWith("_exo/")).toBe(true);
    }
    for (const item of scaffoldItems(LEGACY, "full")) {
      expect(item.path.startsWith("_system/")).toBe(true);
    }
  });

  it("folder items carry no content, file items carry string content", () => {
    for (const item of scaffoldItems(LEGACY, "full")) {
      if (item.kind === "folder") expect(item.content).toBeUndefined();
      else expect(typeof item.content).toBe("string");
    }
  });

  it("has no duplicate paths", () => {
    const paths = scaffoldItems(LEGACY, "full").map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("includes the loops file as a file item with a description (both presets)", () => {
    for (const preset of ["minimal", "full"] as const) {
      const item = scaffoldItems(LEGACY, preset).find((i) => i.path === LEGACY.openLoops);
      expect(item?.kind).toBe("file");
      expect(item?.content).toMatch(/^---\ndescription: /);
    }
  });

  it("never scaffolds AGENTS.md: it is the vault's entry point, written by cyber-brain setup", () => {
    expect(scaffoldItems(LEGACY, "full").map((i) => i.path)).not.toContain(LEGACY.vaultContext);
  });

  it("never scaffolds review.md — its existence is a UI signal owned by another feature", () => {
    for (const preset of ["minimal", "full"] as const) {
      const paths = scaffoldItems(LEGACY, preset).map((i) => i.path);
      expect(paths).not.toContain(LEGACY.review);
      expect(paths).not.toContain("_system/review.md");
    }
  });
});

describe("scaffoldItems presets", () => {
  it("minimal is the mechanism subset of full", () => {
    const full = scaffoldItems(LEGACY, "full").map((i) => i.path);
    const minimal = scaffoldItems(LEGACY, "minimal").map((i) => i.path);
    expect(minimal.length).toBeLessThan(full.length);
    for (const p of minimal) expect(full).toContain(p);
  });

  it("minimal contains only mechanism-tier items", () => {
    for (const item of scaffoldItems(LEGACY, "minimal")) {
      expect(item.tier).toBe("mechanism");
    }
  });

  it("minimal creates the operational layer but no marioverse content", () => {
    const minimal = scaffoldItems(LEGACY, "minimal").map((i) => i.path);
    // mechanism present
    expect(minimal).toContain(LEGACY.queue);
    expect(minimal).toContain(LEGACY.openLoops);
    // no content whatsoever: no observations, rules or agent identity
    expect(minimal.some((p) => p.startsWith(`${LEGACY.rules}/`))).toBe(false);
    expect(minimal).not.toContain(LEGACY.observations);
    expect(minimal.some((p) => p.startsWith(`${LEGACY.agentDir}/`))).toBe(false);
  });

  it("full lays down the knowledge-OS: guided sources, folder READMEs, agent blocks", () => {
    const full = scaffoldItems(LEGACY, "full").map((i) => i.path);
    // guided source files
    expect(full).toContain(LEGACY.observations);
    // folder READMEs (the folders exist by virtue of a file inside them)
    expect(full).toContain(`${LEGACY.rules}/README.md`);
    expect(full).toContain(`${LEGACY.decisions}/README.md`);
    // hand-fillable identity blocks
    expect(full).toContain(`${LEGACY.agentDir}/SOUL.md`);
    expect(full).toContain(`${LEGACY.agentDir}/USER.md`);
    expect(full).toContain(`${LEGACY.agentDir}/NOW.md`);
  });

  it("full agent blocks are seeded template content (round-trips through isUnfilledAgentBlock)", () => {
    const blocks = scaffoldItems(LEGACY, "full").filter((i) => i.path.startsWith(`${LEGACY.agentDir}/`) && i.path !== LEGACY.observations);
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      const name = b.path.slice(`${LEGACY.agentDir}/`.length, -".md".length) as "SOUL" | "USER" | "NOW";
      // The scaffolded content IS the template → the seeder sees it as unfilled
      // and will regenerate it; a hand-edit makes it filled.
      expect(isUnfilledAgentBlock(name, b.content ?? "")).toBe(true);
      expect(isUnfilledAgentBlock(name, `${b.content}\n\nI wrote my own persona here.`)).toBe(false);
    }
  });
});

describe("memorySetupNeeded", () => {
  it("offers the picker on a fresh vault with no choice made", () => {
    expect(memorySetupNeeded(undefined, false)).toBe(true);
  });

  it("does not offer it once any choice is recorded — including 'none'", () => {
    expect(memorySetupNeeded("none", false)).toBe(false);
    expect(memorySetupNeeded("minimal", false)).toBe(false);
    expect(memorySetupNeeded("full", false)).toBe(false);
  });

  it("does not offer it to a pre-picker install that's already set up", () => {
    expect(memorySetupNeeded(undefined, true)).toBe(false);
  });
});

describe("isVaultSetUp", () => {
  it("is false when the loops file is absent", () => {
    expect(isVaultSetUp(() => false, LEGACY)).toBe(false);
  });

  it("is true when the loops file exists", () => {
    expect(isVaultSetUp((path) => path === LEGACY.openLoops, LEGACY)).toBe(true);
  });

  it("only checks the sentinel path, ignoring others", () => {
    expect(isVaultSetUp((path) => path === "_system/some-other-file.md", LEGACY)).toBe(false);
  });

  it("respects the configured root (a _system sentinel doesn't satisfy an _exo vault)", () => {
    expect(isVaultSetUp((path) => path === LEGACY.openLoops, FRESH)).toBe(false);
    expect(isVaultSetUp((path) => path === FRESH.openLoops, FRESH)).toBe(true);
  });
});

describe("parentFolder", () => {
  it("returns the parent directory for a nested path", () => {
    expect(parentFolder("_system/memory/rules/README.md")).toBe("_system/memory/rules");
  });

  it("returns null for a top-level path with no slash", () => {
    expect(parentFolder("vault-context.md")).toBeNull();
  });
});

describe("scaffoldItems parent coverage", () => {
  it("every file item resolves to a non-null parent folder (guards the ENOENT-on-fresh-vault regression)", () => {
    for (const item of scaffoldItems(FRESH, "full")) {
      if (item.kind === "file") {
        expect(parentFolder(item.path)).not.toBeNull();
      }
    }
  });
});
