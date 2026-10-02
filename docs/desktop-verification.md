# ChatGPT desktop verification

Build and install the repository's local plugin using the README commands. Open a fresh chat after installation if tool discovery remains stale.

1. Verify AgentBoard appears in the Plugins Directory and discovers `board_open`, `board_read`, project, issue, dependency and graph tools.
2. Open AgentBoard Workspace from navigation and beside a chat. Both should open the fullscreen app surface rather than an inline card. The widget requests fullscreen once when the host advertises it.
3. Connect a project containing Beads. Compare the issue count with `bd list --all --limit 0 --tree=false --json` in that folder.
4. Create an issue, move it between columns, append a note, and inspect the same values with `bd show <id> --json`. Add a blocking dependency and verify that a blocked issue cannot start.
5. Select List and Graph, search by title or ID, move a graph node, and reopen the plugin to verify persisted coordinates. Change the host theme and verify backgrounds, text, borders, status indicators, native controls and focus rings follow it. Repeat with the project picker, drawer and editor open; unsaved draft text should survive a theme change.
6. Attach an issue to the chat. It should appear as removable context without a sent message. Work in new chat should open a new conversation with the issue and project prompt, without independently changing issue status.
7. Select the local project in the receiving conversation if the host did not carry that placement forward. Verify the agent reloads the issue before implementation and explicitly marks work for review afterward.

The native desktop app is blocked to computer-use automation in this environment. Automated MCP and browser-host checks can verify the implementation, but desktop placement and actual new-conversation creation remain separate host verification steps.

## Refinement checks

- Open Your projects, select a connected folder and reopen the plugin. It should retain the last selected project. An unavailable folder should show a recoverable error with the picker still accessible.
- Click Import project list. Verify the active chat uses `list_projects`, filters to this local host, and calls `project_import` with paths only. Refresh and choose a suggestion. No tracker should be initialized or connected by import alone.
- Drag a card into another column, and try starting a blocked issue using the drawer or List. Its visible status must return to Open when the server rejects the move.
- Drop a short `.md` or `.txt` brief, review the draft and create it. Multiple files, other file types and oversized text should show a clear error without a new issue. Existing draft fields should survive another drop.
- Edit an issue's title, description, priority and type. Test Cmd/Ctrl+Enter and Escape; focus should return to the originating control when the editor closes.
- Drag graph nodes with a pointer, use Shift+arrow keys, fit and reset the view. Reload to verify coordinates persist. Inspect narrow layouts and both host themes.

Local verification for 0.1.1: typecheck, ten real integration/drop tests, manifest validation and bundled stdio startup. Browser-host checks cover populated Board/List/Graph, project picker and errors, Markdown file admission, Cmd+Enter issue creation, issue editing, card movement, rejected-status rollback, graph movement with retained keyboard focus, filters and light/dark layouts at 1280 and 520 pixels. Actual desktop host project-import messaging and native external file drops still require the host checks above.

Version 0.1.2 replaces the custom palette with host tokens and the official SDK's fallback styles. The preview's optional theme controls supply distinct sample colors, fonts, radii and shadows to make hardcoded styles visible; these are verification fixtures, not ChatGPT's actual palette. Browser checks verify live changes across views and dialogs, preserved unsaved edits and light/dark fallbacks without host variables. Actual native desktop appearance remains part of the host checks above.
