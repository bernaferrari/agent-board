import { describe, expect, test } from "bun:test"
import { createIssueArgs, dependenciesFromRawIssues, normalizeDependency, normalizeIssue } from "../../src/agentboard/beads"
import { columnForIssue } from "../../src/agentboard/board"
import { beadsStatusForColumn } from "../../src/agentboard/moves"
import { createAgentBoardPrompt } from "../../src/agentboard/prompt"
import { queuedRunIsStale, runningRunCanBeReconciled } from "../../src/agentboard/reconcile"
import { normalizeStartReadyLimit } from "../../src/agentboard/scheduler"
import type { AgentBoardRun } from "../../src/agentboard/types"

function run(status: AgentBoardRun["status"]): AgentBoardRun {
  return {
    id: `run-${status}`,
    projectID: "project-1",
    issueID: "task-123",
    status,
    time: {
      created: 1,
      updated: 1,
    },
  }
}

function timedRun(status: AgentBoardRun["status"], time: Partial<AgentBoardRun["time"]>): AgentBoardRun {
  return {
    ...run(status),
    opencodeSessionID: "ses_test",
    time: {
      ...run(status).time,
      ...time,
    },
  }
}

describe("agentboard", () => {
  test("normalizes Beads issue payloads", () => {
    const issue = normalizeIssue({
      id: "task-123",
      title: "Build board mode",
      status: "open",
      priority: "2",
      description: "Wire a Kanban board to Beads.",
    })

    expect(issue.id).toBe("task-123")
    expect(issue.title).toBe("Build board mode")
    expect(issue.status).toBe("open")
    expect(issue.priority).toBe(2)
    expect(issue.description).toBe("Wire a Kanban board to Beads.")
  })

  test("builds shell-free Beads create commands", () => {
    expect(
      createIssueArgs({
        title: "Add agent board composer",
        description: "Let users file work from the board.",
        priority: 1,
        labels: ["agentboard", "#ux", " "],
      }),
    ).toEqual([
      "create",
      "--title",
      "Add agent board composer",
      "--silent",
      "--description",
      "Let users file work from the board.",
      "--priority",
      "1",
      "--labels",
      "agentboard,ux",
    ])
  })

  test("normalizes Beads dependency records for graph projection", () => {
    expect(
      normalizeDependency({
        from_id: "AB-2",
        to_id: "AB-1",
        dependency_type: "blocks",
      }),
    ).toEqual({
      fromIssueID: "AB-2",
      toIssueID: "AB-1",
      type: "blocks",
    })
    expect(
      dependenciesFromRawIssues([
        {
          id: "AB-2",
          title: "Dependent",
          raw: {
            depends_on: ["AB-1"],
          },
        },
      ]),
    ).toEqual([
      {
        fromIssueID: "AB-2",
        toIssueID: "AB-1",
        type: "blocks",
      },
    ])
  })

  test("generates a scoped agent prompt from an issue", () => {
    const prompt = createAgentBoardPrompt({
      id: "task-456",
      title: "Add review action",
      status: "ready",
      priority: 1,
      description: "Let a user request changes from the board.",
      raw: { id: "task-456", title: "Add review action" },
    })

    expect(prompt).toContain("Please implement this Beads issue")
    expect(prompt).toContain("task-456")
    expect(prompt).toContain("Add review action")
    expect(prompt).toContain("Keep changes scoped")
  })

  test("maps board drop targets to Beads statuses", () => {
    expect(beadsStatusForColumn("ready")).toBe("open")
    expect(beadsStatusForColumn("running")).toBe("in_progress")
    expect(beadsStatusForColumn("closed")).toBe("closed")
    expect(beadsStatusForColumn("needs_review")).toBe("in_progress")
    expect(() => beadsStatusForColumn("blocked")).toThrow("dependency-derived")
  })

  test("projects run lifecycle over Beads status when needed", () => {
    expect(columnForIssue("ready", run("queued"))).toBe("running")
    expect(columnForIssue("ready", run("running"))).toBe("running")
    expect(columnForIssue("running", run("needs_review"))).toBe("needs_review")
    expect(columnForIssue("running", run("failed"))).toBe("needs_review")
    expect(columnForIssue("ready", run("needs_review"))).toBe("needs_review")
    expect(columnForIssue("ready", run("failed"))).toBe("needs_review")
    expect(columnForIssue("running", run("done"))).toBe("closed")
    expect(columnForIssue("blocked", run("cancelled"))).toBe("blocked")
  })

  test("caps bulk start concurrency", () => {
    expect(normalizeStartReadyLimit(undefined)).toBe(3)
    expect(normalizeStartReadyLimit("bad")).toBe(3)
    expect(normalizeStartReadyLimit(0)).toBe(1)
    expect(normalizeStartReadyLimit(2.9)).toBe(2)
    expect(normalizeStartReadyLimit(20)).toBe(5)
  })

  test("only reconciles stale active runs", () => {
    expect(queuedRunIsStale({ ...run("queued"), time: { created: 0, updated: 0 } }, 1000 * 60)).toBe(false)
    expect(queuedRunIsStale({ ...run("queued"), time: { created: 0, updated: 0 } }, 1000 * 60 * 3)).toBe(true)
    expect(runningRunCanBeReconciled(timedRun("running", { created: 0, started: 0 }), 1000 * 5)).toBe(false)
    expect(runningRunCanBeReconciled(timedRun("running", { created: 0, started: 0 }), 1000 * 30)).toBe(true)
    expect(runningRunCanBeReconciled(timedRun("needs_review", { created: 0, started: 0 }), 1000 * 30)).toBe(false)
  })
})
