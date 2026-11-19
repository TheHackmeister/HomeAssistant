// OpenCode V2 location plugin: ahead of the FIRST prompt of an agent-board-coord
// session, fetches the AI-Dev Board context block from dev-boards and appends it
// to the prompt text, so a scheduled or command-launched board-coord run starts
// with board/swimlane/list/custom-field/label ids resolved instead of burning
// its first MCP round-trips. Hand-written — rulesync must never generate or
// delete this file (precedents: .opencode/plugin/question-notify/, aislop-gate/).
//
// Why raw MCP JSON-RPC: plugins run in the OpenCode server process, outside any
// agent session — the session's MCP tools exist for models, not for plugins.
// The JSON-RPC-over-streamable-HTTP recipe lives in
// skills/wekan-api/references/wekan-mcp-ops.md (OIDC is disabled on the
// wekan-mcp deployments: no token here). dev-boards authenticates server-side
// (login-mint, wekan-mcp skill), so this plugin handles no credentials and
// hardcodes no ingress host — the URL is discovered at runtime from
// ctx.mcp.list(), falling back to parsing .opencode/opencode.jsonc.
//
// Never-throw is a correctness requirement, not a style rule: a prompt hook
// that throws or hangs blocks admission outright (OpenCode V2 docs: "If
// preparation fails or is interrupted, OpenCode does not admit the prompt") —
// the scheduled run would die at dispatch. Every arm degrades silently to an
// unmodified prompt plus one stderr line, and the whole board fetch races a
// FETCH_TIMEOUT_MS budget so a hanging leg cannot stall admission
// indefinitely.
//
// Once-per-session: the command path mints a fresh messageID per attempt, so
// server-side id-dedup never protects the prompt hook (RESEARCH.md Implication
// 1) — the guard keys the sessionID. A failed or hanging attempt still consumes
// the slot: re-firing the fetch on every later prompt of the run would pay the
// latency budget repeatedly for a block the run can resolve itself (absence is
// normal per the boards consumer rule). The canonical-header scan is the second
// belt: a prompt already carrying a pasted block (the /wekan-board-context
// collector path) is never double-injected, and the scan sees the fully
// expanded command text.
//
// The block format has one normative home — the "Board context block schema"
// section of skills/wekan-mcp/SKILL.md. formatBlock below mirrors its bytes;
// tests/wekan-mcp/skill-surface.sh t3 keeps the schema owned by that markdown
// file alone (code mirrors are not doc copies).
//
// Shipping state: merged on main as cf-75 C04 (7bbca8195) behind the AC6
// degraded outcome (user ruling 2026-10-27 OQ5). The cf-75 worktree legs ran
// 2026-10-28: URL discovery via the project-config arm + the real
// initialize/tools/call handshake + the five resolution calls + formatBlock
// against live dev-boards returned the plan's verified-fact ids (read-only) —
// the resolution path is proven, the ON arm through a real admission was not
// yet. Enablement is this file's ticket 2026/2026-10-chore-board-tick-cleanup
// (C03): the user ruling 2026-10-29 (OQ7) re-statused the live-fire legs from
// user-owned (main checkout) to AGENT-OWNED, executed in-worktree — a
// worktree-rooted instance loads this checkout's location plugins, so the
// branch's own code is what the legs prove. scripts/board-preload-probe.sh
// runs the legs (C03 runbook LF1..LF7); the proof citation sits beside
// DEFAULT_ENABLED and the flip is nothing else. "No half-proven hook ships
// on" still holds — only the citation's author changed.

const MCP_SERVER_KEY = "dev-boards";
const BOARD_TITLE = "AI-Dev";
const SWIMLANE_TITLE = "In Process";
// The schema's canonical header prefix — the idempotence scan and the
// fetched-block sanity check share it.
const CANONICAL_HEADER = "Board context (collected";
// The admission-latency budget: a hanging leg must never hold the first
// prompt's admission open-endedly (RESEARCH.md Implication 2).
export const FETCH_TIMEOUT_MS = 8_000;
// See the shipping-state header block.
// live-fire 2026-10-29T21:17Z-22:03Z (worktree probes, C03 T4):
// LF1 p ses_bpplf1202610292117081098922 — the block read back in the
//   first prompt, zero structural dev-boards reads;
// LF2 p ses_bpplf2202610292117161098922 — the plain-text loop door
//   fires the hook too, OQ-a closed live (no /pipeline-tick swap owed);
// LF4 p x3 + 1 fail recorded — ses_e76799437ffeu7jSBjRwXU2z6Q,
//   ses_e765394b2ffe7ao3oKjw0MXfQK and ses_e765029a3ffeiZBUjzM3XSD4sG
//   wrote the marker live with the probeSentinel sibling intact;
//   ses_e767600b8ffe0dz1BfG8kA1fAu wrapped its api call in `cd … &&`,
//   the whole-string shell allow denied it, the run ended unmarked
//   (alert stands — the safe direction) and the leg prompt since pins
//   the bare command shape;
// LF5 p — the 220244Z record: succeeded + manual shape + well-formed
//   marker ⇒ the conjunction keeps alerting, and the user confirmed the
//   finished-push receipt ~22:03Z (one per run, not a double-fire);
// LF6 degraded per the approved OQ-N2 ceiling — kind:"scheduled" is
//   OpenChamber-stamped and the shared server runs main-checkout
//   plugins until merge, so C02's both-direction unit matrix is the
//   pin and the first post-merge hourly fire the optional belt;
// LF7 p — no FETCH_TIMEOUT_MS (8000 ms) breach or degrade line in the
//   211708Z instance logs.
// Evidence: /tmp/opencode/board-preload-probe/ run dirs 211702Z,
// 211708Z, 211730Z, 212124Z, 215900Z, 220244Z (context/record/log
// readbacks) + the chunk Review-notes ledger. OQ-e caveat: OIDC
// re-enablement breaks this credential-free MCP leg for plugin and
// session alike — the restamp duty rides this note.
export const DEFAULT_ENABLED = true;
// A session's once-slot outlives any plausible first-prompt retry burst but
// not the run; the set is in-memory because a server restart already resets
// the plugin, and a re-fired prompt without the block re-injects harmlessly.
const ONCE_TTL_MS = 6 * 60 * 60 * 1000;

export const BOARD_COORD_AGENTS = [
  "agent-board-coord",
  "agent-board-coord-local",
  "agent-board-coord-pr",
];

export function isBoardCoordAgent(agent: unknown): boolean {
  return BOARD_COORD_AGENTS.includes(agent as string);
}

// Mirrors the schema fence block byte-for-byte: line-per-entry indented lists,
// custom fields keyed on `name`, labels from get_board, and the re-resolve
// footer the schema declares part of itself. Pure — the collection stamp comes
// from the input, never a clock read, so tests and callers own the timestamp.
export function formatBlock(fields: any): string {
  const pair = (entry: any) => `  ${entry.name}=${entry.id}`;
  return [
    `Board context (collected ${fields.collectedAt}, ${fields.serverId})`,
    `board_id: ${fields.boardId}`,
    `swimlane_id: ${fields.swimlaneId}`,
    "lists:",
    ...fields.lists.map(pair),
    "custom_fields:",
    ...fields.customFields.map(pair),
    "labels:",
    ...fields.labels.map(pair),
    "Card and checklist ids are not included — they are live per-card data,",
    "resolved at use time. On any id-shaped call error, re-resolve this block",
    "against the live board before retrying.",
  ].join("\n");
}

// WeKan MCP payloads arrive as an array or wrapped under an envelope key
// ({boards: [...]}, {result: [...]}) — the two result shapes are pinned in
// wekan-mcp-ops.md, the envelope key name is not, so unwrap the first array.
function asArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const found = Object.values(value).find((entry) => Array.isArray(entry));
    if (Array.isArray(found)) return found;
  }
  return [];
}

// The collector's resolution sequence (wekan-mcp skill): board by title ->
// get_board (labels) -> swimlane by title -> lists filtered by swimlane id
// (titles repeat across swimlanes; list_lists items carry swimlane_id) ->
// custom fields keyed on `name`. Unknown titles throw — the caller's failure
// policy turns that into an untouched prompt.
export async function resolveBoardContext(deps: any, opts: any): Promise<string> {
  const { callTool } = deps;
  const { boardTitle, swimlaneTitle, serverId, collectedAt } = opts;

  const boards = asArray(await callTool("list_boards", {}));
  const board = boards.find((b: any) => b?.title === boardTitle);
  if (!board) throw new Error(`board not found: ${boardTitle}`);

  const boardInfo = await callTool("get_board", { board_id: board.id });
  const swimlanes = asArray(await callTool("list_swimlanes", { board_id: board.id }));
  const swimlane = swimlanes.find((s: any) => s?.title === swimlaneTitle);
  if (!swimlane) throw new Error(`swimlane not found: ${swimlaneTitle}`);

  const lists = asArray(await callTool("list_lists", { board_id: board.id }));
  const laneLists = lists.filter((l: any) => l?.swimlane_id === swimlane.id);
  const customFields = asArray(await callTool("list_custom_fields", { board_id: board.id }));

  return formatBlock({
    collectedAt,
    serverId,
    boardId: board.id,
    swimlaneId: swimlane.id,
    lists: laneLists.map((l: any) => ({ name: l.title, id: l.id })),
    customFields: customFields.map((f: any) => ({ name: f.name, id: f.id })),
    labels: asArray(boardInfo?.labels).map((l: any) => ({ name: l.name, id: l.id })),
  });
}

// Streamable-HTTP answers as SSE frames or plain JSON; "data:" frames win when
// present. Anything unparseable is null — never a throw on the failure path.
export function parseSseData(text: string): any | null {
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

// wekan-mcp-ops.md: tool results arrive in result.structuredContent.result or
// as a JSON string in result.content[].text needing a second parse — prefer
// structured, fall through to the text parts.
export function unwrapToolResult(rpcBody: any): any {
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

// Named-server match, no credentials: the live catalog first, then the project
// config text (question-notify's parsing precedent — locate the quoted server
// key, take the first url after it). null means "no URL discovered", which the
// handler degrades; there is no invented default.
export async function resolveMcpUrl(deps: any): Promise<string | null> {
  try {
    const list = await deps.mcpList?.();
    const entries = Array.isArray(list) ? list : asArray(list?.servers);
    for (const entry of entries) {
      const [name, cfg] = Array.isArray(entry) ? entry : [entry?.name, entry];
      if (name === MCP_SERVER_KEY && typeof cfg?.url === "string") return cfg.url;
    }
  } catch {
    // catalog unavailable — fall through to the config arm
  }
  try {
    const raw = await deps.readConfig();
    if (typeof raw !== "string") return null;
    const idx = raw.indexOf(`"${MCP_SERVER_KEY}"`);
    if (idx < 0) return null;
    const match = raw.slice(idx).match(/"url"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function createPromptHandler(deps: any, opts: any = {}) {
  const enabled = opts?.enabled ?? DEFAULT_ENABLED;
  const attempted = new Map<string, number>();

  return async (event: any): Promise<void> => {
    if (!enabled) return;
    try {
      const sessionID: string | undefined = event?.sessionID;
      const text = event?.prompt?.text;
      if (!sessionID || typeof text !== "string") return;
      if (text.includes(CANONICAL_HEADER)) {
        attempted.set(sessionID, Date.now());
        return;
      }
      const seen = attempted.get(sessionID);
      if (seen !== undefined && Date.now() - seen < ONCE_TTL_MS) return;

      // Dual read, question-notify's tolerant shape: the prompt event carries
      // no agent field on the checked types, but a present string is free.
      const agent =
        typeof event?.agent === "string" ? event.agent : await deps.getAgent(sessionID);
      if (!isBoardCoordAgent(agent)) return;

      attempted.set(sessionID, Date.now());
      const block = await withinBudget(
        Promise.resolve(deps.resolve(MCP_SERVER_KEY)),
        deps.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
      );
      if (typeof block !== "string" || !block.startsWith(CANONICAL_HEADER)) {
        deps.log("board context unresolved — prompt left untouched");
        return;
      }
      // Append-only: rewriting the text would stale the attachment and
      // mention offsets the expanded command text may carry.
      event.prompt.text = `${text}\n\n${block}`;
    } catch (err: any) {
      deps.log(`prompt hook degraded: ${err?.message ?? err}`);
    }
  };
}

// The race never rejects with an unhandled rejection: the work promise is
// wrapped into a settled-marker so a late board-fetch failure cannot crash the
// server process after the budget already fired.
async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = work.then(
    (value) => ({ state: "done" as const, value }),
    (error) => ({ state: "failed" as const, error }),
  );
  try {
    const outcome: any = await Promise.race([
      settled,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ state: "timeout" as const }), ms);
      }),
    ]);
    if (outcome.state === "done") return outcome.value;
    if (outcome.state === "failed") throw outcome.error;
    throw new Error(`board fetch exceeded the ${ms} ms admission-latency budget`);
  } finally {
    clearTimeout(timer);
  }
}

async function projectConfigText(ctx: any): Promise<string | null> {
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    return readFileSync(join(ctx.location.directory, ".opencode", "opencode.jsonc"), "utf8");
  } catch {
    return null;
  }
}

// One MCP-over-HTTP session per prefetch: initialize -> notifications/
// initialized -> tools/call (wekan-mcp-ops.md recipe). Transport failures
// throw into the handler's degrade arm.
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
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
        clientInfo: { name: "opencode-board-context", version: "1.0.0" },
      });
      await post("notifications/initialized", {});
    }
    const body = await post("tools/call", { name, arguments: args });
    return unwrapToolResult(body);
  };
}

export default {
  id: "local.board-context",
  async setup(ctx: any) {
    const handler = createPromptHandler({
      getAgent: async (sessionID: string) => (await ctx.session.get({ sessionID }))?.agent,
      resolve: async (serverId: string) => {
        const url = await resolveMcpUrl({
          mcpList: async () => ctx.mcp?.list?.(),
          readConfig: () => projectConfigText(ctx),
        });
        if (!url) throw new Error(`no URL discovered for ${serverId}`);
        return resolveBoardContext(
          { callTool: makeCallTool(url) },
          {
            boardTitle: BOARD_TITLE,
            swimlaneTitle: SWIMLANE_TITLE,
            serverId,
            collectedAt: new Date().toISOString(),
          },
        );
      },
      log: (message: string) => console.error(`[board-context] ${message}`),
    });
    await ctx.session.hook("prompt", handler);
  },
};
