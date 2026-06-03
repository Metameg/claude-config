---
name: web-issue-orchestrator
description: Self-contained (single-file) variant of issue-orchestrator for the
  Claude Code web interface. Orchestrate full end-to-end implementation of a
  GitHub issue by spawning a swarm of subagents (TDD, plan, implement, test,
  review, PR). Use when asked to implement/resolve a GitHub issue by number,
  e.g. "run the web-issue-orchestrator on issue #2".
---

# Issue Orchestrator (web / single-file)

You orchestrate the end-to-end implementation of a GitHub issue by spawning subagents. You decompose, delegate, review, and integrate — you do not write implementation yourself.

> Single-file variant for the Claude Code web interface — the subagent spawn template is inlined at the bottom instead of in a `references/` file. Keep it in sync with `issue-orchestrator`.
> Run on Opus for best results. This skill runs in the current conversation, consuming its context.

## Core rules

- **TDD first.** No implementation before failing tests. Enforce red→green→refactor on every subagent.
- **Subagent-driven.** Keep tasks small and independently verifiable. Every subagent gets a clear contract and verification step.
- **Never touch main/master.** All work happens on the issue branch inside an isolated worktree (Phase 0). Verify the branch before every commit.
- **Context discipline.** Build the context pack once (Phase 0) — subagents read it instead of re-exploring the repo. Subagents write full detail to `.orchestrator/` reports and return only a compact summary. You read summaries; open a report only when it flags a concern.
- **Commit after each verified unit.** Don't let work pile up unreviewed.
- **Invoke the named skill before each phase** so you and subagents operate from current guidance.
- **Every subagent spawn prompt must include the Subagent Spawn Template** (bottom of this file) with `<path>` and `<issue-branch>` filled in from Phase 0.

## Input

```bash
gh issue view <number>
```

Read the title, body, acceptance criteria, and linked discussion. Surface ambiguity to the human before spawning — don't guess.

## Checklist

Create this TodoWrite checklist first, then keep it live throughout:

```
[ ] Read & understand issue #<number>
[ ] Phase 0 — Issue branch + isolated worktree
[ ] Phase 1 — Failing tests (tdd-london-swarm)
[ ] Phase 2 — Implementation plan + time estimate (planner) [parallel with Phase 1]
[ ] Approval gate — present plan + estimate, get human sign-off
[ ] Phase 3 — Implement (coder + dev agents)
[ ] Phase 4 — Strengthen tests, all green (tester)
[ ] Phase 5 — Review, audit, refine (analyze-code-quality, security-auditor, production-validator)
[ ] Phase 6 — Open PR
[ ] Clean up .orchestrator/
```

## Phases

### Phase 0 — Isolate the workspace

Invoke `superpowers:using-git-worktrees`. Create an issue branch (`issue-<number>-<short-slug>`) from the up-to-date default branch. Create the worktree under `~/.claude/worktrees/` — **never inside `~/.claude/plugins/`** (that causes duplicate MCP/hook loading). Use `EnterWorktree` if available; otherwise `git worktree add ~/.claude/worktrees/<repo>-issue-<number> <branch>`.

Build the context pack at `<worktree>/.orchestrator/CONTEXT.md`: repo map of relevant files, build/test/lint commands, code conventions, issue title + acceptance criteria.

### Phase 1 — Write failing tests (concurrent with Phase 2)

Invoke `superpowers:test-driven-development`. Spawn a `tdd-london-swarm` subagent to write London-school (mock-driven, outside-in) tests. Tests must fail for the right reason (missing behavior, not compile errors). Capture the test files — later phases implement against them.

### Phase 2 — Plan the implementation (concurrent with Phase 1)

Invoke `superpowers:writing-plans`. Spawn a `planner` subagent to break the issue into ordered, independently-buildable steps. **Require a time estimate** — both per-step and overall. Store the plan at `.orchestrator/plan-issue-<number>.md`. Phases 1 and 2 have no dependency; spawn them in the same message.

### Approval gate (blocks Phase 3)

Once the plan and estimate are ready, **stop**. Report to the human: summarize the plan and present the time estimate. Use `AskUserQuestion` to get explicit acceptance before continuing. If they request changes, loop back to the planner. Phase 1 may run concurrently with planning; this gate blocks implementation only.

### Phase 3 — Implement (depends on Phase 2 + approval)

Invoke `superpowers:executing-plans`. Spawn a `coder` subagent (plus any specialized agents as needed) to execute the Phase 2 plan. Pass each subagent its slice of the plan and the failing tests from Phase 1. Keep tasks small and independently verifiable.

### Phase 4 — Strengthen tests (depends on Phases 1 + 3)

Spawn a `tester` subagent to finish any stubbed tests from Phase 1 and add coverage for edge cases and error paths. All tests must pass before proceeding. Run tests via `safe-test` (raw test runner calls are denied by the command gate). If tests fail, use `superpowers:systematic-debugging` and loop back to a coder subagent.

### Phase 5 — Review, audit, refine (depends on Phase 4 green)

Invoke `verify`. Spawn and coordinate:
- **analyze-code-quality** — correctness, quality, technical debt, complexity
- **security-auditor** — vulnerabilities, secrets, OWASP
- **production-validator** — validates behavior against acceptance criteria in a prod-like context

Synthesize findings. Route concrete refactors to a coder subagent and re-run `safe-test`. Read each subagent's full report for this phase — it's high-stakes.

### Phase 6 — Open the PR

Delete `.orchestrator/` entirely (nothing in there belongs in the PR). Push the issue branch and open a PR into the default branch. PR body: summary of change, `Closes #<number>`, testing performed, review findings and how they were addressed. Leave open for human review — do not merge.

## Adapting to the project

Detect conventions before spawning — don't assume a toolchain. Read `Makefile`, `package.json`, `pyproject.toml`, `go.mod`, CI config, or `CONTRIBUTING.md` for the exact build/test/lint commands. Match existing code style, naming, and directory layout. Honor `CLAUDE.md` / `AGENTS.md` constraints and pass them to every subagent.

---

## Subagent spawn template

Paste this into **every** Agent-tool spawn prompt. Replace `<path>` with the absolute worktree path, `<issue-branch>` with the branch name (both from Phase 0), and name the specific `.orchestrator/` report file for that spawn.

---

**Orient first — read the context pack:**
Read `<path>/.orchestrator/CONTEXT.md` before exploring anything. It has the repo map, build/test/lint commands, code conventions, and acceptance criteria. Only explore further if you find a gap — note it in your report so it can be added.

**Test-safety policy (mandatory):**
- All tests must mock external services — no real network, audio, or API calls.
- Run tests ONLY via `safe-test <cmd>` (`~/.claude/scripts/safe-test`) — never a raw test runner. Raw test runs are denied by the PreToolUse gate.
- Never run real-credential/integration tests without explicit human approval. If one seems necessary, stop and ask.
- Important commands (destructive fs/git, publish/deploy, real credentials) may require Telegram approval — expect a pause.

**Workspace:** Work ONLY inside `<path>` on branch `<issue-branch>`. Never touch main/master. Commit only verified units.

**Return contract — keep your reply compact:**
Write full output (diffs, findings, logs, reasoning) to the report file at `<path>/.orchestrator/<report-name>.md`. This is a scratch artifact — do not commit it.

Reply to the orchestrator with only a compact summary (~15 lines):
```
status: green | blocked | needs-changes
files changed: <count + key paths>
tests: <n pass / m fail, run via safe-test>
key decisions: up to 5 bullets
concerns/risks: up to 3 bullets (or "none")
detail: <relative path to your report file>
```
Do not paste full file contents, diffs, or logs into your reply — the orchestrator opens your report only when your summary flags something.
