# Syncing the pipeline into another repo

The `.rulesync/` sources in this repo are portable. Another repo gets the pipeline (this skill, and — if wanted — the agents/commands) without any Python generator: rulesync IS the transport. Three mechanisms, pick per situation:

## 1. Declarative sources (rules + skills, lockfile-tracked)

In the TARGET repo's `rulesync.jsonc`:

```jsonc
{
  "sources": [
    // this repo as a source: the methodology skill (+ any shared rules)
    { "source": "ownyourio/SpencersLab", "skills": ["agents-sync"] }
    // rules selectable too: { "source": "ownyourio/SpencersLab", "rules": ["..."] }
    // pin a ref: "source": "ownyourio/SpencersLab@<tag>:<path>"
  ]
}
```

then `rulesync install && rulesync generate` (or `rulesync add ownyourio/SpencersLab --skills agents-sync`, which appends the entry, installs, and updates the lockfile). `sources:` resolves rules and skills only — agents/commands need mechanism 2 or 3. Non-GitHub remotes work via `"transport": "git"` with any git URL (or `file:///path/to/local/repo` while iterating locally).

## 2. Fetch (any feature, ad hoc)

```bash
# in the target repo:
rulesync fetch ownyourio/SpencersLab --features skills --skills agents-sync
rulesync fetch ownyourio/SpencersLab --features subagents,commands   # the agent set itself
```

Fetch searches for feature directories (`rules/`, `commands/`, `skills/`, `subagents/`, …) at the given path — point `--path` at `.rulesync` when needed, and `--ref` at a branch/tag/SHA. Fetched sources land in the target's `.rulesync/`; review before `rulesync generate`.

## 3. Copy + re-target (adopting the whole setup)

Copy `.rulesync/` + `rulesync.jsonc` into the target, then adapt (below). Right choice when the target should own its pipeline rather than track this repo.

## Adapting the sources to the target repo

The generic machinery (roles, RESULT schema, friction, chunk lifecycle, templates) is repo-agnostic. The per-repo delta:

| item | what to adapt |
|---|---|
| `rulesync.jsonc` | targets/features the target repo actually uses; keep `delete: true` only once the target's symlink layout is verified safe (see the skills-symlink hazard below) |
| `.rulesync/rules/*.md` | the root rule must become the target's AGENTS.md content (import: `rulesync import --targets <tool> --features rules`) — never ship this repo's GitOps rules into another repo |
| agent MCP rules | the `readonly*`/`admin*`/`global*` prefix rules assume the `<priv>-<cluster>-<service>` server naming; a repo whose servers are named differently needs explicit per-server allow-lists (deny anything that can mutate systems the repo shouldn't touch; unlisted → `ask`) |
| dev context-file rules | re-map the allow/ask/deny table to the target's layout — which dirs are repo context (allow-with-deviation-report), which are agent machinery (ask), which are generated surfaces or registry-managed (deny) |
| agent skill pins | each role's MUST-load list must name skills that exist in the target's registry |
| shell allow-lists | dev/test shell allows = the target's validation commands (this repo: `helm lint/template`) |
| plan templates | `.agents/plans/templates/` copied as-is |

## Skills-symlink hazard (read before enabling the skills feature anywhere)

If the target's tool skills dir is a symlink into a directory holding OTHER tools' skills (here: `.opencode/skills` → `.agents/skills`), `generate --delete` sweeps through it and deletes everything rulesync doesn't own. Replace the symlink with a real directory first; keep the foreign skills discoverable via the tool's own skill-paths config (here: `skills` array in `.opencode/opencode.jsonc`).

## Post-install checklist

1. `git status` in the target — only the expected new files; review and commit (user step).
2. Overlay variants (if you copy a repo that ships them, e.g. `-bmad`) only work if the target has the matching skills installed; otherwise drop the overlay sources or install the overlay's skills first.
3. Target's AGENTS.md must describe the per-ticket plan layout (`.agents/plans/yyyy-mm/<ticket>/` with `FRICTION.md`) — if it still says flat `yyyy-mm-dd-*` plans, update its Plans section (the root rule source, then regenerate).
4. Spot-check one generated agent (`agent-dev` permissions + skill list, `agent-coord` locked-down block) and the `/pipeline` command's STATE lookup against the target's plans layout.
5. Smoke-test: run `/pipeline <tiny request>` and confirm coord reads `templates/`, creates the ticket folder, and the dev/review handoffs land in `STATE.json` (with friction appending to `FRICTION.md`).
