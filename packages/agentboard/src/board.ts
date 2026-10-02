import { dependenciesFromRawIssues, normalizeIssues, runBd } from "./beads"
import { COLUMN_TITLES, REVIEW_LABEL, Status } from "./types"
import type { AgentBoardBoard, BeadsIssue, Project, Position } from "./types"

export function projectBoard(project: Project, issues: BeadsIssue[], positions: Position[] = []): AgentBoardBoard {
  const dependencies = dependenciesFromRawIssues(issues)
  const issueMap = new Map(issues.map((issue) => [issue.id, issue]))
  const blocked = new Set(
    dependencies
      .filter((edge) => edge.type === "blocks" && issueMap.get(edge.toIssueID)?.status !== "closed")
      .map((edge) => edge.fromIssueID),
  )
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
            id: issue.id,
            title: issue.title,
            status: issue.status,
            description: issue.description,
            priority: issue.priority,
            labels: issue.labels,
            blocked: issue.status === "blocked" || blocked.has(issue.id),
            // Carry drawer metadata without duplicating descriptions and graph edges.
            // issue_context still returns the complete freshly read Beads issue.
            raw: Object.fromEntries(
              Object.entries(issue.raw).filter(([key]) =>
                ["issue_type", "notes", "created_at", "updated_at", "closed_at", "assignee", "owner"].includes(key),
              ),
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
  // Current Beads lists already include complete edges and notes. Older lists
  // with counts only need details for issues with unresolved edge data.
  const incomplete = listed.filter(
    (issue) =>
      !Array.isArray(issue.raw.dependencies) &&
      (issue.raw.dependency_count === undefined || Number(issue.raw.dependency_count) > 0),
  )
  const chunks = Array.from({ length: Math.ceil(incomplete.length / 200) }, (_, index) =>
    incomplete.slice(index * 200, (index + 1) * 200),
  )
  const issues = (
    await Promise.all(
      chunks.map(async (chunk) =>
        normalizeIssues(await runBd(project.directory, ["show", ...chunk.map((issue) => issue.id)])),
      ),
    )
  ).flat()
  const details = new Map(issues.map((issue) => [issue.id, issue]))
  return projectBoard(
    project,
    listed.map((issue) => details.get(issue.id) ?? issue),
    positions,
  )
}
