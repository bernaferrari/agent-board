import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Beads } from "./beads"
import { getAgentBoard } from "./board"
import type { AgentBoardEvents } from "./events"
import { beadsStatusForColumn } from "./moves"
import type { AgentBoardReconciler } from "./reconcile"
import type { createAgentBoardRuns } from "./runs"
import type { AgentBoardStore } from "./store"
import type { AgentBoardColumnID } from "./types"

async function handle<T>(c: { json: (value: unknown, status?: number) => Response }, fn: () => Promise<T> | T) {
  try {
    return c.json(await fn())
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}

export function AgentBoardRoutes(input: {
  worktree: string
  store: AgentBoardStore
  events: AgentBoardEvents
  runs: ReturnType<typeof createAgentBoardRuns>
  reconciler: AgentBoardReconciler
}) {
  const worktree = input.worktree
  const store = input.store

  function projectRun(runID: string) {
    const run = store.getRun(runID)
    if (!run || store.getProject(run.projectID)?.worktree !== worktree) throw new Error(`Run not found: ${runID}`)
    return run
  }

  async function moveCard(issueID: string, column: AgentBoardColumnID) {
    const project = store.upsertProject({ worktree })
    const latest = store.latestRunByIssue(project.id).get(issueID)
    if (latest && (latest.status === "queued" || latest.status === "running") && column !== "in_progress") {
      throw new Error("Cancel the active OpenCode run before moving this card.")
    }
    const beadsStatus = beadsStatusForColumn(column)
    if (beadsStatus) await Beads.updateStatus(worktree, issueID, beadsStatus, column === "needs_review")
    if (column === "needs_review") {
      const run =
        latest ??
        store.createRun({
          projectID: project.id,
          issueID,
          prompt: "Manual review marker created from AgentBoard.",
        })
      store.updateRun(run.id, { status: "needs_review", ended: Date.now() })
      store.addRunEvent({
        runID: run.id,
        type: "needs_review",
        message: latest ? "Moved to Needs Review from the board" : "Moved to Needs Review manually from the board",
      })
    }
    if (latest && column === "open" && (latest.status === "needs_review" || latest.status === "failed")) {
      store.updateRun(latest.id, { status: "cancelled", ended: Date.now() })
      store.addRunEvent({
        runID: latest.id,
        type: "cancelled",
        message: "Returned to Open from the board",
      })
    }
    if (latest && column === "closed" && latest.status !== "done") {
      store.updateRun(latest.id, { status: "done", ended: Date.now() })
      store.addRunEvent({
        runID: latest.id,
        type: "done",
        message: "Closed from the board",
      })
    }
    input.events.emit({ type: "board.updated", projectID: project.id })
    return true
  }

  return new Hono()
    .basePath("/api/agentboard")
    .get("/board", async (c) => handle(c, () => getAgentBoard(worktree, store, input.reconciler)))
    .post("/graph/positions", async (c) =>
      handle(c, async () => {
        const body = z
          .object({
            positions: z.array(
              z.object({
                issueID: z.string().min(1),
                x: z.number(),
                y: z.number(),
                pinned: z.boolean().optional(),
              }),
            ),
          })
          .parse(await c.req.json())
        const project = store.upsertProject({ worktree })
        store.setGraphPositions(
          project.id,
          body.positions.map((position) => ({
            issueID: position.issueID,
            x: position.x,
            y: position.y,
            pinned: position.pinned ?? true,
          })),
        )
        input.events.emit({ type: "board.updated", projectID: project.id })
        return true
      }),
    )
    .post("/issues", async (c) =>
      handle(c, async () => {
        const body = z
          .object({
            title: z.string().trim().min(1),
            description: z.string().optional(),
            priority: z.number().int().min(0).max(4).optional(),
            labels: z.array(z.string()).optional(),
            runImmediately: z.boolean().optional(),
          })
          .parse(await c.req.json())
        const project = store.upsertProject({ worktree })
        const issue = await Beads.create(worktree, body)
        const run = body.runImmediately ? await input.runs.start(worktree, issue.id) : undefined
        input.events.emit({ type: "board.updated", projectID: project.id })
        return {
          issue,
          run,
        }
      }),
    )
    .post("/reconcile", async (c) =>
      handle(c, () => {
        const project = store.upsertProject({ worktree })
        return input.reconciler.reconcile(project.id)
      }),
    )
    .post("/setup/init", async (c) =>
      handle(c, async () => {
        const result = await Beads.init(worktree)
        const project = store.upsertProject({ worktree })
        input.events.emit({ type: "board.updated", projectID: project.id })
        return {
          ok: true,
          stdout: result.stdout,
          stderr: result.stderr,
        }
      }),
    )
    .get("/runs/:runID", async (c) =>
      handle(c, () => {
        const run = projectRun(c.req.param("runID"))
        return {
          run,
          artifacts: store.listArtifacts(run.id),
          events: store.listRunEvents(run.id),
        }
      }),
    )
    .post("/cards/:issueID/run", async (c) => handle(c, () => input.runs.start(worktree, c.req.param("issueID"))))
    .post("/runs/start-open", async (c) =>
      handle(c, async () => {
        const body = z.object({ limit: z.number().optional() }).parse(await c.req.json().catch(() => ({})))
        return input.runs.startOpen(worktree, body)
      }),
    )
    .post("/runs/start-ready", async (c) =>
      handle(c, async () => {
        const body = z.object({ limit: z.number().optional() }).parse(await c.req.json().catch(() => ({})))
        return input.runs.startOpen(worktree, body)
      }),
    )
    .post("/cards/:issueID/status", async (c) =>
      handle(c, async () => {
        const body = z
          .object({
            status: z.string().optional(),
            column: z
              .enum(["blocked", "open", "ready", "running", "in_progress", "needs_review", "closed"])
              .transform((value) => (value === "ready" ? "open" : value === "running" ? "in_progress" : value))
              .optional(),
          })
          .parse(await c.req.json())
        if (body.column) return moveCard(c.req.param("issueID"), body.column)
        if (!body.status) throw new Error("Missing status or column")
        await Beads.updateStatus(worktree, c.req.param("issueID"), body.status)
        input.events.emit({
          type: "board.updated",
          projectID: store.upsertProject({ worktree }).id,
        })
        return true
      }),
    )
    .post("/runs/:runID/cancel", async (c) => handle(c, () => input.runs.cancel(projectRun(c.req.param("runID")).id)))
    .post("/runs/:runID/request-changes", async (c) =>
      handle(c, async () => {
        const body = z.object({ message: z.string().optional() }).parse(await c.req.json())
        return input.runs.requestChanges(projectRun(c.req.param("runID")).id, body.message ?? "")
      }),
    )
    .post("/runs/:runID/mark-done", async (c) =>
      handle(c, () => input.runs.markDone(projectRun(c.req.param("runID")).id)),
    )
    .post("/runs/:runID/artifacts/refresh", async (c) =>
      handle(c, () => input.runs.refreshArtifacts(projectRun(c.req.param("runID")).id)),
    )
    .get("/events", (c) => {
      const project = store.upsertProject({ worktree })
      return streamSSE(c, async (writer) => {
        await new Promise<void>((resolve) => {
          const off = input.events.on((event) => {
            if (event.projectID !== project.id) return
            void writer.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => writer.abort())
          })
          const heartbeat = setInterval(() => {
            void writer.writeSSE({ event: "ping", data: "{}" }).catch(() => writer.abort())
          }, 20_000)
          writer.onAbort(() => {
            clearInterval(heartbeat)
            off()
            resolve()
          })
          if (writer.aborted) {
            clearInterval(heartbeat)
            off()
            resolve()
            return
          }
          void writer.writeSSE({ event: "ready", data: "{}" }).catch(() => writer.abort())
        })
      })
    })
}
