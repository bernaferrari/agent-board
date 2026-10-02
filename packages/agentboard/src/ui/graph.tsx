import { createMemo, createSignal, For } from "solid-js"
import type { AgentBoardBoard, AgentBoardCard, Position } from "../types"
import { buildAgentBoardGraph } from "./graph-state"
import { COLUMN_TITLES } from "../types"

export function Graph(props: {
  board: AgentBoardBoard
  cards: AgentBoardCard[]
  busy: boolean
  onSelect: (id: string) => void
  onSave: (positions: Position[]) => void
}) {
  const [zoom, setZoom] = createSignal(0.8)
  const [offsets, setOffsets] = createSignal<Record<string, { x: number; y: number }>>({})
  const graph = createMemo(() => {
    const ids = new Set(props.cards.map((card) => card.issue.id))
    const result = buildAgentBoardGraph({
      ...props.board,
      columns: props.board.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((card) => ids.has(card.issue.id)),
      })),
    })
    const positions = new Map(props.board.graph.positions.map((item) => [item.issueID, item]))
    const nodes = result.nodes.map((node) => ({
      ...node,
      ...(positions.get(node.id) ?? {}),
      ...(offsets()[node.id] ?? {}),
    }))
    return {
      ...result,
      nodes,
      width: Math.max(1000, ...nodes.map((node) => node.x + 340)),
      height: Math.max(600, ...nodes.map((node) => node.y + 200)),
    }
  })
  const byID = createMemo(() => new Map(graph().nodes.map((node) => [node.id, node])))
  const [drag, setDrag] = createSignal<{
    id: string
    startX: number
    startY: number
    x: number
    y: number
    moved: boolean
  }>()
  const viewport = { current: undefined as HTMLDivElement | undefined }
  return (
    <section class="graph-view" aria-label="Dependency graph">
      <div class="graph-tools">
        <span>Prerequisite → dependent</span>
        <button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.3, value - 0.1))}>
          −
        </button>
        <span class="zoom-value">{Math.round(zoom() * 100)}%</span>
        <button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}>
          +
        </button>
        <button
          onClick={() => {
            setZoom(0.8)
            viewport.current?.scrollTo({ left: 0, top: 0 })
          }}
        >
          Reset view
        </button>
      </div>
      <div class="graph-scroll" ref={(element) => (viewport.current = element)}>
        <div
          style={{
            width: `${graph().width * zoom()}px`,
            height: `${graph().height * zoom()}px`,
          }}
        >
          <div
            class="graph-canvas"
            style={{
              width: `${graph().width}px`,
              height: `${graph().height}px`,
              transform: `scale(${zoom()})`,
            }}
          >
            <svg class="graph-edges" width={graph().width} height={graph().height} aria-hidden="true">
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
                </marker>
              </defs>
              <For each={graph().edges}>
                {(edge) => {
                  const line = () => {
                    const source = byID().get(edge.sourceIssueID)
                    const target = byID().get(edge.targetIssueID)
                    if (!source || !target) return ""
                    const x = source.x + 276
                    const y = source.y + 60
                    return `M ${x} ${y} C ${x + 50} ${y}, ${target.x - 50} ${target.y + 60}, ${target.x - 8} ${target.y + 60}`
                  }
                  return (
                    <path d={line()} marker-end="url(#arrow)" classList={{ "edge-parent": edge.type !== "blocks" }} />
                  )
                }}
              </For>
            </svg>
            <For each={graph().nodes}>
              {(node) => (
                <button
                  class="graph-node"
                  disabled={props.busy}
                  style={{ left: `${node.x}px`, top: `${node.y}px` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setDrag({
                      id: node.id,
                      startX: event.clientX,
                      startY: event.clientY,
                      x: node.x,
                      y: node.y,
                      moved: false,
                    })
                  }}
                  onPointerMove={(event) => {
                    const state = drag()
                    if (state?.id !== node.id) return
                    const dx = (event.clientX - state.startX) / zoom()
                    const dy = (event.clientY - state.startY) / zoom()
                    if (Math.abs(dx) + Math.abs(dy) < 5 && !state.moved) return
                    setDrag({ ...state, moved: true })
                    setOffsets((current) => ({
                      ...current,
                      [node.id]: {
                        x: Math.max(0, state.x + dx),
                        y: Math.max(0, state.y + dy),
                      },
                    }))
                  }}
                  onPointerUp={() => {
                    if (drag()?.moved)
                      props.onSave(
                        graph().nodes.map((item) => ({
                          issueID: item.id,
                          x: item.x,
                          y: item.y,
                        })),
                      )
                    // Clear after the synthetic click so a drag does not open the issue.
                    setTimeout(() => setDrag(undefined), 0)
                  }}
                  onPointerCancel={() => setDrag(undefined)}
                  onClick={() => {
                    if (!drag()?.moved) props.onSelect(node.id)
                  }}
                >
                  <span class="card-meta">
                    <span class={`status-dot ${node.card.column}`} />
                    <span>{node.id}</span>
                    <span class="priority">P{node.card.issue.priority ?? 2}</span>
                  </span>
                  <strong>{node.card.issue.title}</strong>
                  <span class="graph-node-footer">
                    {node.card.issue.blocked
                      ? "Blocked"
                      : node.unblocks
                        ? `Unblocks ${node.unblocks}`
                        : COLUMN_TITLES[node.card.column]}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
      <svg class="minimap" viewBox={`0 0 ${graph().width} ${graph().height}`} aria-label="Graph minimap" role="img">
        <For each={graph().nodes}>{(node) => <rect x={node.x} y={node.y} width="276" height="120" rx="12" />}</For>
      </svg>
    </section>
  )
}
