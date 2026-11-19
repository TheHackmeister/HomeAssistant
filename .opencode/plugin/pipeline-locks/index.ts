// OpenCode V2 location plugin: lease locks for parallel board-coord loops
// (card #76). One lock file per pipeline lives at the CANONICAL repo root
// under .pipeline/locks/<pipelineKey>.json, so worktree sessions of one repo
// serialize on shared pipelines and parallelize on disjoint ones. A claim is
// all-or-nothing over the card's whole pipeline set (D18): keys are acquired
// with O_EXCL in sorted order — the same order for every claimant is the
// deadlock argument — and the first contention rolls back everything the
// claim already took. Every file of one claim carries the shared identity
// (sessionID + cardId + setId + full pipelineSet) so release, status, the
// C05 reaper and the board/alert legs can correlate the set.
//
// Why disk locks instead of an in-process mutex: one server process loads
// this plugin once per location dir (D27, probed on v2.1.4), so no object in
// memory can serialize claims across worktrees; O_EXCL creates and atomic
// tmp+rename writes are the cross-process primitives.
//
// Pipeline identity is board LABELS (D17): the worker derives the set from
// the card's `Pipeline:` labels (boards skill) and passes it to pipeline_claim
// — this plugin never reads the board. A card with no such label runs on the
// single default pipeline.
//
// Signalling (D28/D29, C01 probe verdicts for the pinned v2.1.4): the docs'
// session-instruction entry API is absent at runtime, so the PRIMARY
// lock-identity channel is the tool responses themselves; the instruction pin
// arms stay capability-gated and light up silently on a future release.
//
// Precedents: .opencode/plugin/question-notify/ and board-context/ — the
// plain `{ id, async setup(ctx) }` default-export object those two ship (the
// docs' wrapper-based authoring example is not the shape this repo ships;
// the core suite pins this one), degrade-never-throw, and store seams taking
// an injected deps env so the suites run offline against tmp dirs.
// Hand-written; rulesync must never generate or delete this file.
//
// Chunk map (cf-76): C03 shipped the lock store + the four tools; C04 added
// the heartbeat/lifecycle engine — tool hooks, the deferred event loop,
// beat/reap timers, the parent-walk resolveRoot and the set-wide lock-lost
// reaction; C05 added the reaper — stale locks to .reaped/, the card's
// Timeout move with the timeouts.jsonl degrade, the HA alert, and the
// /pipeline-reap + /pipeline-status commands; C06 (this state) adds the
// /pipeline-tick command and the .pipeline/config.json option loader (D8).
// Heartbeats follow ACTIVITY only
// (D20): the clock keeps ticking through human stop points and an idle lock
// goes stale like any other.
// The seam export surface stays ADDITIVE — later chunks extend this file,
// never reshape what the core suite pins.

import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import { basename, dirname, join } from "node:path";

// Single sources for C07's parity greps — each of these literals must occur
// exactly once in this file (core suite K1, A15's python parity reader).
export const LABEL_PREFIX = "Pipeline:";
export const DEFAULT_PIPELINE = "default";
export const TOOL_NAMES = ["pipeline_claim", "pipeline_release", "pipeline_heartbeat", "pipeline_status"];

// The worker prompt the tick executor sends after its reap. This sentence IS
// the shipped loop-file body (D30: slash dispatch from loop text is unproven
// on v2.1.4, so the loop file carries the plain text and /pipeline-tick stays
// the documented swap target until the live smoke proves dispatch) — C07's
// boards-skill iteration section and A15's parity arm pin both sides, so the
// three must agree on this exact wording.
export const TICK_PROMPT = "Load the boards skill and run exactly one Parallel pipeline loops iteration. First call pipeline_status, then follow the skill.";

// The instruction-entry key the claim pins and release removes (D16 lineage).
const PIN_KEY = "pipeline-lock";
// Runtime dir at the canonical root and its members (conventions: DECISIONS
// header — locks/, events.log, meta/lastReap written by C05, config.json
// read by the C06 loader).
const RUNTIME_DIR = ".pipeline";
const LOCKS_DIR = "locks";
const EVENTS_FILE = "events.log";
const CONFIG_FILE = "config.json";
// Storage keys live in one flat namespace per plugin id (ctx.storage is
// plugin-id + project-id scoped and shared across worktrees — D26, so the
// claim bookkeeping rebuilds after a server restart from any location).
const CLAIM_KEY_PREFIX = "claim/";

// An O_EXCL create publishes the file name before its body lands; a
// contending reader can briefly see an empty file. Bounded retry so the
// loser's holder report names the real winner instead of null.
const HOLDER_READ_DELAYS_MS = [0, 2, 5, 15, 40];

// Engine cadences (C04). Baked defaults until C06's loader feeds the file:
// timerMs is the activity-beat interval, reapEveryMs the cadence the C05
// reaper runs on, hookThrottleMs the per-pipeline heartbeat throttle pinned
// by AC2. NEGATIVE_CACHE_MS bounds how long an unresolvable parent walk stays
// unanswered — re-checked after the window so a session that gains a claim
// or a parent is picked up without a restart.
const DEFAULT_TIMER_MS = 300000;
const DEFAULT_REAP_EVERY_MS = 600000;
const DEFAULT_HOOK_THROTTLE_MS = 30000;
const NEGATIVE_CACHE_MS = 60000;
const RESOLVE_MAX_HOPS = 16;

// D21 ruled the stale window at 2 h — the reap uses staleMs default 7200000,
// not the handoff's 3 h; C06's config loader may override it per deployment.
const DEFAULT_STALE_MS = 7200000;

// The reaper's cross-process guard (D27: one plugin instance per location
// dir, all sharing one lock dir): mkdir is the atomic test-and-set, so one
// concurrent pass runs. Five minutes is far past the longest plausible pass,
// so an older guard belongs to a killed reaper and is safe to steal — once.
const REAPER_GUARD_DIR = "reaper.lock";
const GUARD_STALE_MS = 300000;

// Reaped locks land under the locks dir as <name>.<pass-ts>.json: the rename
// is the atomic claim (two reapers cannot both move one file) and the copies
// stay readable for forensics.
const REAPED_SUBDIR = ".reaped";

// The two MCP endpoints the reaper reaches. Their URLs are discovered at
// runtime — these server keys are the module's only literals. dev-boards
// mints the board login server-side (the plugin handles no credential); the
// HA alert needs the ADMIN tier because the readonly ha-mcp rejects service
// calls (question-notify's verified fact).
const BOARD_SERVER_KEY = "dev-boards";
const HA_SERVER_KEY = "admin-global-homeassistant";

// Board titles the card leg reads (D8 baked defaults; C06's loader may
// override). Titles repeat across swimlanes, so the Timeout list resolves
// against the card's own swimlane echo, never by title alone (D24).
const BOARD_DEFAULTS = { boardTitle: "AI-Dev", swimlaneTitle: "In Process", timeoutListTitle: "Timeout" };

// The user-facing reap texts: D21's 2 h window is what the card comment
// says, D11 pins the alert title verbatim.
const TIMEOUT_COMMENT = "Timed out: no heartbeat for 2h";
const REAP_ALERT_TITLE = "OpenCode: pipeline lock reaped";
const NOTIFY_DOMAIN = "notify";
const HA_NOTIFY_SERVICE = "mobile_app_pixel_6";
// question-notify's MAX_MESSAGE bound, shared by every outbound reap text:
// the phone alert and the card comment must carry one ceiling, not two
// truths that can drift apart.
const MAX_OUTBOUND_MESSAGE = 240;

// board-context's FETCH_TIMEOUT_MS precedent on every reaper MCP call: a
// hanging ingress may not stall the claim-time or timer reap paths.
const MCP_CALL_TIMEOUT_MS = 8_000;

// Ordinary beats would flood the audit at tool-call frequency; every tenth
// one is logged, forced beats (manual, child_mapped, execution_started) all
// are.
const BEAT_AUDIT_EVERY = 10;

// Child mappings ride the same durable store as claims (D26): after a server
// restart the session graph rebuilds through the setup-time scan.
const CHILD_KEY_PREFIX = "child/";

// The D16/D28 stop signal. v2.1.4 has no instruction API, so this exact text
// reaches callers through the strict execute.before throw and the tool
// responses; the boards skill tells the agent: on PIPELINE LOCK LOST stop —
// no commit, no card move.
const LOCK_LOST_STOP = "PIPELINE LOCK LOST — stop; do not commit or move the card";

// The tools that can land a commit or move a card — the strict guard blocks
// only these. Read-side tools stay available so a stopped run can still
// gather context for its hand-back.
const GUARDED_TOOLS = ["edit", "write", "bash"];

// session.updated never fires on v2.1.4 (D31) but the leg stays armed per
// the D32 ruling — harmless now, correct on a release that emits it.
const CREATED_EVENTS = ["session.created", "session.updated"];
const EXEC_STARTED = "session.execution.started";
const EXEC_SUCCEEDED = "session.execution.succeeded";
const TERMINAL_EVENTS = [EXEC_SUCCEEDED, "session.execution.failed", "session.execution.interrupted"];

// startEngine's fallback when no env.timers is injected — the suites fake
// the clock through env.timers, setup runs on the host's real timers.
const defaultTimers = {
  setInterval: (fn: any, ms: number) => setInterval(fn, ms),
  clearInterval: (handle: any) => clearInterval(handle),
  setTimeout: (fn: any, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: any) => clearTimeout(handle),
};

export function sanitizePipelineKey(name: string): string {
  // Lock files are named after the key, so everything outside
  // [A-Za-z0-9._-] folds to "-" and the 100-char filesystem-safe bound holds;
  // clean names pass through unchanged so the derived label stays readable on
  // the card. Idempotent by construction (no character is ever introduced
  // that a second pass would rewrite).
  const cleaned = String(name ?? "").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
  return cleaned.length > 0 ? cleaned : DEFAULT_PIPELINE;
}

export function derivePipelineSet(labelNames: string[]): string[] {
  // D17: keep the Pipeline:-prefixed labels, the trimmed remainder is the
  // pipeline name; prefix match is case-sensitive; empty remainder, wrong
  // case, or no labels at all fold to the single default pipeline.
  const kept = (Array.isArray(labelNames) ? labelNames : [])
    .filter((name) => typeof name === "string" && name.startsWith(LABEL_PREFIX))
    .map((name) => name.slice(LABEL_PREFIX.length).trim())
    .filter((name) => name.length > 0);
  const set = [...new Set(kept)];
  return set.length > 0 ? set.sort() : [DEFAULT_PIPELINE];
}

// D8: plugin options ride .pipeline/config.json ONLY — an optional file at
// the runtime dir; anything absent or unusable lands on these baked defaults
// (D13 keeps maxWorkers reserved and unwired, D21 owns the stale window).
function configDefaults(): any {
  return {
    staleMs: DEFAULT_STALE_MS,
    timerMs: DEFAULT_TIMER_MS,
    reapEveryMs: DEFAULT_REAP_EVERY_MS,
    hookThrottleMs: DEFAULT_HOOK_THROTTLE_MS,
    // D12: a failed root marks the lock and lets the reaper do the rest;
    // D16: the strict guard is ON, its throw is the stop signal.
    releaseOnFailure: false,
    strictLockLoss: true,
    haNotify: true,
    maxWorkers: null,
    board: { ...BOARD_DEFAULTS },
  };
}

const CONFIG_NUMBER_KEYS = ["staleMs", "timerMs", "reapEveryMs", "hookThrottleMs"];
const CONFIG_BOOLEAN_KEYS = ["releaseOnFailure", "strictLockLoss", "haNotify"];
const CONFIG_BOARD_KEYS = ["boardTitle", "swimlaneTitle", "timeoutListTitle"];

export async function loadConfig(deps: any, dir: string): Promise<any> {
  // A testable seam over the one option file: callers inject the promises
  // readFile (sync fs is structurally banned in this module — the tick suite
  // pins it) and a stderr log. Wrong-typed values fall back per key WITHOUT
  // coercion, so a config typo cannot quietly rewrite a cadence into NaN or
  // a string; a malformed file costs exactly one log line and never a throw
  // — a plugin that refuses to load is worse than one on defaults. Unknown
  // keys, top-level or inside board, are ignored.
  const cfg = configDefaults();
  const warn = (line: string): void => {
    try {
      if (typeof deps?.log === "function") deps.log(`config.json: ${line}`);
    } catch {
      // a broken logger cannot break the loader contract
    }
  };
  let raw: unknown;
  try {
    if (typeof deps?.readFile !== "function") return cfg;
    raw = await deps.readFile(join(String(dir ?? ""), CONFIG_FILE));
  } catch (err: any) {
    if (err?.code === "ENOENT") return cfg; // the normal state — no file, no warn
    warn(`read failed (${String(err?.code ?? err)}) — defaults stand`);
    return cfg;
  }
  let parsed: any;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    warn("file is not valid JSON — defaults stand");
    return cfg;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warn("file is not a JSON object — defaults stand");
    return cfg;
  }
  for (const key of CONFIG_NUMBER_KEYS) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) cfg[key] = value;
    else warn(`${key} is not a positive number — default stands`);
  }
  for (const key of CONFIG_BOOLEAN_KEYS) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (typeof value === "boolean") cfg[key] = value;
    else warn(`${key} is not a boolean — default stands`);
  }
  if (parsed.maxWorkers !== undefined) {
    if (typeof parsed.maxWorkers === "number" && Number.isFinite(parsed.maxWorkers) && parsed.maxWorkers >= 0) cfg.maxWorkers = parsed.maxWorkers;
    else warn("maxWorkers is not a number — default stands");
  }
  if (parsed.board !== undefined) {
    if (parsed.board && typeof parsed.board === "object" && !Array.isArray(parsed.board)) {
      for (const key of CONFIG_BOARD_KEYS) {
        const value = parsed.board[key];
        if (value === undefined) continue;
        if (typeof value === "string" && value) cfg.board[key] = value;
        else warn(`board.${key} is not a string — default stands`);
      }
    } else warn("board is not an object — defaults stand");
  }
  return cfg;
}

export async function resolveLockRoot(deps: any, startDir: string): Promise<string> {
  // D10 chain: ctx.location.project.canonical (probe-confirmed string path
  // equal to the main checkout root) → git-common-dir derivation from a
  // worktree .git file → the start dir. Pure fs reads through the injected
  // readFile; every miss falls through and the function never throws — a bad
  // guess at the root is worse than the start dir it came from.
  const canonical = typeof deps?.canonical === "string" && deps.canonical ? deps.canonical : null;
  if (canonical) return canonical;
  try {
    if (typeof deps?.readFile === "function" && typeof startDir === "string" && startDir) {
      const raw = String(await deps.readFile(join(startDir, ".git")));
      const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(raw)?.[1];
      // Only the .git/worktrees/<name> suffix strips; any other gitdir target
      // (plain linked worktrees, submodule layouts) is not a provable common
      // dir and falls through instead of guessing.
      const common = gitdir ? /^(.*)\/\.git\/worktrees\/[^/]+$/.exec(gitdir)?.[1] : null;
      if (common) return common;
    }
  } catch {
    // .git is a directory in a main checkout (or unreadable): the leg missed.
  }
  return typeof startDir === "string" && startDir ? startDir : process.cwd();
}

export function newLockRecord(input: any): any {
  // Handoff B.1 shape, version 1, plus the D18 shared claim identity. Every
  // timestamp is an ISO-8601 UTC string (D25) — epoch-ms in lock files is a
  // contract violation; the age math downstream parses these against env.now.
  const at = new Date(input?.now ?? Date.now()).toISOString();
  const record: any = {
    version: 1,
    pipeline: input?.pipeline,
    cardId: input?.cardId,
    sessionID: input?.sessionID,
    setId: input?.setId,
    pipelineSet: [...(input?.pipelineSet ?? [])].sort(),
    state: "live",
    claimedAt: at,
    heartbeatAt: at,
  };
  if (input?.cardTitle) record.cardTitle = input.cardTitle;
  return record;
}

function storeFs(env: any): any {
  // Tests inject single fs members to exercise failure legs; production rides
  // the promises API (a sync fs call here would block the server event loop).
  return env?.fs ?? fsp;
}

function lockPathOf(env: any, pipelineKey: string): string {
  return join(env.locksDir, `${pipelineKey}.json`);
}

function claimKeyOf(sessionID: string): string {
  return `${CLAIM_KEY_PREFIX}${sessionID}`;
}

function childKeyOf(sessionID: string): string {
  return `${CHILD_KEY_PREFIX}${sessionID}`;
}

function logNote(env: any, line: string): void {
  const text = `[pipeline-locks] ${line}`;
  if (typeof env?.log === "function") env.log(text);
  else console.error(text);
}

export async function writeLockAtomic(env: any, path: string, record: any): Promise<void> {
  // tmp sibling + rename: readers never observe a half-written lock. On a
  // failed tmp write or rename the live file must keep its previous bytes —
  // the tmp is what fails, never the target.
  const fsx = storeFs(env);
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await fsx.writeFile(tmp, JSON.stringify(record, null, 2));
    await fsx.rename(tmp, path);
  } catch (err: any) {
    try {
      await fsx.rm(tmp, { force: true });
    } catch {
      // a tmp that never landed needs no cleanup
    }
    throw err;
  }
  const stamp = new Date(env?.now?.() ?? Date.now());
  try {
    // mtime must move with every rewrite: the reaper's staleness formula is
    // max(heartbeatAt, mtime), so a hand-touched or stale-clock file cannot
    // hide behind an old mtime and a corrupt record cannot fake freshness.
    await fsx.utimes(path, stamp, stamp);
  } catch (err: any) {
    logNote(env, `utimes after atomic write failed for ${basename(path)}: ${String(err?.code ?? err)}`);
  }
}

export async function readLock(env: any, path: string): Promise<any | null> {
  // Parse error or missing → null. A valid JSON object comes back verbatim:
  // unknown keys survive, which is the older-schema tolerance contract the
  // reaper and status legs ride on.
  try {
    const parsed = JSON.parse(await storeFs(env).readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function appendEvent(env: any, obj: any): Promise<void> {
  // JSONL audit. Fire-and-forget semantics: a broken path logs one line and
  // resolves — an audit write must never fail or block the action it records.
  const line = JSON.stringify({ at: new Date(env?.now?.() ?? Date.now()).toISOString(), ...obj }) + "\n";
  try {
    await storeFs(env).writeFile(String(env?.eventsPath), line, { encoding: "utf8", flag: "a" });
  } catch (err: any) {
    logNote(env, `audit append failed: ${String(err?.code ?? err)}`);
  }
}

function normalizePipelineSet(pipelines: any): string[] {
  const keys = (Array.isArray(pipelines) ? pipelines : [])
    .map((name: any) => sanitizePipelineKey(String(name ?? "")))
    .filter((key: string) => key.length > 0);
  const set = [...new Set(keys)];
  return set.length > 0 ? set.sort() : [DEFAULT_PIPELINE];
}

async function readHolder(env: any, path: string): Promise<any | null> {
  for (const delay of HOLDER_READ_DELAYS_MS) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const rec = await readLock(env, path);
    if (rec) return rec;
  }
  return null;
}

// Acquisition and rollback in one seam: walking the sorted keys is the
// deadlock argument between overlapping claims, and the first EEXIST (or any
// other fs failure) unlinks every file this pass already took before
// returning — the walk order and its undo can never drift apart (D18).
async function acquireSetWithRollback(env: any, claim: any): Promise<{ ok: true } | { ok: false; reason: string; pipeline: string; holder?: any; error?: string }> {
  const fsx = storeFs(env);
  const taken: string[] = [];
  for (const pipeline of claim.pipelineSet) {
    const path = lockPathOf(env, pipeline);
    try {
      const handle = await fsx.open(path, "wx");
      try {
        await handle.writeFile(JSON.stringify(newLockRecord({ ...claim, pipeline, now: env?.now?.() ?? Date.now() }), null, 2));
      } finally {
        await handle.close();
      }
      taken.push(path);
    } catch (err: any) {
      for (const p of taken) {
        try {
          await fsx.rm(p, { force: true });
        } catch {
          // best-effort: a file this pass took that cannot be removed reads
          // to the reaper as any other orphan and ages out
        }
      }
      if (err?.code !== "EEXIST") {
        return { ok: false, reason: "store_error", pipeline, error: String(err?.code ?? err) };
      }
      const holder = await readHolder(env, path);
      if (taken.length > 0) {
        await appendEvent(env, { ev: "claim_rollback", ...claim, rolledBack: taken.map((p) => basename(p, ".json")), pipeline });
      }
      return { ok: false, reason: "locked", pipeline, holder };
    }
  }
  return { ok: true };
}

export async function claimLockSet(env: any, input: any): Promise<any> {
  const sessionID = String(input?.sessionID ?? "") || "unknown";
  const set = normalizePipelineSet(input?.pipelines);
  const cardId = input?.cardId;

  try {
    // Reap-before-claim: a dead run's stale lock must not starve a fresh
    // claim, so every claimant sweeps once through the guarded reaper.
    if (typeof env?.reapStale === "function") await env.reapStale({ trigger: "claim" });
  } catch (err: any) {
    logNote(env, `claim-time reap hook failed, continuing: ${String(err?.code ?? err?.message ?? err)}`);
  }

  // One card per iteration: refuse while this root session already holds a
  // claim. Checked against the storage bookkeeping too, because a server
  // restart empties the in-process cache while the disk locks persist.
  const held = await findClaim(env, sessionID);
  if (held) return { ok: false, reason: "already_held", held };

  await storeFs(env).mkdir(env.locksDir, { recursive: true });

  const setId = randomUUID();
  const claim = { cardId, sessionID, setId, cardTitle: input?.cardTitle, pipelineSet: set };
  const acquisition = await acquireSetWithRollback(env, claim);
  if (!acquisition.ok) {
    env?.claims?.delete(sessionID);
    return acquisition;
  }

  const entry = { setId, cardId, pipelineSet: set, sessionID };
  env?.claims?.set(sessionID, entry);
  try {
    // ctx.storage is durable and shared across worktree locations (D26) —
    // the restart-resume rebuild C04 relies on starts here. A storage miss
    // never voids the disk locks, which remain the truth.
    if (env?.storage) await env.storage.set(claimKeyOf(sessionID), entry);
  } catch (err: any) {
    logNote(env, `claim bookkeeping persist failed (cache + disk locks still hold): ${String(err?.code ?? err)}`);
  }
  try {
    // Capability-gated per D28: env.pin is null on v2.1.4 (the tool response
    // below is the primary identity channel) and the pin lights up silently
    // when a newer server exposes the instructions entry API.
    if (env?.pin) {
      await env.pin.put(sessionID, PIN_KEY, `PIPELINE LOCK card=${String(cardId ?? "")} pipelines=${set.join(",")} setId=${setId} — release with pipeline_release when the card moves to Review.`);
    }
  } catch (err: any) {
    logNote(env, `instruction pin failed (tool-response channel still authoritative): ${String(err?.code ?? err)}`);
  }
  await appendEvent(env, { ev: "claim", setId, cardId, sessionID, pipelineSet: set });
  return { ok: true, setId, lockPaths: set.map((pipeline) => lockPathOf(env, pipeline)) };
}

async function findClaim(env: any, sessionID: string): Promise<any | null> {
  const cached = env?.claims?.get(sessionID) ?? null;
  if (cached) return cached;
  if (env?.storage) {
    try {
      return (await env.storage.get(claimKeyOf(sessionID), null)) ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function releaseLockSet(env: any, input: any): Promise<any> {
  const sessionID = String(input?.sessionID ?? "");
  const entry = await findClaim(env, sessionID);
  // Idempotent by design: a release for a session holding nothing succeeds
  // quietly, so C04/C05 teardown legs can fire it without racing a claim.
  if (!entry) return { ok: true, released: [] };
  const set: string[] = Array.isArray(entry.pipelineSet) ? entry.pipelineSet : [];

  // Owner-check the WHOLE set first — a release that deletes half of a set
  // whose other member was stolen would free one pipeline under a thief.
  const records = new Map<string, any>();
  for (const pipeline of set) {
    const rec = await readLock(env, lockPathOf(env, pipeline));
    if (rec && String(rec.sessionID) !== sessionID) {
      return { ok: false, reason: "not_owner", pipeline };
    }
    records.set(pipeline, rec);
  }

  const fsx = storeFs(env);
  for (const pipeline of set) {
    try {
      await fsx.rm(lockPathOf(env, pipeline), { force: true });
    } catch (err: any) {
      logNote(env, `release could not remove ${pipeline}: ${String(err?.code ?? err)}`);
    }
  }
  await appendEvent(env, {
    ev: "release",
    outcome: input?.outcome,
    setId: entry.setId,
    cardId: entry.cardId,
    sessionID,
    pipelineSet: set,
  });
  env?.claims?.delete(sessionID);
  try {
    if (env?.storage) await env.storage.remove(claimKeyOf(sessionID));
  } catch (err: any) {
    logNote(env, `release storage cleanup failed: ${String(err?.code ?? err)}`);
  }
  try {
    if (env?.pin) await env.pin.remove(sessionID, PIN_KEY);
  } catch (err: any) {
    logNote(env, `release pin cleanup failed: ${String(err?.code ?? err)}`);
  }
  return { ok: true, released: set, setId: entry.setId };
}

export async function lockStatus(env: any, input: any = {}): Promise<any> {
  // Every lock file, grouped by setId/card so a multi-pipeline claim reads as
  // ONE unit (D18). lastReap is the reaper's meta file — null until the first
  // reap writes it.
  const fsx = storeFs(env);
  let names: string[] = [];
  try {
    names = (await fsx.readdir(env.locksDir)).filter((name: string) => name.endsWith(".json")).sort();
  } catch {
    // no locks dir yet = nothing held
  }

  const groups = new Map<string, any>();
  for (const name of names) {
    const rec = await readLock(env, join(env.locksDir, name));
    if (!rec) continue;
    const key = String(rec.setId ?? `${String(rec.cardId)}|${String(rec.sessionID)}`);
    let group = groups.get(key);
    if (!group) {
      const stamp = Date.parse(String(rec.heartbeatAt ?? rec.claimedAt ?? ""));
      group = {
        setId: rec.setId ?? null,
        cardId: rec.cardId,
        holder: rec.sessionID,
        pipelineSet: Array.isArray(rec.pipelineSet) ? [...rec.pipelineSet] : [],
        pipelines: [] as string[],
        state: String(rec.state ?? "live"),
        ageMs: Number.isFinite(stamp) ? Math.max(0, (env?.now?.() ?? Date.now()) - stamp) : 0,
      };
      groups.set(key, group);
    }
    if (rec.pipeline && !group.pipelines.includes(rec.pipeline)) group.pipelines.push(rec.pipeline);
  }
  const groupList = [...groups.values()];
  for (const group of groupList) {
    // A legacy record without pipelineSet still reads complete through its
    // observed members; the union keeps the set view honest either way.
    group.pipelineSet = [...new Set([...group.pipelineSet, ...group.pipelines])].sort();
  }

  let session: any = null;
  if (input?.sessionID) {
    const entry = await findClaim(env, String(input.sessionID));
    const group = groupList.find((g) => String(g.holder) === String(input.sessionID)) ?? null;
    session = entry && group ? { ...group, ...entry } : entry ?? group;
  }
  return { groups: groupList, session: session ?? null, lastReap: await readLock(env, env?.metaPath) };
}

async function checkMember(env: any, path: string, root: string): Promise<{ state: string; rec?: any }> {
  // Missing (reaped/hand-deleted) or foreign-owned is the D18 lock-lost
  // signal. Any other read failure is indistinguishable from "present but
  // momentarily unreadable" and must never delete a live set, so it reports
  // unreadable and the caller skips the beat instead of guessing.
  try {
    const parsed = JSON.parse(await storeFs(env).readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return { state: "unreadable" };
    return String(parsed.sessionID) === root ? { state: "live", rec: parsed } : { state: "stolen", rec: parsed };
  } catch (err: any) {
    return { state: err?.code === "ENOENT" ? "missing" : "unreadable" };
  }
}

async function handleLockLost(env: any, root: string, entry: any, detail: any): Promise<void> {
  // D18: losing ANY member loses the WHOLE claim. Our surviving members are
  // deleted at once so those pipelines free up for other cards; nothing here
  // can ever recreate a file — a lost set is gone and re-claimed only by a
  // fresh run.
  const set: string[] = Array.isArray(entry?.pipelineSet) ? [...entry.pipelineSet].sort() : [];
  const fsx = storeFs(env);
  const setId = entry?.setId;
  for (const pipeline of set) {
    const path = lockPathOf(env, pipeline);
    try {
      // Ownership-guarded cleanup: the stolen trigger member may already
      // belong to a FRESH healthy claim — our file was reaped (C05 renames
      // it away), another card re-claimed the freed pipeline with its own
      // sessionID and setId — and deleting that file would kill the live
      // new claimant in a cascade. Re-read each member path and delete only
      // what is ours: ours by sessionID, or ours by the setId D18 stamped
      // into every file of this claim. Foreign-owned and unreadable member
      // paths are left untouched (a corrupt one ages out to the reaper, the
      // designed floor for that class); missing is nothing to clear.
      const check = await checkMember(env, path, root);
      if (check.state === "missing") continue;
      const ours =
        check.state === "live" ||
        (setId != null && check.rec != null && String(check.rec.setId) === String(setId));
      if (ours) {
        await fsx.rm(path, { force: true });
      } else {
        logNote(env, `lock-lost left ${pipeline}.json untouched (${check.state}) — an unowned member path belongs to its claimant, not to this dead set`);
      }
    } catch (err: any) {
      logNote(env, `lock-lost cleanup failed for ${pipeline}: ${String(err?.code ?? err)}`);
    }
  }
  env?.claims?.delete(root);
  if (env?.executing && env?.sessToRoot) {
    for (const sid of env.executing) if (String(env.sessToRoot.get(sid) ?? "") === root) env.executing.delete(sid);
    for (const [sid, mapped] of env.sessToRoot) if (mapped === root) env.sessToRoot.delete(sid);
  }
  for (const pipeline of set) {
    // Drop the throttle stamps too: a later claim of the same pipeline must
    // not be silently throttled by this dead set's last beat.
    env?.lastBeat?.delete(pipeline);
    env?.beatSeq?.delete(pipeline);
  }
  try {
    if (env?.storage) await env.storage.remove(claimKeyOf(root));
  } catch (err: any) {
    logNote(env, `lock-lost storage cleanup failed: ${String(err?.code ?? err)}`);
  }
  await appendEvent(env, {
    ev: "lock_lost",
    setId: entry?.setId,
    cardId: entry?.cardId,
    sessionID: root,
    pipelineSet: set,
    lostPipeline: detail?.pipeline ?? null,
    cause: detail?.cause ?? "missing",
  });
  try {
    // Capability-gated per D28: the pin UPDATE to the STOP text is what a
    // future release with the instructions API reads; on v2.1.4 the strict
    // before-guard throw and the tool responses carry the same sentence.
    if (env?.pin) await env.pin.put(root, PIN_KEY, `${LOCK_LOST_STOP} — the claim (setId=${String(entry?.setId ?? "")}) is gone; only a fresh run may re-claim.`);
  } catch (err: any) {
    logNote(env, `lock-lost pin update failed (guard + tool responses still carry the stop): ${String(err?.code ?? err)}`);
  }
}

export async function heartbeatSet(env: any, rootID: any, source: any, force: any): Promise<void> {
  const root = String(rootID ?? "");
  const entry = await findClaim(env, root);
  if (!entry) return;
  const set: string[] = Array.isArray(entry.pipelineSet) ? entry.pipelineSet : [];
  if (set.length === 0) return;

  // Verify EVERY member before touching any: a per-file half beat would keep
  // a doomed set alive — lock state is set-wide (D18).
  const verified = new Map<string, any>();
  for (const pipeline of set) {
    const check = await checkMember(env, lockPathOf(env, pipeline), root);
    if (check.state === "missing" || check.state === "stolen") {
      await handleLockLost(env, root, entry, { pipeline, cause: check.state });
      return;
    }
    if (check.state !== "live") {
      logNote(env, `beat skipped: ${pipeline}.json unreadable this pass (transient read failures never trigger the lost path)`);
      return;
    }
    verified.set(pipeline, check.rec);
  }

  const now = env?.now?.() ?? Date.now();
  const throttle = Number(env?.config?.hookThrottleMs) || DEFAULT_HOOK_THROTTLE_MS;
  const stamp = new Date(now).toISOString();
  for (const pipeline of set) {
    const last = env?.lastBeat?.get(pipeline);
    if (!force && typeof last === "number" && now - last <= throttle) continue;
    try {
      // Rewrite from the re-read record: fields the reaper or another writer
      // added survive the beat, and heartbeatAt is the only thing moved.
      await writeLockAtomic(env, lockPathOf(env, pipeline), { ...verified.get(pipeline), heartbeatAt: stamp });
      env?.lastBeat?.set(pipeline, now);
      if (!env?.beatSeq) env.beatSeq = new Map();
      const seq = Number(env.beatSeq.get(pipeline) ?? 0) + 1;
      env.beatSeq.set(pipeline, seq);
      if (force === true || seq % BEAT_AUDIT_EVERY === 0) {
        await appendEvent(env, { ev: "beat", pipeline, setId: entry.setId, cardId: entry.cardId, sessionID: root, source: String(source ?? "") });
      }
    } catch (err: any) {
      logNote(env, `beat write failed for ${pipeline}: ${String(err?.code ?? err)}`);
    }
  }
}

export async function runBeatTick(env: any): Promise<void> {
  // Activity-based heartbeat only (D20): claims get timer beats solely while
  // their root or a mapped descendant is executing. Idle roots deliberately
  // receive nothing — that is what lets a human stop point and an abandoned
  // run age into staleness like any other dead lock.
  const executing = env?.executing;
  if (!(executing instanceof Set) || executing.size === 0) return;
  const activeRoots = new Set<string>();
  for (const sid of executing) {
    const mapped = env?.sessToRoot?.get(sid);
    activeRoots.add(typeof mapped === "string" && mapped ? mapped : sid);
  }
  const claims = env?.claims;
  if (!(claims instanceof Map)) return;
  for (const rootID of claims.keys()) {
    if (!activeRoots.has(String(rootID))) continue;
    try {
      await heartbeatSet(env, rootID, "timer", false);
    } catch (err: any) {
      logNote(env, `timer beat failed for ${rootID}: ${String(err?.message ?? err)}`);
    }
  }
}

async function markSetFailed(env: any, root: string, entry: any, cause: string): Promise<void> {
  // D12 with releaseOnFailure=false: the set stays on disk marked failed,
  // receives no further beats (runBeatTick only follows executing), and ages
  // out to the C05 reaper. A member already missing/stolen is left to the
  // next heartbeatSet pass — the lost path is that one's job, not this.
  const set: string[] = Array.isArray(entry?.pipelineSet) ? entry.pipelineSet : [];
  for (const pipeline of set) {
    try {
      const path = lockPathOf(env, pipeline);
      const rec = await readLock(env, path);
      if (!rec || String(rec.sessionID) !== root) continue;
      await writeLockAtomic(env, path, { ...rec, state: "failed" });
    } catch (err: any) {
      logNote(env, `failed-state stamp could not write ${pipeline}: ${String(err?.code ?? err)}`);
    }
  }
  await appendEvent(env, {
    ev: "exec_failed",
    setId: entry?.setId,
    cardId: entry?.cardId,
    sessionID: root,
    pipelineSet: [...set].sort(),
    cause,
  });
}

export async function handleEvent(env: any, event: any): Promise<void> {
  try {
    const type = String(event?.type ?? "");
    if (!type) return;
    // Dual read: the durable V2 envelope nests under `data`, the compat twin
    // may deliver it flat, and the session payload itself nests under
    // `info` on some emitters (question-notify's tolerant reads).
    const data: any = event?.data ?? event;
    const sessionID = String(data?.sessionID ?? data?.info?.sessionID ?? "");

    if (CREATED_EVENTS.includes(type)) {
      if (!sessionID) return;
      const parentID = String(data?.parentID ?? data?.info?.parentID ?? "");
      if (!parentID || env?.sessToRoot?.has(sessionID)) return;
      const root = await resolveRoot(env, parentID);
      const entry = await findClaim(env, root);
      if (!entry || root === sessionID) return;
      env?.sessToRoot?.set(sessionID, root);
      try {
        if (env?.storage) await env.storage.set(childKeyOf(sessionID), { sessionID, rootID: root, parentID });
      } catch (err: any) {
        logNote(env, `child-map persist failed (the live mapping still holds): ${String(err?.code ?? err)}`);
      }
      await heartbeatSet(env, root, "child_mapped", true);
      await appendEvent(env, {
        ev: "child_mapped",
        sessionID,
        parentID,
        rootID: root,
        setId: entry?.setId ?? null,
        cardId: entry?.cardId ?? null,
      });
      return;
    }

    if (type === EXEC_STARTED) {
      if (!sessionID) return;
      const root = await resolveRoot(env, sessionID);
      const entry = await findClaim(env, root);
      if (!entry) return;
      env?.executing?.add(sessionID);
      await heartbeatSet(env, root, "execution_started", true);
      return;
    }

    if (TERMINAL_EVENTS.includes(type)) {
      if (!sessionID) return;
      env?.executing?.delete(sessionID);
      const root = await resolveRoot(env, sessionID);
      const entry = await findClaim(env, root);
      if (!entry || sessionID !== root) return;
      // Turn end is not iteration end (B.9): succeeded is bookkeeping only,
      // the release rides the card's move to Review (D6). A CHILD's outcome
      // never touches the set — only the root's does (leg above).
      if (type === EXEC_SUCCEEDED) return;
      if (env?.executing && env?.sessToRoot) {
        for (const sid of env.executing) if (String(env.sessToRoot.get(sid) ?? "") === root) env.executing.delete(sid);
      }
      if (env?.config?.releaseOnFailure === true) {
        await releaseLockSet(env, { sessionID: root, outcome: "abandoned" });
        return;
      }
      await markSetFailed(env, root, entry, type);
    }
  } catch (err: any) {
    logNote(env, `event handler failed for ${String(event?.type ?? "")}: ${String(err?.message ?? err)}`);
  }
}

export async function toolBefore(env: any, event: any): Promise<void> {
  const tool = String(event?.tool ?? "");
  const sessionID = String(event?.sessionID ?? event?.context?.sessionID ?? "");
  if (!tool || !sessionID || TOOL_NAMES.includes(tool)) return;
  // The pipeline_* tools beat through their own executors; hooking them
  // here would double-write on every claim/status call.
  let root = "";
  let claimed = false;
  try {
    root = await resolveRoot(env, sessionID);
    const entry = await findClaim(env, root);
    if (!entry) return;
    claimed = true;
    await heartbeatSet(env, root, "hook", false);
  } catch (err: any) {
    logNote(env, `before-hook beat failed: ${String(err?.message ?? err)}`);
  }
  if (!claimed) return;
  let still = null;
  try {
    still = await findClaim(env, root);
  } catch {
    still = null;
  }
  if (still) return;
  // The beat above just took the set-wide lost path. Throwing here blocks the
  // tool call (C01 fact 2) and its text IS the stop signal on v2.1.4 (D28 —
  // execute.after never fires for before-blocked calls, so the beat that
  // detected the loss is also the last activity this set ever records).
  if (GUARDED_TOOLS.includes(tool) && env?.config?.strictLockLoss !== false) {
    throw new Error(LOCK_LOST_STOP);
  }
}

export async function toolAfter(env: any, event: any): Promise<void> {
  const tool = String(event?.tool ?? "");
  const sessionID = String(event?.sessionID ?? event?.context?.sessionID ?? "");
  if (!tool || !sessionID || TOOL_NAMES.includes(tool)) return;
  try {
    const root = await resolveRoot(env, sessionID);
    const entry = await findClaim(env, root);
    if (!entry) return;
    await heartbeatSet(env, root, "hook", false);
  } catch (err: any) {
    logNote(env, `after-hook beat failed: ${String(err?.message ?? err)}`);
  }
}

export function startEngine(env: any): { stop(): void } {
  // Only timers here — the event subscription and its abort channel belong
  // to setup, so the cadences stay testable without a server. Callbacks
  // catch their own errors: an unhandled rejection can kill the host
  // (question-notify precedent).
  const timers = env?.timers ?? defaultTimers;
  const beat = timers.setInterval(() => {
    runBeatTick(env).catch((err: any) => logNote(env, `beat tick failed: ${String(err?.message ?? err)}`));
  }, Number(env?.config?.timerMs) || DEFAULT_TIMER_MS);
  const reap = timers.setInterval(() => {
    try {
      Promise.resolve(env?.reapStale?.({ trigger: "timer" })).catch((err: any) => logNote(env, `reap tick failed: ${String(err?.message ?? err)}`));
    } catch (err: any) {
      logNote(env, `reap tick failed: ${String(err?.message ?? err)}`);
    }
  }, Number(env?.config?.reapEveryMs) || DEFAULT_REAP_EVERY_MS);
  return {
    stop() {
      timers.clearInterval(beat);
      timers.clearInterval(reap);
    },
  };
}

// C05 — the reaper and its card legs. A lock nobody heartbeats through the
// stale window is a dead run holding a pipeline: free the file, park the
// card, ring the phone. The reap itself is the only guaranteed outcome —
// board, HA and storage legs each degrade to their own audit line.

// Raw MCP-over-HTTP mechanics: asArray/parseSseData/unwrapToolResult/
// makeCallTool are copied verbatim from .opencode/plugin/board-context/
// index.ts (the recipe provenance lives in that file's header and in
// skills/wekan-api/references/wekan-mcp-ops.md). Duplicated, never imported:
// plugin discovery loads every module under .opencode/plugin/, so a cross-
// plugin import would register board-context a second time as a dependency
// entry of this plugin.
function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const found = Object.values(value).find((entry) => Array.isArray(entry));
    if (Array.isArray(found)) return found;
  }
  return [];
}

function parseSseData(text: string): any | null {
  try {
    if (text.includes("data:")) {
      const data = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .pop()
        ?.slice(5)
        .trim();
      return data ? JSON.parse(data) : null;
    }
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function unwrapToolResult(rpcBody: any): any {
  if (rpcBody?.error) throw new Error(`MCP error ${rpcBody.error.code}: ${rpcBody.error.message}`);
  const result = rpcBody?.result;
  if (!result) throw new Error("MCP response carried no result");
  const structured = result.structuredContent;
  if (structured && typeof structured === "object") {
    return structured.result !== undefined ? structured.result : structured;
  }
  for (const part of asArray(result.content)) {
    if (part?.type === "text" && typeof part.text === "string") {
      try {
        return JSON.parse(part.text);
      } catch {
        return part.text;
      }
    }
  }
  return result;
}

function makeCallTool(url: string): (name: string, args: any) => Promise<any> {
  let sessionId: string | null = null;
  let seq = 0;

  const post = async (method: string, params: any) => {
    const isNotification = method.startsWith("notifications/");
    const payload: any = { jsonrpc: "2.0", method, params };
    if (!isNotification) payload.id = ++seq;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(MCP_CALL_TIMEOUT_MS),
    });
    sessionId = res.headers.get("mcp-session-id") ?? sessionId;
    if (isNotification) return null;
    const body = parseSseData(await res.text());
    if (body === null) throw new Error(`unparseable ${method} response`);
    return body;
  };

  return async (name, args) => {
    if (!sessionId) {
      await post("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "opencode-pipeline-locks", version: "1.0.0" },
      });
      await post("notifications/initialized", {});
    }
    const body = await post("tools/call", { name, arguments: args });
    return unwrapToolResult(body);
  };
}

// Runtime URL discovery for one named MCP server, the two shipped precedents'
// arms in order: ctx.mcp.transform editor.get — the only ctx view whose
// entries carry full server configs (question-notify's verified shape) — then
// the ctx.mcp.list() scan (compat twin for builds whose list answers
// configs). opts.projectConfig adds board-context's third leg, the project-
// config text: dev-boards is configured in the project file, while the HA
// admin entry lives in the machine-global config that file cannot show — so
// HA discovery stops at the two live arms. Never rejects: null means no URL
// and every caller owns its degrade.
async function discoverMcpUrl(ctx: any, serverKey: string, opts: any = {}): Promise<string | null> {
  let url: string | undefined;
  let registration: any;
  try {
    registration = await ctx?.mcp?.transform?.((editor: any) => {
      try {
        const cfg = editor?.get?.(serverKey);
        if (typeof cfg?.url === "string") url = cfg.url;
      } catch {
        // a poisoned config read is a leg-1 miss; the next arms own the rest
      }
    });
  } catch {
    // transform absent or rejecting: leg-1 miss
  } finally {
    try {
      // A leaked transform registration keeps re-firing on every config
      // recompute, so it closes here always; a rejecting dispose cannot
      // undo a completed capture.
      await registration?.dispose?.();
    } catch {
      // never reject the seam
    }
  }
  if (typeof url === "string") return url;
  try {
    const list = await ctx?.mcp?.list?.();
    const entries: any[] = Array.isArray(list) ? list : asArray(list?.servers);
    for (const entry of entries) {
      const [name, cfg] = Array.isArray(entry) ? entry : [entry?.name, entry];
      if (name === serverKey && typeof cfg?.url === "string") return cfg.url;
    }
  } catch {
    // list absent or rejecting: the live arms missed
  }
  if (opts?.projectConfig !== true) return null;
  try {
    // The promises API only — a sync read here would block the server event
    // loop, which this module structurally never does (the tick suite pins).
    const raw = await fsp.readFile(join(String(ctx?.location?.directory ?? ""), ".opencode", "opencode.jsonc"), "utf8");
    const idx = raw.indexOf(`"${serverKey}"`);
    if (idx < 0) return null;
    const match = raw.slice(idx).match(/"url"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function acquireReaperGuard(env: any, fsx: any): Promise<boolean> {
  const guard = join(env.runtimeDir, REAPER_GUARD_DIR);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fsx.mkdir(env.runtimeDir, { recursive: true });
      await fsx.mkdir(guard);
      return true;
    } catch (err: any) {
      if (err?.code !== "EEXIST") {
        logNote(env, `reaper guard could not be created: ${String(err?.code ?? err)}`);
        return false;
      }
      if (attempt > 0) return false; // lost the steal race — a live reaper owns it now
      let ageMs = Number.NaN;
      try {
        ageMs = (env?.now?.() ?? Date.now()) - (await fsx.stat(guard)).mtimeMs;
      } catch {
        return false; // the guard vanished mid-race: its holder is releasing it
      }
      if (ageMs < GUARD_STALE_MS) return false;
      try {
        await fsx.rm(guard, { recursive: true, force: true });
      } catch (err: any) {
        logNote(env, `stale reaper guard could not be removed: ${String(err?.code ?? err)}`);
        return false;
      }
    }
  }
  return false;
}

// The heartbeat-race restore is only safe while the live path is still
// vacant. A pass that frees pipelines can be followed by a fresh O_EXCL
// claim of the same pipeline BEFORE the rename-back runs, and renaming back
// then would overwrite the new holder's file with this dead record — its
// next beat would see a foreign record and take the whole-set lost path
// (C05 review Minor-1: same defect class as C04 MAJOR-1, fs-syscall-wide
// instead of minutes-wide). Prove the destination absent first; on occupied
// or unreadable state leave the copy under .reaped for forensics and audit
// restored:false — a live claim is worth more than a resurrected dead one.
async function restoreRacedLock(env: any, fsx: any, path: string, reapedPath: string, copy: any, pass: any): Promise<void> {
  const pipeline = basename(path, ".json");
  let destination = "vacant";
  try {
    await fsx.stat(path);
    destination = "occupied";
  } catch (err: any) {
    if (err?.code !== "ENOENT") destination = "unreadable";
  }
  if (destination === "vacant") {
    try {
      await fsx.rename(reapedPath, path);
      await appendEvent(env, { ev: "reap_raced", pipeline, cardId: copy?.cardId ?? null, setId: copy?.setId ?? null, trigger: pass.trigger, restored: true });
      return;
    } catch (err: any) {
      logNote(env, `heartbeat-race restore failed for ${pipeline}: ${String(err?.code ?? err)}`);
      return;
    }
  }
  await appendEvent(env, { ev: "reap_raced", pipeline, cardId: copy?.cardId ?? null, setId: copy?.setId ?? null, trigger: pass.trigger, restored: false });
  logNote(env, `heartbeat-race restore skipped for ${pipeline}: the lock path is ${destination}`);
}

async function reapOneLock(env: any, fsx: any, name: string, pass: any): Promise<any | null> {
  // BOTH clock and disk must say dead: stale iff pass.now − max(heartbeatAt,
  // mtime) ≥ staleMs, so a hand-touched or freshly-beat mtime legitimately
  // rescues a file. Older-schema tolerance: unknown keys survive the
  // restore, a missing heartbeatAt falls to mtime, a parse-error record
  // reaps by mtime with cardId unknown.
  const path = join(env.locksDir, name);
  const pipeline = basename(name, ".json");
  const rec = await readLock(env, path); // parse error or unknown shape → null
  let mtimeMs = Number.NaN;
  try {
    mtimeMs = (await fsx.stat(path)).mtimeMs;
  } catch {
    return null; // vanished between readdir and stat
  }
  const hbMs = rec ? Date.parse(String(rec.heartbeatAt ?? "")) : Number.NaN;
  const lastMs = Math.max(Number.isFinite(hbMs) ? hbMs : Number.NEGATIVE_INFINITY, mtimeMs);
  if (pass.now - lastMs < pass.staleMs) return null;
  // The rename is the atomic claim: two reapers (or a racing release)
  // cannot both move one file.
  const reapedPath = join(pass.reapedDir, `${pipeline}.${pass.now}.json`);
  try {
    await fsx.mkdir(pass.reapedDir, { recursive: true });
    await fsx.rename(path, reapedPath);
  } catch (err: any) {
    logNote(env, `reap could not claim ${pipeline}: ${String(err?.code ?? err)}`);
    return null;
  }
  // Re-read the moved copy: a heartbeat that wrote between the stale check
  // and the rename shows up as a fresh heartbeatAt. That lock is alive —
  // put it back and run no card leg for it.
  const copy = await readLock(env, reapedPath);
  const copyHbMs = copy ? Date.parse(String(copy.heartbeatAt ?? "")) : Number.NaN;
  if (Number.isFinite(copyHbMs) && pass.now - copyHbMs < pass.staleMs) {
    await restoreRacedLock(env, fsx, path, reapedPath, copy, pass);
    return null;
  }
  const entry = {
    pipeline,
    setId: rec?.setId ?? null,
    cardId: rec?.cardId ?? null,
    sessionID: rec?.sessionID ?? null,
    pipelineSet: Array.isArray(rec?.pipelineSet) ? rec.pipelineSet : [],
    ageMin: Math.max(0, Math.round((pass.now - lastMs) / 60000)),
  };
  await appendEvent(env, {
    ev: "reaped",
    pipeline: entry.pipeline,
    setId: entry.setId,
    cardId: entry.cardId,
    sessionID: entry.sessionID,
    ageMin: entry.ageMin,
    trigger: pass.trigger,
  });
  return entry;
}

async function clearDeadHolders(env: any, reaped: any[]): Promise<void> {
  for (const r of reaped) {
    // Free this instance's view of the dead holder — but only the claim the
    // reaped file belongs to: after D20's resume path the same session can
    // already hold a FRESH claim whose caches must survive.
    const sid = r.sessionID == null ? "" : String(r.sessionID);
    const owned = sid ? env?.claims?.get(sid) : null;
    if (owned && (owned.setId == null || String(owned.setId) === String(r.setId))) {
      env.claims.delete(sid);
      try {
        if (env?.storage) {
          const row = await env.storage.get(claimKeyOf(sid), null);
          if (row && (row.setId == null || String(row.setId) === String(r.setId))) await env.storage.remove(claimKeyOf(sid));
        }
      } catch (err: any) {
        logNote(env, `reap storage cleanup failed for ${sid}: ${String(err?.code ?? err)}`);
      }
    }
    // A dead pipeline's throttle stamps must not make its next claimant's
    // first beats silent (lock-lost cleanup precedent).
    env?.lastBeat?.delete(r.pipeline);
    env?.beatSeq?.delete(r.pipeline);
  }
}

async function writeReapMeta(env: any, fsx: any, now: number, trigger: string, reaped: any[]): Promise<void> {
  try {
    await fsx.mkdir(dirname(env.metaPath), { recursive: true });
    await fsx.writeFile(env.metaPath, JSON.stringify({ at: new Date(now).toISOString(), trigger, reaped: reaped.map((r) => r.pipeline) }));
  } catch (err: any) {
    logNote(env, `lastReap meta write failed: ${String(err?.code ?? err)}`);
  }
}

async function runReapCardLegs(env: any, reaped: any[]): Promise<void> {
  // Per-CARD legs (D18): two reaped members of one claim are ONE timeout
  // event. The named set is the union of the group's reaped pipelines with
  // every reaped record's pipelineSet, so a partially-reaped set still reads
  // complete on the card and on the phone.
  const byCard = new Map<string, any>();
  for (const r of reaped) {
    const key = String(r.cardId ?? "");
    let group: any = byCard.get(key);
    if (!group) {
      group = { cardId: r.cardId ?? null, setId: r.setId ?? null, sessionID: r.sessionID ?? null, names: new Set<string>(), ageMin: 0 };
      byCard.set(key, group);
    }
    group.names.add(r.pipeline);
    for (const p of r.pipelineSet) group.names.add(p);
    group.ageMin = Math.max(group.ageMin, Number(r.ageMin) || 0);
  }
  const moveLeg = typeof env?.moveCardToTimeout === "function" ? env.moveCardToTimeout : (info: any) => moveCardToTimeout(env, info);
  const alertLeg = typeof env?.notify === "function" ? env.notify : (info: any) => sendHaReapAlert(env, info);
  for (const group of byCard.values()) {
    const info = {
      cardId: group.cardId,
      setId: group.setId,
      sessionID: group.sessionID,
      ageMin: group.ageMin,
      pipelines: [...group.names].sort(),
    };
    // The real seam never rejects (its own degrade arm); the belt stays
    // because env.moveCardToTimeout may be a caller-injected fake.
    try {
      await moveLeg(info);
    } catch (err: any) {
      logNote(env, `board leg failed for card ${String(group.cardId ?? "?")}: ${String(err?.message ?? err)}`);
    }
    // Alert AFTER the file move and after the board leg: a dead board
    // still rings, a dead HA never disturbs the reap (D11).
    if (env?.config?.haNotify !== false) {
      try {
        await alertLeg(info);
      } catch (err: any) {
        logNote(env, `HA alert failed: ${String(err?.message ?? err)}`);
      }
    }
  }
}

export async function reapStale(env: any, input: any = {}): Promise<{ reaped: any[]; skipped?: boolean }> {
  // One guarded pass in four phases: collect confirmed reaps per file, free
  // the dead holders' caches, stamp meta/lastReap, then run the per-card
  // board and alert legs. The guard releases in all outcomes.
  const trigger = String(input?.trigger ?? "timer");
  const fsx = storeFs(env);
  if (!(await acquireReaperGuard(env, fsx))) return { reaped: [], skipped: true };
  try {
    const pass = {
      now: env?.now?.() ?? Date.now(),
      staleMs: Number(env?.config?.staleMs) || DEFAULT_STALE_MS,
      trigger,
      reapedDir: join(env.locksDir, REAPED_SUBDIR),
    };
    const reaped: any[] = [];
    let names: string[] = [];
    try {
      names = (await fsx.readdir(env.locksDir)).filter((name: string) => name.endsWith(".json")).sort();
    } catch {
      // no locks dir: nothing is held, nothing to reap
    }
    for (const name of names) {
      const entry = await reapOneLock(env, fsx, name, pass);
      if (entry) reaped.push(entry);
    }
    if (reaped.length > 0) {
      await clearDeadHolders(env, reaped);
      await writeReapMeta(env, fsx, pass.now, trigger, reaped);
      await runReapCardLegs(env, reaped);
    }
    return { reaped };
  } finally {
    try {
      await fsx.rm(join(env.runtimeDir, REAPER_GUARD_DIR), { recursive: true, force: true });
    } catch (err: any) {
      // A surviving guard blocks reaps only until GUARD_STALE_MS lets the
      // next pass steal it; a loud note is all this failure can still do.
      logNote(env, `reaper guard release failed: ${String(err?.code ?? err)}`);
    }
  }
}

// The row half of the D22 interim contract (the comment half rides
// reapCommentBody): until the follow-up card lands a create_list tool in
// wekan-mcp, a board may not HAVE a Timeout list at all, and any other leg
// can fail the same way. Every failure arm appends the full card row to
// timeouts.jsonl and audits the reason — the row is the triage mechanism
// and the best-effort comment supplements it, never replaces it; the
// reaped pipelines are already free, so a lost board move never means a
// held pipeline.
async function queueTimeoutRow(env: any, info: any, reason: string): Promise<void> {
  const row = {
    at: new Date(env?.now?.() ?? Date.now()).toISOString(),
    cardId: info?.cardId ?? null,
    setId: info?.setId ?? null,
    pipelines: Array.isArray(info?.pipelines) ? info.pipelines : [],
    sessionID: info?.sessionID ?? null,
    reason,
  };
  try {
    await storeFs(env).writeFile(String(env?.timeoutsPath), JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  } catch (err: any) {
    logNote(env, `timeouts.jsonl append failed: ${String(err?.code ?? err)}`);
  }
  await appendEvent(env, { ev: "board_move_err", cardId: row.cardId, setId: row.setId, sessionID: row.sessionID, reason });
}

// One builder for every path that owes the card the reap marker — the
// move-success leg and the degrade legs alike — so the D21 sentence, the
// holder, and the full named set cannot drift between arms. The named set
// arrives already unioned upstream (a legacy record without pipelineSet
// reads as just its own pipeline).
function reapCommentBody(info: any): string {
  const pipelines = Array.isArray(info?.pipelines) ? info.pipelines : [];
  return `${TIMEOUT_COMMENT} (session ${String(info?.sessionID ?? "")}, pipelines: ${pipelines.join(", ")})`.slice(0, MAX_OUTBOUND_MESSAGE);
}

export async function moveCardToTimeout(env: any, info: any): Promise<void> {
  // D24 pins the sequence: get_card → list_lists → move_card → add_comment.
  // The Timeout target resolves against the card's OWN swimlane echo because
  // list titles repeat across swimlanes — a namesake in another swimlane
  // must never be the move target. With no target the move is skipped but
  // the comment still lands: D22's interim is jsonl row + CARD COMMENT, and
  // the list-absent arm is precisely where the board is up and the on-card
  // marker is most needed (F1). The comment is best-effort and attempted
  // once per leg — its failure falls to the same catch as any other, so the
  // row and audit still land and a rejecting endpoint cannot cause a retry
  // storm.
  try {
    const callTool =
      typeof env?.client?.callTool === "function"
        ? (name: string, args: any) => env.client.callTool(name, args)
        : typeof env?.client?.api?.callTool === "function"
          ? (name: string, args: any) => env.client.api.callTool(name, args)
          : null;
    if (!callTool) throw new Error(`no ${BOARD_SERVER_KEY} client (URL undiscovered)`);
    if (!info?.cardId) throw new Error("reaped record carries no cardId");
    const card = await callTool("get_card", { board_id: env?.boardId ?? null, card_id: String(info.cardId) });
    const fromList = String(card?.list_id ?? "");
    const swimlane = String(card?.swimlane_id ?? "");
    if (!fromList) throw new Error("get_card answered no list_id");
    const lists = asArray(await callTool("list_lists", { board_id: env?.boardId ?? null }));
    const wanted = String(env?.config?.board?.timeoutListTitle ?? BOARD_DEFAULTS.timeoutListTitle);
    const target = lists.find((l: any) => String(l?.title ?? "") === wanted && String(l?.swimlane_id ?? "") === swimlane);
    if (target) {
      await callTool("move_card", {
        board_id: env?.boardId ?? null,
        card_id: String(info.cardId),
        from_list_id: fromList,
        to_list_id: target.id,
      });
    }
    await callTool("add_comment", { board_id: env?.boardId ?? null, card_id: String(info.cardId), comment: reapCommentBody(info) });
    if (!target) {
      // queueTimeoutRow is total (its own arms catch), so this leg cannot
      // throw past it into the catch and double-book the row.
      await queueTimeoutRow(env, info, `no ${wanted} list in the card's swimlane`);
    }
  } catch (err: any) {
    await queueTimeoutRow(env, info, String(err?.message ?? err?.code ?? err));
  }
}

export async function sendHaReapAlert(env: any, info: any): Promise<void> {
  // D11: fire-and-forget. Whatever an alert costs lands in env.log; the
  // call resolving is not a precondition of any reap outcome.
  try {
    if (typeof env?.callHA !== "function") return;
    const pipelines = Array.isArray(info?.pipelines) ? info.pipelines : [];
    const message = `card=${String(info?.cardId ?? "")} pipelines=${pipelines.join(",")} age=${Number(info?.ageMin) || 0}min session=${String(info?.sessionID ?? "")}`.slice(0, MAX_OUTBOUND_MESSAGE);
    await env.callHA("call_service", {
      domain: NOTIFY_DOMAIN,
      service: HA_NOTIFY_SERVICE,
      data: { title: REAP_ALERT_TITLE, message },
    });
  } catch (err: any) {
    logNote(env, `HA reap alert failed: ${String(err?.message ?? err)}`);
  }
}

// The tool response IS the lock-identity channel (D28). `content` is the
// field the 2.1.4 host renders for the agent — the probe's { content: ... }
// return is the proven shape, and a raw-object return surfaced through Code
// Mode answers "undefined" (live-observed 2026-10-29) — so the full result
// rides the content JSON; the same fields are spread first-class for direct
// (offline-suite) readers. Executor failures answer structured too: a throw
// would surface as an opaque host error instead of lock state.
async function respond(fn: () => Promise<any>): Promise<any> {
  let result: any;
  try {
    result = await fn();
  } catch (err: any) {
    result = { ok: false, reason: "error", error: String(err?.code ?? err?.message ?? err) };
  }
  return { ...result, content: JSON.stringify(result) };
}

async function toolClaim(env: any, args: any, context: any): Promise<any> {
  const cardId = typeof args?.cardId === "string" && args.cardId ? args.cardId : null;
  if (!cardId) return { ok: false, reason: "invalid_input", error: "cardId is required" };
  const root = await resolveRoot(env, context?.sessionID);
  return await claimLockSet(env, { cardId, pipelines: args?.pipelines, cardTitle: args?.cardTitle, sessionID: root });
}

async function toolRelease(env: any, args: any, context: any): Promise<any> {
  const outcome = args?.outcome === "done" || args?.outcome === "abandoned" ? args.outcome : null;
  if (!outcome) return { ok: false, reason: "invalid_input", error: "outcome must be done or abandoned" };
  const root = await resolveRoot(env, context?.sessionID);
  return await releaseLockSet(env, { sessionID: root, outcome });
}

async function toolHeartbeat(env: any, _args: any, context: any): Promise<any> {
  // C04: the manual beat rides the engine path, so a half-lost set reacts
  // set-wide (D18) instead of keeping survivors alive file by file.
  const root = await resolveRoot(env, context?.sessionID);
  const entry = await findClaim(env, root);
  if (!entry) return { ok: false, reason: "no_claim", sessionID: root };
  const set: string[] = Array.isArray(entry.pipelineSet) ? entry.pipelineSet : [];
  await heartbeatSet(env, root, "manual", true);
  const still = await findClaim(env, root);
  if (!still) {
    // The engine just ran the lock-lost reaction. The response IS the stop
    // signal on v2.1.4 (D28) — the worker-facing text is the guard's own.
    return { ok: false, reason: "lock_lost", note: LOCK_LOST_STOP, setId: entry.setId, cardId: entry.cardId, beaten: [], missing: set };
  }
  return { ok: true, setId: entry.setId, cardId: entry.cardId, beaten: set };
}

async function toolStatus(env: any, _args: any, context: any): Promise<any> {
  return await lockStatus(env, { sessionID: await resolveRoot(env, context?.sessionID) });
}

function buildToolSpecs(env: any): any[] {
  const definitions = [
    {
      callAs: "tools.pipeline_claim",
      blurb: "Acquire the lease-lock set for a board card, all-or-nothing over every pipeline the card's labels name: every pipeline is taken or none is (a contended claim rolls back and names the holder). cardId required; pipelines is the derived Pipeline:-label set (omit it or pass an empty list for the default pipeline).",
      schema: {
        type: "object",
        properties: {
          cardId: { type: "string", description: "WeKan card id the claim is held for" },
          pipelines: { type: "array", items: { type: "string" }, description: "Pipeline names derived from the card's Pipeline: labels (D17); empty or omitted means the single default pipeline" },
          cardTitle: { type: "string", description: "Card title, recorded in the lock for status and alert text" },
        },
        required: ["cardId"],
        additionalProperties: false,
      },
      execute: (args: any, context: any) => respond(() => toolClaim(env, args, context)),
    },
    {
      callAs: "tools.pipeline_release",
      blurb: "Release the whole lock set held by this session's root. outcome is done (card handed to Review) or abandoned; a member owned by another session refuses the release and touches nothing.",
      schema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["done", "abandoned"], description: "done when the card reached Review (D6), abandoned when the run gives up on it" },
        },
        required: ["outcome"],
        additionalProperties: false,
      },
      execute: (args: any, context: any) => respond(() => toolRelease(env, args, context)),
    },
    {
      callAs: "tools.pipeline_heartbeat",
      blurb: "Force-beat every lock file of this session's root claim (rewrites heartbeatAt and touches mtime). Takes no arguments.",
      schema: { type: "object", properties: {}, additionalProperties: false },
      execute: (args: any, context: any) => respond(() => toolHeartbeat(env, args, context)),
    },
    {
      callAs: "tools.pipeline_status",
      blurb: "Read the lock state: every held set grouped per claim with age, holder and pipeline set, plus this session's own claim. Takes no arguments; the answer is the primary lock-identity channel (D28).",
      schema: { type: "object", properties: {}, additionalProperties: false },
      execute: (args: any, context: any) => respond(() => toolStatus(env, args, context)),
    },
  ];

  // Visible name rides flat (name = the full pipeline_* id, no namespace
  // option): adding options.namespace on top of an already-prefixed name
  // joins a second prefix on the real registry (probe: the effective name is
  // namespace_name), and the cf-76 core contract pins the full visible name
  // on the spec — the flat shape lands the exact ids DECISIONS D29 requires,
  // live-restamped 2026-10-29 when this plugin loaded into a v2.1.4 session
  // and Code Mode listed the tools under exactly these names.
  return TOOL_NAMES.map((name, i) => ({
    name,
    description: `${definitions[i].blurb} On OpenCode v2.1.4 plugin tools are reachable ONLY through Code Mode: call ${definitions[i].callAs} from the execute tool (probe fact, D29) — never as a native provider tool.`,
    inputSchema: definitions[i].schema,
    // The docs' add() example names the schema field `input` while the C03
    // seam contract pins `inputSchema`; both keys point at one object, so
    // the registry read and the pinned contract cannot drift apart.
    input: definitions[i].schema,
    execute: definitions[i].execute,
  }));
}

// Commands ride C01 fact 4's proven shape: ctx.command.transform +
// editor.add({name, description, execute({sessionID, prompt, delivery})}),
// answering through ctx.session.prompt on the invocation's own envelope —
// the synthetic message is a command's only answer channel on v2.1.4.
function buildCommandSpecs(env: any, ctx: any): any[] {
  const say = async (input: any, text: string): Promise<void> => {
    try {
      // The probe's live envelope carries prompt as an object ({text, files,
      // …}); a bare string (offline suites) must not spread into numeric
      // junk keys on the real prompt call.
      const base = input?.prompt && typeof input.prompt === "object" ? input.prompt : {};
      await ctx?.session?.prompt?.({ ...base, sessionID: input?.sessionID, text, delivery: input?.delivery });
    } catch (err: any) {
      logNote(env, `command reply could not be posted: ${String(err?.message ?? err)}`);
    }
  };
  return [
    {
      name: "pipeline-reap",
      description:
        "Run one stale-lock reap pass now: guarded scan of .pipeline/locks, stale files to .reaped/, their cards through the Timeout board leg (or the timeouts.jsonl degrade), one HA alert per reaped card. Answers the pass summary. Takes no arguments.",
      execute: async (input: any) => {
        let text: string;
        try {
          const res = await reapStale(env, { trigger: "command" });
          if (res?.skipped) text = "pipeline-locks reap: skipped — another reaper holds the guard.";
          else if (!Array.isArray(res?.reaped) || res.reaped.length === 0) text = "pipeline-locks reap: no stale locks.";
          else
            text = `pipeline-locks reap: reaped ${res.reaped.length} lock(s): ${res.reaped
              .map((r: any) => `${r.pipeline} (card=${String(r.cardId ?? "?")} holder=${String(r.sessionID ?? "?")} idle=${r.ageMin}min)`)
              .join("; ")}`;
        } catch (err: any) {
          text = `pipeline-locks reap failed: ${String(err?.message ?? err)}`;
        }
        await say(input, text);
        return text;
      },
    },
    {
      name: "pipeline-status",
      description:
        "Answer the lock state: every held claim grouped by setId with card, holder, state, heartbeat age and pipeline names, plus the last reap. Takes no arguments.",
      execute: async (input: any) => {
        let text: string;
        try {
          const st = await lockStatus(env, { sessionID: input?.sessionID });
          const groups: any[] = Array.isArray(st?.groups) ? st.groups : [];
          const lines = groups.map(
            (g: any) =>
              `claim ${String(g.setId ?? "?")} card=${String(g.cardId ?? "?")} holder=${String(g.holder ?? "?")} state=${String(
                g.state ?? "live",
              )} age=${Math.max(0, Math.round((Number(g.ageMs) || 0) / 60000))}min pipelines: ${[...(g.pipelines ?? [])].sort().join(", ")}`,
          );
          const last = st?.lastReap;
          const lastLine =
            last && typeof last.at === "string"
              ? `lastReap: ${last.at} reaped ${(Array.isArray(last.reaped) ? last.reaped : []).join(",")}`
              : "lastReap: none";
          text = [`pipeline-locks status: ${groups.length} claim(s) held`, ...lines, lastLine].join("\n");
        } catch (err: any) {
          text = `pipeline-locks status failed: ${String(err?.message ?? err)}`;
        }
        await say(input, text);
        return text;
      },
    },
    {
      name: "pipeline-tick",
      description:
        "Run one pipeline worker tick: reap stale locks first, then prompt this session with the worker text (boards skill, exactly one iteration). Takes no arguments.",
      execute: async (input: any) => {
        // Reap-before-prompt (C06 AC 2) as plain code: the sweep lands
        // whoever dispatches this command, and the shipped D30 loop body
        // never names it — determinism without dispatch rides on the
        // claim-time and timer reaps the same guarded pass serves.
        let reapSummary: string;
        try {
          const res = await reapStale(env, { trigger: "tick" });
          reapSummary = res?.skipped ? "reap skipped (guard held elsewhere)" : `reaped ${Array.isArray(res?.reaped) ? res.reaped.length : 0} stale lock(s)`;
        } catch (err: any) {
          // A broken reap must still hand the session its work prompt —
          // claim-time reaping covers one missed sweep.
          reapSummary = `reap failed: ${String(err?.message ?? err)}`;
        }
        await appendEvent(env, { ev: "tick", sessionID: String(input?.sessionID ?? ""), reap: reapSummary });
        await say(input, TICK_PROMPT);
        return `pipeline-locks tick: ${reapSummary}`;
      },
    },
  ];
}

export async function resolveRoot(env: any, sessionID: any): Promise<string> {
  // The deferred parent-walk (C04): a session is its root's claimant. The
  // walk reads sessions ONLY through env.sessionGet and only inside async
  // dispatch — callers in the event loop must never await it inline
  // (handoff #55318). Results cache forward (sessToRoot, durable for the
  // process) and negative (a 60 s window: an unresolvable or claimless-top
  // session is re-checked after it, so a session that gains a parent or a
  // claim is picked up without a restart).
  const id = String(sessionID ?? "");
  if (!id) return "unknown";
  const mapped = env?.sessToRoot?.get(id);
  if (typeof mapped === "string" && mapped) return mapped;
  const now = env?.now?.() ?? Date.now();
  const negUntil = env?.negative?.get(id);
  if (typeof negUntil === "number" && now < negUntil) return id;
  const markNegative = (): void => {
    env?.negative?.set(id, now + NEGATIVE_CACHE_MS);
  };

  try {
    const chain = new Set<string>([id]);
    const visited: string[] = [];
    let cur = id;
    for (let hop = 0; hop < RESOLVE_MAX_HOPS; hop++) {
      const entry = await findClaim(env, cur);
      if (entry) {
        const root = String(entry?.sessionID ?? cur);
        for (const pid of visited) if (pid !== root) env?.sessToRoot?.set(pid, root);
        return root;
      }
      const info = await env?.sessionGet?.(cur);
      const parent = String(info?.parentID ?? info?.info?.parentID ?? "");
      if (!parent) {
        // A claimless top session is its own root; the negative window is
        // safe because every caller findClaim()s the returned id itself,
        // and claims are keyed by exactly that id.
        markNegative();
        return cur;
      }
      if (chain.has(parent)) break; // cyclic topology: unknown, retry later
      chain.add(parent);
      visited.push(cur);
      cur = parent;
    }
  } catch (err: any) {
    logNote(env, `parent walk failed for ${id}: ${String(err?.message ?? err)}`);
  }
  markNegative();
  return id;
}

function bindStorage(ctx: any): any {
  // ctx.storage probes confirmed on 2.1.4: positional set(key, value),
  // get(key) answering undefined for absent keys, scan({prefix}) answering
  // {entries: [{key, value}]} (C01 evidence, fact 5). Adapter normalizes to
  // the (key, default) seam shape the store uses; adapter failure degrades
  // to the cache + disk-locks truth, never to a lost claim.
  const store = ctx?.storage;
  if (typeof store?.set !== "function" || typeof store?.get !== "function" || typeof store?.remove !== "function") return null;
  const scan =
    typeof store.scan === "function"
      ? async (prefix: string) => {
          try {
            const res = await store.scan({ prefix });
            return Array.isArray(res?.entries) ? res.entries : [];
          } catch {
            return [];
          }
        }
      : null;
  return {
    get: async (key: string, def: any) => {
      try {
        const value = await store.get(key);
        return value ?? def;
      } catch {
        return def;
      }
    },
    set: async (key: string, value: any) => store.set(key, value),
    remove: async (key: string) => store.remove(key),
    scan,
  };
}

function bindPin(ctx: any): any {
  // D28 capability gate: the instructions entry API is in the current docs
  // but absent from the pinned v2.1.4 runtime — null here means the pin arms
  // no-op silently and the tool responses carry the identity instead.
  const entry = ctx?.session?.instructions?.entry;
  if (typeof entry?.put !== "function" || typeof entry?.remove !== "function") return null;
  return {
    put: async (sessionID: string, key: string, value: string) => entry.put({ sessionID, key, value }),
    remove: async (sessionID: string, key: string) => entry.remove({ sessionID, key }),
  };
}

export default {
  id: "local.pipeline-locks",
  async setup(ctx: any): Promise<() => void> {
    // Aborting this signal is the cancellation channel for any background
    // work this location instance runs; the host calls the returned cleanup
    // unconditionally, so it is returned even on the degrade path (AC9).
    const shutdown = new AbortController();
    let engine: any = null;
    const log = (line: string) => console.error(`[pipeline-locks] ${line}`);
    try {
      // D31: the whole body sits inside try/catch — a sync throw in setup
      // wedged an ephemeral location load in the C01 probe, and a plugin
      // load failure would poison the server's plugin group.
      const startDir = typeof ctx?.location?.directory === "string" ? ctx.location.directory : process.cwd();
      const root = await resolveLockRoot(
        {
          canonical: typeof ctx?.location?.project?.canonical === "string" ? ctx.location.project.canonical : null,
          readFile: async (path: string) => fsp.readFile(path, "utf8"),
        },
        startDir,
      );
      const env = {
        runtimeDir: join(root, RUNTIME_DIR),
        locksDir: join(root, RUNTIME_DIR, LOCKS_DIR),
        eventsPath: join(root, RUNTIME_DIR, EVENTS_FILE),
        timeoutsPath: join(root, RUNTIME_DIR, "timeouts.jsonl"),
        metaPath: join(root, RUNTIME_DIR, "meta", "lastReap"),
        now: () => Date.now(),
        claims: new Map<string, any>(),
        // Engine state (C04) — the same map/set shapes the suites inject.
        sessToRoot: new Map<string, string>(),
        executing: new Set<string>(),
        lastBeat: new Map<string, number>(),
        negative: new Map<string, number>(),
        storage: bindStorage(ctx),
        pin: bindPin(ctx),
        // Resolved once at first board use, outside the D24-pinned per-card
        // call sequence (see openBoardClient).
        boardId: null,
        sessionGet: async (sessionID: string) =>
          typeof ctx?.session?.get === "function" ? ((await ctx.session.get({ sessionID })) ?? undefined) : undefined,
        // The claim-time and reap-timer legs run the real guarded reaper —
        // C05 replaced C03's no-op stub without changing either call site.
        reapStale: async (o: any) => await reapStale(env, { trigger: String(o?.trigger ?? "timer") }),
        signal: shutdown.signal,
      };

      // D8: the only options channel — .pipeline/config.json read here, at
      // setup, through the loadConfig seam (no module-scope fs read; the tick
      // suite pins setup-through-the-seam with a staleMs that is impossible
      // as a default). The loader never rejects, so a malformed or unreadable
      // file lands on the baked defaults plus a stderr line.
      env.config = await loadConfig({ readFile: (path: string) => fsp.readFile(path, "utf8"), log }, env.runtimeDir);

      // The reap's MCP legs bind lazily: URL discovery runs at the first
      // board/alert call, so an offline setup degrades inside the seams' own
      // arms (the D22 interim contract) instead of touching the network at
      // load. A success caches the transport; a miss retries on the next
      // pass — the fleet config can gain an entry after plugin load without
      // a restart, which is why question-notify re-resolves per push.
      let boardCallTool: ((name: string, args: any) => Promise<any>) | null = null;
      const openBoardClient = async (): Promise<any> => {
        if (boardCallTool) return boardCallTool;
        const url = await discoverMcpUrl(ctx, BOARD_SERVER_KEY, { projectConfig: true });
        if (!url) return null;
        const callTool = makeCallTool(url);
        try {
          const boards = asArray(await callTool("list_boards", {}));
          const board = boards.find((b: any) => b?.title === env.config.board.boardTitle);
          if (board) env.boardId = String(board.id);
        } catch (err: any) {
          log(`board id unresolved, card legs will degrade: ${String(err?.message ?? err)}`);
        }
        boardCallTool = callTool;
        return callTool;
      };
      env.client = {
        callTool: async (name: string, args: any) => {
          const callTool = await openBoardClient().catch((err: any) => {
            log(`dev-boards discovery failed: ${String(err?.message ?? err)}`);
            return null;
          });
          if (!callTool) throw new Error(`no ${BOARD_SERVER_KEY} client (URL undiscovered)`);
          return callTool(name, args);
        },
      };
      // question-notify's call_service mechanics against the ADMIN tier (the
      // readonly ha-mcp rejects service calls); the project-config discovery
      // leg stays excluded — a machine-global entry is invisible to it.
      env.callHA = async (toolName: string, args: any) => {
        const url = await discoverMcpUrl(ctx, HA_SERVER_KEY);
        if (!url) throw new Error(`no ${HA_SERVER_KEY} URL discovered`);
        return makeCallTool(url)(toolName, args);
      };

      if (typeof ctx?.tool?.transform === "function") {
        await ctx.tool.transform((editor: any) => {
          for (const spec of buildToolSpecs(env)) editor.add(spec);
        });
      } else {
        log("degraded: no ctx.tool.transform — lock tools not registered, store seams still load");
      }

      if (typeof ctx?.command?.transform === "function") {
        // C01 fact 4's proven chain: transform + editor.add is how a plugin
        // command joins the location registry — tick, reap and status all
        // ride it.
        try {
          await ctx.command.transform((editor: any) => {
            for (const spec of buildCommandSpecs(env, ctx)) editor.add(spec);
          });
        } catch (err: any) {
          log(`command registration failed: ${String(err?.message ?? err)}`);
        }
      } else {
        log("degraded: no ctx.command.transform — reap/status commands not registered");
      }

      try {
        // Restart-resume rebuild (D26: the durable store is shared across
        // this repo's locations): claims and child mappings repopulate the
        // in-process caches here. The disk locks stay the truth — this is
        // only the view the engine drives, so a scan miss loses nothing.
        if (typeof env.storage?.scan === "function") {
          const claimRows = await env.storage.scan(CLAIM_KEY_PREFIX);
          for (const item of claimRows) {
            const value = item?.value;
            if (value && typeof value.sessionID === "string" && value.sessionID && Array.isArray(value.pipelineSet)) {
              env.claims.set(value.sessionID, {
                setId: value.setId,
                cardId: value.cardId,
                pipelineSet: value.pipelineSet,
                sessionID: value.sessionID,
              });
            }
          }
          const childRows = await env.storage.scan(CHILD_KEY_PREFIX);
          for (const item of childRows) {
            const value = item?.value;
            if (value && typeof value.sessionID === "string" && typeof value.rootID === "string") {
              env.sessToRoot.set(value.sessionID, value.rootID);
            }
          }
        }
      } catch (err: any) {
        log(`storage rebuild failed (disk locks stay the truth): ${String(err?.message ?? err)}`);
      }

      if (typeof ctx?.tool?.hook === "function") {
        await ctx.tool.hook("execute.before", async (event: any) => {
          try {
            await toolBefore(env, event);
          } catch (err: any) {
            // Only the strict guard's stop error may reach the host — a
            // throw here blocks the tool call (C01 fact 2), which is the
            // point. An internal failure must never block normal work.
            if (err instanceof Error && err.message === LOCK_LOST_STOP) throw err;
            log(`execute.before failed: ${String(err?.message ?? err)}`);
          }
        });
        await ctx.tool.hook("execute.after", async (event: any) => {
          try {
            await toolAfter(env, event);
          } catch (err: any) {
            log(`execute.after failed: ${String(err?.message ?? err)}`);
          }
        });
      } else {
        log("degraded: no ctx.tool.hook — activity beats fall back to the pipeline_heartbeat tool and timer path");
      }

      // No `types` filter on subscribe: the option needs @opencode/plugin
      // >= 2.2.0 and on 2.1.4 it would silently drop everything (DECISIONS
      // convention, question-notify precedent) — the filtering happens in
      // handleEvent instead.
      let stream: any;
      try {
        stream = typeof ctx?.event?.subscribe === "function" ? ctx.event.subscribe({ signal: shutdown.signal }) : undefined;
      } catch (err: any) {
        log(`event subscription failed: ${String(err?.message ?? err)}`);
      }
      if (stream) {
        // The loop must not be awaited inside setup (a subscription lives
        // for the server's whole lifetime) and must not await anything
        // session-shaped inline: one slow or never-returning lookup would
        // stall the entire event pump (handoff #55318). Every event is
        // dispatched deferred; the loop only consumes.
        let envelopeProbed = false;
        void (async () => {
          try {
            for await (const event of stream) {
              if (shutdown.signal.aborted) break;
              if (!envelopeProbed) {
                envelopeProbed = true;
                log(`first event keys=${Object.keys(event ?? {}).join(",")} data=${Object.keys(event?.data ?? {}).join(",")}`);
              }
              setTimeout(() => {
                void handleEvent(env, event).catch((err: any) => log(`event dispatch failed: ${String(err?.message ?? err)}`));
              }, 0);
            }
          } catch (err: any) {
            log(`event stream ended: ${String(err?.message ?? err)}`);
          }
        })();
      } else {
        log("degraded: no ctx.event subscription — child mapping and lifecycle follow the tool hooks only");
      }

      engine = startEngine(env);
    } catch (err: any) {
      log(`setup degraded: ${String(err?.message ?? err)}`);
    }
    return () => {
      // Abort first (the subscription's cancellation contract), then disarm
      // both timers: a surviving interval would beat or reap past this
      // location's unload.
      shutdown.abort();
      try {
        engine?.stop?.();
      } catch (err: any) {
        log(`engine stop failed: ${String(err?.message ?? err)}`);
      }
    };
  },
};
