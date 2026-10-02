# AgentBoard for ChatGPT desktop

AgentBoard brings your local [Beads](https://github.com/steveyegge/beads) issues into ChatGPT desktop. Plan work, inspect dependencies, attach an issue to chat, or hand it to a new ChatGPT conversation.

The plugin has three synchronized views: **Board**, **List**, and **Graph**. Beads owns issue status, priority, notes and dependencies. ChatGPT owns conversations and model execution. The plugin runs locally over stdio and requires no API key, OpenCode server, Electron shell or hosted service.

## Install locally

Requires Bun 1.3.13 or newer, Beads 0.62 or newer with its Dolt runtime, and ChatGPT desktop in a local execution environment.

```sh
bun install
bun run build
codex plugin marketplace add .
codex plugin add agent-board@agentboard-desktop
```

The `codex` command is the desktop host's plugin management CLI. The portable plugin is in `plugins/agent-board`; `.agents/plugins/marketplace.json` makes it discoverable from this repository. Restart the desktop app if the new plugin does not appear in the Plugins Directory. Open **AgentBoard Workspace** from the plugin's navigation or chat entrypoint. Select a local folder containing `.beads`, or invoke the plugin's setup skill to initialize one.

For a private portable archive:

```sh
bun run package
```

This writes `releases/agent-board-0.1.0.zip`, including the bundled server, self-contained HTML, manifests, icon, license and workflow skills. The archive needs no dependency installation after extraction; Bun and Beads remain host prerequisites. Use the local plugin installation flow for stdio packages. Account upload by itself cannot provide a local runtime to web or mobile clients.

## Work with a project

- **Create** issues with acceptance criteria, type and priority. **Plan in ChatGPT** sends the goal to a new chat for discussion.
- **Move** cards through Open → In Progress → Needs Review → Closed by dragging or using the issue drawer's status selector. Unresolved blockers prevent starting work.
- **Inspect** descriptions, dependencies, notes and timestamps in the drawer. Add or remove prerequisites there.
- **Attach to chat** supplies issue context without sending a message. **Work in new chat** uses ChatGPT's message extension and sends the handoff prompt when clicked. The new chat verifies the local project before implementation.
- **Graph** shows prerequisites pointing to dependents. Scroll to pan, change zoom, drag nodes, and retain the saved layout across restarts.
- Changes made through `bd` are picked up by Refresh or the visible board's 15-second refresh.

Needs Review is represented by the `agentboard:review` label on a Beads `in_progress` issue. Moving to another column removes that label. This keeps the workflow compatible with Beads' standard statuses. Completion is explicit; the plugin does not infer success from a chat ending.

## Development and verification

```sh
cd packages/agentboard
bun typecheck
bun test
bun run build
AGENTBOARD_PROJECT_DIRECTORY=/absolute/path/to/project bun run preview
```

The preview uses the official MCP Apps `AppBridge` with the real MCP server and Beads. It runs only on loopback, is a development test host, and is excluded from the plugin archive. `bun run dev` exposes the UI build for development, but the UI needs an MCP Apps host to connect.

The integration suite creates an isolated temporary Beads tracker, exercises issue/dependency mutations through MCP, verifies status projections and layout persistence, and stops its test Dolt server afterward. UI verification uses the same preview test host and the browser checks documented below. Actual desktop entrypoint placement and new-chat creation must also be checked in ChatGPT desktop; browser-host verification alone does not establish those behaviors.

See [architecture and migration](docs/architecture.md) for the local runtime boundaries and the source transformation, and [desktop verification](docs/desktop-verification.md) for the host checks.

## Source layout

```text
packages/agentboard/          MCP server, Beads adapter, Solid UI and integration tests
plugins/agent-board/          Portable ChatGPT plugin and workflow skills
.agents/plugins/             Local marketplace definition
releases/                    Generated private plugin archive
```

This transformation is on `chatgpt-plugin`. The original OpenCode-based app remains in the `agent-board` branch and Git history. The MIT attribution is preserved.
