# Architecture and migration

The standalone plugin replaces the OpenCode monorepo. It keeps the AgentBoard workflow and adapts the original dependency graph projection, while rebuilding its rendering without OpenCode UI, server or session imports.

## Runtime boundaries

ChatGPT desktop starts the plugin's bundled Bun stdio process from `mcp.json`. Protocol messages use stdout. The process exposes tools and one self-contained `text/html;profile=mcp-app` resource. No public HTTP server or remote origin is required. Host PATH must contain Bun and Beads.

`project_connect` registers a user-selected absolute folder containing `.beads`. Other tools accept an opaque registered project ID; they resolve the directory server-side. CLI calls use argument arrays, never a shell. Issue identifiers cannot become CLI options. Beads subprocesses time out after 30 seconds and nonzero exits propagate as MCP errors.

Beads remains authoritative for issue data. The board reads the complete issue list and batch-loads details because list results contain dependency counts rather than edges. The original dependent-to-prerequisite edge representation is preserved, while visual arrows point from prerequisite to dependent. Open, In Progress, Needs Review and Closed remain the four visible columns. Blocked/deferred issues are visible in Open; blocked work cannot start. Needs Review is an explicit Beads label.

The plugin's SQLite database stores connected project folders, imported local path suggestions, the last selected project, and graph positions. It resides in host-provided `PLUGIN_DATA`, or `AGENTBOARD_DATA_DIR` for direct development runs, falling back to `~/.agentboard`. Issue notes and artifact links belong in Beads notes. No OpenCode run tables or session history are migrated, and an existing Beads tracker is reused without initialization or schema changes.

## ChatGPT host integration

The official MCP Apps SDK connects the UI to server tools and model context. The OpenAI Extensions SDK provides global and thread entrypoints, fullscreen display preferences, theme styling, issue attachments and new-conversation message targeting. The UI registers its initial tool-result listener before connecting and consumes that result once; Refresh uses the data-only `board_read` tool.

A handoff reads the current issue and prepares a prompt containing its local project, acceptance context and review workflow. Clicking Work in new chat sends that prompt through `ui/message` with `openai/message.target = new`. It does not change the issue status or claim execution has begun. The receiving chat verifies project availability before implementation. Attach to chat updates model context without sending.

The local stdio runtime makes this a desktop-local plugin. The portable plugin format does not supply an enforceable “ChatGPT-only” flag; other compatible desktop clients may also load it. The product and skills target ChatGPT desktop, while web/mobile clients cannot run its local process. No undocumented platform restriction is invented.

The project picker uses an agent-mediated bridge: the desktop agent reads `list_projects` and passes local paths to `project_import`. The widget never reads desktop configuration files or calls an undocumented host API. Importing choices is separate from connecting a folder; no filesystem reads occur until the user chooses a path. The opener preserves access to the picker and shows an explicit error if the last selected project cannot be loaded.

External text/Markdown drops are parsed locally into a draft, with file count, size and text limits. They need an explicit Create action before any Beads mutation. Native card drops change status through the same tool used by the list and drawer. Graph nodes retain their DOM identity while dragging so pointer capture survives coordinate updates; failed layout saves restore the persisted positions.

## Removed runtime

The transformation removes the OpenCode CLI, Electron desktop shell, provider adapters, session runner, HTTP API, generated SDKs, cloud infrastructure and unrelated workspaces. The retained runtime package depends only on MCP, MCP Apps, OpenAI Extensions, Solid and Zod. Git history retains the prior source.

## Build and package

Vite compiles the Solid UI into one JavaScript chunk and inline CSS. The build script embeds both into `board.html`; the MCP resource needs no external network access. Bun bundles the MCP server into `dist/server.js`. The private ZIP includes only the plugin folder, with portable and compatibility manifests synchronized. Source, test hosts, tracker databases, credentials and node_modules stay outside the archive.
