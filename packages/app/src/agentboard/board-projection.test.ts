import { describe, expect, test } from "bun:test"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { boardCards, boardContentKey, boardEpics, boardIssueTypes, boardLabels, filterBoard } from "./board-projection"

function card(
  id: string,
  title: string,
  options: { column?: AgentBoardCard["column"]; type?: string; labels?: string[]; description?: string } = {},
): AgentBoardCard {
  return {
    column: options.column ?? "open",
    issue: {
      id,
      title,
      description: options.description,
      raw: {
        issue_type: options.type,
        labels: options.labels,
      },
    },
    artifacts: [],
    events: [],
  }
}

function board(): AgentBoardBoard {
  return {
    project: { id: "project-1", worktree: "/tmp/project", enabled: true, time: { created: 1, updated: 1 } },
    generatedAt: 1,
    graph: {
      dependencies: [
        { type: "parent-child", fromIssueID: "AB-2", toIssueID: "AB-1" },
        { type: "parent-child", fromIssueID: "AB-3", toIssueID: "AB-1" },
      ],
      positions: [],
    },
    columns: [
      {
        id: "open",
        title: "Open",
        cards: [
          card("AB-1", "Checkout epic", { type: "epic", labels: ["commerce"] }),
          card("AB-2", "Fix checkout", {
            type: "bug",
            labels: ["commerce", "urgent"],
            description: "Repair payment confirmation",
          }),
        ],
      },
      { id: "in_progress", title: "In Progress", cards: [card("AB-4", "Update docs", { type: "task" })] },
      { id: "needs_review", title: "Needs Review", cards: [] },
      { id: "closed", title: "Closed", cards: [card("AB-3", "Add receipt", { column: "closed", type: "task" })] },
    ],
  }
}

describe("agentboard board projection", () => {
  test("derives labels, issue types, and recursive epic progress", () => {
    const value = board()
    const cards = boardCards(value)

    expect(boardLabels(cards)).toEqual(["commerce", "urgent"])
    expect(boardIssueTypes(cards)).toEqual([
      { id: "task", label: "Task", count: 2 },
      { id: "bug", label: "Bug", count: 1 },
    ])
    expect(boardEpics(value, cards)).toEqual([
      {
        id: "AB-1",
        title: "Checkout epic",
        childCount: 2,
        closedCount: 1,
        childIDs: new Set(["AB-2", "AB-3"]),
      },
    ])
  })

  test("filters non-epic cards by query, epic membership, and issue type", () => {
    const value = board()
    const filtered = filterBoard(value, {
      query: "payment",
      childIDs: new Set(["AB-2", "AB-3"]),
      issueType: "bug",
    })

    expect(boardCards(filtered).map((item) => item.issue.id)).toEqual(["AB-2"])
  })

  test("content identity ignores polling timestamps but tracks meaningful board changes", () => {
    const value = board()
    const refreshed = { ...value, generatedAt: value.generatedAt + 1 }
    const changed = {
      ...value,
      columns: value.columns.map((column) => (column.id === "open" ? { ...column, title: "Backlog" } : column)),
    }

    expect(boardContentKey(refreshed)).toBe(boardContentKey(value))
    expect(boardContentKey(changed)).not.toBe(boardContentKey(value))
  })
})
