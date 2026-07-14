import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { AgentBoardBoard, AgentBoardColumnID, AgentBoardGraphPosition } from "./api"
import {
  GRAPH_FOCUS_COLUMN_GAP,
  GRAPH_FOCUS_PADDING,
  GRAPH_FOCUS_ROW_GAP,
  GRAPH_LAYOUT_LAYER_GAP,
  GRAPH_LAYOUT_NODE_GAP,
  GRAPH_NODE_HEIGHT,
  GRAPH_NODE_WIDTH,
  buildGraphSeedNodes,
  clamp,
  graphNodeBounds,
  graphRouteNodeRects,
  reduceTransitiveGraphEdges,
  resolveGraphNodeOverlaps,
  routeGraphEdge,
  type GraphEdgeShape,
} from "./graph-geometry"
import { buildGraphDependencyLayout } from "./graph-layout"
import { GraphMinimap } from "./graph-minimap"
import { GraphNodeCard } from "./graph-node-card"
import { buildAgentBoardGraph } from "./graph-state"

export type AgentBoardViewMode = "board" | "list" | "graph"

type GraphFilter = "all" | "open" | "critical"

const GRAPH_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }

export function GraphMode(props: {
  board: AgentBoardBoard
  unfilteredBoard?: AgentBoardBoard
  query: string
  selectedID?: string
  busy?: string
  onSelect: (issueID: string) => void
  onChat: (issueID: string) => void
  onSavePositions: (positions: AgentBoardGraphPosition[]) => void
  onClearWorkFilters?: () => void
}) {
  const [viewport, setViewport] = createSignal({ x: 40, y: 40, scale: 1 })
  const [filter, setFilter] = createSignal<GraphFilter>("open")
  const [dependencyLayers, setDependencyLayers] = createSignal<Record<string, number>>({})
  const [hoveredID, setHoveredID] = createSignal<string>()
  const [autoPositions, setAutoPositions] = createSignal<Record<string, AgentBoardGraphPosition>>({})
  const [autoPositionsSignature, setAutoPositionsSignature] = createSignal("")
  const [localPositions, setLocalPositions] = createSignal<Record<string, AgentBoardGraphPosition>>({})
  const [manuallyMovedIDs, setManuallyMovedIDs] = createSignal(new Set<string>())
  const [userEditedGraph, setUserEditedGraph] = createSignal(false)
  const [draggingIssueID, setDraggingIssueID] = createSignal<string>()
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>()
  let arrangedSignature = ""
  let didDrag = false
  let routedEdgeShapeCache = new Map<string, GraphEdgeShape>()
  let pendingNodeDrag: AgentBoardGraphPosition | undefined
  let nodeDragFrame: number | undefined
  let minimapPointer:
    | {
        rect: DOMRect
        bounds: ReturnType<typeof graphBounds>
      }
    | undefined
  let pointer:
    | {
        type: "pan"
        startX: number
        startY: number
        viewport: { x: number; y: number; scale: number }
      }
    | {
        type: "node"
        issueID: string
        startX: number
        startY: number
        originX: number
        originY: number
        grabOffsetX: number
        grabOffsetY: number
      }
    | undefined

  const baseGraph = createMemo(() => buildAgentBoardGraph(props.board, props.query))
  const graph = createMemo(() => baseGraph())
  const graphFilterCounts = createMemo(() => {
    const current = graph()
    const count = (value: GraphFilter) =>
      current.nodes.filter((node) => {
        if (value === "critical") return node.critical
        if (value === "open") return node.card.column !== "closed"
        return true
      }).length
    return {
      open: count("open"),
      critical: count("critical"),
      all: count("all"),
      closed: current.nodes.filter((node) => node.card.column === "closed").length,
    }
  })
  const visibleGraphInput = createMemo(() => {
    const current = graph()
    const rawNodes = current.nodes.filter((node) => {
      if (filter() === "critical") return node.critical
      if (filter() === "open") return node.card.column !== "closed"
      return true
    })
    const ids = new Set(rawNodes.map((node) => node.id))
    const edges = current.edges.filter((edge) => ids.has(edge.sourceIssueID) && ids.has(edge.targetIssueID))
    const layoutEdges = reduceTransitiveGraphEdges(edges)
    const signature = [
      filter(),
      rawNodes
        .map((node) => node.id)
        .sort()
        .join(","),
      edges
        .map((edge) => edge.id)
        .sort()
        .join(","),
    ].join("|")
    return { current, rawNodes, edges, layoutEdges, signature }
  })
  const emptyHint = createMemo(() => {
    if (visibleGraphInput().rawNodes.length > 0) return undefined
    const withoutSearch = buildAgentBoardGraph(props.unfilteredBoard ?? props.board, "")
    if (withoutSearch.nodes.length === 0) return undefined
    if (props.query.trim()) return "Clear search to see matching issues."
    return undefined
  })
  const filterEmptyAction = createMemo<
    | {
        before: string
        label: string
        after: string
        onClick: () => void
      }
    | undefined
  >(() => {
    if (visibleGraphInput().rawNodes.length > 0 || props.query.trim()) return undefined
    const withoutSearch = buildAgentBoardGraph(props.unfilteredBoard ?? props.board, "")
    if (withoutSearch.nodes.length === 0) return undefined
    if (filter() === "critical" || filter() === "open") {
      return {
        before: "Click",
        label: "All",
        after: "to see more issues.",
        onClick: () => selectFilter("all"),
      }
    }
    return undefined
  })
  const automaticVisibleGraph = createMemo(() => {
    const input = visibleGraphInput()
    const { current, rawNodes, edges, layoutEdges } = input
    const visibleBlockedBy = new Map(rawNodes.map((node) => [node.id, 0]))
    const visibleUnblocks = new Map(rawNodes.map((node) => [node.id, 0]))
    for (const edge of edges) {
      if (edge.type !== "blocks") continue
      visibleUnblocks.set(edge.sourceIssueID, (visibleUnblocks.get(edge.sourceIssueID) ?? 0) + 1)
      visibleBlockedBy.set(edge.targetIssueID, (visibleBlockedBy.get(edge.targetIssueID) ?? 0) + 1)
    }
    const nodesWithVisibleCounts = rawNodes.map((node) => ({
      ...node,
      blockedBy: visibleBlockedBy.get(node.id) ?? 0,
      unblocks: visibleUnblocks.get(node.id) ?? 0,
    }))
    const automaticNodes = resolveGraphNodeOverlaps(buildGraphSeedNodes(nodesWithVisibleCounts, layoutEdges))
    const auto = autoPositionsSignature() === input.signature ? autoPositions() : {}
    const nodes = automaticNodes.map((node) => {
      const autoPosition = auto[node.id]
      return autoPosition
        ? {
            ...node,
            x: autoPosition.x,
            y: autoPosition.y,
            pinned: autoPosition.pinned,
          }
        : node
    })
    return {
      ...current,
      nodes,
      edges,
      layoutEdges,
    }
  })
  const visibleGraph = createMemo(() => {
    const current = automaticVisibleGraph()
    const local = localPositions()
    const moved = manuallyMovedIDs()
    const nodes = current.nodes.map((node) => {
      const position = local[node.id]
      if (!position || !moved.has(node.id)) return node
      return {
        ...node,
        x: position.x,
        y: position.y,
        pinned: position.pinned,
      }
    })
    return {
      ...current,
      nodes,
      width: Math.max(960, ...nodes.map((node) => node.x + GRAPH_NODE_WIDTH + GRAPH_FOCUS_PADDING)),
      height: Math.max(560, ...nodes.map((node) => node.y + GRAPH_NODE_HEIGHT + GRAPH_FOCUS_PADDING)),
    }
  })
  const nodeMap = createMemo(() => new Map(visibleGraph().nodes.map((node) => [node.id, node])))
  const graphBounds = createMemo(() => graphNodeBounds(visibleGraph().nodes))
  const graphArrangementSignature = createMemo(() => {
    const input = visibleGraphInput()
    if (input.rawNodes.length === 0) return ""
    return input.signature
  })
  const canvasSize = createMemo(() => {
    const bounds = graphBounds()
    return {
      width: Math.max(960, bounds.maxX + 96),
      height: Math.max(560, bounds.maxY + 96),
    }
  })
  const minimapWorldBounds = createMemo(() => {
    const bounds = graphBounds()
    const canvas = canvasSize()
    const minX = Math.min(0, bounds.minX - 96)
    const minY = Math.min(0, bounds.minY - 96)
    const maxX = Math.max(canvas.width, bounds.maxX + 96)
    const maxY = Math.max(canvas.height, bounds.maxY + 96)
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    }
  })
  const viewportBounds = createMemo(() => {
    const rect = rootElement()?.getBoundingClientRect()
    if (!rect) return undefined
    const bounds = minimapWorldBounds()
    const current = viewport()
    const worldLeft = -current.x / current.scale
    const worldTop = -current.y / current.scale
    const worldWidth = rect.width / current.scale
    const worldHeight = rect.height / current.scale
    const rawLeft = ((worldLeft - bounds.minX) / bounds.width) * 100
    const rawTop = ((worldTop - bounds.minY) / bounds.height) * 100
    const rawRight = rawLeft + (worldWidth / bounds.width) * 100
    const rawBottom = rawTop + (worldHeight / bounds.height) * 100
    const left = clamp(rawLeft, 0, 100)
    const top = clamp(rawTop, 0, 100)
    const right = clamp(rawRight, 0, 100)
    const bottom = clamp(rawBottom, 0, 100)
    return {
      left,
      top,
      width: Math.max(2, right - left),
      height: Math.max(2, bottom - top),
    }
  })
  const focusID = createMemo(() => hoveredID() ?? props.selectedID)
  const focusedIDs = createMemo(() => {
    const id = focusID()
    if (!id) return new Set<string>()
    const ids = new Set([id])
    for (const edge of visibleGraph().edges) {
      if (edge.sourceIssueID === id) ids.add(edge.targetIssueID)
      if (edge.targetIssueID === id) ids.add(edge.sourceIssueID)
    }
    return ids
  })
  const routedEdges = createMemo(() => {
    const current = visibleGraph()
    const nodes = current.nodes
    const nodesByID = nodeMap()
    const id = focusID()
    const draggingID = draggingIssueID()
    const layers = dependencyLayers()
    const nodeRects = graphRouteNodeRects(nodes)
    const pairCounts = new Map<string, number>()
    const nextCache = new Map<string, GraphEdgeShape>()
    const edges = current.edges
      .map((edge, index) => {
        const active = id !== undefined && (edge.sourceIssueID === id || edge.targetIssueID === id)
        const muted = id !== undefined && edge.sourceIssueID !== id && edge.targetIssueID !== id
        const source = nodesByID.get(edge.sourceIssueID)
        const target = nodesByID.get(edge.targetIssueID)
        const pairKey = [source?.depth ?? 0, target?.depth ?? 0].join(":")
        const edgeOffset = pairCounts.get(pairKey) ?? 0
        pairCounts.set(pairKey, edgeOffset + 1)
        const connectedToDrag =
          draggingID !== undefined && (edge.sourceIssueID === draggingID || edge.targetIssueID === draggingID)
        const cachedShape = draggingID !== undefined && !connectedToDrag ? routedEdgeShapeCache.get(edge.id) : undefined
        const shape = cachedShape ?? routeGraphEdge(source, target, nodes, active, layers, edgeOffset, nodeRects)
        nextCache.set(edge.id, shape)
        return {
          id: edge.id,
          active,
          muted,
          critical: edge.critical,
          paintOrder: active ? 3 : edge.critical ? 2 : muted ? 0 : 1,
          sourceOrder: index,
          shape,
          tone: active ? "text-border-strong-base" : edge.critical ? "text-border-strong-base" : "text-border-base",
          opacity: active ? 1 : muted ? 0.34 : id !== undefined ? 0.72 : 0.94,
        }
      })
      .sort((a, b) => a.paintOrder - b.paintOrder || a.sourceOrder - b.sourceOrder)
    routedEdgeShapeCache = nextCache
    return edges
  })
  const columnStats = createMemo(() => {
    const counts = new Map<AgentBoardColumnID, number>()
    for (const node of visibleGraph().nodes) counts.set(node.card.column, (counts.get(node.card.column) ?? 0) + 1)
    return (["open", "in_progress", "needs_review", "closed"] as const)
      .map((column) => ({ column, count: counts.get(column) ?? 0 }))
      .filter((item) => item.count > 0)
  })
  const minimapNodes = createMemo(() => {
    const bounds = minimapWorldBounds()
    const focused = focusedIDs()
    const focusedNode = focusID()
    return visibleGraph().nodes.map((node) => ({
      id: node.card.issue.id,
      column: node.card.column,
      selected: node.card.issue.id === props.selectedID,
      active: node.card.issue.id === focusedNode,
      related: focused.has(node.card.issue.id),
      muted: focusedNode !== undefined && !focused.has(node.card.issue.id),
      x: clamp(((node.x + GRAPH_NODE_WIDTH / 2 - bounds.minX) / bounds.width) * 100, 1.5, 98.5),
      y: clamp(((node.y + GRAPH_NODE_HEIGHT / 2 - bounds.minY) / bounds.height) * 100, 1.5, 98.5),
    }))
  })
  const minimapEdges = createMemo(() => {
    const nodes = new Map(minimapNodes().map((node) => [node.id, node]))
    return visibleGraph().edges.flatMap((edge) => {
      const source = nodes.get(edge.sourceIssueID)
      const target = nodes.get(edge.targetIssueID)
      if (!source || !target) return []
      const focused = focusID()
      const active = focused !== undefined && (edge.sourceIssueID === focused || edge.targetIssueID === focused)
      const muted = focused !== undefined && !active
      return [
        { id: edge.id, x1: source.x, y1: source.y, x2: target.x, y2: target.y, critical: edge.critical, active, muted },
      ]
    })
  })

  function screenToWorld(clientX: number, clientY: number) {
    const rect = rootElement()?.getBoundingClientRect()
    const current = viewport()
    return {
      x: (clientX - (rect?.left ?? 0) - current.x) / current.scale,
      y: (clientY - (rect?.top ?? 0) - current.y) / current.scale,
    }
  }

  function fitGraph() {
    const rect = rootElement()?.getBoundingClientRect()
    if (!rect || visibleGraph().nodes.length === 0) return
    const bounds = graphBounds()
    const scale = clamp(Math.min((rect.width - 96) / bounds.width, (rect.height - 96) / bounds.height), 0.18, 1.15)
    setViewport({
      scale,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    })
  }

  function moveViewportToMinimapPoint(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    bounds: ReturnType<typeof graphBounds>,
  ) {
    const rootRect = rootElement()?.getBoundingClientRect()
    if (!rootRect) return
    const current = viewport()
    const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1)
    const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1)
    const worldX = bounds.minX + ratioX * bounds.width
    const worldY = bounds.minY + ratioY * bounds.height
    setViewport({
      ...current,
      x: rootRect.width / 2 - worldX * current.scale,
      y: rootRect.height / 2 - worldY * current.scale,
    })
  }

  function onMinimapPointerMove(event: PointerEvent) {
    if (!minimapPointer) return
    event.preventDefault()
    moveViewportToMinimapPoint(event.clientX, event.clientY, minimapPointer.rect, minimapPointer.bounds)
  }

  function onMinimapPointerUp() {
    minimapPointer = undefined
    window.removeEventListener("pointermove", onMinimapPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onMinimapPointerUp, GRAPH_POINTER_OPTIONS)
  }

  function beginMinimapPointer(event: PointerEvent) {
    const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : undefined
    if (!rect) return
    event.preventDefault()
    event.stopPropagation()
    minimapPointer = { rect, bounds: minimapWorldBounds() }
    moveViewportToMinimapPoint(event.clientX, event.clientY, rect, minimapPointer.bounds)
    window.addEventListener("pointermove", onMinimapPointerMove, GRAPH_POINTER_OPTIONS)
    window.addEventListener("pointerup", onMinimapPointerUp, GRAPH_POINTER_OPTIONS)
  }

  function flushPendingNodeDrag() {
    const position = pendingNodeDrag
    if (!position) return
    pendingNodeDrag = undefined
    nodeDragFrame = undefined
    setLocalPositions((current) => ({
      ...current,
      [position.issueID]: position,
    }))
  }

  function scheduleNodeDrag(position: AgentBoardGraphPosition) {
    pendingNodeDrag = position
    if (nodeDragFrame !== undefined) return
    nodeDragFrame = window.requestAnimationFrame(flushPendingNodeDrag)
  }

  function selectFilter(value: GraphFilter) {
    if (value === "all") {
      props.onClearWorkFilters?.()
    }
    setFilter(value)
    requestAnimationFrame(() => requestAnimationFrame(fitGraph))
  }

  const graphScopeControls = () => (
    <div class="flex h-[28px] items-center overflow-hidden rounded-lg border border-border-weaker-base bg-background-base/92 shadow-lg backdrop-blur">
      <div class="flex h-full overflow-hidden">
        <For
          each={
            [
              ["open", "Open"],
              ["critical", "Critical"],
              ["all", "All"],
            ] as const
          }
        >
          {(value) => {
            const count = () => graphFilterCounts()[value[0]]
            const isActive = () => filter() === value[0]
            const showCriticalDot = () => value[0] === "critical" && count() > 0
            return (
              <button
                type="button"
                class="inline-flex h-full items-center gap-1.5 border-r border-border-weak-base px-2 text-11-semibold transition-colors"
                classList={{
                  "bg-surface-raised-base-active text-text-strong": isActive(),
                  "text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base": !isActive(),
                }}
                onClick={() => selectFilter(value[0])}
              >
                <Show when={showCriticalDot()}>
                  <span
                    class="size-1.5 rounded-full bg-[#f85149]"
                    classList={{ "opacity-100": isActive(), "opacity-70": !isActive() }}
                  />
                </Show>
                <span>{value[1]}</span>
                <span
                  class="font-mono text-10-regular tabular-nums"
                  classList={{
                    "text-text-strong": isActive(),
                    "text-text-weak": !isActive(),
                  }}
                >
                  {count()}
                </span>
              </button>
            )
          }}
        </For>
      </div>
    </div>
  )

  function onPointerMove(event: PointerEvent) {
    if (!pointer) return
    event.preventDefault()
    if (Math.abs(event.clientX - pointer.startX) > 3 || Math.abs(event.clientY - pointer.startY) > 3) didDrag = true
    if (pointer.type === "pan") {
      setViewport({
        ...pointer.viewport,
        x: pointer.viewport.x + event.clientX - pointer.startX,
        y: pointer.viewport.y + event.clientY - pointer.startY,
      })
      return
    }
    const world = screenToWorld(event.clientX, event.clientY)
    const x = world.x - pointer.grabOffsetX
    const y = world.y - pointer.grabOffsetY
    const issueID = pointer.issueID
    if (didDrag) {
      setManuallyMovedIDs((current) => (current.has(issueID) ? current : new Set(current).add(issueID)))
      setUserEditedGraph(true)
    }
    scheduleNodeDrag({
      issueID,
      x,
      y,
      pinned: true,
    })
  }

  function onPointerUp() {
    if (nodeDragFrame !== undefined) {
      window.cancelAnimationFrame(nodeDragFrame)
      nodeDragFrame = undefined
    }
    flushPendingNodeDrag()
    if (pointer?.type === "node") {
      const position = localPositions()[pointer.issueID]
      if (position) props.onSavePositions([position])
    }
    setDraggingIssueID(undefined)
    pointer = undefined
    window.removeEventListener("pointermove", onPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onPointerUp, GRAPH_POINTER_OPTIONS)
    if (didDrag) {
      window.setTimeout(() => {
        didDrag = false
      }, 0)
    }
  }

  function beginPointer(next: typeof pointer) {
    if (pointer) onPointerUp()
    pointer = next
    setDraggingIssueID(next?.type === "node" ? next.issueID : undefined)
    didDrag = false
    window.addEventListener("pointermove", onPointerMove, GRAPH_POINTER_OPTIONS)
    window.addEventListener("pointerup", onPointerUp, GRAPH_POINTER_OPTIONS)
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault()
    const before = screenToWorld(event.clientX, event.clientY)
    const current = viewport()
    const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.001), 0.15, 1.6)
    const rect = rootElement()?.getBoundingClientRect()
    setViewport({
      scale,
      x: event.clientX - (rect?.left ?? 0) - before.x * scale,
      y: event.clientY - (rect?.top ?? 0) - before.y * scale,
    })
  }

  function arrangeGraph() {
    const current = visibleGraph()
    const { positions, layers } = buildGraphDependencyLayout(current.nodes, current.layoutEdges, {
      nodeWidth: GRAPH_NODE_WIDTH,
      nodeHeight: GRAPH_NODE_HEIGHT,
      nodeGap: GRAPH_LAYOUT_NODE_GAP,
      layerGap: GRAPH_LAYOUT_LAYER_GAP,
      columnGap: GRAPH_FOCUS_COLUMN_GAP,
      rowGap: GRAPH_FOCUS_ROW_GAP,
    })
    if (positions.length === 0) return
    setDependencyLayers(layers)
    setUserEditedGraph(false)
    setAutoPositionsSignature(graphArrangementSignature())
    setAutoPositions(
      Object.fromEntries(positions.map((position) => [position.issueID, { ...position, pinned: false }])),
    )
    requestAnimationFrame(() => requestAnimationFrame(fitGraph))
  }

  createEffect(() => {
    const signature = graphArrangementSignature()
    if (!signature || userEditedGraph() || arrangedSignature === signature) return
    arrangedSignature = signature
    requestAnimationFrame(arrangeGraph)
  })

  onCleanup(() => {
    if (nodeDragFrame !== undefined) window.cancelAnimationFrame(nodeDragFrame)
    window.removeEventListener("pointermove", onPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onPointerUp, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointermove", onMinimapPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onMinimapPointerUp, GRAPH_POINTER_OPTIONS)
  })

  return (
    <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-background-base">
      <div
        ref={setRootElement}
        class="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.055)_1px,transparent_0)] bg-[length:28px_28px] active:cursor-grabbing"
        onWheel={onWheel}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          beginPointer({
            type: "pan",
            startX: event.clientX,
            startY: event.clientY,
            viewport: viewport(),
          })
        }}
      >
        <div class="absolute right-4 top-4 z-30 hidden md:block">{graphScopeControls()}</div>
        <div
          class="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{
            width: `${canvasSize().width}px`,
            height: `${canvasSize().height}px`,
            transform: `translate3d(${viewport().x}px, ${viewport().y}px, 0) scale(${viewport().scale})`,
          }}
        >
          <svg
            class="pointer-events-none absolute inset-0 z-0 size-full overflow-visible"
            viewBox={`0 0 ${canvasSize().width} ${canvasSize().height}`}
          >
            <For each={routedEdges()}>
              {(edge) => (
                <g class={edge.tone} opacity={edge.opacity}>
                  <path
                    d={edge.shape.line}
                    fill="none"
                    stroke="var(--background-base)"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={9}
                    opacity={0.96}
                  />
                  <path
                    d={edge.shape.line}
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={edge.active ? 2.5 : edge.critical ? 1.65 : 1.5}
                  />
                  <Show when={edge.shape.arrow}>
                    <path
                      d={edge.shape.arrow}
                      fill="none"
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width={edge.active ? 2.5 : edge.critical ? 1.65 : 1.5}
                    />
                  </Show>
                </g>
              )}
            </For>
          </svg>

          <For each={visibleGraph().nodes}>
            {(node) => (
              <GraphNodeCard
                node={node}
                selected={props.selectedID === node.id}
                focused={focusedIDs().has(node.id)}
                dimmed={focusID() !== undefined && !focusedIDs().has(node.id)}
                busy={props.busy === node.id}
                onSelect={() => {
                  if (!didDrag) props.onSelect(node.id)
                }}
                onChat={() => props.onChat(node.id)}
                onHover={() => setHoveredID(node.id)}
                onLeave={() => setHoveredID((current) => (current === node.id ? undefined : current))}
                onDragStart={(event) => {
                  if (event.button !== 0) return
                  event.preventDefault()
                  event.stopPropagation()
                  const world = screenToWorld(event.clientX, event.clientY)
                  beginPointer({
                    type: "node",
                    issueID: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.x,
                    originY: node.y,
                    grabOffsetX: world.x - node.x,
                    grabOffsetY: world.y - node.y,
                  })
                }}
              />
            )}
          </For>
        </div>

        <Show when={visibleGraph().nodes.length === 0}>
          <div class="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div>
              <div class="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-surface-raised-base shadow-xs-border-base">
                <Icon name="branch" class="size-4 text-text-weak" />
              </div>
              <h3 class="text-14-semibold text-text-strong">No Issues to Show</h3>
              <Show when={filterEmptyAction()}>
                {(action) => (
                  <button
                    type="button"
                    class="mt-1 text-12-regular text-text-weak hover:text-text-base"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={action().onClick}
                  >
                    {action().before}{" "}
                    <span class="rounded-sm bg-surface-raised-base px-1 py-0.5 text-text-strong shadow-xs-border-base">
                      {action().label}
                    </span>{" "}
                    {action().after}
                  </button>
                )}
              </Show>
              <Show when={emptyHint()}>{(hint) => <p class="mt-1 text-12-regular text-text-weak">{hint()}</p>}</Show>
            </div>
          </div>
        </Show>

        <GraphMinimap
          scale={viewport().scale}
          nodes={minimapNodes()}
          edges={minimapEdges()}
          viewportBounds={viewportBounds()}
          columnStats={columnStats()}
          onFit={fitGraph}
          onPointerDown={beginMinimapPointer}
        />
      </div>
    </div>
  )
}
