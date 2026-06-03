# Claude Code Configuration

## File Organization

- NEVER save to root folder — use the directories below
- Use `/src` for source code files
- Use `/tests` for test files
- Use `/docs` for documentation and markdown files
- Use `/config` for configuration files
- Use `/scripts` for utility scripts
- Use `/examples` for example code

## Project Architecture

- Follow Domain-Driven Design with bounded contexts
- Keep files under 500 lines
- Use typed interfaces for all public APIs
- Prefer TDD London School (mock-first) for new code
- Use event sourcing for state changes

## Concurrency

- Run all independent operations in parallel in a single message
- Batch all file reads/writes/edits in one message when possible
- Batch all Bash commands in one message when possible

## Model Routing

| Tier | Model | Use Cases |
|------|-------|-----------|
| **1** | *(no agent)* | Trivial edits (rename, add type, fix typo) — use Edit tool directly |
| **2** | Haiku | Simple, well-defined, single-file tasks |
| **3** | Sonnet/Opus | Complex reasoning, multi-file, architecture, security |

Before spawning any subagent, assess complexity and pass the correct `model` parameter. The model is locked at spawn time.

- **Skip agent**: single-line change, rename, fix typo
- **Haiku**: format, add comment, simple single-file change
- **Sonnet**: implement feature, write tests, debug, multi-file changes
- **Opus**: security audit, architecture design, codebase-wide refactor

Default to `sonnet` if complexity is unclear.
