import { randomUUID } from "node:crypto"
import type { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/core/schema"
import { Effect } from "effect"
import { Beads } from "./beads"
import type { AgentBoardEvents } from "./events"
import { collectRunArtifacts } from "./artifacts"
import { createAgentBoardPrompt } from "./prompt"
import { normalizeStartOpenLimit } from "./scheduler"
import type { AgentBoardStore } from "./store"
import type { AgentBoardRun } from "./types"

export function createAgentBoardRuns(
  store: AgentBoardStore,
  events: AgentBoardEvents,
  sessions: Session.Interface,
  signal: AbortSignal,
) {
  const pending = new Set<string>()

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

  function runSession<A, E>(effect: Effect.Effect<A, E>) {
    return Effect.runPromise(effect, { signal })
  }

  function startPrompt(sessionID: Session.ID, text: string) {
    return runSession(
      Effect.gen(function* () {
        const submitted = yield* sessions.prompt({ sessionID, text })
        yield* sessions.wait(sessionID)
        const messages = yield* sessions.messages({
          sessionID,
          order: "asc",
          cursor: { id: submitted.id, direction: "next" },
        })
        const response = messages.findLast((message) => message.type === "assistant")
        if (response?.error) return yield* Effect.fail(new Error(response.error.message))
        if (!response)
          return yield* Effect.fail(new Error("The OpenCode session stopped before it produced a response."))
      }),
    )
  }

  async function finishRun(runID: string, worktree: string, lease: string, work: Promise<void>) {
    pending.add(runID)
    try {
      await work
      const run = store.getRun(runID)
      if (run?.status !== "running" || signal.aborted) return
      await runSession(collectRunArtifacts(run, store, sessions))
      if (store.getRun(runID)?.status !== "running" || signal.aborted) return
      log(runID, "artifacts_collected", "Collected session, diff, and log artifacts")
      await Beads.updateStatus(worktree, run.issueID, "in_progress", true)
      if (store.getRun(runID)?.status !== "running" || signal.aborted) return
      const updated = store.updateRun(runID, { status: "needs_review", ended: Date.now() })
      log(runID, "needs_review", "Run completed and is ready for review")
      if (updated) emit(updated)
    } catch (error) {
      if (store.getRun(runID)?.status !== "running" || signal.aborted) return
      const updated = store.updateRun(runID, {
        status: "failed",
        ended: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
      log(runID, "failed", "Run failed", { error: updated?.error })
      if (updated) emit(updated)
    } finally {
      pending.delete(runID)
      if (!signal.aborted) {
        store.releaseLease({ resource: lease, owner: runID })
        log(runID, "lease_released", "Released issue lease")
      }
    }
  }

  return {
    pending: (runID: string) => pending.has(runID),
    async start(worktree: string, issueID: string) {
      const project = store.upsertProject({ worktree })
      const issue = await Beads.show(worktree, issueID)
      const existing = store.latestRunByIssue(project.id).get(issue.id)
      if (existing?.status === "queued" || existing?.status === "running") {
        throw new Error("Another AgentBoard run already owns this issue.")
      }
      const prompt = createAgentBoardPrompt(issue)
      const id = `abr_${randomUUID()}`
      const lease = `issue:${project.id}:${issue.id}`
      if (!store.acquireLease({ resource: lease, owner: id })) {
        throw new Error("Another AgentBoard run already owns this issue.")
      }
      const run = store.createRun({ id, projectID: project.id, issueID: issue.id, prompt })
      log(run.id, "queued", "Queued from Open")
      log(run.id, "lease_acquired", "Acquired issue lease", { resource: lease })
      emit(run)

      let session: Session.Info
      try {
        await Beads.updateStatus(worktree, issue.id, "in_progress")
        log(run.id, "beads_status_updated", "Moved Beads issue to in_progress")
        session = await runSession(
          sessions.create({
            title: `${issue.id}: ${issue.title}`,
            location: { directory: AbsolutePath.make(worktree) },
          }),
        )
      } catch (error) {
        const current = store.getRun(run.id)
        if (current?.status === "cancelled") return current
        const failed = store.updateRun(run.id, {
          status: "failed",
          ended: Date.now(),
          error: error instanceof Error ? error.message : String(error),
        })!
        log(run.id, "failed", "Failed before prompt start", { error: failed.error })
        store.releaseLease({ resource: lease, owner: run.id })
        log(run.id, "lease_released", "Released issue lease")
        emit(failed)
        return failed
      }
      if (store.getRun(run.id)?.status !== "queued") return store.getRun(run.id)!
      log(run.id, "session_created", "Created OpenCode session", { sessionID: session.id })
      const running = store.updateRun(run.id, {
        status: "running",
        opencodeSessionID: session.id,
        started: Date.now(),
      })!
      log(run.id, "prompt_started", "Sent implementation prompt to OpenCode")
      store.addArtifact({
        runID: run.id,
        kind: "session",
        title: "OpenCode session",
        url: `/session/${session.id}`,
        data: { sessionID: session.id },
      })
      emit(running)

      void finishRun(run.id, worktree, lease, startPrompt(session.id, prompt))

      return store.getRun(run.id)!
    },
    async startOpen(worktree: string, input?: { limit?: number }) {
      const project = store.upsertProject({ worktree })
      const limit = normalizeStartOpenLimit(input?.limit)
      const open = await Beads.listOpen(worktree)
      const latest = store.latestRunByIssue(project.id)
      const started: AgentBoardRun[] = []
      const skipped: Array<{ issueID: string; reason: string }> = []
      const failed: Array<{ issueID: string; error: string }> = []

      for (const issue of open) {
        if (started.length >= limit) break
        const run = latest.get(issue.id)
        if (run?.status === "queued" || run?.status === "running") {
          skipped.push({ issueID: issue.id, reason: "Already running" })
          continue
        }
        try {
          const created = await this.start(worktree, issue.id)
          if (created.status === "failed") {
            failed.push({ issueID: issue.id, error: created.error ?? "Run failed to start" })
          } else {
            started.push(created)
          }
        } catch (error) {
          failed.push({ issueID: issue.id, error: error instanceof Error ? error.message : String(error) })
        }
      }

      return { started, skipped, failed }
    },
    async cancel(runID: string) {
      const run = store.getRun(runID)
      if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
      const project = store.getProject(run.projectID)
      if (run.status !== "running" && run.status !== "queued") throw new Error("This run is no longer active.")
      const updated = store.updateRun(runID, { status: "cancelled", ended: Date.now() })!
      try {
        if (run.opencodeSessionID) await runSession(sessions.interrupt(run.opencodeSessionID, { resume: false }))
        if (project) {
          await Beads.updateStatus(project.worktree, run.issueID, "open")
          log(runID, "beads_status_updated", "Moved Beads issue back to open")
        }
      } finally {
        log(runID, "cancelled", "Cancelled run")
        store.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: runID })
        log(runID, "lease_released", "Released issue lease")
        emit(updated)
      }
      return updated
    },
    async requestChanges(runID: string, message: string) {
      const run = store.getRun(runID)
      if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
      if (!run.opencodeSessionID) throw new Error(`Run ${runID} has no OpenCode session`)
      if (run.status !== "needs_review" && run.status !== "failed")
        throw new Error("This run is not ready for changes.")
      const sessionID = run.opencodeSessionID
      const project = store.getProject(run.projectID)
      if (!project) throw new Error(`AgentBoard project not found: ${run.projectID}`)
      const lease = `issue:${run.projectID}:${run.issueID}`
      const acquired = store.acquireLease({ resource: lease, owner: runID })
      if (!acquired) throw new Error(`Run ${runID} is already receiving changes`)
      const prompt = `Please continue working on Beads issue ${run.issueID}.

${message.trim() || "Please review the current implementation, address any remaining problems, and summarize the result."}`
      await Beads.updateStatus(project.worktree, run.issueID, "in_progress").catch((error) => {
        store.releaseLease({ resource: lease, owner: runID })
        throw error
      })
      log(runID, "beads_status_updated", "Moved Beads issue back to in_progress")
      const updated = store.updateRun(runID, {
        status: "running",
        prompt,
        error: undefined,
        started: Date.now(),
        ended: undefined,
      })!
      log(runID, "request_changes", "Reviewer requested changes", { message })
      log(runID, "lease_acquired", "Acquired request-changes lease", { resource: lease })
      emit(updated)
      void finishRun(runID, project.worktree, lease, startPrompt(sessionID, prompt))
      return updated
    },
    async markDone(runID: string) {
      const run = store.getRun(runID)
      if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
      if (run.status !== "needs_review" && run.status !== "failed") throw new Error("This run is not ready to close.")
      const project = store.getProject(run.projectID)
      if (project) await Beads.updateStatus(project.worktree, run.issueID, "closed")
      const updated = store.updateRun(runID, { status: "done", ended: Date.now() })!
      log(runID, "done", "Marked done and closed the Beads issue")
      store.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: runID })
      log(runID, "lease_released", "Released issue lease")
      emit(updated)
      return updated
    },
    async refreshArtifacts(runID: string) {
      const run = store.getRun(runID)
      if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
      if (!run.opencodeSessionID) throw new Error(`Run ${runID} has no OpenCode session`)
      const project = store.getProject(run.projectID)
      if (!project) throw new Error(`AgentBoard project not found: ${run.projectID}`)
      await runSession(collectRunArtifacts(run, store, sessions))
      log(runID, "artifacts_collected", "Refreshed session, diff, and review artifacts")
      emit(run)
      return {
        run: store.getRun(runID)!,
        artifacts: store.listArtifacts(runID),
        events: store.listRunEvents(runID),
      }
    },
  }
}
