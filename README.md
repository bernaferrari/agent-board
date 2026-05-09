# OpenCode AgentBoard

<p align="center">
  <img src="assets/header.png" alt="OpenCode AgentBoard" width="100%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-experimental_preview-8b5cf6" alt="Experimental Preview">
  <img src="https://img.shields.io/badge/runtime-Electron-47848f" alt="Electron">
  <img src="https://img.shields.io/badge/issues-Beads-8b5cf6" alt="Beads">
  <img src="https://img.shields.io/badge/fork-OpenCode-blue" alt="OpenCode Fork">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License">
</p>

**A visual workspace for coding models.**

OpenCode AgentBoard is an experimental fork of [OpenCode](https://github.com/anomalyco/opencode) that turns [Beads](https://github.com/steveyegge/beads) issues into a desktop workspace for planning, reviewing, and handing work to chat.

Instead of keeping every task in a long conversation, AgentBoard gives you three views of the same local issue graph:

- **Board** for flow: ready, running, review, blocked, closed
- **List** for scanning a large backlog quickly
- **Graph** for understanding dependencies before asking a model to work

> This fork is not built by, endorsed by, or affiliated with the OpenCode team.

## Why This Exists

Chat is good for execution. It is not always good for seeing the whole project.

When a codebase has dozens or hundreds of tasks, you need to know:

- what is ready to work on
- what is blocked by dependencies
- what changed recently
- what needs human review
- which task should be handed to a model next

AgentBoard keeps that work in Beads, then gives both you and the model a shared visual surface on top of it.

## Features

- **Kanban board** — Ready, Running, Needs Review, Blocked, and Closed columns backed by Beads
- **Dependency graph** — Zoomable graph with pan, fit, minimap, filters, manual positioning, and readable dependency arrows
- **List view** — A dense, clean way to scan issues without moving cards around
- **Issue drawer** — Status, priority, blockers, description, created/updated age, timeline, artifacts, and quick transitions
- **Chat handoff** — Open an OpenCode chat with the selected Beads issue already attached
- **Issue creation** — Create Beads issues from the bottom composer, optionally continuing in chat
- **Beads setup flow** — Initialize Beads from the UI or use an existing `.beads` database
- **Local-first state** — Beads remains the source of truth for issue content, status, priority, and dependencies

## Run Locally

Requirements:

- [Bun](https://bun.sh)
- Beads `bd` CLI on your `PATH`

```bash
git clone https://github.com/bernaferrari/opencode-agentboard
cd opencode-agentboard
bun install
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

Beads docs: [github.com/steveyegge/beads](https://github.com/steveyegge/beads)

Tip: `npx skills beads` teaches any model to use Beads.

## What Works Today

- Load Beads issues into Board, List, and Graph views
- Create issues from the AgentBoard composer
- Move issues across board columns and persist status back to Beads
- Reorder cards and board sections locally
- Inspect blockers and related issues from the drawer
- See timeline and artifact counts when available
- Open a chat with issue context attached
- Persist graph node positions and use fit/minimap controls

## Status

This is an experimental preview. The core desktop loop works today, but the graph layout, deeper automation, packaging, and release polish are still evolving.

The goal is to explore a simple idea: coding models should not only live in chat. They should also share a task board, dependency graph, and review surface with the human.

## Origin

AgentBoard started after studying several agent-orchestration interfaces:

- [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/) for orchestration architecture ideas
- Cursor-style kanban workflows for the interaction model
- Beads UI for a Beads-native baseline
- OpenCode for the desktop shell, project model, and chat runtime

The rough direction was: build a Symphony-inspired workflow with a Cursor-inspired interface on top of OpenCode, using Beads as the issue substrate. The app was then iterated manually with Codex: board first, then graph, then list.

## Relationship To OpenCode

This repository is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode). It keeps OpenCode's desktop shell and chat experience, then adds AgentBoard as an experiment on top.

Upstream OpenCode:

- Website: [opencode.ai](https://opencode.ai)
- GitHub: [github.com/anomalyco/opencode](https://github.com/anomalyco/opencode)
- Docs: [opencode.ai/docs](https://opencode.ai/docs)

## License

MIT. See [LICENSE](./LICENSE).
