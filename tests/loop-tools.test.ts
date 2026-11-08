import { describe, expect, test } from "vitest";
import { TFile, type App } from "obsidian";
import { buildObsidianTools } from "../src/obsidian/tools";
import { exoPaths } from "../src/core/paths";
import { LOOPS_FILE_HEADER, parseLoopsFile } from "../src/core/open-loops";
import { parseLoops } from "../src/vendor/cyber-brain/core.mjs";

const paths = exoPaths("System");

/** A vault holding the loops file (or none), with Obsidian's atomic `process`. */
function vaultWith(initial: string | null) {
  const state = { content: initial };
  const file = Object.assign(new TFile(), { path: paths.openLoops, basename: "loops" });
  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === paths.openLoops && state.content !== null ? file : null),
      cachedRead: async () => state.content ?? "",
      process: async (_f: TFile, fn: (d: string) => string) => (state.content = fn(state.content ?? "")),
      create: async (_p: string, c: string) => void (state.content = c),
      createFolder: async () => undefined,
    },
    metadataCache: { getFirstLinkpathDest: () => null, getFileCache: () => null },
  } as unknown as App;
  const run = async (name: string, args: Record<string, unknown>) => {
    const t = buildObsidianTools(app, { paths }).find((x) => x.name === name)!;
    const res = await (t.handler as (a: unknown, e: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)(args, {});
    return { text: res.content[0].text, isError: res.isError === true };
  };
  return { state, run };
}

describe("loop tools write the kit's loops.md", () => {
  test("open_loop creates the file with a description and a kit loop, id from the title", async () => {
    const { state, run } = vaultWith(null);
    const res = await run("open_loop", { title: "Call Anna back", context: "About the design role." });
    expect(res.text).toContain("loop-call-anna-back");
    expect(state.content!.startsWith(LOOPS_FILE_HEADER)).toBe(true);
    const [kit] = parseLoops(state.content!);
    expect(kit.fields).toMatchObject({ title: "Call Anna back", status: "open", owner: "user", state: "open" });
  });

  test("open_loop can wait on the user, and a second loop with the same title gets a suffix", async () => {
    const { state, run } = vaultWith(null);
    await run("open_loop", { title: "Send deck", context: "x", status: "waiting-user", owner: "user", state: "needs the pricing numbers" });
    await run("open_loop", { title: "Send deck", context: "y" });
    const loops = parseLoopsFile(state.content!);
    expect(loops.map((l) => l.id)).toEqual(["loop-send-deck", "loop-send-deck-2"]);
    expect(loops[0]).toMatchObject({ status: "waiting-user", state: "needs the pricing numbers" });
  });

  test("close_loop keeps waiting-user on the other loops, the preamble, and writes the outcome into state", async () => {
    const { state, run } = vaultWith(null);
    await run("open_loop", { title: "Send deck", context: "x", status: "waiting-user" });
    await run("open_loop", { title: "Book flight", context: "y" });
    const res = await run("close_loop", { id: "loop-book-flight", outcome: "booked for Friday" });
    expect(res.isError).toBe(false);
    expect(state.content!.startsWith(LOOPS_FILE_HEADER)).toBe(true);
    const loops = parseLoopsFile(state.content!);
    expect(loops[0].status).toBe("waiting-user"); // the bug: any status but closed was flattened to open
    expect(loops[1]).toMatchObject({ status: "closed" });
    expect(loops[1].state).toMatch(/^closed \d{4}-\d{2}-\d{2}: booked for Friday$/);
    expect(loops[1].note).toContain("Outcome");
  });

  test("list_loops names the status of a waiting loop", async () => {
    const { run } = vaultWith(null);
    await run("open_loop", { title: "Send deck", context: "x", status: "waiting-user", resurface: "2099-01-01" });
    expect((await run("list_loops", {})).text).toContain("[waiting-user] loop-send-deck");
  });
});
