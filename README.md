# AgentBoard for ChatGPT desktop

AgentBoard brings your local [Beads](https://github.com/steveyegge/beads) issues into ChatGPT desktop. Plan work, inspect dependencies, attach an issue to chat, or hand it to a new ChatGPT conversation.

The plugin has three synchronized views: **Board**, **List**, and **Graph**. Beads owns issue status, priority, notes and dependencies. ChatGPT owns conversations and model execution. The plugin runs locally over stdio and requires no API key, OpenCode server, Electron shell or hosted service.

The workspace follows ChatGPT's live theme, including host colors, fonts, focus rings, corner radii and shadows. All views and dialogs use the host's semantic tokens; OpenAI's official stylesheet supplies light/dark defaults when a host omits tokens. There is no separate OpenCode theme or board palette.

## Install locally

Requires Bun 1.3.13 or newer, Beads 0.62 or newer with its Dolt runtime, and ChatGPT desktop in a local execution environment.

```sh
bun install
bun run build
codex plugin marketplace add .
codex plugin add agent-board@agentboard-desktop
```

The `codex` command is the desktop host's plugin management CLI. The portable plugin is in `plugins/agent-board`; `.agents/plugins/marketplace.json` makes it discoverable from this repository. Restart the desktop app if the new plugin does not appear in the Plugins Directory. Open **AgentBoard Workspace** from the plugin's navigation or chat entrypoint. The first screen lists your saved local project paths automatically. Search by name or path and click a project to open its board. **Open another folder** accepts a pasted or dropped absolute path. A board icon and Beads label indicate a tracker folder; a folder icon indicates no tracker, and a slash indicates an unavailable path. Select a folder containing `.beads`, or invoke the plugin's setup skill to initialize one.

For a private portable archive:

```sh
bun run package
```

This writes `releases/agent-board-0.1.6.zip`, including the bundled server, self-contained HTML, manifests, icon, license and workflow skills. The archive needs no dependency installation after extraction; Bun and Beads remain host prerequisites. Use the local plugin installation flow for stdio packages. Account upload by itself cannot provide a local runtime to web or mobile clients.

## Work with a project

- **Create and edit** issues with acceptance criteria, type and priority. Press **N** for a new issue and **/** to search; Cmd/Ctrl+Enter saves a draft. **Plan in ChatGPT** sends the goal to a new chat for discussion.
- **Move** cards through Open → In Progress → Needs Review → Closed by dragging or using the issue drawer's status selector. Unresolved blockers prevent starting work.
- **Inspect** descriptions, dependencies, notes and timestamps in the drawer. Add or remove prerequisites there.
- **Attach to chat** supplies issue context without sending a message. **Work in new chat** uses ChatGPT's message extension and sends the handoff prompt when clicked. The new chat verifies the local project before implementation.
- **Graph** shows prerequisites pointing to dependents. Scroll to pan, fit the graph, drag nodes or use Shift+arrow keys, and retain the saved layout across restarts.
- **Drop a brief** onto the board or draft: plain text and one `.md`/`.txt` file fill a reviewable draft. Choose file provides the same import without dragging. Drops never create issues automatically. Dropping into a populated draft appends context and keeps its existing fields.
- **List** supports direct status changes. Sort by priority, update time or title, and hide closed issues in any view.
- Changes made through `bd` are picked up by Refresh or the visible board's refresh (15 seconds for small boards, at most once a minute for boards over 500 issues).

Needs Review is represented by the `agentboard:review` label on a Beads `in_progress` issue. Moving to another column removes that label. This keeps the workflow compatible with Beads' standard statuses. Completion is explicit; the plugin does not infer success from a chat ending.

## Desktop project paths

The local server reads saved desktop paths automatically and returns them through `project_list` and board snapshots. The first screen is a searchable list with compact sidebar-style rows and explicit opening and failure states. **Refresh list** rereads desktop preferences. Paths are normalized and deduplicated; names and order follow the desktop sidebar. Connected folders retain their position, and extra paths appear afterward. Folder names provide a fallback when no saved display name exists. Listing performs only bounded shallow checks for the root and `.beads` directory. It never starts Beads, reads issues or initializes a tracker.

The reader is a compatibility adapter for `$CODEX_HOME/.codex-global-state.json` (default `~/.codex/.codex-global-state.json`), using `local-projects` root paths and display names with `project-order`, or legacy `electron-saved-workspace-roots` and root labels when the modern collection is absent. This is a desktop preferences format, not a public SDK API, and may change with desktop updates. The preferences file is never modified; only paths and display names leave the reader. Missing or malformed state leaves manual paths and connected folders available. `AGENTBOARD_DESKTOP_STATE` overrides the file for development and testing.

`project_import` remains available as a fallback for agent-supplied paths from the host's `list_projects` tool. There is no import round trip in the normal UI. The plugin stores only folder paths, not ChatGPT project IDs, and connects a folder only when the user chooses it. Opening AgentBoard always shows the project list first, so a large or unavailable last-selected tracker cannot hold up navigation.

Cloud ChatGPT projects have no local filesystem path. Projects on remote hosts are excluded. Hosts without `list_projects` can still use manual paths. A dragged folder can be used only when the host supplies its path as text or a local file URI; a browser File object alone does not reveal an absolute folder path.

## Development and verification

```sh
cd packages/agentboard
bun typecheck
bun test
bun run build
AGENTBOARD_PROJECT_DIRECTORY=/absolute/path/to/project bun run preview
```

The preview uses the official MCP Apps `AppBridge` with the real MCP server and Beads. It runs only on loopback, is a development test host, and is excluded from the plugin archive. `bun run dev` exposes the UI build for development, but the UI needs an MCP Apps host to connect.

Open the preview with `?themeControls=1` to switch live between light/dark defaults and deliberately distinct sample host tokens. These controls belong to the test host and are excluded from the plugin UI. Verify the Board, List, Graph and dialogs, including an unsaved draft, without reloading between theme changes.

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
