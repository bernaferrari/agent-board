import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { WithInstance } from "@/project/with-instance"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { SessionShare } from "@/share/session"
import { Beads } from "./beads"
import { AgentBoardEvents } from "./events"
import { collectRunArtifacts } from "./artifacts"
import { createAgentBoardPrompt } from "./prompt"
import { normalizeStartReadyLimit } from "./scheduler"
import { AgentBoardStore } from "./store"
import type { AgentBoardRun } from "./types"

function emit(run: AgentBoardRun) {
  AgentBoardEvents.emit({ type: "run.updated", projectID: run.projectID, runID: run.id, issueID: run.issueID })
  AgentBoardEvents.emit({ type: "board.updated", projectID: run.projectID })
}

function log(
  runID: string,
  type: Parameters<typeof AgentBoardStore.addRunEvent>[0]["type"],
  message: string,
  data?: unknown,
) {
  AgentBoardStore.addRunEvent({ runID, type, message, data })
}

async function finishRun(runID: string, worktree: string, lease: string, promise: Promise<unknown>) {
  try {
    await promise
    await WithInstance.provide({
      directory: worktree,
      async fn() {
        const current = AgentBoardStore.getRun(runID)
        if (!current || current.status === "cancelled") return
        await collectRunArtifacts(current)
        log(runID, "artifacts_collected", "Collected session, diff, and log artifacts")
        const updated = AgentBoardStore.updateRun(runID, { status: "needs_review", ended: Date.now() })
        log(runID, "needs_review", "Run completed and is ready for review")
        if (updated) {
          emit(updated)
          AgentBoardStore.releaseLease({ resource: lease, owner: runID })
          log(runID, "lease_released", "Released run lease")
        }
      },
    })
  } catch (error) {
    const current = AgentBoardStore.getRun(runID)
    if (!current || current.status === "cancelled") return
    const updated = AgentBoardStore.updateRun(runID, {
      status: "failed",
      ended: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    })
    log(runID, "failed", "Run failed", { error: error instanceof Error ? error.message : String(error) })
    AgentBoardStore.releaseLease({ resource: lease, owner: runID })
    log(runID, "lease_released", "Released run lease")
    if (updated) emit(updated)
  }
}

export const AgentBoardRuns = {
  async start(issueID: string) {
    const worktree = Instance.worktree
    const project = AgentBoardStore.upsertProject({ worktree })
    const issue = await Beads.show(worktree, issueID)
    const prompt = createAgentBoardPrompt(issue)
    const run = AgentBoardStore.createRun({ projectID: project.id, issueID, prompt })
    const lease = `issue:${project.id}:${issueID}`
    const acquired = AgentBoardStore.acquireLease({ resource: lease, owner: run.id })
    if (!acquired) {
      const failed = AgentBoardStore.updateRun(run.id, {
        status: "failed",
        ended: Date.now(),
        error: "Another AgentBoard run already owns this issue.",
      })!
      log(run.id, "failed", "Could not acquire issue lease")
      emit(failed)
      return failed
    }
    log(run.id, "queued", "Queued from Ready")
    log(run.id, "lease_acquired", "Acquired issue lease", { resource: lease })
    emit(run)

    let session: { id: SessionID }
    try {
      await Beads.updateStatus(worktree, issueID, "in_progress")
      log(run.id, "beads_status_updated", "Moved Beads issue to in_progress")
      session = await AppRuntime.runPromise(
        SessionShare.Service.use((service) => service.create({ title: `${issue.id}: ${issue.title}` })),
      )
    } catch (error) {
      const failed = AgentBoardStore.updateRun(run.id, {
        status: "failed",
        ended: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })!
      log(run.id, "failed", "Failed before prompt start", { error: failed.error })
      AgentBoardStore.releaseLease({ resource: lease, owner: run.id })
      log(run.id, "lease_released", "Released issue lease")
      emit(failed)
      return failed
    }
    log(run.id, "session_created", "Created OpenCode session", { sessionID: session.id })
    const running = AgentBoardStore.updateRun(run.id, {
      status: "running",
      opencodeSessionID: session.id,
      started: Date.now(),
    })!
    log(run.id, "prompt_started", "Sent implementation prompt to OpenCode")
    AgentBoardStore.addArtifact({
      runID: run.id,
      kind: "session",
      title: "OpenCode session",
      url: `/session/${session.id}`,
      data: { sessionID: session.id },
    })
    emit(running)

    void finishRun(
      run.id,
      worktree,
      lease,
      AppRuntime.runPromise(
        SessionPrompt.Service.use((service) =>
          service.prompt({
            sessionID: session.id,
            parts: [{ type: "text", text: prompt }],
          }),
        ),
      ),
    )

    return AgentBoardStore.getRun(run.id)!
  },
  async startReady(input?: { limit?: number }) {
    const worktree = Instance.worktree
    const project = AgentBoardStore.upsertProject({ worktree })
    const limit = normalizeStartReadyLimit(input?.limit)
    const ready = await Beads.listReady(worktree)
    const latest = AgentBoardStore.latestRunByIssue(project.id)
    const started: AgentBoardRun[] = []
    const skipped: Array<{ issueID: string; reason: string }> = []
    const failed: Array<{ issueID: string; error: string }> = []

    for (const issue of ready) {
      if (started.length >= limit) break
      const run = latest.get(issue.id)
      if (run?.status === "queued" || run?.status === "running") {
        skipped.push({ issueID: issue.id, reason: "Already running" })
        continue
      }
      try {
        const created = await this.start(issue.id)
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
    const run = AgentBoardStore.getRun(runID)
    if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
    if (run.opencodeSessionID) {
      await AppRuntime.runPromise(
        SessionPrompt.Service.use((service) => service.cancel(run.opencodeSessionID! as SessionID)),
      )
    }
    const project = AgentBoardStore.getProject(run.projectID)
    if (project) {
      await Beads.updateStatus(project.worktree, run.issueID, "open")
      log(runID, "beads_status_updated", "Moved Beads issue back to open")
    }
    const updated = AgentBoardStore.updateRun(runID, { status: "cancelled", ended: Date.now() })!
    log(runID, "cancelled", "Cancelled run")
    AgentBoardStore.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: runID })
    log(runID, "lease_released", "Released issue lease")
    emit(updated)
    return updated
  },
  async requestChanges(runID: string, message: string) {
    const run = AgentBoardStore.getRun(runID)
    if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
    if (!run.opencodeSessionID) throw new Error(`Run ${runID} has no OpenCode session`)
    const sessionID = run.opencodeSessionID as SessionID
    const lease = `run:${runID}`
    const acquired = AgentBoardStore.acquireLease({ resource: lease, owner: runID })
    if (!acquired) throw new Error(`Run ${runID} is already receiving changes`)
    const prompt = `Please continue working on Beads issue ${run.issueID}.

${message.trim() || "Please review the current implementation, address any remaining problems, and summarize the result."}`
    const project = AgentBoardStore.getProject(run.projectID)
    if (project) {
      await Beads.updateStatus(project.worktree, run.issueID, "in_progress")
      log(runID, "beads_status_updated", "Moved Beads issue back to in_progress")
    }
    const updated = AgentBoardStore.updateRun(runID, {
      status: "running",
      prompt,
      error: undefined,
      started: Date.now(),
      ended: undefined,
    })!
    log(runID, "request_changes", "Reviewer requested changes", { message })
    log(runID, "lease_acquired", "Acquired request-changes lease", { resource: lease })
    emit(updated)
    void finishRun(
      runID,
      Instance.worktree,
      lease,
      AppRuntime.runPromise(
        SessionPrompt.Service.use((service) =>
          service.prompt({
            sessionID,
            parts: [{ type: "text", text: prompt }],
          }),
        ),
      ),
    )
    return updated
  },
  async markDone(runID: string) {
    const run = AgentBoardStore.getRun(runID)
    if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
    const project = AgentBoardStore.getProject(run.projectID)
    if (project) await Beads.updateStatus(project.worktree, run.issueID, "closed")
    const updated = AgentBoardStore.updateRun(runID, { status: "done", ended: Date.now() })!
    log(runID, "done", "Marked done and closed the Beads issue")
    AgentBoardStore.releaseLease({ resource: `issue:${run.projectID}:${run.issueID}`, owner: runID })
    log(runID, "lease_released", "Released issue lease")
    emit(updated)
    return updated
  },
  async refreshArtifacts(runID: string) {
    const run = AgentBoardStore.getRun(runID)
    if (!run) throw new Error(`AgentBoard run not found: ${runID}`)
    if (!run.opencodeSessionID) throw new Error(`Run ${runID} has no OpenCode session`)
    await collectRunArtifacts(run)
    log(runID, "artifacts_collected", "Refreshed session, diff, and review artifacts")
    emit(run)
    return {
      run: AgentBoardStore.getRun(runID)!,
      artifacts: AgentBoardStore.listArtifacts(runID),
      events: AgentBoardStore.listRunEvents(runID),
    }
  },
}
