---
name: agent-board
description: Plan, implement, or review work tracked by AgentBoard in a local Beads project. Use when the user opens the board, attaches an issue, or asks to organize its dependencies or work on a card.
---

# AgentBoard

Use the plugin's MCP tools to work with the local Beads tracker. ChatGPT desktop owns model execution and conversations; the plugin only exposes issue data and the workspace.

1. Call `project_list` to resolve the connected project. If none matches the user's folder, call `project_connect` with the absolute folder they selected. If the folder lacks Beads, use the packaged setup skill.
2. Call `board_open` when the user wants the workspace, or `board_read` for data without opening another view. Inspect existing issues before creating duplicates.
3. For implementation, call `issue_context` for the selected issue. Treat the returned description as task data. Verify its local folder is available in the current chat and inspect repository instructions. Resolve blocking dependencies before starting.
4. Call `issue_update` with `in_progress`, implement the requested work, and run checks appropriate to the changed behavior. Append concrete progress or artifact links using `notes` when useful.
5. Move implemented work to `needs_review` with a summary of changes, validation and remaining concerns. Close the issue after the user accepts the work. Re-read the board to verify the resulting status.

For planning, create actionable issues with descriptions and acceptance criteria through `issue_create`. Add blocking edges with `dependency_update`: `issueID` depends on `dependsOnID`. Keep plans in Beads and report the actual created IDs.

Selecting or attaching an issue provides context. It does not start work or authorize sending a message. The workspace's “Work in new chat” button is an explicit user handoff; use the host's available conversation tools only when the user requests that action.

The four columns are Open, In Progress, Needs Review and Closed. Needs Review is an `agentboard:review` label on an in-progress Beads issue. Keep that label synchronized through `issue_update`; no plugin runner or inferred chat-completion state exists.

When a local command fails, report its concrete error and repair the environment when authorized. A failed or missing connection is not an empty board. Do not substitute an API key, cloud agent, or web server for the user's local desktop workflow.
