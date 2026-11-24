import { Beads, dependenciesFromRawIssues, REVIEW_LABEL } from "./beads"
import type { AgentBoardReconciler } from "./reconcile"
import type { AgentBoardStore } from "./store"
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
  if (Array.isArray(issue.raw.labels) && issue.raw.labels.includes(REVIEW_LABEL)) return "needs_review"
  if (status === "in_progress" || status === "running") return "in_progress"
  if (status === "needs_review" || status === "review") return "needs_review"
  return "open"
}

export async function getAgentBoard(
  worktree: string,
  store: AgentBoardStore,
  reconciler: AgentBoardReconciler,
): Promise<AgentBoardBoard> {
  const project = store.upsertProject({ worktree })
  await reconciler.reconcile(project.id)
  const [blocked, issues] = await Promise.all([Beads.listBlocked(worktree), Beads.list(worktree)])
  const latest = store.latestRunByIssue(project.id)
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
      artifacts: run ? store.listArtifacts(run.id) : [],
      events: run ? store.listRunEvents(run.id) : [],
    })
  }

  for (const issue of issues) add(issue, columnForBeadsStatus(issue))
  const visibleIssues = Array.from(columns.values()).flatMap((cards) => cards.map((card) => card.issue))
  const issueIDs = new Set(visibleIssues.map((issue) => issue.id))

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
      dependencies: dependenciesFromRawIssues(visibleIssues).filter(
        (dependency) => issueIDs.has(dependency.fromIssueID) && issueIDs.has(dependency.toIssueID),
      ),
      positions: store.listGraphPositions(project.id),
    },
  }
}
