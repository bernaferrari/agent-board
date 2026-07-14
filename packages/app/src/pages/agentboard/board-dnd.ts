import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID } from "./api"
import { isBoardColumnID } from "./board-state"

export type BoardDragTarget = {
  current: AgentBoardBoard
  card: AgentBoardCard
  issueID: string
  target: AgentBoardColumnID
  beforeIssueID?: string
}

export type ColumnDropPlacement = {
  beforeColumnID?: AgentBoardColumnID
}

export type PendingCardDrag = {
  card: AgentBoardCard
  current: AgentBoardBoard
  rect: DOMRect
  startX: number
  startY: number
}

let boardDragPointer: { x: number; y: number } | undefined
let boardDragGrabOffset: { x: number; y: number } | undefined
let boardDragSourceSize: { width: number; height: number } | undefined
const BOARD_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }

function trackBoardDragPointer(event: PointerEvent) {
  boardDragPointer = { x: event.clientX, y: event.clientY }
}

export function currentBoardDragPointer() {
  return boardDragPointer
}

export function currentBoardDragGeometry() {
  return {
    offset: boardDragGrabOffset,
    size: boardDragSourceSize,
  }
}

export function setBoardDragPointer(point: { x: number; y: number } | undefined) {
  boardDragPointer = point
}

export function setBoardDragGeometry(input: {
  offset?: { x: number; y: number }
  size?: { width: number; height: number }
}) {
  boardDragGrabOffset = input.offset
  boardDragSourceSize = input.size
}

export function stopBoardPointerTracking() {
  window.removeEventListener("pointermove", trackBoardDragPointer, BOARD_POINTER_OPTIONS)
  boardDragGrabOffset = undefined
  boardDragSourceSize = undefined
}

export function startBoardPointerTracking(event: PointerEvent) {
  trackBoardDragPointer(event)
  const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const target = current?.closest<HTMLElement>("[data-agentboard-card],[data-agentboard-column]") ?? current
  const rect = target?.getBoundingClientRect()
  boardDragGrabOffset = rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : undefined
  boardDragSourceSize = rect ? { width: rect.width, height: rect.height } : undefined
  window.addEventListener("pointermove", trackBoardDragPointer, BOARD_POINTER_OPTIONS)
}

export function boardColumnRects(exclude?: AgentBoardColumnID) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-agentboard-column]"))
    .map((element) => {
      const id = element.dataset.agentboardColumn
      if (!id || !isBoardColumnID(id) || id === exclude) return undefined
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return undefined
      return { id, rect }
    })
    .filter((item): item is { id: AgentBoardColumnID; rect: DOMRect } => !!item)
    .sort((a, b) => a.rect.left - b.rect.left)
}

export function columnIDAtPoint(point: { x: number; y: number }): AgentBoardColumnID | undefined {
  const columns = boardColumnRects()
  if (!columns.length) return undefined
  const direct = columns.find(
    (column) =>
      point.x >= column.rect.left &&
      point.x <= column.rect.right &&
      point.y >= column.rect.top &&
      point.y <= column.rect.bottom,
  )
  if (direct) return direct.id

  const horizontal = columns.find((column) => point.x >= column.rect.left && point.x <= column.rect.right)
  if (horizontal) return horizontal.id

  if (point.x < columns[0].rect.left) return columns[0].id
  const last = columns.at(-1)!
  if (point.x > last.rect.right) return last.id

  for (let index = 0; index < columns.length - 1; index++) {
    const current = columns[index]
    const next = columns[index + 1]
    if (point.x > current.rect.right && point.x < next.rect.left) {
      return point.x < current.rect.right + (next.rect.left - current.rect.right) / 2 ? current.id : next.id
    }
  }
  return undefined
}

export function beforeColumnIDAtPoint(input: {
  moving: AgentBoardColumnID
  point?: { x: number; y: number }
  fallback?: AgentBoardColumnID
}) {
  if (!input.point) return input.fallback ?? input.moving
  const columns = boardColumnRects(input.moving)
  for (let index = 0; index < columns.length; index++) {
    const column = columns[index]
    if (input.point.x < column.rect.left) return column.id
    if (input.point.x <= column.rect.right) {
      const next = columns[index + 1]?.id
      return input.point.x < column.rect.left + column.rect.width / 2 ? column.id : next
    }
  }
  return undefined
}

function cardInsertionPoint(point: { x: number; y: number }) {
  const { offset, size } = currentBoardDragGeometry()
  if (!offset || !size) return point
  return {
    x: point.x,
    y: point.y - offset.y + size.height / 2,
  }
}

export function beforeIssueIDAtPoint(
  column: AgentBoardColumnID,
  movingIssueID: string,
  point: { x: number; y: number },
) {
  const insertion = cardInsertionPoint(point)
  const cards = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-agentboard-column="${column}"] [data-agentboard-card]`),
  ).filter((card) => card.dataset.agentboardCard !== movingIssueID)
  for (let index = 0; index < cards.length; index++) {
    const card = cards[index]
    const issueID = card.dataset.agentboardCard
    if (!issueID) continue
    const rect = card.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) continue
    if (insertion.y < rect.top) return issueID
    if (insertion.y <= rect.bottom) {
      const insertAfterCard = insertion.y >= rect.top + rect.height * 0.5
      return insertAfterCard ? cards[index + 1]?.dataset.agentboardCard : issueID
    }
  }
  return undefined
}
