---
name: issue-orchestrator
description: Orchestrate full end-to-end implementation of a GitHub issue by
  spawning a swarm of subagents (TDD, plan, implement, test, review, PR). Use
  when asked to implement/resolve a GitHub issue by number, e.g. "run the
  issue-orchestrator on issue #2".
---

# Issue Orchestrator

You, the **main agent**, orchestrate the end-to-end implementation of one GitHub
issue by **spawning subagents with the Agent tool**. You do not write
implementation yourself — you decompose, delegate, review, and integrate.

> Run this on Opus for best orchestration. Running as a skill executes in THIS
> conversation (consuming its context) — that is the cost of real spawn power.

## Operating Principles

- **Test-driven first.** Follow the `superpowers:test-driven-development` skill. No implementation code is written before there is a failing test that describes the desired behavior. Invoke this skill before kicking off the swarm so you internalize the red→green→refactor discipline you will enforce on subagents.
- **Subagent-driven execution.** Every implementation subagent follows the `superpowers:subagent-driven-development` approach — small, independently-verifiable tasks with a clear contract and verification step.
- **Swarm coordination.** Invoke the `swarm-orchestration` skill to manage topology, parallelism, and inter-agent communication. Be deliberate about what runs in parallel vs. what has a hard dependency.
- **You are the integrator.** After each subagent finishes, review its work, run the relevant checks, and make a focused git commit. Never let work pile up unreviewed.
- **Isolated workspace, always.** Every orchestrator run operates in its own working directory on its own issue branch. You **never** do work, and **never** commit, on `main`/`master`. This isolation is your responsibility to set up before any other phase (see Phase 0).
- **Skill-first.** Before each phase, invoke the skill named for that phase so both you and the subagents operate from current guidance.
- **Context discipline (your biggest cost lever).** Your own context grows monotonically and is re-billed every turn, so most of the run's cost is yours. Push token-heavy work into subagents' disposable contexts: build the context pack once (Phase 0) so subagents orient from one file instead of each re-exploring the repo, and require every subagent to write full detail to an `.orchestrator/` report and return only a compact summary. You read summaries and open a report **only** when one flags a concern. Keep your reply-reading and re-exploration minimal.

## Inputs

This skill takes **two** GitHub issue numbers:

1. **Implementation issue** — the specific slice to build end-to-end (e.g. `#4`).
2. **PRD / parent issue** — the product-requirements doc the slice belongs to (e.g. `#1`). The implementation issue usually names it under a `## Parent` heading, and the invoking user prompt should include it explicitly.

### Verification gate — confirm BOTH issue numbers first (blocks everything else)

Before reading anything or starting Phase 0, **immediately use `AskUserQuestion` to make the human confirm both numbers.** Do not assume, infer-and-proceed, or skip this even when both numbers appear in the prompt — this gate is mandatory and comes before every other step. Present your best guess for each (parsed from the prompt, and from the implementation issue's `## Parent` link) as the recommended option, and require explicit confirmation of:

- **Implementation issue to build** — "#\<n\> — correct?"
- **PRD / parent issue for context** — "#\<m\> — correct?"

Only after the human confirms (or corrects) both numbers do you read either issue or begin Phase 0. If either number is wrong or missing, get the right one before proceeding.

Once both are confirmed, read them:

```bash
gh issue view <impl-number>   # the slice to implement
gh issue view <prd-number>    # the PRD — for YOUR context only, not the subagent context pack
```

Capture the implementation issue's title, body, acceptance criteria, and any linked discussion, plus a summary of the PRD (problem statement, relevant user stories, and the architecture/implementation decisions bearing on this slice). If either issue is ambiguous or under-specified, surface the ambiguity to the human before spawning the swarm rather than guessing.

## Process

Run the following phases. **Before doing anything else, create a TodoWrite checklist** so the human can watch progress in real time, then mark each item `in_progress` when you start it and `completed` when it is verified. Use this checklist as your spine:

```
[ ] Verify issue numbers — confirm implementation #<n> AND PRD/parent #<m> with the human (AskUserQuestion) before anything else
[ ] Read & understand implementation issue #<n> + summarize PRD #<m>
[ ] Phase 0 — Create issue branch + isolated worktree (never main/master)
[ ] Phase 1 — Write failing tests (tdd-london-swarm)
[ ] Phase 2 — Devise implementation plan (planner)
[ ] Phase 3 — Implement the plan (coder + dev agents)
[ ] Phase 4 — Strengthen test suite, all tests green (tester)
[ ] Phase 5 — Review, audit, refine (reviewer, code-analyzer, security-auditor)
[ ] Phase 6 — Open PR for human review
[ ] Update PRD #<m> dependency graph to reflect this slice's new status
[ ] Clean up temp plan/scratch files
```

Keep the checklist current at every step — it is the human's window into the swarm's progress. Add sub-items as phases fan out into multiple subagent tasks.

### Phase 0 — Isolate the workspace (do this first, always)

Before spawning any subagent, set up a dedicated, isolated workspace so this run never touches `main`/`master` and never collides with other orchestrator runs. Invoke `superpowers:using-git-worktrees`.

- **Create an issue branch whose name contains the issue number**, following any branch-naming convention the repo already uses. A good default is `issue-<number>-<short-slug>` (e.g. `issue-2-add-retry-logic`), branched from the up-to-date default branch.
- **Create a separate working directory (git worktree) in a dedicated worktrees directory — NEVER inside `~/.claude/plugins/`.** Putting a worktree under the plugins folder makes Claude Code try to load it as a duplicate plugin (duplicate MCP server, duplicate hooks). Prefer the `EnterWorktree` tool if available. If falling back to raw git, create it under `~/.claude/worktrees/`, e.g. `git worktree add ~/.claude/worktrees/<repo>-issue-<number> issue-<number>-<short-slug>` (create `~/.claude/worktrees/` first if needed). Run the entire rest of the process from inside the worktree. If worktrees are not usable in this environment, at minimum check out the new branch locally.
- **Refuse to proceed on `main`/`master`.** Verify the current branch before any commit. If you ever find yourself on the default branch, stop and create/switch to the issue branch first.
- All subagents you spawn must operate inside this same worktree, and every commit lands on the issue branch — never the default branch.
- **Build the context pack once.** Before spawning any subagent, create `<worktree>/.orchestrator/CONTEXT.md` containing: a concise repo map (the directories and files relevant to this issue), the project's build/test/lint commands (discovered per "Adapting to the target project"), the code conventions to match, and the issue's title + acceptance criteria. Every subagent reads this to orient instead of re-exploring the codebase from scratch — across a full run that removes the same rediscovery being paid 8+ times. Keep it concise but sufficient; update it if a later phase uncovers something every subagent should know. **The PRD / parent-issue summary stays in *your* (the orchestrator's) context only — do NOT add it to the context pack.** Subagents work from the slice's acceptance criteria; you hold the wider product context and translate it into the per-task instructions you give them.
- **Every subagent spawn prompt MUST include the contents of `references/spawn-template.md`** with `<path>` filled in with the absolute worktree path and `<issue-branch>` filled in with the branch name established in this phase. The template directs each subagent to read the context pack first and to return a compact summary while writing full detail to an `.orchestrator/` report — so for each spawn, name the specific report file the subagent should write to (e.g. `.orchestrator/phase4-tester-report.md`).

### Phase 1 — Write failing tests (TDD)

Invoke `superpowers:test-driven-development`. Use the **Agent tool** to spawn a `tdd-london-swarm` subagent to implement London-school (mock-driven, outside-in) tests describing the behavior required by the issue.

- These tests should fail for the right reason (behavior missing, not compile error noise).
- Capture the test files produced so later phases know what contract to satisfy.
- Include the spawn-template (from `references/spawn-template.md`, with `<path>` and `<issue-branch>` filled in) in this subagent's prompt.

### Phase 2 — Plan the implementation (concurrent with Phase 1)

Invoke `superpowers:writing-plans`. Use the **Agent tool** to spawn a `planner` subagent to break the issue into ordered, independently-buildable implementation steps.

- Store generated plans in temporary markdown files (e.g. `.orchestrator/plan-issue-<number>.md`). These are scratch artifacts — delete them once implementation is finished.
- Phases 1 and 2 have no dependency on each other; spawn them in the same message so they run in parallel.
- Include the spawn-template (from `references/spawn-template.md`, with `<path>` and `<issue-branch>` filled in) in this subagent's prompt.

### Phase 3 — Implement the plan (depends on Phase 2)

Invoke `superpowers:executing-plans`. Use the **Agent tool** to spawn a `coder` subagent — plus any specialized subagents under the development agents directory (e.g. `backend-dev`/`dev-backend-api`) as the task warrants — to execute the temp plans from Phase 2.

- Pass each implementation subagent the relevant slice of the plan and make them explicitly aware of the `superpowers:executing-plans` skill and the failing tests from Phase 1.
- Keep tasks small and independently verifiable per subagent-driven development.
- **Every subagent spawn prompt MUST include the contents of `references/spawn-template.md`** with `<path>` and `<issue-branch>` filled in from Phase 0. This ensures all implementation subagents operate in the correct worktree, never on `main`/`master`, and follow the test-safety policy.

### Phase 4 — Strengthen the test suite (depends on Phases 1 and 3)

Once implementation (Phase 3) and the initial tests (Phase 1) are both complete, use the **Agent tool** to spawn a `tester` subagent to:

- Finish any unimplemented or stubbed tests left from Phase 1.
- Add coverage for edge cases, error paths, and integration seams the initial London tests did not exercise.

Do not proceed until **all** tests written through this phase pass. Tests MUST be run via `safe-test` (the command-gate hook enforces this — raw test runner calls will be denied). If tests fail, treat it as a debugging task (`superpowers:systematic-debugging`) and loop the failing slice back to a coder subagent.

Include the spawn-template (from `references/spawn-template.md`, with `<path>` and `<issue-branch>` filled in) in this subagent's prompt.

### Phase 5 — Review, audit, and refine (depends on Phase 4 green)

This is the highest-bandwidth phase and demands careful reading of every subagent's context and response. Invoke the `verify` skill so subagents validate behavior against the issue's acceptance criteria. Use the **Agent tool** to spawn, and coordinate among:

- **reviewer** — correctness, maintainability, adherence to the issue.
- **code-analyzer** — code quality, technical debt, complexity hot-spots.
- **security-auditor** — vulnerability detection, secret scanning, dependency and OWASP concerns.

Synthesize their findings. Where they disagree or raise non-trivial concerns, reconcile carefully rather than rubber-stamping. Route concrete refactors back to a coder subagent, then re-run the suite via `safe-test` to confirm everything still passes.

Include the spawn-template (from `references/spawn-template.md`, with `<path>` and `<issue-branch>` filled in) in each subagent's prompt.

### Phase 6 — Open the pull request

When all phases are complete, tests are green, and reviews are clear:

- Delete the entire `.orchestrator/` scratch directory (the Phase 2 plans, the `CONTEXT.md` context pack, and every subagent report). None of it belongs in the PR. Confirm nothing under `.orchestrator/` is tracked/committed before pushing.
- Push the issue branch and use the relevant GitHub skill (`github-project-management` / `github-code-review`, or `gh pr create`) to open a pull request **from the issue branch into the default branch**.
- The PR body should summarize the change, link the issue (`Closes #<number>`), describe the testing performed, and note any review/audit findings and how they were addressed.
- Leave the PR open for **human review** — do not merge.
- **Update the PRD's dependency graph.** Once the PR is open, edit the PRD / parent issue (`#<m>`, confirmed in the verification gate) so its dependency graph reflects this slice's new status — mark the implemented issue's node as PR-open / in-review (and any downstream issues it unblocks accordingly). Fetch the current body (`gh issue view <m> --json body -q .body`), update the graph section, and write it back (`gh issue edit <m> --body-file ...`). Preserve the rest of the PRD body untouched. If the PRD has no dependency-graph section yet, skip this step rather than inventing one.

## Your Responsibilities as Orchestrator

- **Review every subagent's summary** before acting on it. Read the whole compact summary — do not skim it — and open its `.orchestrator/` report when the summary flags a concern, is inconsistent, reports `blocked`/`needs-changes`, or the phase is high-stakes (the Phase 5 review/audit, where reading the full report is warranted). If a subagent's result is incomplete, inconsistent, or wrong, send it back with specifics rather than papering over it. Do not ask subagents to paste full diffs or logs into their replies — pull that detail from the branch or the report only when you actually need it.
- **Commit after each subagent finishes** a verified unit of work, using focused, well-described commits — always on the issue branch inside the isolated worktree (Phase 0), never on `main`/`master`.
- **Respect dependencies**: Phase 3 waits on Phase 2; Phase 4 waits on Phases 1 and 3; Phase 5 waits on Phase 4 being green. Phases 1 and 2 run concurrently.
- **Maintain the TodoWrite checklist** continuously so the human always has a live view of which phase is in progress.
- **Communicate** progress, blockers, and decisions back to the human throughout.
- **Verify before claiming done** — run the actual commands and confirm output before asserting any phase is complete.

## Adapting to the target project

This skill is project-agnostic. Before spawning the swarm, detect the project's conventions instead of assuming any language or toolchain:

- Discover the build/test/lint commands from the project itself — `Makefile`, `package.json` scripts, `pyproject.toml`, `Cargo.toml`, `go.mod`, CI config, or a `CONTRIBUTING.md`. Use those exact commands for verification in every phase (always via `safe-test` for any test invocations).
- Match the existing code: language, framework, test runner, directory layout, and naming. New tests and code should look like they were written by the project's existing authors.
- Honor any `CLAUDE.md` / `AGENTS.md` / contributor guidelines in the repo (file-size limits, directory rules, model-routing, commit conventions) and pass the relevant constraints to each subagent you spawn.
