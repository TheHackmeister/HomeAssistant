(() => {
  "use strict";

  const CHANNEL = "openchamber.sdk";
  const API_VERSION = 1;
  const REQUEST_TIMEOUT_MS = 20000;

  const root = document.querySelector("#root");
  if (!root) return;

  const state = {
    ready: false,
    surface: "",
    directory: null,
    projectsState: "idle",
    projects: [],
    selectedProjectId: null,
    userSelectedProject: false,
    sessionsState: "idle",
    sessions: [],
    error: null,
  };

  const pending = new Map();
  const subscriptions = new Map();
  let requestCounter = 0;
  let projectsSubscribed = false;

  const normalizePath = (value) => {
    if (!value) return "";
    const replaced = String(value).replace(/\\/g, "/");
    if (replaced === "/") return "/";
    return replaced.replace(/\/+$/, "");
  };

  const nextId = () => {
    requestCounter += 1;
    return `group-costs-${requestCounter}`;
  };

  const post = (message) => {
    window.parent.postMessage({ channel: CHANNEL, v: API_VERSION, ...message }, "*");
  };

  const call = (type, payload) =>
    new Promise((resolve, reject) => {
      const id = nextId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Host did not answer in time."));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      post({ type, id, payload });
    });

  const subscribe = async (subscriptionId, query, handler) => {
    if (subscriptions.has(subscriptionId)) return;
    subscriptions.set(subscriptionId, handler);
    try {
      await call("workspace-subscribe", { subscriptionId, query });
    } catch (error) {
      subscriptions.delete(subscriptionId);
      throw error;
    }
  };

  const unsubscribe = (subscriptionId) => {
    if (!subscriptions.delete(subscriptionId)) return;
    const id = nextId();
    post({ type: "workspace-unsubscribe", id, payload: { subscriptionId } });
    const pendingEntry = pending.get(id);
    if (pendingEntry) {
      clearTimeout(pendingEntry.timer);
      pending.delete(id);
    }
  };

  const applyTheme = (theme) => {
    const tokens = theme?.tokens ?? {};
    const style = document.documentElement.style;
    const set = (name, value, fallback) => {
      style.setProperty(name, value || fallback);
    };
    set("--background", tokens.background, "#ffffff");
    set("--elevated", tokens.elevated, "#f7f7f8");
    set("--foreground", tokens.foreground, "#111111");
    set("--muted", tokens.muted, "#666666");
    set("--border", tokens.border, "rgba(0,0,0,.14)");
    set("--primary", tokens.primary, "#2563eb");
    set("--primary-foreground", tokens.primaryForeground, "#ffffff");
    set("--success", tokens.successText || tokens.success, "#15803d");
    set("--warning", tokens.warningText || tokens.warning, "#b45309");
    set("--error", tokens.errorText || tokens.error, "#b91c1c");
    set("--info", tokens.infoText || tokens.info, "#1d4ed8");
    set("--radius", tokens.radius, "10px");
    if (tokens.font) style.setProperty("--font", tokens.font);
    if (tokens.mono) style.setProperty("--mono", tokens.mono);
    if (theme?.mode) document.documentElement.dataset.theme = theme.mode;
  };

  const COST_SUFFIX = /\s·\s\$(\d+(?:\.\d+)?)\s·\s(\d+(?:\.\d+)?)([kM]?)\s+tok$/;
  const GROUP_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
  const RUN_GROUP = /^g[1-9]\d*$/;

  const parseCostTitle = (rawTitle) => {
    const title = String(rawTitle ?? "").trim();
    const withoutWarning = title.replace(/^⚠\s+/u, "");
    const match = withoutWarning.match(COST_SUFFIX);
    if (!match) {
      return { base: withoutWarning, cost: null, tokens: null };
    }
    const base = withoutWarning.slice(0, match.index).trim();
    const cost = Number.parseFloat(match[1]);
    const tokenValue = Number.parseFloat(match[2]);
    const unit = match[3];
    const multiplier = unit === "M" ? 1_000_000 : unit === "k" ? 1_000 : 1;
    return {
      base,
      cost: Number.isFinite(cost) ? cost : null,
      tokens: Number.isFinite(tokenValue) ? Math.round(tokenValue * multiplier) : null,
    };
  };

  const parseMultiRunTitle = (base) => {
    const segments = String(base || "").split("/");
    if (segments.length < 3) return null;

    const groupSlug = segments[0];
    if (!GROUP_SLUG.test(groupSlug)) return null;

    let providerOffset = 1;
    let runGroup;
    if (segments.length >= 4 && RUN_GROUP.test(segments[1])) {
      runGroup = segments[1];
      providerOffset = 2;
    } else if (segments.length >= 5 && segments[1] === "") {
      providerOffset = 2;
    }

    const providerID = segments[providerOffset];
    let modelParts = segments.slice(providerOffset + 1);
    if (!providerID || modelParts.length === 0) return null;
    if (modelParts.some((part) => !part || part !== part.trim())) return null;

    let index;
    let fusion = false;
    if (modelParts.length > 1) {
      const last = modelParts[modelParts.length - 1];
      if (last === "fusion") {
        fusion = true;
        modelParts = modelParts.slice(0, -1);
      } else if (/^\d+$/.test(last)) {
        index = Number.parseInt(last, 10);
        modelParts = modelParts.slice(0, -1);
      }
    }

    const modelID = modelParts.join("/");
    if (!modelID) return null;

    return { groupSlug, runGroup, providerID, modelID, index, fusion };
  };

  const formatMoney = (value) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return `$${value.toFixed(2)}`;
  };

  const formatTokens = (value) => {
    if (value == null || !Number.isFinite(value)) return "—";
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
    return String(value);
  };

  const addNullable = (left, right) => {
    if (left == null && right == null) return null;
    return (left ?? 0) + (right ?? 0);
  };

  const buildViewModel = (sessions) => {
    const groups = new Map();
    const ungrouped = [];

    for (const session of sessions ?? []) {
      if (!session?.id || session.parentId || session.archivedAt) continue;

      const parsed = parseCostTitle(session.title);
      const identity = parseMultiRunTitle(parsed.base);
      const run = {
        id: session.id,
        title: session.title || session.id,
        label: identity
          ? `${identity.providerID}/${identity.modelID}${identity.index && identity.index > 1 ? ` #${identity.index}` : ""}${identity.fusion ? " fusion" : ""}`
          : parsed.base || session.id,
        branch: session.worktree?.branch || session.worktree?.name || "",
        activity: session.activity || "unknown",
        outcome: session.outcome ?? null,
        cost: parsed.cost,
        tokens: parsed.tokens,
        updatedAt: session.updatedAt || session.createdAt || 0,
      };

      if (identity) {
        const key = [session.projectId || "", identity.groupSlug, identity.runGroup || ""].join("|");
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            name: identity.runGroup ? `${identity.groupSlug} · ${identity.runGroup}` : identity.groupSlug,
            runs: [],
            cost: null,
            tokens: null,
            lastActive: 0,
            missingCost: false,
          };
          groups.set(key, group);
        }
        group.runs.push(run);
        group.cost = addNullable(group.cost, run.cost);
        group.tokens = addNullable(group.tokens, run.tokens);
        group.lastActive = Math.max(group.lastActive, run.updatedAt);
        if (run.cost == null) group.missingCost = true;
      } else {
        ungrouped.push(run);
      }
    }

    for (const group of groups.values()) {
      group.runs.sort(
        (a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true }) ||
          b.updatedAt - a.updatedAt,
      );
    }

    ungrouped.sort((a, b) => b.updatedAt - a.updatedAt);

    return {
      groups: [...groups.values()].sort((a, b) => b.lastActive - a.lastActive),
      ungrouped,
    };
  };

  const el = (tagName, className, text) => {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const activityDotClass = (run) => {
    if (run.activity === "running" || run.activity === "retrying") return "running";
    if (run.activity === "waiting-permission" || run.activity === "waiting-question") return "waiting";
    if (run.outcome === "failed") return "failed";
    if (run.outcome === "completed" || run.activity === "idle") return "completed";
    return "idle";
  };

  const openSession = (sessionId) => {
    call("open-session", { sessionId }).catch(() => {});
  };

  const renderRunRow = (run) => {
    const row = el("button", "row");
    row.type = "button";
    row.title = `Open ${run.title}`;
    row.addEventListener("click", () => openSession(run.id));

    const main = el("div", "row-main");
    const titleLine = el("div", "row-title");
    titleLine.appendChild(el("span", `dot ${activityDotClass(run)}`));
    titleLine.appendChild(el("span", "row-label", run.label));

    const metaParts = [];
    if (run.branch) metaParts.push(run.branch);
    metaParts.push(run.activity || "unknown");
    if (run.outcome) metaParts.push(run.outcome);
    metaParts.push(run.id);
    main.appendChild(titleLine);
    main.appendChild(el("div", "row-meta", metaParts.join(" · ")));

    row.appendChild(main);
    row.appendChild(el("div", "value", formatMoney(run.cost)));
    row.appendChild(el("div", "value", formatTokens(run.tokens)));
    return row;
  };

  const renderGroup = (group) => {
    const card = el("section", "group");
    const header = el("div", "group-header");
    header.appendChild(el("div", "group-name", group.name));

    const total = el("div", "group-total");
    total.textContent = `${formatMoney(group.cost)}${group.missingCost ? "+" : ""} · ${formatTokens(group.tokens)} tok · ${group.runs.length} run${group.runs.length === 1 ? "" : "s"}`;
    header.appendChild(total);
    card.appendChild(header);

    for (const run of group.runs) {
      card.appendChild(renderRunRow(run));
    }
    return card;
  };

  const renderProjectControls = () => {
    const topbar = el("div", "topbar");
    topbar.appendChild(el("h1", undefined, "Agent group costs"));

    if (state.projects.length > 1) {
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Project");
      for (const project of state.projects) {
        const option = document.createElement("option");
        option.value = project.id;
        option.textContent = project.name || project.directory || project.id;
        option.selected = project.id === state.selectedProjectId;
        select.appendChild(option);
      }
      select.addEventListener("change", () => {
        state.userSelectedProject = true;
        void setSessionsProject(select.value);
      });
      topbar.appendChild(select);
    }

    return topbar;
  };

  const render = () => {
    root.textContent = "";

    if (!state.ready) {
      root.appendChild(el("div", "hint", "Connecting to OpenChamber…"));
      return;
    }

    if (state.error) {
      root.appendChild(el("div", "error", state.error));
      return;
    }

    if (state.projectsState === "loading" || state.projectsState === "idle") {
      root.appendChild(el("div", "hint", "Loading projects…"));
      return;
    }

    if (!state.projects.length) {
      root.appendChild(el("div", "empty", "No projects are available yet."));
      return;
    }

    root.appendChild(renderProjectControls());

    if (state.sessionsState === "loading" || state.sessionsState === "idle") {
      root.appendChild(el("div", "hint", "Loading sessions…"));
      return;
    }

    if (state.sessionsState === "error") {
      root.appendChild(el("div", "error", "Could not load sessions for this project."));
      return;
    }

    const { groups, ungrouped } = buildViewModel(state.sessions);

    root.appendChild(el("div", "section-title", "Agent groups"));
    if (!groups.length) {
      root.appendChild(
        el(
          "div",
          "empty",
          "No multi-run agent groups found. Sessions created by OpenChamber multi-run have structured titles like group-slug/provider/model; the cost-title plugin appends cost to them.",
        ),
      );
    }
    for (const group of groups) {
      root.appendChild(renderGroup(group));
    }

    if (ungrouped.length) {
      root.appendChild(el("div", "section-title", "Other sessions"));
      for (const run of ungrouped.slice(0, 20)) {
        root.appendChild(renderRunRow(run));
      }
    }
  };

  const setSessionsProject = async (projectId) => {
    if (!projectId) return;

    if (state.selectedProjectId && state.selectedProjectId !== projectId) {
      unsubscribe(`sessions:${state.selectedProjectId}`);
    }

    state.selectedProjectId = projectId;
    state.sessions = [];
    state.sessionsState = "loading";
    state.error = null;
    render();

    const subscriptionId = `sessions:${projectId}`;
    try {
      await subscribe(subscriptionId, { kind: "sessions", projectId }, (snapshot) => {
        if (snapshot?.projectId !== state.selectedProjectId) return;
        state.sessionsState = snapshot.state ?? "ready";
        state.sessions = snapshot.sessions ?? [];
        state.error = null;
        render();
      });
    } catch (error) {
      state.sessionsState = "error";
      state.error = `Could not subscribe to sessions: ${error.message}`;
      render();
    }
  };

  const handleProjectsSnapshot = (snapshot) => {
    state.projectsState = snapshot?.state ?? "ready";
    state.projects = snapshot?.projects ?? [];

    if (!state.projects.length) {
      state.selectedProjectId = null;
      state.sessions = [];
      state.sessionsState = "idle";
      render();
      return;
    }

    const currentStillExists = state.selectedProjectId
      ? state.projects.some((project) => project.id === state.selectedProjectId)
      : false;

    if (!currentStillExists || !state.selectedProjectId) {
      const normalizedDirectory = normalizePath(state.directory);
      const preferred =
        state.projects.find((project) => normalizePath(project.directory) === normalizedDirectory) ||
        state.projects[0];
      state.userSelectedProject = false;
      void setSessionsProject(preferred.id);
    }

    render();
  };

  const ensureProjectsSubscription = async () => {
    if (projectsSubscribed) return;
    projectsSubscribed = true;
    state.projectsState = "loading";
    render();
    try {
      await subscribe("projects", { kind: "projects" }, handleProjectsSnapshot);
    } catch (error) {
      state.projectsState = "error";
      state.error = `Could not load projects: ${error.message}`;
      render();
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL || message.v !== API_VERSION) return;

    if (message.type === "ready") {
      state.ready = true;
      state.surface = message.payload?.surface ?? "";
      state.directory = message.payload?.directory ?? null;
      applyTheme(message.payload?.theme);
      render();
      void ensureProjectsSubscription();
      return;
    }

    if (message.type === "directory") {
      state.directory = message.payload?.directory ?? null;
      if (!state.userSelectedProject && state.projects.length) {
        const normalizedDirectory = normalizePath(state.directory);
        const preferred = state.projects.find(
          (project) => normalizePath(project.directory) === normalizedDirectory,
        );
        if (preferred && preferred.id !== state.selectedProjectId) {
          void setSessionsProject(preferred.id);
        }
      }
      render();
      return;
    }

    if (message.type === "workspace") {
      const subscriptionId = message.payload?.subscriptionId;
      const handler = subscriptionId ? subscriptions.get(subscriptionId) : null;
      if (handler && message.payload?.snapshot) handler(message.payload.snapshot);
      return;
    }

    if (message.type === "result") {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) waiter.resolve(message.payload);
      else waiter.reject(new Error(message.error || "Host request failed."));
    }
  });

  render();
  post({ type: "hello" });
})();
