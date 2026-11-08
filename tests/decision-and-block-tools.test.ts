import { describe, expect, test, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { buildObsidianTools } from "../src/obsidian/tools";
import { memoryCaps } from "../src/core/memory-caps";
import { exoPaths } from "../src/core/paths";
import { today } from "../src/obsidian/tool-kit";
import { parseFrontmatter, parseTransit } from "../src/vendor/cyber-brain/core.mjs";

const paths = exoPaths("System");
const memory = memoryCaps(
  { memoryReadEnabled: true, memoryWriteEnabled: true, agentFolderEnabled: true, autoMemory: true, backgroundPassesEnabled: true },
  { surface: "chat", readOnlySandbox: false },
);

/** In-memory vault; `agents` is the AGENTS.md text the brain config is read from. */
function vaultWith(files: Record<string, string>, agents: string | null) {
  const store = new Map(Object.entries(files));
  const tfiles = new Map<string, TFile>();
  const fileOf = (p: string) => {
    if (!store.has(p)) return null;
    if (!tfiles.has(p)) tfiles.set(p, Object.assign(new TFile(), { path: p, basename: p.split("/").pop()!.replace(/\.md$/, "") }));
    return tfiles.get(p)!;
  };
  const app = {
    vault: {
      getAbstractFileByPath: fileOf,
      cachedRead: async (f: TFile) => store.get(f.path) ?? "",
      process: async (f: TFile, fn: (d: string) => string) => void store.set(f.path, fn(store.get(f.path) ?? "")),
      create: async (p: string, c: string) => void store.set(p, c),
      createFolder: async () => undefined,
      adapter: { read: async (p: string) => (p === "AGENTS.md" && agents !== null ? agents : Promise.reject(new Error("missing"))) },
    },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
  } as unknown as App;
  const run = async (name: string, args: Record<string, unknown>, bridge = vi.fn(async () => "Rewrote")) => {
    const t = buildObsidianTools(app, { paths, memory, rethinkBridge: bridge }).find((x) => x.name === name)!;
    const res = await (t.handler as (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)(args, {});
    return { text: res.content[0].text, isError: res.isError === true, bridge };
  };
  return { store, run };
}

const BRAIN = (writers: string) => `---\ncyber_brain: "0.1"\nwriters: ${writers}\n---\n# AGENTS\n`;

describe("capture_decision writes the spec 4.4 file", () => {
  test("frontmatter and sections, revisit folded into Trade-offs", async () => {
    const { store, run } = vaultWith({}, null);
    const res = await run("capture_decision", {
      title: "Use the inbox",
      context: "Several writers.",
      options: "Direct or inbox.",
      decision: "Queue in the inbox.",
      rationale: "One writer places notes.",
      revisit: "a second vault appears",
    });
    expect(res.isError).toBe(false);
    const path = `${paths.decisions}/${today()}-use-the-inbox.md`;
    const { data, body } = parseFrontmatter(store.get(path)!);
    expect(data).toEqual({ description: "Queue in the inbox.", status: "accepted", date: today() });
    expect(body).toBe(
      "# Use the inbox\n\n## Context\nSeveral writers.\n\n## Options\nDirect or inbox.\n\n## Decision\nQueue in the inbox.\n\n" +
        "## Trade-offs\nOne writer places notes.\n\nRevisit if: a second vault appears\n",
    );
  });

  test("refuses to overwrite", async () => {
    const path = `${paths.decisions}/${today()}-same.md`;
    const { store, run } = vaultWith({ [path]: "keep" }, null);
    const res = await run("capture_decision", { title: "Same", context: "c", decision: "d", rationale: "r" });
    expect(res.isError).toBe(true);
    expect(store.get(path)).toBe("keep");
  });
});

describe("rethink_memory respects writers", () => {
  test("inbox: queues a block entry that replaces the current first body line, bridge untouched", async () => {
    const now = `${paths.agentDir}/NOW.md`;
    const { store, run } = vaultWith({ [now]: "---\ndescription: now\n---\n# NOW\n\nShip the vault kit.\nSecond line.\n" }, BRAIN("inbox"));
    const res = await run("rethink_memory", { block: "NOW", new_content: "Focus: cyber-brain\nand dream", rationale: "plan changed; new focus" });
    expect(res.isError).toBe(false);
    expect(res.bridge).not.toHaveBeenCalled();
    const inbox = store.get(`${paths.inbox}/${today()}.md`)!;
    expect(inbox.startsWith(`# Transit ${today()}\n`)).toBe(true);
    const entry = parseTransit(inbox.trim().split("\n").pop()!)!;
    expect(entry.kind).toBe("block");
    expect(entry.text).toBe("Focus: cyber-brain and dream");
    expect(entry.target).toBe(now);
    expect(entry.meta).toMatchObject({ since: today(), was: "Ship the vault kit." });
    expect(entry.meta.source).toContain("plan changed, new focus");
    expect(store.get(now)).toContain("Ship the vault kit.");
  });

  test("inbox: a second rewrite appends to the same transit file, with no was: for a missing block", async () => {
    const { store, run } = vaultWith({}, BRAIN("inbox"));
    await run("rethink_memory", { block: "NOW", new_content: "one" });
    await run("rethink_memory", { block: "NOW", new_content: "two" });
    const lines = store.get(`${paths.inbox}/${today()}.md`)!.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(parseTransit(lines[1])!.meta.was).toBeUndefined();
  });

  test("inbox: the rationale guard still comes first", async () => {
    const { store, run } = vaultWith({}, BRAIN("inbox"));
    const res = await run("rethink_memory", { block: "USER", new_content: "x" });
    expect(res.isError).toBe(true);
    expect(store.size).toBe(0);
  });

  test("direct: goes through the bridge and writes no transit", async () => {
    const { store, run } = vaultWith({}, BRAIN("direct"));
    const res = await run("rethink_memory", { block: "NOW", new_content: "x" });
    expect(res.bridge).toHaveBeenCalledWith({ block: "NOW", content: "x" });
    expect(store.size).toBe(0);
  });
});
