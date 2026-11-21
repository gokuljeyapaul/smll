# Runners

postclip is built by a **building agent** on a Linux machine. The plan (`docs/BUILD_PLAN.md`) and the rules (`AGENTS.md`) are runner-neutral. Only mechanics that differ per runner live here:

| Runner | Doc |
|---|---|
| Hermes on openclawlaunch (Linux container) | [hermes.md](hermes.md) |
| Claude Code on the web (claude.ai/code cloud session) | [claude-code-web.md](claude-code-web.md) |

Read the doc for the runner you are actually in. If a runner doc ever conflicts with `AGENTS.md` hard rules or the plan, `AGENTS.md` and the plan win and you stop and report. Runner docs never relax a test, an evidence rule or a stop condition.

Adding a runner = adding one file here; nothing else in the project changes.
