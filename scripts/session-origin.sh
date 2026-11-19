#!/usr/bin/env bash
# session-origin.sh — the sanctioned resolution leg for a board run whose
# /pipeline-boards* command never expanded, leaving the launch with no
# `Session origin:` line (cf-52 FRICTION line 8). The user ruling DECISIONS
# D10 records makes this script, behind a scoped `bash scripts/session-origin.sh*`
# shell grant on both coordinator variants, the approved channel — running
# it once formalizes the ad-hoc derivation cf-52 improvised, so no agent
# ever re-derives an origin host from memory again.
#
# Verdict contract (D12): exactly ONE line on stdout, in the command block's
# vocabulary. The verdict is the LINE, never the exit code — resolved AND
# degraded verdicts exit 0, because UNRESOLVED must never block the run: the
# board flow already owns the raw-session-id posture (D23-r2) for every
# UNRESOLVED, command-block or script alike. Exit 1 happens only on caller
# misuse, and the mis-call still degrades on the line instead of stalling
# the claim:
#   Session origin: <base>                                            resolved
#   Session origin: UNRESOLVED (no Coder app-origin env)              env absent
#   Session origin: UNRESOLVED (unexpected VSCODE_PROXY_URI shape)    template gone
#   Session origin: UNRESOLVED (derived host answered <code>)         probe out of
#                                                                     recognition
#   Session origin: UNRESOLVED (script misuse: unexpected arguments)  exit 1
#
# The if-chain below is the command block's shell logic copied VERBATIM: this
# file is the 5th copy of that derivation+probe (D12) and tests/session-
# origin/script.sh check b6 pins every shared fragment byte-identical across
# this script and the four command files — a future command-block edit that
# skips this script lands red, and one canonical mechanism stays five pinned
# surfaces. The casing rule is D13's ruling: the emitted base is the block's
# lowercased canonical form, so every resolution leg of one run carries ONE
# origin spelling (a per-env casing would fork it).
#
# Posture: no credentials in output — the raw $VSCODE_PROXY_URI never appears
# in any branch's line, only the derived canonical base or a reason token —
# and one bounded curl, no retry. D16: no test seam and no env-driven
# behavior beyond $VSCODE_PROXY_URI itself; an injectable probe answer would
# be a forgery surface the command block never had, so the behavior suite
# drives the shipped path through env injection and loopback listeners.

set -euo pipefail

# Refusal precedes the derive+probe path: the grant is a whole-string shell
# matcher that admits argument-suffixed command strings, so containment lives
# here — an argument-suffixed call must not spend the bounded curl the real
# verdict needs.
if [ "$#" -ne 0 ]; then
  printf 'Session origin: UNRESOLVED (script misuse: unexpected arguments)\n'
  exit 1
fi

if [ -z "${VSCODE_PROXY_URI:-}" ]; then printf 'Session origin: UNRESOLVED (no Coder app-origin env)\n'; elif printf '%s\n' "$VSCODE_PROXY_URI" | grep -qF '{{port}}'; then b=$(printf '%s\n' "$VSCODE_PROXY_URI" | sed 's/{{port}}/openchamber/' | tr 'A-Z' 'a-z'); c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$b/" || true); case "$c" in 200|301|302|303|401|403) printf 'Session origin: %s\n' "$b";; *) printf 'Session origin: UNRESOLVED (derived host answered %s)\n' "$c";; esac; else printf 'Session origin: UNRESOLVED (unexpected VSCODE_PROXY_URI shape)\n'; fi
