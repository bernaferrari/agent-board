import { describe, expect, test } from "bun:test"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { applyBoardOrder, insertArrayItemBefore, normalizeColumnOrder, orderFromBoard } from "./board-order"

function card(id: string): AgentBoardCard {
  return {
    column: "ready",
    issue: { id, title: id, raw: {} },
    artifacts: [],
    events: [],
  }
}

function board(): AgentBoardBoard {
  return {
    project: { id: "project-1", worktree: "/tmp/project", enabled: true, time: { created: 1, updated: 1 } },
    generatedAt: 1,
    graph: { dependencies: [], positions: [] },
    columns: [
      { id: "blocked", title: "Blocked", cards: [] },
      { id: "ready", title: "Ready", cards: [card("A"), card("B"), card("C")] },
      { id: "running", title: "Running", cards: [card("D")] },
      { id: "needs_review", title: "Needs Review", cards: [] },
      { id: "closed", title: "Closed", cards: [] },
    ],
  }
}

describe("agentboard board order", () => {
  test("normalizes invalid and duplicate columns", () => {
    expect(normalizeColumnOrder(["running", "ready", "running", "unknown" as never])).toEqual([
      "running",
      "ready",
      "blocked",
      "needs_review",
      "closed",
    ])
  })

  test("applies saved column and card order while preserving unknown cards", () => {
    const ordered = applyBoardOrder(board(), {
      columns: ["running", "ready", "closed", "blocked", "needs_review"],
      cards: { ready: ["C", "A"] },
    })

    expect(ordered.columns.map((column) => column.id)).toEqual([
      "running",
      "ready",
      "closed",
      "blocked",
      "needs_review",
    ])
    expect(ordered.columns.find((column) => column.id === "ready")?.cards.map((item) => item.issue.id)).toEqual([
      "C",
      "A",
      "B",
    ])
  })

  test("captures order from current board", () => {
    const order = orderFromBoard(board(), ["ready", "running"])

    expect(order.columns).toEqual(["ready", "running", "blocked", "needs_review", "closed"])
    expect(order.cards.ready).toEqual(["A", "B", "C"])
    expect(order.cards.running).toEqual(["D"])
  })

  test("moves array items before another item or to the end", () => {
    expect(insertArrayItemBefore(["A", "B", "C"], "C", "A")).toEqual(["C", "A", "B"])
    expect(insertArrayItemBefore(["A", "B", "C"], "A")).toEqual(["B", "C", "A"])
    expect(insertArrayItemBefore(["A", "B", "C"], "B", "B")).toEqual(["A", "B", "C"])
  })
})
