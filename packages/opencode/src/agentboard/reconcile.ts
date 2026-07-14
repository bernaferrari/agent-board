import { AppRuntime } from "@/effect/app-runtime"
import { SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { collectRunArtifacts } from "./artifacts"
import { AgentBoardEvents } from "./events"
import { AgentBoardStore } from "./store"
import type { AgentBoardProject, AgentBoardRun } from "./types"

const QUEUED_WITHOUT_SESSION_TIMEOUT = 1000 * 60 * 2
const RUNNING_RECONCILE_GRACE = 1000 * 15

function emit(run: AgentBoardRun) {
  AgentBoardEvents.emit({ type: "run.updated", projectID: run.projectID, runID: run.id, issueID: run.issueID })
  AgentBoardEvents.emit({ type: "board.updated", projectID: run.projectID })
}

function log(runID: string, type: Parameters<typeof AgentBoardStore.addRunEvent>[0]["type"], message: string, data?: unknown) {
  AgentBoardStore.addRunEvent({ runID, type, message, data })
}

function releaseRunLeases(run: AgentBoardRun) {
  AgentBoardStore.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: run.id })
  AgentBoardStore.releaseLease({ resource: `run:${run.id}`, owner: run.id })
}

export function queuedRunIsStale(run: AgentBoardRun, now = Date.now()) {
  return run.status === "queued" && !run.opencodeSessionID && now - run.time.created > QUEUED_WITHOUT_SESSION_TIMEOUT
}

export function runningRunCanBeReconciled(run: AgentBoardRun, now = Date.now()) {
  if (run.status !== "running" || !run.opencodeSessionID) return false
  return now - (run.time.started ?? run.time.created) > RUNNING_RECONCILE_GRACE
}

async function reconcileRun(project: AgentBoardProject, run: AgentBoardRun) {
  if (queuedRunIsStale(run)) {
    const updated = AgentBoardStore.updateRun(run.id, {
      status: "failed",
      ended: Date.now(),
      error: "Run was queued before an OpenCode session was created. Start it again from the board.",
    })
    log(run.id, "reconciled", "Recovered stale queued run after refresh")
    releaseRunLeases(run)
    if (updated) emit(updated)
    return updated ? 1 : 0
  }

  if (!run.opencodeSessionID) return 0
  if (!runningRunCanBeReconciled(run)) return 0

  const sessionID = run.opencodeSessionID as SessionID
  const status = await AppRuntime.runPromise(SessionStatus.Service.use((service) => service.get(sessionID)))
  if (status.type !== "idle") return 0

  try {
    await AppRuntime.runPromise(Session.Service.use((service) => service.get(sessionID)))
  } catch (error) {
    const updated = AgentBoardStore.updateRun(run.id, {
      status: "failed",
      ended: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    })
    log(run.id, "reconciled", "OpenCode session was missing during reconciliation", {
      sessionID,
      projectID: project.id,
    })
    releaseRunLeases(run)
    if (updated) emit(updated)
    return updated ? 1 : 0
  }

  await collectRunArtifacts(run)
  log(run.id, "artifacts_collected", "Collected session, diff, and log artifacts during reconciliation")
  const updated = AgentBoardStore.updateRun(run.id, {
    status: "needs_review",
    ended: Date.now(),
    error: undefined,
  })
  log(run.id, "reconciled", "Recovered idle OpenCode session and moved run to review", {
    sessionID,
    projectID: project.id,
  })
  releaseRunLeases(run)
  if (updated) emit(updated)
  return updated ? 1 : 0
}

export const AgentBoardReconciler = {
  async reconcile(projectID?: string) {
    const projects = projectID
      ? [AgentBoardStore.getProject(projectID)].filter((project): project is AgentBoardProject => !!project)
      : AgentBoardStore.listProjects()
    let changed = 0
    for (const project of projects) {
      for (const run of AgentBoardStore.listActiveRuns(project.id)) {
        changed += await reconcileRun(project, run)
      }
    }
    return { changed }
  },
}
