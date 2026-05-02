import { Hono } from "hono"
import { stream } from "hono/streaming"
import z from "zod"
import { Instance } from "@/project/instance"
import { Beads } from "./beads"
import { getAgentBoard } from "./board"
import { AgentBoardEvents } from "./events"
import { beadsStatusForColumn } from "./moves"
import { AgentBoardReconciler } from "./reconcile"
import { AgentBoardRuns } from "./runs"
import { AgentBoardStore } from "./store"
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

export function AgentBoardRoutes() {
  async function moveCard(issueID: string, column: AgentBoardColumnID) {
    const project = AgentBoardStore.upsertProject({ worktree: Instance.worktree })
    const latest = AgentBoardStore.latestRunByIssue(project.id).get(issueID)
    if (latest && (latest.status === "queued" || latest.status === "running") && column !== "running") {
      throw new Error("Cancel the active OpenCode run before moving this card.")
    }
    const beadsStatus = beadsStatusForColumn(column)
    if (beadsStatus) await Beads.updateStatus(Instance.worktree, issueID, beadsStatus)
    if (column === "needs_review") {
      const run = latest
      if (!run) throw new Error("Needs Review requires an AgentBoard run.")
      AgentBoardStore.updateRun(run.id, { status: "needs_review", ended: Date.now() })
      AgentBoardStore.addRunEvent({
        runID: run.id,
        type: "needs_review",
        message: "Moved to Needs Review from the board",
      })
    }
    if (latest && column === "ready" && (latest.status === "needs_review" || latest.status === "failed")) {
      AgentBoardStore.updateRun(latest.id, { status: "cancelled", ended: Date.now() })
      AgentBoardStore.addRunEvent({
        runID: latest.id,
        type: "cancelled",
        message: "Returned to Ready from the board",
      })
    }
    if (latest && column === "closed" && latest.status !== "done") {
      AgentBoardStore.updateRun(latest.id, { status: "done", ended: Date.now() })
      AgentBoardStore.addRunEvent({
        runID: latest.id,
        type: "done",
        message: "Closed from the board",
      })
    }
    AgentBoardEvents.emit({ type: "board.updated", projectID: project.id })
    return true
  }

  return new Hono()
    .get("/projects", async (c) =>
      handle(c, () => {
        const current = AgentBoardStore.upsertProject({ worktree: Instance.worktree })
        return {
          current,
          projects: AgentBoardStore.listProjects(),
        }
      }),
    )
    .post("/projects", async (c) =>
      handle(c, async () => {
        const body = z.object({ worktree: z.string(), bdDbPath: z.string().optional() }).parse(await c.req.json())
        return AgentBoardStore.upsertProject(body)
      }),
    )
    .get("/board", async (c) => handle(c, () => getAgentBoard()))
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
        const project = AgentBoardStore.upsertProject({ worktree: Instance.worktree })
        const issue = await Beads.create(Instance.worktree, body)
        const run = body.runImmediately ? await AgentBoardRuns.start(issue.id) : undefined
        AgentBoardEvents.emit({ type: "board.updated", projectID: project.id })
        return {
          issue,
          run,
        }
      }),
    )
    .post("/reconcile", async (c) =>
      handle(c, () => {
        const project = AgentBoardStore.upsertProject({ worktree: Instance.worktree })
        return AgentBoardReconciler.reconcile(project.id)
      }),
    )
    .post("/setup/init", async (c) =>
      handle(c, async () => {
        const result = await Beads.init(Instance.worktree)
        const project = AgentBoardStore.upsertProject({ worktree: Instance.worktree })
        AgentBoardEvents.emit({ type: "board.updated", projectID: project.id })
        return {
          ok: true,
          stdout: result.stdout,
          stderr: result.stderr,
        }
      }),
    )
    .get("/runs/:runID", async (c) =>
      handle(c, () => {
        const run = AgentBoardStore.getRun(c.req.param("runID"))
        if (!run) throw new Error(`Run not found: ${c.req.param("runID")}`)
        return {
          run,
          artifacts: AgentBoardStore.listArtifacts(run.id),
          events: AgentBoardStore.listRunEvents(run.id),
        }
      }),
    )
    .post("/cards/:issueID/run", async (c) => handle(c, () => AgentBoardRuns.start(c.req.param("issueID"))))
    .post("/runs/start-ready", async (c) =>
      handle(c, async () => {
        const body = z.object({ limit: z.number().optional() }).parse(await c.req.json().catch(() => ({})))
        return AgentBoardRuns.startReady(body)
      }),
    )
    .post("/cards/:issueID/status", async (c) =>
      handle(c, async () => {
        const body = z
          .object({
            status: z.string().optional(),
            column: z.enum(["blocked", "ready", "running", "needs_review", "closed"]).optional(),
          })
          .parse(await c.req.json())
        if (body.column) return moveCard(c.req.param("issueID"), body.column)
        if (!body.status) throw new Error("Missing status or column")
        await Beads.updateStatus(Instance.worktree, c.req.param("issueID"), body.status)
        AgentBoardEvents.emit({
          type: "board.updated",
          projectID: AgentBoardStore.upsertProject({ worktree: Instance.worktree }).id,
        })
        return true
      }),
    )
    .post("/runs/:runID/cancel", async (c) => handle(c, () => AgentBoardRuns.cancel(c.req.param("runID"))))
    .post("/runs/:runID/request-changes", async (c) =>
      handle(c, async () => {
        const body = z.object({ message: z.string().optional() }).parse(await c.req.json())
        return AgentBoardRuns.requestChanges(c.req.param("runID"), body.message ?? "")
      }),
    )
    .post("/runs/:runID/mark-done", async (c) => handle(c, () => AgentBoardRuns.markDone(c.req.param("runID"))))
    .post("/runs/:runID/artifacts/refresh", async (c) =>
      handle(c, () => AgentBoardRuns.refreshArtifacts(c.req.param("runID"))),
    )
    .get("/events", (c) =>
      stream(c, async (writer) => {
        await writer.write("event: ready\ndata: {}\n\n")
        const off = AgentBoardEvents.on((event) => {
          void writer.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        })
        await new Promise<void>((resolve) => {
          c.req.raw.signal.addEventListener("abort", () => {
            off()
            resolve()
          })
        })
      }),
    )
}
