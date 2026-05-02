import { Instance } from "@/project/instance"
import { Beads } from "./beads"
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
  ready: "Ready",
  running: "Running",
  needs_review: "Needs Review",
  closed: "Closed",
}

const COLUMN_ORDER: AgentBoardColumnID[] = ["blocked", "ready", "running", "needs_review", "closed"]
const ACTIVE_RUN_STATUS = new Set(["queued", "running"])

export function columnForIssue(base: AgentBoardColumnID, run?: AgentBoardRun): AgentBoardColumnID {
  if (!run) return base
  if (ACTIVE_RUN_STATUS.has(run.status)) return "running"
  if (run.status === "done") return "closed"
  if ((run.status === "needs_review" || run.status === "failed") && base === "running") return "needs_review"
  return base
}

export async function getAgentBoard(): Promise<AgentBoardBoard> {
  const worktree = Instance.worktree
  const project = AgentBoardStore.upsertProject({ worktree })
  await AgentBoardReconciler.reconcile(project.id)
  const [blocked, ready, inProgress, closed] = await Promise.all([
    Beads.listBlocked(worktree),
    Beads.listReady(worktree),
    Beads.listInProgress(worktree),
    Beads.listClosed(worktree),
  ])
  const latest = AgentBoardStore.latestRunByIssue(project.id)
  const seen = new Set<string>()

  const columns = new Map<AgentBoardColumnID, AgentBoardCard[]>(COLUMN_ORDER.map((id) => [id, [] as AgentBoardCard[]]))

  function add(issue: BeadsIssue, column: AgentBoardColumnID) {
    if (seen.has(issue.id)) return
    const run = latest.get(issue.id)
    const projected = columnForIssue(column, run)
    seen.add(issue.id)
    columns.get(projected)!.push({
      issue,
      column: projected,
      latestRun: run,
      activeRun: run && ACTIVE_RUN_STATUS.has(run.status) ? run : undefined,
      artifacts: run ? AgentBoardStore.listArtifacts(run.id) : [],
      events: run ? AgentBoardStore.listRunEvents(run.id) : [],
    })
  }

  for (const issue of blocked) add(issue, "blocked")
  for (const issue of ready) add(issue, "ready")
  for (const issue of inProgress) add(issue, "running")

  for (const run of AgentBoardStore.listRuns(project.id)) {
    if (!ACTIVE_RUN_STATUS.has(run.status) || seen.has(run.issueID)) continue
    let issue: BeadsIssue
    try {
      issue = await Beads.show(worktree, run.issueID)
    } catch {
      issue = { id: run.issueID, title: run.issueID, status: "in_progress", raw: {} }
    }
    add(issue, "running")
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
  }
}
