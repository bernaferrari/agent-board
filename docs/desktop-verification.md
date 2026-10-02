# ChatGPT desktop verification

Build and install the repository's local plugin using the README commands. Open a fresh chat after installation if tool discovery remains stale.

1. Verify AgentBoard appears in the Plugins Directory and discovers `board_open`, `board_read`, project, issue, dependency and graph tools.
2. Open AgentBoard Workspace from navigation and beside a chat. Both should open the fullscreen app surface rather than an inline card. The widget requests fullscreen once when the host advertises it.
3. Connect a project containing Beads. Compare the issue count with `bd list --all --limit 0 --tree=false --json` in that folder.
4. Create an issue, move it between columns, append a note, and inspect the same values with `bd show <id> --json`. Add a blocking dependency and verify that a blocked issue cannot start.
5. Select List and Graph, search by title or ID, move a graph node, and reopen the plugin to verify persisted coordinates. Change the host theme and verify the widget follows it.
6. Attach an issue to the chat. It should appear as removable context without a sent message. Work in new chat should open a new conversation with the issue and project prompt, without independently changing issue status.
7. Select the local project in the receiving conversation if the host did not carry that placement forward. Verify the agent reloads the issue before implementation and explicitly marks work for review afterward.

The native desktop app is blocked to computer-use automation in this environment. Automated MCP and browser-host checks can verify the implementation, but desktop placement and actual new-conversation creation remain separate host verification steps.
