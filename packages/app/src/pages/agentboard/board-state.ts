import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID } from "./api"

export const BOARD_COLUMN_IDS = ["open", "in_progress", "needs_review", "closed"] as const

const BOARD_COLUMN_ID_SET = new Set<string>(BOARD_COLUMN_IDS)

export function normalizeBoardColumnID(value: string | undefined): AgentBoardColumnID | undefined {
  if (value === "ready") return "open"
  if (value === "blocked") return "open"
  if (value === "running") return "in_progress"
  return value && BOARD_COLUMN_ID_SET.has(value) ? (value as AgentBoardColumnID) : undefined
}

export function isBoardColumnID(value: string): value is AgentBoardColumnID {
  return !!normalizeBoardColumnID(value)
}

export function allCards(board?: AgentBoardBoard) {
  return board?.columns.flatMap((column) => column.cards) ?? []
}

export function normalizeBoard(board: AgentBoardBoard): AgentBoardBoard {
  const columns = new Map<AgentBoardColumnID, AgentBoardBoard["columns"][number]>()
  for (const id of BOARD_COLUMN_IDS) {
    columns.set(id, { id, title: boardColumnTitle(id), cards: [] })
  }
  for (const column of board.columns) {
    const id = normalizeBoardColumnID(column.id)
    if (!id) continue
    const current = columns.get(id)
    const title = boardColumnTitle(id)
    const legacyBlockedColumn = column.id === "blocked"
    const cards = column.cards.map((card) => ({
      ...card,
      column: id,
      issue: legacyBlockedColumn ? { ...card.issue, blocked: true } : card.issue,
    }))
    columns.set(id, current ? { ...current, title, cards: [...current.cards, ...cards] } : { id, title, cards })
  }
  return {
    ...board,
    columns: BOARD_COLUMN_IDS.map((id) => columns.get(id)!),
  }
}

export function boardColumnTitle(id: AgentBoardColumnID) {
  if (id === "open") return "Open"
  if (id === "in_progress") return "In Progress"
  if (id === "needs_review") return "Needs Review"
  if (id === "closed") return "Closed"
  return "Blocked"
}

export function findCard(board: AgentBoardBoard | undefined, issueID: string | undefined) {
  if (!issueID) return
  return allCards(board).find((card) => card.issue.id === issueID)
}

export function canMoveCardTo(card: AgentBoardCard, target: AgentBoardColumnID, options?: { allowSameColumn?: boolean }) {
  if (target === card.column && !options?.allowSameColumn) {
    return { ok: false, reason: "Card is already in this column." }
  }
  if (target === "blocked") {
    return { ok: false, reason: "Blocked is derived from Beads dependencies and cannot be set manually." }
  }
  if ((card.latestRun?.status === "queued" || card.latestRun?.status === "running") && target !== "in_progress") {
    return { ok: false, reason: "Cancel the active OpenCode run before moving this card." }
  }
  if (target === "in_progress" && (card.latestRun?.status === "needs_review" || card.latestRun?.status === "failed")) {
    return { ok: false, reason: "Use Request Changes to resume an OpenCode review run." }
  }
  return { ok: true, reason: undefined }
}

function issueStatusForColumn(column: AgentBoardColumnID) {
  if (column === "open") return "open"
  if (column === "in_progress" || column === "needs_review") return "in_progress"
  if (column === "closed") return "closed"
  return undefined
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
  const nextStatus = issueStatusForColumn(targetColumn)
  const nextCard = {
    ...moved,
    column: targetColumn,
    issue: nextStatus ? { ...moved.issue, status: nextStatus } : moved.issue,
  }
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
