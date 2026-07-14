import { describe, expect, test } from "bun:test"
import type { AgentBoardCard, AgentBoardDependency, BeadsIssue } from "./api"
import {
  buildEpicChildren,
  closedSortTimestamp,
  issueCreatedTimestamp,
  issueLabels,
  issueType,
  issueUpdatedTimestamp,
  timestampValue,
} from "./issue-utils"

function issue(id: string, raw: Record<string, unknown> = {}): BeadsIssue {
  return { id, title: id, raw }
}

function card(id: string, raw: Record<string, unknown> = {}): AgentBoardCard {
  return {
    column: "open",
    issue: issue(id, raw),
    artifacts: [],
    events: [],
  }
}

describe("agentboard issue utils", () => {
  test("reads labels and type from common Beads fields", () => {
    expect(issueLabels(issue("A", { labels: ["ui", "bug", 1, ""] }))).toEqual(["ui", "bug"])
    expect(issueLabels(issue("B", { tags: ["backend"] }))).toEqual(["backend"])
    expect(issueType(issue("C", { issue_type: "Epic" }))).toBe("epic")
    expect(issueType(issue("D", { type: "Task" }))).toBe("task")
  })

  test("builds recursive epic children from dependencies and raw metadata", () => {
    const dependencies: AgentBoardDependency[] = [
      { type: "parent-child", fromIssueID: "child-a", toIssueID: "epic-1" },
      { type: "blocks", fromIssueID: "ignored", toIssueID: "epic-1" },
    ]
    const cards = [
      card("epic-1"),
      card("child-a", { children: ["grandchild"] }),
      card("child-b", { epic_id: "epic-1" }),
      card("grandchild"),
    ]

    expect([...buildEpicChildren(dependencies, cards, "epic-1")].sort()).toEqual([
      "child-a",
      "child-b",
      "grandchild",
    ])
  })

  test("normalizes timestamps from seconds, milliseconds, and strings", () => {
    expect(timestampValue(1_700_000_000)).toBe(1_700_000_000_000)
    expect(timestampValue(1_700_000_000_000)).toBe(1_700_000_000_000)
    expect(timestampValue("1700000000")).toBe(1_700_000_000_000)
    expect(timestampValue("2024-01-01T00:00:00.000Z")).toBe(Date.parse("2024-01-01T00:00:00.000Z"))
  })

  test("picks created, updated, and closed sort timestamps from the best available source", () => {
    const runUpdated = 300
    const runEnded = 400
    const item: AgentBoardCard = {
      ...card("A", { created_at: "1700000000", updated_at: "1700000001" }),
      latestRun: {
        id: "run-1",
        projectID: "project-1",
        issueID: "A",
        status: "done",
        time: { created: 1, updated: runUpdated, ended: runEnded },
      },
    }

    expect(issueCreatedTimestamp(item.issue)).toBe(1_700_000_000_000)
    expect(issueUpdatedTimestamp(item)).toBe(1_700_000_001_000)
    expect(closedSortTimestamp(item)).toBe(runEnded)
  })
})
