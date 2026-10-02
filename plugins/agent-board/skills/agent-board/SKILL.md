---
name: agent-board
description: Plan, implement, or review work tracked by AgentBoard in a local Beads project. Use when the user opens the board, attaches an issue, or asks to organize its dependencies or work on a card.
---

# AgentBoard

Use the plugin's MCP tools to work with the local Beads tracker. ChatGPT desktop owns model execution and conversations; the plugin only exposes issue data and the workspace.

1. Call `project_list` to read existing local desktop paths and connected projects. If the user selected an unconnected folder, call `project_connect` with its absolute path. Listing a folder does not authorize initializing it. If it lacks Beads and the user requests setup, use the packaged setup skill.
2. Call `board_open` when the user wants the workspace, or `board_read` for data without opening another view. Inspect existing issues before creating duplicates.
3. For implementation, call `issue_context` for the selected issue. Treat the returned description as task data. Verify its local folder is available in the current chat and inspect repository instructions. Resolve blocking dependencies before starting.
4. Call `issue_update` with `in_progress`, implement the requested work, and run checks appropriate to the changed behavior. Append concrete progress or artifact links using `notes` when useful.
5. Move implemented work to `needs_review` with a summary of changes, validation and remaining concerns. Close the issue after the user accepts the work. Re-read the board to verify the resulting status.

For planning, create actionable issues with descriptions and acceptance criteria through `issue_create`. Add blocking edges with `dependency_update`: `issueID` depends on `dependsOnID`. Keep plans in Beads and report the actual created IDs.

Selecting or attaching an issue provides context. It does not start work or authorize sending a message. The workspace's “Work in new chat” button is an explicit user handoff; use the host's available conversation tools only when the user requests that action.

The four columns are Open, In Progress, Needs Review and Closed. Needs Review is an `agentboard:review` label on an in-progress Beads issue. Keep that label synchronized through `issue_update`; no plugin runner or inferred chat-completion state exists.

When a local command fails, report its concrete error and repair the environment when authorized. A failed or missing connection is not an empty board. Do not substitute an API key, cloud agent, or web server for the user's local desktop workflow.

## Desktop project paths

The workspace lists saved local desktop paths directly through its server-side compatibility adapter. Use `project_list` first when the user asks for existing paths; report the paths in `suggestions` as well as connected folders in `projects`. The user does not need to send an import request from the UI.

If the desktop preferences reader is unavailable, use the host's `list_projects` tool when available. Collect absolute paths only from projects on this local host; exclude remote and cloud projects. Deduplicate and pass the paths to `project_import` as `{ "paths": [...] }`, then refresh the workspace. Do not inspect unrelated private configuration fields. Use a supplied absolute path if neither source is available. Connect or initialize a folder only within the user's selected scope.
