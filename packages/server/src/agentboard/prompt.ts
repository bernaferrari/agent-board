import type { BeadsIssue } from "./types"

export function createAgentBoardPrompt(issue: BeadsIssue) {
  const raw = JSON.stringify(issue.raw, null, 2)
  return `Please implement this Beads issue.

Issue:
- ID: ${issue.id}
- Title: ${issue.title}
- Status: ${issue.status ?? "unknown"}
- Priority: ${issue.priority ?? "unset"}

Description:
${issue.description ?? "(No description provided.)"}

Instructions:
1. Implement the issue end to end in the current OpenCode project.
2. Keep changes scoped to this issue and do not revert unrelated user work.
3. Run the most relevant checks you can.
4. Finish with a concise review handoff using these headings when applicable:
   - Summary
   - Changed files
   - Tests
   - Risks or blockers
   - Review notes

Beads raw issue:
${raw}
`
}
