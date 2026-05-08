import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID } from "./api"

export const BOARD_COLUMN_IDS = ["blocked", "ready", "running", "needs_review", "closed"] as const

export function isBoardColumnID(value: string): value is AgentBoardColumnID {
  return BOARD_COLUMN_IDS.includes(value as AgentBoardColumnID)
}

export function allCards(board?: AgentBoardBoard) {
  return board?.columns.flatMap((column) => column.cards) ?? []
}

export function findCard(board: AgentBoardBoard | undefined, issueID: string | undefined) {
  if (!issueID) return
  return allCards(board).find((card) => card.issue.id === issueID)
}

export function canMoveCardTo(card: AgentBoardCard, target: AgentBoardColumnID, options?: { allowSameColumn?: boolean }) {
  if (target === card.column && !options?.allowSameColumn) {
    return { ok: false, reason: "Card is already in this column." }
  }
  if (card.column === "blocked") {
    return { ok: false, reason: "Resolve this card's blocking dependencies in Beads before moving it." }
  }
  if (target === "blocked") {
    return { ok: false, reason: "Blocked is derived from Beads dependencies and cannot be set manually." }
  }
  if ((card.latestRun?.status === "queued" || card.latestRun?.status === "running") && target !== "running") {
    return { ok: false, reason: "Cancel the active OpenCode run before moving this card." }
  }
  if (target === "running" && (card.latestRun?.status === "needs_review" || card.latestRun?.status === "failed")) {
    return { ok: false, reason: "Use Request Changes to resume an OpenCode review run." }
  }
  return { ok: true, reason: undefined }
}

export function moveCardOnBoard(
  board: AgentBoardBoard,
  issueID: string,
  target: AgentBoardColumnID,
  beforeIssueID?: string,
): AgentBoardBoard {
  const moved = findCard(board, issueID)
  if (!moved) return board
  const targetCard = beforeIssueID ? findCard(board, beforeIssueID) : undefined
  const targetColumn = targetCard?.column ?? target
  const nextColumns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => card.issue.id !== issueID),
  }))
  const column = nextColumns.find((item) => item.id === targetColumn)
  if (!column) return board
  const insertAt = beforeIssueID ? column.cards.findIndex((card) => card.issue.id === beforeIssueID) : -1
  const nextCard = { ...moved, column: targetColumn }
  if (insertAt === -1) {
    column.cards = [...column.cards, nextCard]
  } else {
    column.cards = [...column.cards.slice(0, insertAt), nextCard, ...column.cards.slice(insertAt)]
  }
  return {
    ...board,
    columns: nextColumns,
  }
}
