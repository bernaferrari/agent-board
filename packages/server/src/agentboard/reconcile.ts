import type { Session } from "@opencode/core/session"
import { DateTime, Effect } from "effect"
import { Beads } from "./beads"
import { collectRunArtifacts } from "./artifacts"
import type { AgentBoardEvents } from "./events"
import type { AgentBoardStore } from "./store"
import type { AgentBoardProject, AgentBoardRun } from "./types"

const QUEUED_WITHOUT_SESSION_TIMEOUT = 1000 * 60 * 2
const RUNNING_RECONCILE_GRACE = 1000 * 15

export function queuedRunIsStale(run: AgentBoardRun, now = Date.now()) {
  return run.status === "queued" && !run.opencodeSessionID && now - run.time.created > QUEUED_WITHOUT_SESSION_TIMEOUT
}

export function runningRunCanBeReconciled(run: AgentBoardRun, now = Date.now()) {
  if (run.status !== "running" || !run.opencodeSessionID) return false
  return now - (run.time.started ?? run.time.created) > RUNNING_RECONCILE_GRACE
}

export type AgentBoardReconciler = ReturnType<typeof createAgentBoardReconciler>

export function createAgentBoardReconciler(
  store: AgentBoardStore,
  events: AgentBoardEvents,
  sessions: Session.Interface,
  pending: (runID: string) => boolean,
) {
  function emit(run: AgentBoardRun) {
    events.emit({ type: "run.updated", projectID: run.projectID, runID: run.id, issueID: run.issueID })
    events.emit({ type: "board.updated", projectID: run.projectID })
  }

  function log(
    runID: string,
    type: Parameters<AgentBoardStore["addRunEvent"]>[0]["type"],
    message: string,
    data?: unknown,
  ) {
    store.addRunEvent({ runID, type, message, data })
  }

  function releaseRunLeases(run: AgentBoardRun) {
    store.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: run.id })
    store.releaseLease({ resource: `run:${run.id}`, owner: run.id })
  }

  async function reconcileRun(project: AgentBoardProject, run: AgentBoardRun) {
    if (queuedRunIsStale(run)) {
      const updated = store.updateRun(run.id, {
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

    const sessionID = run.opencodeSessionID
    if (pending(run.id) || (await Effect.runPromise(sessions.active)).has(sessionID)) return 0

    try {
      await Effect.runPromise(sessions.get(sessionID))
    } catch (error) {
      const updated = store.updateRun(run.id, {
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

    const messages = await Effect.runPromise(sessions.messages({ sessionID, limit: 1, type: "assistant" }))
    if (store.getRun(run.id)?.status !== "running") return 0
    const response = messages[0]
    if (
      response?.type !== "assistant" ||
      response.error ||
      !response.time.completed ||
      DateTime.toEpochMillis(response.time.created) < (run.time.started ?? run.time.created)
    ) {
      const error = response?.type === "assistant" && response.error?.message
      const updated = store.updateRun(run.id, {
        status: "failed",
        ended: Date.now(),
        error: error || "The OpenCode session stopped before this run completed.",
      })
      log(run.id, "reconciled", "Recovered an incomplete OpenCode run")
      releaseRunLeases(run)
      if (updated) emit(updated)
      return updated ? 1 : 0
    }
    await Effect.runPromise(collectRunArtifacts(run, store, sessions))
    if (store.getRun(run.id)?.status !== "running") return 0
    await Beads.updateStatus(project.worktree, run.issueID, "in_progress", true)
    if (store.getRun(run.id)?.status !== "running") return 0
    log(run.id, "artifacts_collected", "Collected session, diff, and log artifacts during reconciliation")
    const updated = store.updateRun(run.id, {
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

  const reconciling = new Set<string>()

  return {
    async reconcile(projectID?: string) {
      const projects = projectID
        ? [store.getProject(projectID)].filter((project): project is AgentBoardProject => !!project)
        : store.listProjects()
      let changed = 0
      for (const project of projects) {
        for (const run of store.listActiveRuns(project.id)) {
          if (reconciling.has(run.id)) continue
          reconciling.add(run.id)
          try {
            changed += await reconcileRun(project, run)
          } finally {
            reconciling.delete(run.id)
          }
        }
      }
      return { changed }
    },
  }
}
