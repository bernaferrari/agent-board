import { describe, expect, test } from "bun:test"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { canMoveCardTo, findCard, isBoardColumnID, moveCardOnBoard, normalizeBoard } from "./board-state"

const openCard: AgentBoardCard = {
  column: "open",
  issue: { id: "AB-1", title: "Open work", raw: {} },
  artifacts: [],
  events: [],
}

const reviewableCard: AgentBoardCard = {
  ...openCard,
  issue: { id: "AB-2", title: "Reviewable work", raw: {} },
  latestRun: {
    id: "run-1",
    projectID: "project-1",
    issueID: "AB-2",
    status: "running",
    time: { created: 1, updated: 1 },
  },
}

const completedOpenCard: AgentBoardCard = {
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
      { id: "open", title: "Open", cards: [openCard, reviewableCard] },
      { id: "in_progress", title: "In Progress", cards: [] },
      { id: "needs_review", title: "Needs Review", cards: [] },
      { id: "closed", title: "Closed", cards: [] },
    ],
  }
}

describe("agentboard board state", () => {
  test("recognizes board column ids", () => {
    expect(isBoardColumnID("open")).toBe(true)
    expect(isBoardColumnID("blocked")).toBe(true)
    expect(isBoardColumnID("unknown")).toBe(false)
  })

  test("merges legacy blocked columns into open", () => {
    const blockedCard: AgentBoardCard = {
      ...openCard,
      column: "blocked",
      issue: { id: "AB-B", title: "Blocked work", raw: {} },
    }
    const normalized = normalizeBoard({
      ...board(),
      columns: [
        { id: "blocked", title: "Blocked", cards: [blockedCard] },
        ...board().columns,
      ],
    })

    expect(normalized.columns.map((column) => column.id)).toEqual(["open", "in_progress", "needs_review", "closed"])
    expect(findCard(normalized, "AB-B")).toMatchObject({
      column: "open",
      issue: { blocked: true },
    })
  })

  test("moves a card between columns optimistically", () => {
    const moved = moveCardOnBoard(board(), "AB-1", "in_progress")

    expect(findCard(moved, "AB-1")?.column).toBe("in_progress")
    expect(findCard(moved, "AB-1")?.issue.status).toBe("in_progress")
    expect(moved.columns.find((column) => column.id === "open")?.cards.map((card) => card.issue.id)).toEqual(["AB-2"])
    expect(moved.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.issue.id)).toEqual([
      "AB-1",
    ])
  })

  test("reorders cards within a column", () => {
    const moved = moveCardOnBoard(board(), "AB-2", "open", "AB-1")

    expect(findCard(moved, "AB-2")?.issue.status).toBe("open")
    expect(moved.columns.find((column) => column.id === "open")?.cards.map((card) => card.issue.id)).toEqual([
      "AB-2",
      "AB-1",
    ])
  })

  test("blocks impossible manual moves before optimistic UI", () => {
    expect(canMoveCardTo(openCard, "blocked").ok).toBe(false)
    expect(canMoveCardTo(openCard, "open").ok).toBe(false)
    expect(canMoveCardTo(openCard, "needs_review").ok).toBe(true)
    expect(canMoveCardTo(completedOpenCard, "needs_review").ok).toBe(true)
    expect(canMoveCardTo(reviewableCard, "closed").ok).toBe(false)
    expect(canMoveCardTo(reviewCard, "in_progress").ok).toBe(false)
  })
})
