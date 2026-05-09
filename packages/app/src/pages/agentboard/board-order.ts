import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID } from "./api"
import { BOARD_COLUMN_IDS, isBoardColumnID } from "./board-state"

const BOARD_ORDER_STORAGE_PREFIX = "agentboard.order"

export type BoardLocalOrder = {
  columns: AgentBoardColumnID[]
  cards: Partial<Record<AgentBoardColumnID, string[]>>
}

function defaultBoardOrder(): BoardLocalOrder {
  return {
    columns: [...BOARD_COLUMN_IDS],
    cards: {},
  }
}

function boardOrderKey(directory: string) {
  return `${BOARD_ORDER_STORAGE_PREFIX}:${directory}`
}

export function normalizeColumnOrder(input?: AgentBoardColumnID[]) {
  const seen = new Set<AgentBoardColumnID>()
  const output: AgentBoardColumnID[] = []
  for (const column of input ?? []) {
    if (!isBoardColumnID(column) || seen.has(column)) continue
    seen.add(column)
    output.push(column)
  }
  for (const column of BOARD_COLUMN_IDS) {
    if (!seen.has(column)) output.push(column)
  }
  return output
}

export function loadBoardOrder(directory: string): BoardLocalOrder {
  if (typeof localStorage === "undefined") return defaultBoardOrder()
  try {
    const raw = localStorage.getItem(boardOrderKey(directory))
    if (!raw) return defaultBoardOrder()
    const parsed = JSON.parse(raw) as Partial<BoardLocalOrder>
    const cards: BoardLocalOrder["cards"] = {}
    for (const column of BOARD_COLUMN_IDS) {
      const order = parsed.cards?.[column]
      if (Array.isArray(order)) cards[column] = order.filter((id): id is string => typeof id === "string")
    }
    return {
      columns: normalizeColumnOrder(parsed.columns),
      cards,
    }
  } catch {
    return defaultBoardOrder()
  }
}

export function saveBoardOrder(directory: string, order: BoardLocalOrder) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(
      boardOrderKey(directory),
      JSON.stringify({
        columns: normalizeColumnOrder(order.columns),
        cards: order.cards,
      }),
    )
  } catch {
    /* storage can be unavailable */
  }
}

function orderCards(cards: AgentBoardCard[], order?: string[]) {
  if (!order?.length) return cards
  const rank = new Map(order.map((id, index) => [id, index]))
  return cards
    .map((card, index) => ({ card, index, rank: rank.get(card.issue.id) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.index - b.index
      if (a.rank === undefined) return 1
      if (b.rank === undefined) return -1
      return a.rank - b.rank
    })
    .map((item) => item.card)
}

export function applyBoardOrder(board: AgentBoardBoard, order: BoardLocalOrder): AgentBoardBoard {
  const columns = new Map(board.columns.map((column) => [column.id, column]))
  return {
    ...board,
    columns: normalizeColumnOrder(order.columns)
      .map((id) => columns.get(id))
      .filter((column): column is AgentBoardBoard["columns"][number] => !!column)
      .map((column) => ({
        ...column,
        cards: orderCards(column.cards, order.cards[column.id]),
      })),
  }
}

export function orderFromBoard(board: AgentBoardBoard, columns?: AgentBoardColumnID[]): BoardLocalOrder {
  return {
    columns: normalizeColumnOrder(columns ?? board.columns.map((column) => column.id)),
    cards: Object.fromEntries(
      board.columns.map((column) => [column.id, column.cards.map((card) => card.issue.id)]),
    ) as BoardLocalOrder["cards"],
  }
}

export function insertArrayItemBefore<T>(items: T[], item: T, before?: T) {
  if (before === item) return items
  const next = items.filter((value) => value !== item)
  const index = before === undefined ? next.length : next.indexOf(before)
  next.splice(index === -1 ? next.length : index, 0, item)
  return next
}
