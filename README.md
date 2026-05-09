# OpenCode AgentBoard

**OpenCode AgentBoard: a Beads-powered kanban and dependency graph for coding agents.**

This is an experimental desktop-focused fork of [OpenCode](https://github.com/anomalyco/opencode). It adds AgentBoard, a visual layer for managing agent work with [Beads](https://github.com/Coding-An-AI/beads): board, list, graph, issue details, and chat handoff inside the OpenCode desktop app.

> This fork is not built by, endorsed by, or affiliated with the OpenCode team. It is a prototype for people who want to experiment with agent-oriented project management.

## Run The Desktop App Locally

Requirements:

- [Bun](https://bun.sh)
- Beads `bd` CLI available on `PATH` for projects you want to use with AgentBoard

```bash
git clone <this-fork-url>
cd opencode
bun install
bun run dev:desktop
```

To hide OpenCode's development performance panel:

```bash
VITE_OPENCODE_DEBUG_BAR=false bun run dev:desktop
```

Then:

1. Open a project in the desktop app.
2. Click **AgentBoard** in the project sidebar.
3. If the project does not have Beads set up yet, click **Initialize Beads**.

You can also initialize Beads manually:

```bash
cd /path/to/your/project
bd init
```

## What AgentBoard Does

AgentBoard turns Beads issues into a desktop workspace for coding agents:

- **Board**: kanban columns for Ready, Running, Needs Review, Blocked, and Closed work.
- **List**: a compact scan-friendly view of all issues.
- **Graph**: a zoomable dependency graph with pan, fit, minimap, filters, and manual positioning.
- **Details**: issue metadata, description, blockers, timeline, artifacts, created/updated age, and quick transitions.
- **Chat handoff**: open an OpenCode chat with issue context so a model can work on a specific Beads issue.

Beads remains the source of truth for issues, status, priority, and dependencies. AgentBoard is the UI layer that makes that state easier to use while working with coding agents.

## Why

Chat alone is a weak project memory. Once work spans multiple issues, agents and humans need to see:

- what is ready
- what is blocked
- what needs review
- what depends on what
- what changed recently
- which task should be handed to chat next

AgentBoard explores that workflow directly inside the OpenCode desktop app.

## Relationship To OpenCode

This repository is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). The fork keeps OpenCode's desktop shell and chat experience, then adds AgentBoard as an experiment on top.

Upstream OpenCode:

- Website: [opencode.ai](https://opencode.ai)
- GitHub: [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- Docs: [opencode.ai/docs](https://opencode.ai/docs)

## Status

Early prototype. The desktop flow works, but the UI, graph layout, Beads integration, and review workflow are still being refined.

## License

This fork follows the upstream OpenCode license. See [LICENSE](./LICENSE).
