/**
 * Memory harvest, write half: apply the decider's ADD/UPDATE decisions under
 * the guardrails in `memory-harvest.ts`. Each write is recorded as the exact
 * lines it inserted or replaced, which is what undo reverses (no note bodies
 * are stored anywhere). I/O is injected (`ApplyVault`), so this stays
 * Obsidian-free and the guardrails are testable end to end.
 */
import {
  appendTransit,
  applyAdd,
  applyUpdate,
  checkTarget,
  isFactText,
  normalizeTarget,
  stripProvenance,
  transitEntry,
  transitNote,
  HARVEST_MAX_WRITES,
  type Decision,
  type HarvestProvenance,
  type TargetEnv,
} from "./memory-harvest";
import { formatProvenance } from "./block-patch";
import { formatLoop, parseLoopsFile, uniqueLoopId, writeLoops } from "./open-loops";
import { protectedLines } from "./save-target";
import { factTextOf } from "./supersede";
import { containsSecret, oneLine } from "./text-safety";

export interface ApplyVault {
  exists(path: string): boolean;
  /** Current content of an existing note, or null. */
  read(path: string): Promise<string | null>;
  /** Atomic read-modify-write of an existing note (Obsidian `vault.process`):
   *  `fn` returns the new content, or null to leave the note untouched. */
  edit(path: string, fn: (current: string) => string | null): Promise<boolean>;
  /** Create a note (and its parent folders). */
  create(path: string, content: string): Promise<void>;
}

/** One write, precise enough to reverse: the digest's row and undo's handle. */
export interface AppliedWrite {
  path: string;
  op: "add" | "update";
  /** Human-readable text for the digest. */
  text: string;
  /** add: the exact lines inserted; update: the one new line. */
  lines: string[];
  /** update: the exact line it replaced. */
  replaced?: string;
  /** add that created the note (the transit file): its starter content, so
   *  undo can remove a note that holds nothing else. */
  created?: string;
}

export interface ApplyResult {
  writes: AppliedWrite[];
  rejected: { decision: Decision; reason: string }[];
}

export interface ApplyEnv extends TargetEnv {
  today: string;
  now: number;
  /** Every path shown to the decider as a NOTE: nothing else is writable
   *  (besides the inbox), whatever the model answers. */
  offered: ReadonlySet<string>;
  /** The loops file: an ADD there becomes a well-formed loop entry,
   *  and UPDATE is refused (its lines are the ledger's own metadata). */
  ledgerPath: string;
  /** `writers` of the vault's AGENTS.md (spec 5.1). With `inbox`, a fact for a
   *  shared note waits in Exo's transit file for `dream`; with `direct` it
   *  lands in its note at once. */
  writers: "inbox" | "direct";
  /** Paths and folder prefixes written at once whatever `writers` says: notes
   *  owned by one writer or append-only (observations, per-agent memory). */
  immediate: readonly string[];
  /** The chat the facts came from: code appends it to every line it writes. */
  provenance: HarvestProvenance;
}

export async function applyDecisions(vault: ApplyVault, decisions: readonly Decision[], env: ApplyEnv): Promise<ApplyResult> {
  const writes: AppliedWrite[] = [];
  const rejected: { decision: Decision; reason: string }[] = [];
  const created = new Set<string>();

  /** One entry into Exo's transit file, created on first use. */
  const transit = async (entry: string, text: string): Promise<AppliedWrite | null> => {
    const path = env.inboxPath;
    if (!created.has(path) && !env.exists(path)) {
      const starter = transitNote(env.today);
      await vault.create(path, appendTransit(starter, entry));
      created.add(path);
      return { path, op: "add", text, lines: [entry], created: starter };
    }
    const ok = await vault.edit(path, (cur) => appendTransit(cur, entry));
    return ok ? { path, op: "add", text, lines: [entry] } : null;
  };

  for (const d of decisions) {
    if (d.op === "noop") continue;
    const reject = (reason: string): void => void rejected.push({ decision: d, reason });
    if (writes.length >= HARVEST_MAX_WRITES) {
      reject("write limit reached");
      continue;
    }
    const path = normalizeTarget(d.path);
    if (path !== env.inboxPath && !env.offered.has(path)) {
      reject("not a note shown to the decider");
      continue;
    }
    const why = checkTarget(path, { ...env, exists: (p) => created.has(p) || env.exists(p) });
    if (why) {
      reject(why);
      continue;
    }
    const text = d.op === "add" ? d.text : d.newText;
    if (containsSecret(text) || (d.op === "update" && containsSecret(d.oldLine))) {
      reject("looks like a credential");
      continue;
    }

    if (path === env.ledgerPath) {
      if (d.op === "update") {
        reject("the loops file only takes new loops");
        continue;
      }
      const fact = oneLine(stripProvenance(d.text));
      if (!fact) {
        reject("text is only a provenance tail");
        continue;
      }
      const note = `${fact} ${formatProvenance({ ...env.provenance, msgIndex: 0 })}`;
      const out: { block?: string } = {};
      const ok = await vault.edit(path, (cur) => {
        const entries = parseLoopsFile(cur);
        const entry = {
          id: uniqueLoopId(fact.slice(0, 80), entries.map((e) => e.id)),
          title: fact.slice(0, 80),
          note,
          openedAt: env.now,
          status: "open" as const,
          owner: "user",
        };
        out.block = formatLoop(entry);
        return writeLoops(cur, [...entries, entry]);
      });
      if (!ok || !out.block) reject("loops file could not be edited");
      else writes.push({ path, op: "add", text: fact, lines: out.block.split("\n") });
      continue;
    }

    // The transit file takes new entries only: a fact with no home yet.
    if (path === env.inboxPath) {
      if (d.op === "update") {
        reject("the transit file only takes new entries");
        continue;
      }
      if (!isFactText(d.text)) {
        reject("text would be structure, not a line");
        continue;
      }
      const w = await transit(transitEntry(d.text, "?", env.provenance), oneLine(stripProvenance(d.text)));
      if (w) writes.push(w);
      else reject("transit file could not be edited");
      continue;
    }

    // writers: inbox. A fact for a shared note waits in transit (with the line
    // it replaces as `was`); `dream` places it. Owned or append-only notes
    // are written at once.
    if (env.writers === "inbox" && !env.immediate.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)))) {
      if (!isFactText(text)) {
        reject("text would be structure, not a line");
        continue;
      }
      let was: string | undefined;
      if (d.op === "update") {
        const lines = ((await vault.read(path)) ?? "").split("\n");
        const hits = lines.flatMap((l, i) => (l.trim() === d.oldLine.trim() ? [i] : []));
        if (hits.length !== 1 || protectedLines(lines).locked[hits[0]]) {
          reject("oldLine is not one plain line found exactly once");
          continue;
        }
        was = factTextOf(lines[hits[0]]);
      }
      const w = await transit(transitEntry(text, path, env.provenance, was), oneLine(stripProvenance(text)));
      if (w) writes.push(w);
      else reject("transit file could not be edited");
      continue;
    }

    const out: { write?: AppliedWrite } = {};
    const ok = await vault.edit(path, (cur) => {
      if (d.op === "add") {
        const res = applyAdd(cur, d.section, d.text, env.provenance);
        if (!res) return null;
        out.write = { path, op: "add", text: oneLine(stripProvenance(d.text)), lines: [res.line] };
        return res.content;
      }
      const res = applyUpdate(cur, d.oldLine, d.newText, env.provenance);
      if (!res) return null;
      out.write = { path, op: "update", text: oneLine(stripProvenance(d.newText)), lines: [res.to], replaced: res.from };
      return res.content;
    });
    if (!ok || !out.write) {
      reject(d.op === "add" ? "text would be structure, or the note is malformed" : "oldLine is not one plain line found exactly once");
      continue;
    }
    writes.push(out.write);
  }
  return { writes, rejected };
}
