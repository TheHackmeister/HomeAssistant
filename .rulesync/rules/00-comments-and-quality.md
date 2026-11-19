---
root: true
targets:
  - '*'
description: "Comment policy and quality gate"
globs:
  - '**/*'
---

# Comments and code quality

- Comments explain **why** (constraints, invariants, trade-offs, links to issues). Never restate what the code does, narrate history ("now we…", "updated to…"), or describe planned work.
- When writing or editing comments/docstrings, or before handing back a change, apply the `comment-slop` skill (rulesync-managed, vendored from `dashed/claude-marketplace`). It auto-selects when comment work is in scope.
- Before claiming work done, paste the validation output as evidence — the grep/YAML-sanity checks and `rulesync generate --check` per the root AGENTS.md Commands — never say "should work" or "all green" without it.
- The cf-93 port deliberately does NOT carry SpencersLab's `aislop` skill, `aislop-gate` plugin or CI gate into this repo (their CI does not run `aislop ci`); a future card decides whether to adopt them.
