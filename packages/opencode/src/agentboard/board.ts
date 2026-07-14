import { Beads, dependenciesFromRawIssues } from "./beads"
import { AgentBoardReconciler } from "./reconcile"
import { AgentBoardStore } from "./store"
import type {
  AgentBoardBoard,
  AgentBoardCard,
  AgentBoardColumn,
  AgentBoardColumnID,
  AgentBoardRun,
  BeadsIssue,
} from "./types"

const COLUMN_TITLES: Record<AgentBoardColumnID, string> = {
  blocked: "Blocked",
  open: "Open",
  in_progress: "In Progress",
  needs_review: "Needs Review",
  closed: "Closed",
}

const COLUMN_ORDER: AgentBoardColumnID[] = ["open", "in_progress", "needs_review", "closed"]
const ACTIVE_RUN_STATUS = new Set(["queued", "running"])

export function columnForIssue(base: AgentBoardColumnID, run?: AgentBoardRun): AgentBoardColumnID {
  if (!run) return base
  if (ACTIVE_RUN_STATUS.has(run.status)) return "in_progress"
  if (run.status === "done") return "closed"
  if (run.status === "needs_review" || run.status === "failed") return "needs_review"
  return base
}

function columnForBeadsStatus(issue: BeadsIssue): AgentBoardColumnID {
  const status = issue.status?.toLowerCase().replaceAll("-", "_")
  if (status === "closed" || status === "done") return "closed"
  if (status === "in_progress" || status === "running") return "in_progress"
  if (status === "needs_review" || status === "review") return "needs_review"
  return "open"
}

export async function getAgentBoard(worktree: string): Promise<AgentBoardBoard> {
  const project = AgentBoardStore.upsertProject({ worktree })
  await AgentBoardReconciler.reconcile(project.id)
  const [blocked, open, inProgress, closed] = await Promise.all([
    Beads.listBlocked(worktree),
    Beads.listOpen(worktree),
    Beads.listInProgress(worktree),
    Beads.listClosed(worktree),
  ])
  const latest = AgentBoardStore.latestRunByIssue(project.id)
  const seen = new Set<string>()
  const blockedIDs = new Set(blocked.map((issue) => issue.id))

  const columns = new Map<AgentBoardColumnID, AgentBoardCard[]>(COLUMN_ORDER.map((id) => [id, [] as AgentBoardCard[]]))

  function add(issue: BeadsIssue, column: AgentBoardColumnID) {
    if (seen.has(issue.id)) return
    const run = latest.get(issue.id)
    const projected = columnForIssue(column, run)
    const projectedIssue = blockedIDs.has(issue.id) ? { ...issue, blocked: true } : issue
    seen.add(issue.id)
    columns.get(projected)!.push({
      issue: projectedIssue,
      column: projected,
      latestRun: run,
      activeRun: run && ACTIVE_RUN_STATUS.has(run.status) ? run : undefined,
      artifacts: run ? AgentBoardStore.listArtifacts(run.id) : [],
      events: run ? AgentBoardStore.listRunEvents(run.id) : [],
    })
  }

  for (const issue of open) add(issue, "open")
  for (const issue of blocked) add(issue, columnForBeadsStatus(issue))
  for (const issue of inProgress) add(issue, "in_progress")

  for (const run of AgentBoardStore.listRuns(project.id)) {
    if (!ACTIVE_RUN_STATUS.has(run.status) || seen.has(run.issueID)) continue
    let issue: BeadsIssue
    try {
      issue = await Beads.show(worktree, run.issueID)
    } catch {
      issue = { id: run.issueID, title: run.issueID, status: "in_progress", raw: {} }
    }
    add(issue, "in_progress")
  }

  for (const run of AgentBoardStore.listRuns(project.id)) {
    if ((run.status !== "needs_review" && run.status !== "failed") || seen.has(run.issueID)) continue
    let issue: BeadsIssue
    try {
      issue = await Beads.show(worktree, run.issueID)
    } catch {
      issue = { id: run.issueID, title: run.issueID, status: run.status, raw: {} }
    }
    add(issue, "needs_review")
  }

  for (const issue of closed) add(issue, "closed")
  const issues = Array.from(columns.values()).flatMap((cards) => cards.map((card) => card.issue))
  const issueIDs = issues.map((issue) => issue.id)
  const issueIDSet = new Set(issueIDs)
  let dependencies = dependenciesFromRawIssues(issues)
  try {
    const listed = await Beads.listDependencies(worktree, issueIDs)
    if (listed.length > 0) dependencies = listed
  } catch {
    // Older bd versions or projects without dependency support still get raw-field graph edges.
  }

  return {
    project,
    generatedAt: Date.now(),
    columns: COLUMN_ORDER.map(
      (id): AgentBoardColumn => ({
        id,
        title: COLUMN_TITLES[id],
        cards: columns.get(id)!,
      }),
    ),
    graph: {
      dependencies: dependencies.filter(
        (dependency) => issueIDSet.has(dependency.fromIssueID) && issueIDSet.has(dependency.toIssueID),
      ),
      positions: AgentBoardStore.listGraphPositions(project.id),
    },
  }
}
