---
targets:
  - '*'
description: Resume an approved plan with the coordinator only
opencode:
  agent: agent-coord
---
Resume the approved plan in feature folder: $ARGUMENTS
If no folder is given, list the feature folders that contain a STATE.json and ask the user which one to resume.

!`state=$(find .agents/plans -mindepth 2 -maxdepth 3 -name STATE.json 2>/dev/null); if [ -z "$state" ]; then echo "no plan yet"; else for f in $state; do echo "== $f"; cat "$f"; done; fi`

Pick the next ready chunk and continue the pipeline.

For runs that push the branch to be built/tested remotely, use `/pipeline-pr`.
