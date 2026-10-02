import { dependenciesFromRawIssues, normalizeIssues, runBd } from "./beads"
import { COLUMN_TITLES, REVIEW_LABEL, Status } from "./types"
import type { AgentBoardBoard, BeadsIssue, Project, Position } from "./types"

export function projectBoard(project: Project, issues: BeadsIssue[], positions: Position[] = []): AgentBoardBoard {
  const dependencies = dependenciesFromRawIssues(issues)
  const issueMap = new Map(issues.map((issue) => [issue.id, issue]))
  return {
    project,
    generatedAt: Date.now(),
    columns: Status.options.map((id) => ({
      id,
      title: COLUMN_TITLES[id],
      cards: issues
        .filter((issue) => columnForIssue(issue) === id)
        .map((issue) => ({
          issue: {
            ...issue,
            blocked:
              issue.status === "blocked" ||
              dependencies.some(
                (edge) =>
                  edge.type === "blocks" &&
                  edge.fromIssueID === issue.id &&
                  issueMap.get(edge.toIssueID)?.status !== "closed",
              ),
          },
          column: id,
        })),
    })),
    graph: { dependencies, positions },
  }
}

export function columnForIssue(issue: BeadsIssue) {
  if (issue.status === "closed") return "closed"
  if (issue.labels?.includes(REVIEW_LABEL) || issue.status === "needs_review") return "needs_review"
  if (issue.status === "in_progress") return "in_progress"
  return "open"
}

export async function loadBoard(project: Project, positions: Position[]) {
  const listed = normalizeIssues(await runBd(project.directory, ["list", "--all", "--limit", "0", "--tree=false"]))
  // The list response has dependency counts only; batched show responses carry graph edges.
  const chunks = Array.from({ length: Math.ceil(listed.length / 200) }, (_, index) =>
    listed.slice(index * 200, (index + 1) * 200),
  )
  const issues = (
    await Promise.all(
      chunks.map(async (chunk) =>
        normalizeIssues(await runBd(project.directory, ["show", ...chunk.map((issue) => issue.id)])),
      ),
    )
  ).flat()
  return projectBoard(project, issues, positions)
}
