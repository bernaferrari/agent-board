import { describe, expect, test } from "bun:test"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { canMoveCardTo, findCard, isBoardColumnID, moveCardOnBoard } from "./board-state"

const readyCard: AgentBoardCard = {
  column: "ready",
  issue: { id: "AB-1", title: "Ready work", raw: {} },
  artifacts: [],
  events: [],
}

const reviewableCard: AgentBoardCard = {
  ...readyCard,
  issue: { id: "AB-2", title: "Reviewable work", raw: {} },
  latestRun: {
    id: "run-1",
    projectID: "project-1",
    issueID: "AB-2",
    status: "running",
    time: { created: 1, updated: 1 },
  },
}

const completedReadyCard: AgentBoardCard = {
  ...reviewableCard,
  latestRun: {
    ...reviewableCard.latestRun!,
    status: "cancelled",
  },
}

const reviewCard: AgentBoardCard = {
  ...reviewableCard,
  column: "needs_review",
  latestRun: {
    ...reviewableCard.latestRun!,
    status: "needs_review",
  },
}

function board(): AgentBoardBoard {
  return {
    project: { id: "project-1", worktree: "/tmp/project", enabled: true, time: { created: 1, updated: 1 } },
    generatedAt: 1,
    graph: { dependencies: [], positions: [] },
    columns: [
      { id: "blocked", title: "Blocked", cards: [] },
      { id: "ready", title: "Ready", cards: [readyCard, reviewableCard] },
      { id: "running", title: "Running", cards: [] },
      { id: "needs_review", title: "Needs Review", cards: [] },
      { id: "closed", title: "Closed", cards: [] },
    ],
  }
}

describe("agentboard board state", () => {
  test("recognizes board column ids", () => {
    expect(isBoardColumnID("ready")).toBe(true)
    expect(isBoardColumnID("blocked")).toBe(true)
    expect(isBoardColumnID("unknown")).toBe(false)
  })

  test("moves a card between columns optimistically", () => {
    const moved = moveCardOnBoard(board(), "AB-1", "running")

    expect(findCard(moved, "AB-1")?.column).toBe("running")
    expect(moved.columns.find((column) => column.id === "ready")?.cards.map((card) => card.issue.id)).toEqual(["AB-2"])
    expect(moved.columns.find((column) => column.id === "running")?.cards.map((card) => card.issue.id)).toEqual([
      "AB-1",
    ])
  })

  test("reorders cards within a column", () => {
    const moved = moveCardOnBoard(board(), "AB-2", "ready", "AB-1")

    expect(moved.columns.find((column) => column.id === "ready")?.cards.map((card) => card.issue.id)).toEqual([
      "AB-2",
      "AB-1",
    ])
  })

  test("blocks impossible manual moves before optimistic UI", () => {
    expect(canMoveCardTo(readyCard, "blocked").ok).toBe(false)
    expect(canMoveCardTo(readyCard, "ready").ok).toBe(false)
    expect(canMoveCardTo(readyCard, "needs_review").ok).toBe(false)
    expect(canMoveCardTo(completedReadyCard, "needs_review").ok).toBe(true)
    expect(canMoveCardTo(reviewableCard, "closed").ok).toBe(false)
    expect(canMoveCardTo(reviewCard, "running").ok).toBe(false)
  })
})
