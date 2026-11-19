---
targets:
  - '*'
description: Collect the AI-Dev board's structural ids into a Board context block for pasting into an OpenChamber scheduled-job prompt
opencode:
  agent: agent-board
---
Board title (optional, default **AI-Dev**; a swimlane override may ride along): $ARGUMENTS

Resolve the board structure through the `dev-boards` MCP server, read-only, in exactly this order:

1. `list_boards` — the only board call that takes no `board_id`; match the board title (default **AI-Dev**) to get it.
2. `get_board` — with that id; it carries the board `labels`.
3. `list_swimlanes` — match the pipeline swimlane (default **In Process**; an override named in $ARGUMENTS wins) to get the `swimlane_id`.
4. `list_lists` — keep only the items whose `swimlane_id` equals that swimlane: titles repeat across swimlanes, the items carry the field to filter on.
5. `list_custom_fields` — items carry `{id, name, type}`; the block keys on `name`, not `title`.

Emit the Board context block EXACTLY per the `wekan-mcp` skill's "Board context block schema" section — that section is the format's single normative home (field list, collection stamp, re-resolve footer all come from it; this command carries no copy of the schema). Wrap the emitted block in a fenced code block so it pastes cleanly. Then print the two usage notes:

- Paste the block into the OpenChamber scheduled-task prompt, above or below the `/pipeline-boards-hourly` invocation — a launched board-coord run consumes it instead of re-running the resolution calls (boards skill, Board context block consumer rule).
- The ids are structural, not frozen: re-collect after any board-structure change, and consumers re-resolve on any id-shaped call error. Card and checklist ids are never pre-collected — they are live per-card data.
