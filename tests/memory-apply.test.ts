import { describe, it, expect } from "vitest";
import { applyDecisions, type ApplyEnv, type ApplyVault } from "../src/core/memory-apply";
import { harvestBlocklist, HARVEST_MAX_WRITES, type Decision } from "../src/core/memory-harvest";
import { exoPaths } from "../src/core/paths";
import { makeExclusion } from "../src/core/vault-exclusions";
import { parseLoopsFile } from "../src/core/open-loops";
import { parseTransit } from "../src/vendor/cyber-brain/core.mjs";

function fakeVault(files: Record<string, string>) {
  const store = new Map(Object.entries(files));
  const created: string[] = [];
  const vault: ApplyVault = {
    exists: (p) => store.has(p),
    read: async (p) => store.get(p) ?? null,
    edit: async (p, fn) => {
      const cur = store.get(p);
      if (cur === undefined) return false;
      const next = fn(cur);
      if (next === null) return false;
      store.set(p, next);
      return true;
    },
    create: async (p, c) => {
      if (store.has(p)) throw new Error(`create over ${p}`);
      created.push(p);
      store.set(p, c);
    },
  };
  return { vault, store, created };
}

const P = exoPaths("_exo");
const SOURCE = 'chat "Planning" (obsidian://exo-chat?id=c-1&msg=0)';
const TAIL = ` [source: ${SOURCE}; since: 2026-09-25]`;
const INBOX = "_exo/memory/inbox/exo/2026-09-25.md";
function envFor(vault: ApplyVault, offered: string[], over: Partial<ApplyEnv> = {}): ApplyEnv {
  return {
    exists: (p) => vault.exists(p),
    inboxPath: INBOX,
    blocked: harvestBlocklist(P),
    excluded: makeExclusion([], ["Input/"]),
    today: "2026-09-25",
    now: 1_790_000_000_000,
    offered: new Set(offered),
    ledgerPath: P.openLoops,
    writers: "direct",
    immediate: [P.observations, `${P.agentMemory}/`],
    provenance: { convoId: "c-1", chatTitle: "Planning", date: "2026-09-25" },
    ...over,
  };
}

describe("applyDecisions", () => {
  it("ADD appends one bullet to the named section and records the exact line", async () => {
    const { vault, store } = fakeVault({ "CRM/Anna.md": "# Anna\n## Work\n- Designer\n" });
    const res = await applyDecisions(
      vault,
      [{ op: "add", candidate: 0, path: "CRM/Anna.md", section: "Work", text: "Leads design at Acme" }],
      envFor(vault, ["CRM/Anna.md"]),
    );
    expect(store.get("CRM/Anna.md")).toBe(`# Anna\n## Work\n- Designer\n- Leads design at Acme${TAIL}\n`);
    expect(res.writes).toEqual([{ path: "CRM/Anna.md", op: "add", text: "Leads design at Acme", lines: [`- Leads design at Acme${TAIL}`] }]);
  });

  it("UPDATE replaces only the exact line and records both lines; a line not there exactly once is rejected", async () => {
    const { vault, store } = fakeVault({ "P/context.md": "- Status: beta\n- Owner: Mario\n- Owner: Mario\n" });
    const res = await applyDecisions(
      vault,
      [
        { op: "update", candidate: 0, path: "P/context.md", oldLine: "- Status: beta", newText: "Status: live" },
        { op: "update", candidate: 1, path: "P/context.md", oldLine: "- Owner: Mario", newText: "Owner: Anna" },
        { op: "update", candidate: 2, path: "P/context.md", oldLine: "- Status: alpha", newText: "x" },
      ],
      envFor(vault, ["P/context.md"]),
    );
    expect(store.get("P/context.md")).toBe(`- Status: live [source: ${SOURCE}; since: 2026-09-25; was: Status: beta]\n- Owner: Mario\n- Owner: Mario\n`);
    expect(res.writes).toEqual([
      {
        path: "P/context.md",
        op: "update",
        text: "Status: live",
        lines: [`- Status: live [source: ${SOURCE}; since: 2026-09-25; was: Status: beta]`],
        replaced: "- Status: beta",
      },
    ]);
    expect(res.rejected).toHaveLength(2);
  });

  it("UPDATE on frontmatter is refused even when the model asks for it", async () => {
    const before = "---\nstatus: beta\n---\n# P\n";
    const { vault, store } = fakeVault({ "P/context.md": before });
    const res = await applyDecisions(
      vault,
      [{ op: "update", candidate: 0, path: "P/context.md", oldLine: "status: beta", newText: "status: live" }],
      envFor(vault, ["P/context.md"]),
    );
    expect(res.writes).toEqual([]);
    expect(store.get("P/context.md")).toBe(before);
  });

  it("NOOP writes nothing", async () => {
    const { vault, store } = fakeVault({ "a.md": "x\n" });
    const res = await applyDecisions(vault, [{ op: "noop", candidate: 0 }], envFor(vault, ["a.md"]));
    expect(res.writes).toEqual([]);
    expect(store.get("a.md")).toBe("x\n");
  });

  it("only notes shown to the decider are writable, whatever the model answers", async () => {
    const { vault, store } = fakeVault({ "CRM/Anna.md": "- a\n", "CRM/Bob.md": "- b\n" });
    const res = await applyDecisions(
      vault,
      [{ op: "add", candidate: 0, path: "CRM/Bob.md", text: "not offered" }],
      envFor(vault, ["CRM/Anna.md"]),
    );
    expect(res.writes).toEqual([]);
    expect(res.rejected[0].reason).toBe("not a note shown to the decider");
    expect(store.get("CRM/Bob.md")).toBe("- b\n");
  });

  it("guardrails reject ignored, kernel, mechanism and non-existent paths without touching them", async () => {
    const files = {
      "Input/Readwise/Book.md": "book\n",
      "_exo/identity/USER.md": "user\n",
      "AGENTS.md": "ctx\n",
      ".obsidian/x.md": "cfg\n",
    };
    const { vault, store, created } = fakeVault(files);
    const targets = [...Object.keys(files), "CRM/New Person.md"];
    const decisions: Decision[] = targets.map((path, i) => ({ op: "add", candidate: i, path, text: "note" }));
    const res = await applyDecisions(vault, decisions, envFor(vault, targets));
    expect(res.writes).toEqual([]);
    expect(res.rejected.map((r) => r.reason)).toEqual([
      "synced source folder",
      "agent kernel or Exo mechanism file",
      "agent kernel or Exo mechanism file",
      "hidden or config folder",
      "note does not exist",
    ]);
    expect(created).toEqual([]);
    for (const [p, c] of Object.entries(files)) expect(store.get(p)).toBe(c);
  });

  it("creates today's transit file when needed, and records its starter content", async () => {
    const { vault, store, created } = fakeVault({});
    const res = await applyDecisions(
      vault,
      [
        { op: "add", candidate: 0, path: INBOX, text: "rclone has a gdrive remote" },
        { op: "add", candidate: 1, path: INBOX, text: "second fact" },
      ],
      envFor(vault, []),
    );
    expect(created).toEqual([INBOX]);
    expect(store.get(INBOX)).toBe(
      `# Transit 2026-09-25\n- [fact] rclone has a gdrive remote -> ?${TAIL}\n- [fact] second fact -> ?${TAIL}\n`,
    );
    expect(res.writes[0].created).toBe("# Transit 2026-09-25\n");
    expect(res.writes[1].created).toBeUndefined();
  });

  it("an open loop becomes a well-formed ledger entry; UPDATE on the ledger is refused", async () => {
    const ledger = "## loop-1\n- title: Old\n- opened: 2026-09-01\n- status: open\n- state: open\n\nold note\n";
    const { vault, store } = fakeVault({ [P.openLoops]: ledger });
    const res = await applyDecisions(
      vault,
      [
        { op: "add", candidate: 0, path: P.openLoops, text: "Call Anna back about the design role" },
        { op: "update", candidate: 1, path: P.openLoops, oldLine: "- title: Old", newText: "title: New" },
      ],
      envFor(vault, [P.openLoops]),
    );
    const loops = parseLoopsFile(store.get(P.openLoops)!);
    expect(loops.map((l) => l.title)).toEqual(["Old", "Call Anna back about the design role"]);
    expect(loops[0].note).toBe("old note"); // the previous loop is untouched
    expect(res.rejected.map((r) => r.reason)).toEqual(["the loops file only takes new loops"]);
  });

  it("an open loop carries the provenance in its note, model tails stripped from title and note", async () => {
    const { vault, store } = fakeVault({ [P.openLoops]: "" });
    await applyDecisions(
      vault,
      [{ op: "add", candidate: 0, path: P.openLoops, text: "Call Anna back [source: chat \"Old\" (obsidian://exo-chat?id=z&msg=1); since: 2026-01-01]" }],
      envFor(vault, [P.openLoops]),
    );
    const [loop] = parseLoopsFile(store.get(P.openLoops)!);
    expect(loop.title).toBe("Call Anna back");
    expect(loop.note).toBe(`Call Anna back${TAIL}`);
    expect(loop.note.match(/\[source/g)).toHaveLength(1);
    expect(loop.owner).toBe("user");
  });

  it("drops edits that carry a credential", async () => {
    const { vault, store } = fakeVault({ "a.md": "- x\n" });
    const res = await applyDecisions(
      vault,
      [{ op: "add", candidate: 0, path: "a.md", text: "deploy token: ghp_abcdefghijklmnopqrstuvwxyz0123" }],
      envFor(vault, ["a.md"]),
    );
    expect(res.writes).toEqual([]);
    expect(res.rejected[0].reason).toBe("looks like a credential");
    expect(store.get("a.md")).toBe("- x\n");
  });

  it(`stops at ${HARVEST_MAX_WRITES} writes per harvest`, async () => {
    const { vault } = fakeVault({ "a.md": "" });
    const decisions: Decision[] = Array.from({ length: HARVEST_MAX_WRITES + 3 }, (_, i) => ({
      op: "add" as const,
      candidate: i,
      path: "a.md",
      text: `fact number ${i}`,
    }));
    const res = await applyDecisions(vault, decisions, envFor(vault, ["a.md"]));
    expect(res.writes).toHaveLength(HARVEST_MAX_WRITES);
    expect(res.rejected.filter((r) => r.reason === "write limit reached")).toHaveLength(3);
  });

  describe("writers: inbox (spec 5.1)", () => {
    const inbox = (vault: ApplyVault, offered: string[]) => envFor(vault, offered, { writers: "inbox" });

    it("a fact for a shared note waits in Exo's transit file, naming its note", async () => {
      const { vault, store } = fakeVault({ "CRM/Anna.md": "# Anna\n## Work\n- Designer\n" });
      const res = await applyDecisions(
        vault,
        [{ op: "add", candidate: 0, path: "CRM/Anna.md", section: "Work", text: "Leads design at Acme" }],
        inbox(vault, ["CRM/Anna.md"]),
      );
      expect(store.get("CRM/Anna.md")).toBe("# Anna\n## Work\n- Designer\n"); // untouched
      expect(store.get(INBOX)).toBe(`# Transit 2026-09-25\n- [fact] Leads design at Acme -> CRM/Anna.md${TAIL}\n`);
      expect(res.writes).toEqual([
        {
          path: INBOX,
          op: "add",
          text: "Leads design at Acme",
          lines: [`- [fact] Leads design at Acme -> CRM/Anna.md${TAIL}`],
          created: "# Transit 2026-09-25\n",
        },
      ]);
    });

    it("an update becomes a transit entry whose was is the replaced fact", async () => {
      const { vault, store } = fakeVault({ "P/context.md": "- Status: beta [source: nota; since: 2026-01-01] ^exo-abc123\n" });
      await applyDecisions(
        vault,
        [{ op: "update", candidate: 0, path: "P/context.md", oldLine: "- Status: beta [source: nota; since: 2026-01-01] ^exo-abc123", newText: "Status: live" }],
        inbox(vault, ["P/context.md"]),
      );
      expect(store.get(INBOX)).toContain(`- [fact] Status: live -> P/context.md [source: ${SOURCE}; since: 2026-09-25; was: Status: beta]`);
      expect(store.get("P/context.md")).toBe("- Status: beta [source: nota; since: 2026-01-01] ^exo-abc123\n");
    });

    it("a queued update still needs its line exactly once, outside frontmatter", async () => {
      const { vault, store } = fakeVault({ "P/context.md": "---\nstatus: beta\n---\n- Owner: Mario\n- Owner: Mario\n" });
      const res = await applyDecisions(
        vault,
        [
          { op: "update", candidate: 0, path: "P/context.md", oldLine: "status: beta", newText: "status: live" },
          { op: "update", candidate: 1, path: "P/context.md", oldLine: "- Owner: Mario", newText: "Owner: Anna" },
          { op: "update", candidate: 2, path: "P/context.md", oldLine: "- Gone", newText: "x" },
        ],
        inbox(vault, ["P/context.md"]),
      );
      expect(res.writes).toEqual([]);
      expect(res.rejected).toHaveLength(3);
      expect(store.has(INBOX)).toBe(false);
    });

    it("observations and the agent's own memory are written at once", async () => {
      const files = { [P.observations]: "# Observations\n", [`${P.agentMemory}/exo.md`]: "# exo\n" };
      const { vault, store } = fakeVault(files);
      const res = await applyDecisions(
        vault,
        [
          { op: "add", candidate: 0, path: P.observations, text: "Prefers Italian for strategy" },
          { op: "add", candidate: 1, path: `${P.agentMemory}/exo.md`, text: "Do not add a preamble" },
        ],
        inbox(vault, Object.keys(files)),
      );
      expect(res.writes.map((w) => w.path)).toEqual([P.observations, `${P.agentMemory}/exo.md`]);
      expect(store.get(P.observations)).toBe(`# Observations\n- Prefers Italian for strategy${TAIL}\n`);
      expect(store.has(INBOX)).toBe(false);
    });

    it("a loop is written at once", async () => {
      const { vault, store } = fakeVault({ [P.openLoops]: "# Loops\n" });
      await applyDecisions(vault, [{ op: "add", candidate: 0, path: P.openLoops, text: "Call Anna back" }], inbox(vault, [P.openLoops]));
      expect(parseLoopsFile(store.get(P.openLoops)!).map((l) => l.title)).toEqual(["Call Anna back"]);
      expect(store.has(INBOX)).toBe(false);
    });

    it("a fact with a transit-hostile arrow keeps its target parseable", async () => {
      const { vault, store } = fakeVault({ "CRM/Anna.md": "# Anna\n" });
      await applyDecisions(vault, [{ op: "add", candidate: 0, path: "CRM/Anna.md", text: "Moved A -> B" }], inbox(vault, ["CRM/Anna.md"]));
      expect(parseTransit(store.get(INBOX)!.split("\n")[1])).toMatchObject({ kind: "fact", text: "Moved A \u2192 B", target: "CRM/Anna.md" });
    });
  });
});
