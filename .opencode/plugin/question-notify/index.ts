// OpenCode V2 local plugin: pushes a notification to the user's phone via Home
// Assistant when (1) an agent-* session asks a question (question tool hook),
// (2) a top-level session finishes an assistant turn or stops on a terminal
// execution failure (event stream), or (3) a permission approval ask is still
// pending 15 s after the server published it (the durable permission.asked
// event on the same stream; permission.replied for that request cancels it).
// Hand-written — rulesync must never generate or delete this file (rulesync's
// hooks feature is OFF in rulesync.jsonc; no other writer exists).
//
// Why raw MCP JSON-RPC instead of the MCP tools: plugins run in the OpenCode
// server process, outside any agent session — MCP tools exist for models, not
// for plugins. The lab's ha-mcp servers are remote streamable-HTTP endpoints
// in the cluster, so the plugin speaks MCP directly (initialize →
// notifications/initialized → tools/call call_service). Deterministic: no
// model in the loop. The server URL is discovered at runtime from the ctx's
// MCP config view (ctx.mcp.transform — the only view whose entries carry
// full server configs), with the ctx.mcp.list() status scan demoted to a
// compat fallback, so nothing is hard-coded. The ADMIN endpoint is required:
// the readonly ha-mcp server runs READ_ONLY_MODE and rejects service calls.
//
// Failure policy: a notification must never delay or break the agent —
// everything here is fire-and-forget with stderr logging only. A lifecycle
// session lookup that fails suppresses its push rather than pinging about a
// session whose topology could not be verified. An approval lookup that fails
// still pushes with the `session` label: the ask needs a human regardless of
// whose record could not be read, so dropping the push is the worst outcome
// (.agents/plans/2026/2026-10-feat-ha-lifecycle-notify/DECISIONS.md,
// 2026-10-26 lookup-failure policy).
//
// Verified against @opencode/plugin 2.1.2 types (dist/promise/tool.d.ts):
// the execute.before event carries { tool, sessionID, agent, messageID, id,
// input } directly — we read event.agent and keep a ctx.session.get fallback
// only because the v2.0.32 CLI at first shipping predated the checked types.
// Lifecycle triggers are the durable V2 execution pair below, grounded at first
// shipping against the v2.0.32 binary (see .agents/plans/2026/2026-10-feat-ha-
// lifecycle-notify). They fire once per terminal outcome of an agent-loop run,
// so retries and transient status events need neither a heuristic nor a dedup
// map; legacy session.idle/session.error and interrupts stay ignored on purpose
// — the plan's grep commands pin the pair.
// The finished push has exactly one suppression (OQ4 ruling, 2026-10-29): a
// scheduled OpenChamber launch whose coord marked the session no-work — the
// boards skill's marker contract is the writer authority and noWorkSuppressed
// reads both legs off the session record the lookup already fetched. What
// keeps alerting: crash, question and approval pushes, scheduled runs that
// did work, and manual /pipeline-boards ends even when marked — every
// unknown or malformed shape alerts (fail-loud).
// The approval trigger is the durable permission.asked event, re-grounded
// on the v2.1.4 binary: the server publishes it only when the
// ruleset effect resolves to `ask` and exactly once per request id. The push
// is pending-only, because the server's single publish site is oblivious to
// the client's auto-approve setting: an arrival-time push rings clients that
// had already answered (the live bug behind C03). permission.replied for the
// request id cancels the pending push whatever its reply value: every server
// resolution path emits it (Grounding #14). The cooldown gate therefore runs
// in the timer callback, at the actual push attempt — a cancelled ask
// consumes no stamp. The payload carries no agent name (the title reads it from the
// session record at fire time) and a v1-compat twin shares the type string
// with permission/patterns fields, hence the tolerant field reads in
// approvalExcerpt.
// Unverified at write time (watch ~/.local/share/opencode/log/opencode.log):
// - Whether this ha-mcp build accepts tools/call without the initialized
//   notification; we send the full handshake anyway.
// - The per-event envelope of the lifecycle stream. The loop logs the keys of
//   the first lifecycle event once, so the user-owned live smoke confirms the
//   shape; handleLifecycle's dual read already covers the flat variant. The
//   permission path mirrors this with its own one-shot flag and dual reads.

const NOTIFY_DOMAIN = "notify";
const NOTIFY_SERVICE = "mobile_app_pixel_6";
const MCP_SERVER_KEY = "admin-global-homeassistant";
const AGENT_PREFIX = "agent-";
const COOLDOWN_MS = 15_000; // one push per session per burst, shared by the question and approval paths
// How long an approval ask must stay unanswered before it rings the phone.
// The same literal as COOLDOWN_MS by coincidence, not by design: pending-
// detection and burst-suppression are independent user-visible behaviors and
// merging the constants would couple them (DECISIONS 2026-10-27).
const PENDING_NOTIFY_MS = 15_000;
const MAX_MESSAGE = 240;
const FINISHED_EVENT = "session.execution.succeeded";
const CRASH_EVENT = "session.execution.failed";
const PERMISSION_ASK_EVENT = "permission.asked";
const PERMISSION_REPLY_EVENT = "permission.replied";

// Exported seam: tests/opencode/question-notify.test.ts and
// permission-ask-notify.test.ts drive the lifecycle and approval decision
// matrices offline through handleLifecycle / handlePermission with injected
// fakes for the session lookups, the push, the cooldown gate, and the
// pending-timer plumbing (schedule/cancel/timers/pendingMs), so no test needs
// a server, a socket, or a real 15 s wait. The helpers are pure.

// A non-string body collapses to "" rather than "undefined": a notification
// for a missing part is empty, never misleading.
export function truncate(value: any): string {
  return typeof value === "string" ? value.slice(0, MAX_MESSAGE) : "";
}

export function questionTitle(agent: string): string {
  return `OpenCode: ${agent} has a question`;
}

export function finishedTitle(agent: string): string {
  return `OpenCode: ${agent} finished`;
}

export function crashTitle(agent: string): string {
  return `OpenCode: ${agent} stopped`;
}

export function approvalTitle(agent: string): string {
  return `OpenCode: ${agent} needs approval`;
}

// A missing session record is unknown topology, not top-level: the failure
// policy suppresses on doubt rather than pinging about a session whose
// parentage could not be read.
export function isTopLevel(info: any): boolean {
  if (!info || typeof info !== "object") return false;
  return !info.parentID;
}

// Reader half of the no-op marker contract — the writer is the boards skill,
// which marks every no-op end whatever the launcher. The conjunction with the
// scheduled kind is the OQ4 ruling: marker presence alone never mutes, so a
// mis-marked manual run still alerts and the unsafe "missed real alert"
// direction is confined to scheduled ticks. Well-formedness is the non-empty
// string `reason` alone — `at` is the writer's audit stamp, never a gate
// (OQ2) — and any other shape returns false so the caller pushes (fail-loud).
export function noWorkSuppressed(info: any): boolean {
  // Dual read: the record may arrive bare or wrapped in a { data: ... } envelope.
  const metadata = info?.metadata ?? info?.data?.metadata;
  if (!metadata || typeof metadata !== "object") return false;
  if (!metadata.openchamber || metadata.openchamber.kind !== "scheduled") return false;
  const marker = metadata.pipelineNoop;
  return typeof marker === "object" && marker !== null && typeof marker.reason === "string" && marker.reason !== "";
}

// Newest-first scan over assistant `content` parts only: a turn commonly ends
// on a tool or reasoning part, and the top-level `text` on user/system records
// is the user's own prompt — reading it would echo it back as the answer.
export function lastAssistantExcerpt(messages: any): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.type !== "assistant" || !Array.isArray(message.content)) continue;
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j];
      if (part?.type === "text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

// Session.StructuredError puts the human-readable text in `message` and falls
// back to its discriminator; `status`/`response.body` are noise for a phone push.
export function crashExcerpt(error: any): string {
  if (typeof error?.message === "string" && error.message) return error.message;
  return typeof error?.type === "string" && error.type ? error.type : "unknown error";
}

// Excerpt precedence from the Permission.Request call sites (plan Grounding #9):
// the human-written `message` wins; otherwise the action word with at most the
// first three resources. `metadata` is never read: edit asks embed whole diffs
// there. The action/resources and permission/patterns dual read spans the
// v1-compat twin sharing the `permission.asked` type string, and
// "permission request" is the documented degrade when neither carries text.
export function approvalExcerpt(data: any): string {
  if (typeof data?.message === "string" && data.message) return data.message;
  const action =
    typeof data?.action === "string"
      ? data.action
      : typeof data?.permission === "string"
        ? data.permission
        : "";
  const items = Array.isArray(data?.resources) ? data.resources : Array.isArray(data?.patterns) ? data.patterns : [];
  const shown = items.filter((item: any) => typeof item === "string").slice(0, 3);
  if (!action) return "permission request";
  return shown.length > 0 ? `${action}: ${shown.join(", ")}` : action;
}

export async function handleLifecycle(deps: any, event: any): Promise<void> {
  const type = event?.type;
  if (type !== FINISHED_EVENT && type !== CRASH_EVENT) return;
  try {
    // Dual read: the V2-native envelope nests the payload under `data`, the
    // compat layer may deliver it flat.
    const sessionID: string | undefined = event.data?.sessionID ?? event.sessionID;
    if (!sessionID) return;
    const info = await deps.getSession(sessionID);
    if (!isTopLevel(info)) return;
    const agent = typeof info.agent === "string" && info.agent ? info.agent : "session";
    if (type === FINISHED_EVENT) {
      // Returns before getMessages and before any push attempt: the
      // suppression consumes nothing, so a later real completion is unaffected.
      if (noWorkSuppressed(info)) {
        console.error("[question-notify] suppressed no-work finished push", sessionID);
        return;
      }
      const messages = await deps.getMessages(sessionID);
      await deps.notify(finishedTitle(agent), truncate(lastAssistantExcerpt(messages) || "no text output"));
    } else {
      await deps.notify(crashTitle(agent), truncate(crashExcerpt(event.data?.error ?? event.error)));
    }
  } catch (err: any) {
    // Swallowed by design: the caller's stream must keep consuming, and a
    // partial lookup must not reach the phone.
    console.error("[question-notify] lifecycle push suppressed:", err?.message ?? err);
  }
}

// Every session that blocks on an approval needs a human, whatever its
// parentage, so — unlike lifecycle — there is no topology filter here
// (DECISIONS 2026-10-26: scope-all-sessions).
//
// Pending-only contract (plan Grounding #13–#15): an ask arms a per-request-id
// timer and otherwise reads nothing — no cooldown gate, no session record —
// because auto-approving clients answer milliseconds after asked, and a
// cancelled ask must consume no cooldown stamp (DECISIONS 2026-10-27). Every
// server resolution path emits permission.replied, so any reply value cancels.
export async function handlePermission(deps: any, event: any): Promise<void> {
  const type = event?.type;
  if (type !== PERMISSION_ASK_EVENT && type !== PERMISSION_REPLY_EVENT) return;
  try {
    // The field names stay unharmonized on purpose: the asked cancel key is
    // `id`, the replied one is `requestID`, and both envelope twins carry the
    // same names — only the nesting position varies (Grounding #13).
    if (type === PERMISSION_REPLY_EVENT) {
      const requestID: string | undefined = event.data?.requestID ?? event.requestID;
      const handle = requestID === undefined ? undefined : deps.timers.get(requestID);
      if (handle === undefined) return;
      // Unkey first: a deps.cancel that throws must not leave the entry
      // behind, or the guarded callback could still find it and push.
      deps.timers.delete(requestID);
      deps.cancel(handle);
      return;
    }
    const sessionID: string | undefined = event.data?.sessionID ?? event.sessionID;
    const requestID: string | undefined = event.data?.id ?? event.id;
    // An ask without a cancel key or without a gate key stays unarmed: a
    // timer nobody can cancel would push after the human has already answered.
    if (!sessionID || !requestID) return;
    const payload = event.data ?? event;
    // The holder exists because the callback must compare against the handle
    // deps.schedule returns. Even a 0 ms pendingMs cannot fire the callback
    // before schedule returns, so assigning after the call stays race-free.
    const armed: { handle?: any } = {};
    armed.handle = deps.schedule(async () => {
      try {
        // The live map entry must be this callback's own handle: clearTimeout
        // can lose the race against an expiring timer, and a redelivered or
        // cancelled ask replaces the entry — its stale callback stays silent.
        if (deps.timers.get(requestID) !== armed.handle) return;
        deps.timers.delete(requestID);
        // Gate before the lookup: the cooldown key is the sessionID alone and
        // an approval push needs no session record to decide whether to fire
        // — the record only refines the title.
        if (!deps.allowPush(sessionID)) return;
        let agent = "session";
        try {
          const info = await deps.getSession(sessionID);
          if (typeof info?.agent === "string" && info.agent) agent = info.agent;
        } catch (err: any) {
          // Degrade, never suppress: an imprecise title beats a silently
          // dropped block (DECISIONS 2026-10-26: lookup-failure policy).
          console.error("[question-notify] approval session lookup failed:", err?.message ?? err);
        }
        await deps.notify(approvalTitle(agent), truncate(approvalExcerpt(payload)));
      } catch (err: any) {
        // A rejecting timer callback would surface as an unhandled rejection
        // and can kill the host process: swallow at this boundary instead.
        console.error("[question-notify] approval push failed:", err?.message ?? err);
      }
    }, deps.pendingMs);
    // Redelivery (stream reconnect) may replay a live id: keep at most one
    // handle per request so the old timer cannot fire alongside the new.
    const stale = deps.timers.get(requestID);
    if (stale !== undefined) deps.cancel(stale);
    deps.timers.set(requestID, armed.handle);
  } catch (err: any) {
    console.error("[question-notify] approval timer wiring failed:", err?.message ?? err);
  }
}

function firstQuestion(input: any): string {
  const q = input?.questions;
  if (Array.isArray(q) && q.length > 0) {
    const head = q[0];
    return String(head?.question ?? head?.header ?? "question pending");
  }
  return "question pending";
}

// Exported URL-discovery seam (tests/opencode/ha-mcp-url.test.ts). Leg 1 is
// the v2.1.4 MCP config view, ctx.mcp.transform: the only ctx surface whose
// entries carry full server configs, fed from every config document —
// including the machine-global one the 2026-10-25 fleet split moved this
// entry into, invisible to the retired project-file leg (plan Grounding
// #18–#22). A fresh register/dispose per call keeps fleet config edits live
// without a restart (DECISIONS 2026-10-28: no caching). Never rejects: an
// all-miss resolves null, and sendHANotify owns the missing-URL stderr line.
export async function haMcpUrl(ctx: any): Promise<string | null> {
  let url: string | undefined;
  let registration: any;
  try {
    registration = await ctx.mcp?.transform?.((editor: any) => {
      // Recomputes re-invoke live registrations until dispose (Grounding
      // #21): this fires 0..N times per call and the capture stays pure. A
      // throw past this callback would fail the plugin's whole registration
      // group and poison later transforms for the process lifetime — the
      // guard stays inside on purpose.
      try {
        const cfg = editor?.get?.(MCP_SERVER_KEY);
        if (typeof cfg?.url === "string") url = cfg.url;
      } catch {
        // a poisoned config read is a leg-1 miss; leg 2 owns the rest
      }
    });
  } catch {
    // transform absent, throwing, or rejecting: a leg-1 miss
  } finally {
    try {
      // A leaked registration would keep re-firing on every state recompute,
      // so it is always awaited closed here; a rejecting dispose cannot undo
      // a completed capture.
      await registration?.dispose?.();
    } catch {
      // never reject the seam (failure policy)
    }
  }
  if (typeof url === "string") return url;
  // Leg 2 (compat): the pre-split status-list scan, kept verbatim. On
  // v2.1.4 its entries carry name+status only (Grounding #20), so nothing
  // can match, but it costs nothing and covers builds whose list() answers
  // full configs (DECISIONS 2026-10-28).
  try {
    const list = await ctx.mcp?.list?.();
    const entries: any[] = Array.isArray(list) ? list : (list?.servers ?? []);
    for (const entry of entries) {
      const [name, cfg] = Array.isArray(entry) ? entry : [entry?.name, entry];
      if (name === MCP_SERVER_KEY && typeof cfg?.url === "string") return cfg.url;
    }
  } catch {
    // list absent or rejecting: both legs missed
  }
  return null;
}

let rpcSeq = 0;

async function mcpRequest(url: string, sessionID: string | null, method: string, params: any): Promise<{ body: any; sessionID: string | null }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionID) headers["Mcp-Session-Id"] = sessionID;
  const isNotification = method.startsWith("notifications/");
  const payload: any = { jsonrpc: "2.0", method, params };
  if (!isNotification) payload.id = ++rpcSeq;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
  const sid = res.headers.get("mcp-session-id") ?? sessionID;
  if (isNotification) return { body: null, sessionID: sid };
  const text = await res.text();
  if (!text) return { body: null, sessionID: sid };
  // Streamable HTTP may answer with SSE frames or plain JSON.
  if (text.includes("data:")) {
    const data = text.split("\n").filter((l) => l.startsWith("data:")).pop()?.slice(5);
    return { body: data ? JSON.parse(data) : null, sessionID: sid };
  }
  return { body: JSON.parse(text), sessionID: sid };
}

async function sendHANotify(ctx: any, title: string, message: string) {
  const url = await haMcpUrl(ctx);
  if (!url) {
    console.error("[question-notify] no URL found for", MCP_SERVER_KEY);
    return;
  }
  const init = await mcpRequest(url, null, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "opencode-question-notify", version: "1.0.0" },
  });
  await mcpRequest(url, init.sessionID, "notifications/initialized", {});
  const call = await mcpRequest(url, init.sessionID, "tools/call", {
    name: "call_service",
    arguments: {
      domain: NOTIFY_DOMAIN,
      service: NOTIFY_SERVICE,
      data: { title, message: truncate(message) },
    },
  });
  if (call.body?.error) console.error("[question-notify] call_service error:", JSON.stringify(call.body.error));
}

export default {
  id: "local.question-notify",
  async setup(ctx: any) {
    const lastNotified = new Map<string, number>();
    // Read the pending window per setup, never at module load: a cached read
    // would pin one test run's OPENCODE_NOTIFY_PENDING_MS onto every later
    // setup (chunks/C03.md AC 15). Only a finite number >= 0 is a legal
    // window; anything else keeps the shipped constant.
    const envPendingMs = Number(process.env.OPENCODE_NOTIFY_PENDING_MS);
    const pendingMs = Number.isFinite(envPendingMs) && envPendingMs >= 0 ? envPendingMs : PENDING_NOTIFY_MS;
    const pendingApproval = new Map<string, any>();
    // One cooldown gate, keyed on sessionID alone, shared by the question hook
    // and the fired approval path: a question push and a near-simultaneous ask
    // for one session yield a single phone push (intake: burst → one push).
    // Stamps on the push attempt, not on transport success.
    const allowPush = (key: string): boolean => {
      const now = Date.now();
      if (now - (lastNotified.get(key) ?? 0) < COOLDOWN_MS) return false;
      lastNotified.set(key, now);
      return true;
    };
    let debugLogged = false;
    let lifecycleDebugLogged = false;
    let permissionDebugLogged = false;

    await ctx.tool.hook("execute.before", async (event: any) => {
      try {
        if (event.tool !== "question") return;
        if (!debugLogged) {
          debugLogged = true;
          console.error("[question-notify] execute.before event keys:", Object.keys(event ?? {}));
        }
        const sessionID: string | undefined = event.sessionID ?? event.context?.sessionID;
        let agent: unknown = event.agent;
        if (typeof agent !== "string" && sessionID) {
          try {
            agent = (await ctx.session.get({ sessionID }))?.agent;
          } catch {
            agent = undefined;
          }
        }
        if (typeof agent !== "string" || !agent.startsWith(AGENT_PREFIX)) return;
        if (!allowPush(sessionID ?? agent)) return;

        void sendHANotify(ctx, questionTitle(agent), firstQuestion(event.input)).catch((err) =>
          console.error("[question-notify] notify failed:", err?.message ?? err),
        );
      } catch (err: any) {
        console.error("[question-notify] hook error:", err?.message ?? err);
      }
    });

    // The loop must not be awaited inside setup: a subscription stays open for
    // the life of the server, and blocking setup would hang plugin load. Each
    // event is dispatched fire-and-forget so one failed push cannot stop
    // consumption; the returned cleanup aborts the subscription on unload.
    const controller = new AbortController();
    const deps = {
      allowPush,
      getSession: (sessionID: string) => ctx.session.get({ sessionID }),
      getMessages: (sessionID: string) => ctx.session.context({ sessionID }),
      notify: (title: string, message: string) => sendHANotify(ctx, title, message),
      timers: pendingApproval,
      schedule: (fn: any, ms: number) => setTimeout(fn, ms),
      cancel: (handle: any) => clearTimeout(handle),
      pendingMs,
    };
    // A subscription that cannot start must not reject setup: the question hook
    // above is already registered and has its own verified-working contract.
    let stream: any;
    try {
      stream =
        typeof ctx.event?.subscribe === "function"
          ? ctx.event.subscribe({ signal: controller.signal })
          : undefined;
    } catch (err: any) {
      console.error("[question-notify] event subscription failed:", err?.message ?? err);
    }
    if (stream) {
      void (async () => {
        for await (const event of stream) {
          if ((event?.type === FINISHED_EVENT || event?.type === CRASH_EVENT) && !lifecycleDebugLogged) {
            lifecycleDebugLogged = true;
            console.error(
              "[question-notify] first lifecycle event keys:",
              Object.keys(event ?? {}),
              "data keys:",
              Object.keys(event?.data ?? {}),
            );
          }
          if (event?.type === PERMISSION_ASK_EVENT && !permissionDebugLogged) {
            permissionDebugLogged = true;
            console.error(
              "[question-notify] first permission event keys:",
              Object.keys(event ?? {}),
              "data keys:",
              Object.keys(event?.data ?? {}),
            );
          }
          // Both handlers self-filter on event.type, so each event goes to
          // both; the void-catch guards stay as the outer belt against a
          // handler rejecting on a shape it did not anticipate.
          void handleLifecycle(deps, event).catch((err: any) =>
            console.error("[question-notify] lifecycle handler failed:", err?.message ?? err),
          );
          void handlePermission(deps, event).catch((err: any) =>
            console.error("[question-notify] permission handler failed:", err?.message ?? err),
          );
        }
      })().catch((err: any) => console.error("[question-notify] event stream ended:", err?.message ?? err));
    }

    return () => {
      controller.abort();
      // Abort first (the cleanup contract the tests pin), then disarm every
      // still-pending approval timer: a surviving handle would push for a
      // session whose server just unloaded.
      for (const handle of pendingApproval.values()) clearTimeout(handle);
      pendingApproval.clear();
    };
  },
};