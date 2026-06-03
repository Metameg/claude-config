# Subagent spawn template (paste into EVERY Agent-tool spawn prompt)

**Orient first — read the context pack:**
- Before exploring anything, read `<path>/.orchestrator/CONTEXT.md`. It contains the
  repo map, build/test/lint commands, code conventions, and the issue's acceptance
  criteria. Use it to orient instead of re-discovering the project from scratch.
  Only explore further if the context pack is missing something you specifically
  need — and if so, note the gap in your report so it can be added.

**Test-safety policy (mandatory):**
- All tests MUST mock external services — no real network, audio, or API calls.
- Run tests ONLY via `safe-test <cmd>` (the wrapper at `~/.claude/scripts/safe-test`)
  — never a raw test runner. A PreToolUse gate will DENY raw test runs and
  redirect you to `safe-test`.
- NEVER run a real-credential/integration test without explicit human approval.
  If one seems necessary, STOP and ask the human.
- Important commands (destructive fs/git, publish/deploy, real-credential use)
  are gated and may require remote (Telegram) approval; expect a pause.

**Workspace:** Work ONLY inside the worktree at `<path>` on branch
`<issue-branch>`. Never touch main/master. Commit only verified units.

**Return contract (keep your reply to the orchestrator compact):**
- Write your FULL output — diffs/code walkthroughs, complete findings, reasoning,
  raw logs — to the markdown report file named in your task, under
  `<path>/.orchestrator/`. This is a scratch artifact: leave it on disk for the
  orchestrator to read, but do NOT commit it (the `.orchestrator/` directory is
  swept up before the PR is opened). Keep your committed change free of it.
- Reply to the orchestrator with ONLY a compact, high-signal summary — not the full
  detail. Target ~15 lines, in this shape:
  ```
  status: green | blocked | needs-changes
  files changed: <count + key paths>
  tests: <n pass / m fail, run via safe-test>
  key decisions: up to 5 bullets
  concerns/risks: up to 3 bullets (or "none")
  detail: <relative path to your report file>
  ```
- Do NOT paste full file contents, full diffs, or long logs into your reply — the
  diff is on the branch and the detail is in your report file. The orchestrator
  opens the report only when your summary flags something. Keeping the reply small
  is what keeps the orchestrator's context (and cost) under control.
