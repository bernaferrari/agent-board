---
name: setup
description: Set up AgentBoard for a local ChatGPT desktop project when installing the plugin or connecting a folder without Beads.
---

# Set up AgentBoard

1. Establish the absolute project folder from the user or the current local project. Run `bun --version` and `bd --version` in the host's local terminal. If either is missing, explain which dependency is needed and follow its official installation instructions within the user's authorized scope.
2. Check whether the chosen folder has `.beads`. For an existing tracker, use it as-is. For a new tracker, initialize Beads in that folder when the user has requested setup. Follow `bd init --help` for the installed version and resolve any Dolt startup error.
3. Call `project_connect` with the selected absolute folder. Open `board_open` with the returned project ID.
4. Verify that the board loads and the existing issue count matches `bd list --all --limit 0 --tree=false --json`. Verify an issue can be attached to the current chat. Report any host behavior that remains unverified.

The plugin uses a local stdio MCP process. It requires the desktop local execution environment, Bun and Beads on the host PATH. Its board resource is bundled into the package and makes no external web requests. No OpenAI API key is required; the existing ChatGPT conversation performs the work.
