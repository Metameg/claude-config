---
name: issue-orchestrator
description: Orchestrate full end-to-end implementation of a GitHub issue by
  spawning a swarm of subagents (TDD, plan, implement, test, review, PR). Use
  when asked to implement/resolve a GitHub issue by number, e.g. "run the
  issue-orchestrator on issue #2".
---

# Issue Orchestrator

You orchestrate the end-to-end implementation of a GitHub issue by spawning subagents. You decompose, delegate, review, and integrate — you do not write implementation yourself.

> Run on Opus for best results. This skill runs in the current conversation, consuming its context.

## Core rules

- **TDD first.** No implementation before failing tests. Enforce red→green→refactor on every subagent.
- **Subagent-driven.** Keep tasks small and independently verifiable. Every subagent gets a clear contract and verification step.
- **Never touch main/master.** All work happens on the issue branch inside an isolated worktree (Phase 0). Verify the branch before every commit.
- **Context discipline.** Build the context pack once (Phase 0) — subagents read it instead of re-exploring the repo. Subagents write full detail to `.orchestrator/` reports and return only a compact summary. You read summaries; open a report only when it flags a concern.
- **Commit after each verified unit.** Don't let work pile up unreviewed.
- **Invoke the named skill before each phase** so you and subagents operate from current guidance.
- **Every subagent spawn prompt must include `references/spawn-template.md`** with `<path>` and `<issue-branch>` filled in from Phase 0.

## Inputs — confirm BOTH issue numbers first

This skill requires two issue numbers:
1. **Implementation issue** — the slice to build (e.g. `#4`)
2. **PRD / parent issue** — the product requirements doc it belongs to (e.g. `#1`)

**Before reading anything**, use `AskUserQuestion` to confirm both numbers (present your best guess from the prompt as the default). Do not proceed until both are explicitly confirmed.

Once confirmed:
```bash
gh issue view <impl-number>   # slice to implement
gh issue view <prd-number>    # PRD — stays in YOUR context only, not the context pack
```

Surface any ambiguity to the human before spawning — don't guess.

## Checklist

Create this TodoWrite checklist first, then keep it live throughout:

```
[ ] Confirm implementation #<n> AND PRD #<m> with human (AskUserQuestion)
[ ] Read implementation issue + summarize PRD
[ ] Phase 0 — Issue branch + isolated worktree
[ ] Phase 1 — Failing tests (tdd-london-swarm)
[ ] Phase 2 — Implementation plan (planner) [parallel with Phase 1]
[ ] Phase 3 — Implement (coder + dev agents)
[ ] Phase 4 — Strengthen tests, all green (tester)
[ ] Phase 5 — Review, audit, refine (analyze-code-quality, security-auditor, production-validator)
[ ] Phase 6 — Open PR
[ ] Update PRD #<m> dependency graph
[ ] Clean up .orchestrator/
```

## Phases

### Phase 0 — Isolate the workspace

Invoke `superpowers:using-git-worktrees`. Create an issue branch (`issue-<number>-<short-slug>`) from the up-to-date default branch. Create the worktree under `~/.claude/worktrees/` — **never inside `~/.claude/plugins/`** (that causes duplicate MCP/hook loading). Use `EnterWorktree` if available; otherwise `git worktree add ~/.claude/worktrees/<repo>-issue-<number> <branch>`.

Build the context pack at `<worktree>/.orchestrator/CONTEXT.md`: repo map of relevant files, build/test/lint commands, code conventions, issue title + acceptance criteria. Keep the PRD summary in your context only — subagents work from the slice's acceptance criteria.

### Phase 1 — Write failing tests (concurrent with Phase 2)

Invoke `superpowers:test-driven-development`. Spawn a `tdd-london-swarm` subagent to write London-school (mock-driven, outside-in) tests. Tests must fail for the right reason (missing behavior, not compile errors). Capture the test files — later phases implement against them.

### Phase 2 — Plan the implementation (concurrent with Phase 1)

Invoke `superpowers:writing-plans`. Spawn a `planner` subagent to break the issue into ordered, independently-buildable steps. Store the plan at `.orchestrator/plan-issue-<number>.md` (scratch — deleted before PR). Phases 1 and 2 have no dependency; spawn them in the same message.

### Phase 3 — Implement (depends on Phase 2)

Invoke `superpowers:executing-plans`. Spawn a `coder` subagent (plus any specialized agents as needed) to execute the Phase 2 plan. Pass each subagent its slice of the plan and the failing tests from Phase 1. Keep tasks small and independently verifiable.

### Phase 4 — Strengthen tests (depends on Phases 1 + 3)

Spawn two subagents in parallel:
- **`tester`** — finish any stubbed tests from Phase 1 and add coverage for edge cases and error paths
- **`backend-contract-tester`** — audit data-contract gaps: fields that fetch functions don't return but downstream code reads, and test fixtures that hand-craft data instead of flowing through the real API layer

Both must complete green before proceeding. Run tests via `safe-test` (raw test runner calls are denied by the command gate). If tests fail, use `superpowers:systematic-debugging` and loop back to a coder subagent.

### Phase 5 — Review, audit, refine (depends on Phase 4 green)

Invoke `verify`. Spawn and coordinate:
- **analyze-code-quality** — correctness, quality, technical debt, complexity
- **security-auditor** — vulnerabilities, secrets, OWASP
- **production-validator** — validates behavior against acceptance criteria in a prod-like context

Synthesize findings. Route concrete refactors to a coder subagent and re-run `safe-test`. Read each subagent's full report for this phase — it's high-stakes.

### Phase 6 — Open the PR

Delete `.orchestrator/` entirely (plans, context pack, all reports — nothing in there belongs in the PR). Push the issue branch and open a PR into the default branch. PR body: summary of change, `Closes #<number>`, testing performed, review findings and how they were addressed. Leave open for human review — do not merge.

Update the PRD's dependency graph: mark this slice as PR-open in issue `#<m>`. Fetch the current body (`gh issue view <m> --json body -q .body`), update only the dependency-graph section, write it back. Skip if the PRD has no dependency graph.

## Adapting to the project

Detect conventions before spawning — don't assume a toolchain. Read `Makefile`, `package.json`, `pyproject.toml`, `go.mod`, CI config, or `CONTRIBUTING.md` for the exact build/test/lint commands. Match existing code style, naming, and directory layout. Honor `CLAUDE.md` / `AGENTS.md` constraints and pass them to every subagent.
