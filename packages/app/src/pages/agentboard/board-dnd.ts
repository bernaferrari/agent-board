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
