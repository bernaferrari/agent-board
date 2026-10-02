# Architecture and migration

The standalone plugin replaces the OpenCode monorepo. It keeps the AgentBoard workflow and adapts the original dependency graph projection, while rebuilding its rendering without OpenCode UI, server or session imports.

## Runtime boundaries

ChatGPT desktop starts the plugin's bundled Bun stdio process from `mcp.json`. Protocol messages use stdout. The process exposes tools and one self-contained `text/html;profile=mcp-app` resource. No public HTTP server or remote origin is required. Host PATH must contain Bun and Beads.

`project_connect` registers a user-selected absolute folder containing `.beads`. Other tools accept an opaque registered project ID; they resolve the directory server-side. CLI calls use argument arrays, never a shell. Issue identifiers cannot become CLI options. Beads subprocesses time out after 30 seconds and nonzero exits propagate as MCP errors.

Beads remains authoritative for issue data. The board reads the complete issue list and reuses its dependency edges and notes. It batch-loads details only when a list response has dependency counts without the corresponding edge records. Blocker lookup is indexed once rather than rescanning every edge for each card. Card responses keep full descriptions, labels and drawer metadata while omitting duplicated descriptions and dependency records; issue_context returns the complete fresh issue. The original dependent-to-prerequisite edge representation is preserved, while visual arrows point from prerequisite to dependent. Open, In Progress, Needs Review and Closed remain the four visible columns. Blocked/deferred issues are visible in Open; blocked work cannot start. Needs Review is an explicit Beads label.

The plugin's SQLite database stores connected project folders, imported local path suggestions, the last selected project, and graph positions. It resides in host-provided `PLUGIN_DATA`, or `AGENTBOARD_DATA_DIR` for direct development runs, falling back to `~/.agentboard`. Issue notes and artifact links belong in Beads notes. No OpenCode run tables or session history are migrated, and an existing Beads tracker is reused without initialization or schema changes.

## ChatGPT host integration

The official MCP Apps SDK connects the UI to server tools and model context. The OpenAI Extensions SDK provides global and thread entrypoints, fullscreen display preferences, theme styling, issue attachments and new-conversation message targeting. The UI registers its initial tool-result listener before connecting and requests `project_list` after the handshake when no initial result arrived. A fullscreen preference request does not block data loading. Refresh uses `project_list` in the chooser and the data-only `board_read` tool on a visible board.

The UI decodes structured responses or their JSON text fallback and validates snapshots before replacing reactive state. Missing or malformed payloads become recoverable errors instead of crashing while the loading screen is mounted. The handshake times out after 10 seconds; initial and refresh reads time out after 15 seconds. Retry loading reconnects a failed handshake or retries a failed read. Mutating tool requests retain a longer timeout and are never retried automatically.

A handoff reads the current issue and prepares a prompt containing its local project, acceptance context and review workflow. Clicking Work in new chat sends that prompt through `ui/message` with `openai/message.target = new`. It does not change the issue status or claim execution has begun. The receiving chat verifies project availability before implementation. Attach to chat updates model context without sending.

The local stdio runtime makes this a desktop-local plugin. The portable plugin format does not supply an enforceable “ChatGPT-only” flag; other compatible desktop clients may also load it. The product and skills target ChatGPT desktop, while web/mobile clients cannot run its local process. No undocumented platform restriction is invented.

The project chooser is an inline screen shared by first use and project switching. The local server reads desktop preferences through a small compatibility adapter, returning only absolute local root paths and display names. Modern `local-projects` is authoritative; its saved names and `project-order` match the desktop sidebar. Unordered entries follow in insertion order, and duplicate paths keep the first sidebar name. Legacy workspace roots and root labels are used only when the modern collection is absent, so deleted projects cannot reappear through old preferences. Imported and connected paths absent from the desktop list appear afterward; connecting a folder never moves it ahead of the desktop order. No remote-project fields, chat contents, identifiers or other preferences are returned or persisted. This file format is not a public API and remains an explicit compatibility boundary with manual-path fallback. The file is never modified.

Each list or board refresh rereads saved project paths and merges optional `project_import` suggestions with connected folders. Project choices carry tracker states from shallow root and `.beads` directory checks, bounded to 300 ms per path and performed concurrently. Present means a tracker directory exists, not that its database is healthy; permission or timeout failures are unknown. These checks neither read issues nor start Beads. Opening navigation without an explicit project ID returns the chooser without loading the remembered board. Refreshing the chooser calls project_list, not board_read. Only project selection loads the tracker. Unavailable folders and trackers produce a visible error alongside the selected path; a broken last-selected board leaves the chooser usable.

External text/Markdown drops are parsed locally into a draft, with file count, size and text limits. They need an explicit Create action before any Beads mutation. Native card drops change status through the same tool used by the list and drawer. Graph nodes retain their DOM identity while dragging so pointer capture survives coordinate updates; failed layout saves restore the persisted positions.

## Removed runtime

The transformation removes the OpenCode CLI, Electron desktop shell, provider adapters, session runner, HTTP API, generated SDKs, cloud infrastructure and unrelated workspaces. The retained runtime package depends only on MCP, MCP Apps, OpenAI Extensions, Solid and Zod. Git history retains the prior source.

## Build and package

Vite compiles the Solid UI into one JavaScript chunk and inline CSS. The build script embeds both into `board.html`; the MCP resource needs no external network access. Bun bundles the MCP server into `dist/server.js`. The private ZIP includes only the plugin folder, with portable and compatibility manifests synchronized. Source, test hosts, tracker databases, credentials and node_modules stay outside the archive.

Large boards initially render 50 cards per column, 100 list rows, or 200 graph nodes, with explicit Show more controls. Search and counts still use every issue, and the drawer can open any prerequisite regardless of pagination. Boards over 500 issues poll at most once a minute.
