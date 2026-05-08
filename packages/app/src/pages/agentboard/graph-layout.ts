import type { AgentBoardGraphPosition } from "./api"
import type { AgentBoardGraphNode } from "./graph-state"

export type AgentBoardGraphDependencyLayout = {
  positions: AgentBoardGraphPosition[]
  layers: Record<string, number>
}

export type AgentBoardGraphDependencyOptions = {
  nodeWidth: number
  nodeHeight: number
  nodeGap: number
  layerGap: number
  columnGap: number
  rowGap: number
}

type DependencyComponent = {
  id: number
  nodeIDs: string[]
  outgoing: Set<number>
  layer: number
}

type DependencyIslandLayout = {
  positions: AgentBoardGraphPosition[]
  layers: Record<string, number>
  width: number
  height: number
}

function priorityRank(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  return Number.isFinite(value) ? value : 5
}

function nodeBounds(nodes: AgentBoardGraphNode[], options: Pick<AgentBoardGraphDependencyOptions, "nodeWidth" | "nodeHeight">) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 }
  const minX = Math.min(...nodes.map((node) => node.x))
  const minY = Math.min(...nodes.map((node) => node.y))
  const maxX = Math.max(...nodes.map((node) => node.x + options.nodeWidth))
  const maxY = Math.max(...nodes.map((node) => node.y + options.nodeHeight))
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function positionBounds(positions: AgentBoardGraphPosition[], options: Pick<AgentBoardGraphDependencyOptions, "nodeWidth" | "nodeHeight">) {
  if (positions.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 }
  const minX = Math.min(...positions.map((position) => position.x))
  const minY = Math.min(...positions.map((position) => position.y))
  const maxX = Math.max(...positions.map((position) => position.x + options.nodeWidth))
  const maxY = Math.max(...positions.map((position) => position.y + options.nodeHeight))
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function positionsOverlap(
  a: AgentBoardGraphPosition,
  b: AgentBoardGraphPosition,
  options: Pick<AgentBoardGraphDependencyOptions, "nodeWidth" | "nodeHeight">,
  padding = 28,
) {
  return (
    a.x < b.x + options.nodeWidth + padding &&
    a.x + options.nodeWidth + padding > b.x &&
    a.y < b.y + options.nodeHeight + padding &&
    a.y + options.nodeHeight + padding > b.y
  )
}

function resolvePositionCollisions(
  input: AgentBoardGraphPosition[],
  options: Pick<AgentBoardGraphDependencyOptions, "nodeWidth" | "nodeHeight">,
) {
  const positions = input.map((position) => ({ ...position }))
  for (let pass = 0; pass < 80; pass++) {
    let moved = false
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!
        const b = positions[j]!
        if (!positionsOverlap(a, b, options)) continue
        const ax = a.x + options.nodeWidth / 2
        const ay = a.y + options.nodeHeight / 2
        const bx = b.x + options.nodeWidth / 2
        const by = b.y + options.nodeHeight / 2
        const dx = bx - ax || 1
        const dy = by - ay || 1
        const distance = Math.max(1, Math.hypot(dx, dy))
        const overlapX = options.nodeWidth + 40 - Math.abs(dx)
        const overlapY = options.nodeHeight + 40 - Math.abs(dy)
        const push = Math.max(6, Math.min(28, Math.min(overlapX, overlapY) / 2))
        const ux = (dx / distance) * push
        const uy = (dy / distance) * push
        a.x -= ux
        a.y -= uy
        b.x += ux
        b.y += uy
        moved = true
      }
    }
    if (!moved) break
  }
  return positions
}

export function getDependencyEdgeNodes(
  a: AgentBoardGraphNode | undefined,
  b: AgentBoardGraphNode | undefined,
  layers: Record<string, number>,
) {
  if (!a || !b) return { source: undefined, target: undefined }
  const layerA = layers[a.id] ?? 0
  const layerB = layers[b.id] ?? 0
  const source = layerA >= layerB ? a : b
  return { source, target: source.id === a.id ? b : a }
}

function stronglyConnectedComponents(ids: string[], outgoing: Map<string, Set<string>>) {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const indexByID = new Map<string, number>()
  const lowlinkByID = new Map<string, number>()
  const components: string[][] = []

  const visit = (id: string) => {
    indexByID.set(id, index)
    lowlinkByID.set(id, index)
    index++
    stack.push(id)
    onStack.add(id)

    for (const next of outgoing.get(id) ?? []) {
      if (!indexByID.has(next)) {
        visit(next)
        lowlinkByID.set(id, Math.min(lowlinkByID.get(id) ?? 0, lowlinkByID.get(next) ?? 0))
      } else if (onStack.has(next)) {
        lowlinkByID.set(id, Math.min(lowlinkByID.get(id) ?? 0, indexByID.get(next) ?? 0))
      }
    }

    if (lowlinkByID.get(id) !== indexByID.get(id)) return
    const component: string[] = []
    while (stack.length > 0) {
      const current = stack.pop()!
      onStack.delete(current)
      component.push(current)
      if (current === id) break
    }
    components.push(component)
  }

  for (const id of ids) {
    if (!indexByID.has(id)) visit(id)
  }
  return components
}

function weaklyConnectedIslands(nodes: AgentBoardGraphNode[], incoming: Map<string, Set<string>>, outgoing: Map<string, Set<string>>) {
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const remaining = new Set(nodes.map((node) => node.id))
  const islands: AgentBoardGraphNode[][] = []

  while (remaining.size > 0) {
    const first = remaining.values().next().value
    if (!first) break
    const queue = [first]
    const islandIDs = new Set<string>()
    remaining.delete(first)
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!
      islandIDs.add(id)
      for (const next of [...(incoming.get(id) ?? []), ...(outgoing.get(id) ?? [])]) {
        if (!remaining.has(next)) continue
        remaining.delete(next)
        queue.push(next)
      }
    }
    islands.push(
      Array.from(islandIDs)
        .map((id) => nodesByID.get(id))
        .filter((node): node is AgentBoardGraphNode => node !== undefined),
    )
  }

  return islands.sort((a, b) => b.length - a.length || a[0]?.id.localeCompare(b[0]?.id ?? "") || 0)
}

function buildDependencyComponents(connected: AgentBoardGraphNode[], outgoing: Map<string, Set<string>>) {
  const components = stronglyConnectedComponents(
    connected.map((node) => node.id),
    outgoing,
  )
  const componentByNodeID = new Map<string, number>()
  components.forEach((nodeIDs, id) => {
    for (const nodeID of nodeIDs) componentByNodeID.set(nodeID, id)
  })

  const output: DependencyComponent[] = components.map((nodeIDs, id) => ({
    id,
    nodeIDs,
    outgoing: new Set<number>(),
    layer: 0,
  }))

  for (const node of connected) {
    const sourceComponent = componentByNodeID.get(node.id)
    if (sourceComponent === undefined) continue
    for (const targetID of outgoing.get(node.id) ?? []) {
      const targetComponent = componentByNodeID.get(targetID)
      if (targetComponent === undefined || targetComponent === sourceComponent) continue
      output[sourceComponent]?.outgoing.add(targetComponent)
    }
  }

  const layerForComponent = (componentID: number, seen = new Set<number>()): number => {
    const component = output[componentID]
    if (!component || component.outgoing.size === 0) return 0
    if (seen.has(componentID)) return component.layer
    seen.add(componentID)
    let layer = 0
    for (const nextID of component.outgoing) layer = Math.max(layer, layerForComponent(nextID, seen) + 1)
    component.layer = layer
    seen.delete(componentID)
    return layer
  }

  for (const component of output) component.layer = layerForComponent(component.id)
  return { components: output, componentByNodeID }
}

function nodeScore(node: AgentBoardGraphNode) {
  return priorityRank(node.card.issue.priority) * 100 - node.blockedBy * 10 - node.unblocks
}

function layoutDependencyIsland(
  island: AgentBoardGraphNode[],
  outgoing: Map<string, Set<string>>,
  options: AgentBoardGraphDependencyOptions,
): DependencyIslandLayout {
  const nodesByID = new Map(island.map((node) => [node.id, node]))
  const { components, componentByNodeID } = buildDependencyComponents(island, outgoing)
  const layers: Record<string, number> = {}
  const byLayer = new Map<number, DependencyComponent[]>()
  const incoming = new Map(island.map((node) => [node.id, new Set<string>()]))
  for (const node of island) {
    for (const target of outgoing.get(node.id) ?? []) {
      if (nodesByID.has(target)) incoming.get(target)?.add(node.id)
    }
  }
  for (const component of components) {
    byLayer.set(component.layer, [...(byLayer.get(component.layer) ?? []), component])
    for (const nodeID of component.nodeIDs) layers[nodeID] = component.layer
  }

  const currentBounds = nodeBounds(island, options)
  const center = {
    x: (currentBounds.minX + currentBounds.maxX) / 2,
    y: (currentBounds.minY + currentBounds.maxY) / 2,
  }
  const positions: AgentBoardGraphPosition[] = []
  const componentScore = (component: DependencyComponent) => {
    const componentNodes = component.nodeIDs
      .map((id) => nodesByID.get(id))
      .filter((node): node is AgentBoardGraphNode => node !== undefined)
    return Math.min(...componentNodes.map(nodeScore))
  }

  const layerIndexes = Array.from(byLayer.keys()).sort((a, b) => a - b)
  const maxLayer = Math.max(...layerIndexes)
  const orderedByLayer = new Map<number, AgentBoardGraphNode[]>()
  const orderByID = new Map<string, number>()
  const setOrder = (layerIndex: number, nodes: AgentBoardGraphNode[]) => {
    orderedByLayer.set(layerIndex, nodes)
    nodes.forEach((node, index) => orderByID.set(node.id, index))
  }
  for (const layerIndex of layerIndexes) {
    const componentGroup = [...(byLayer.get(layerIndex) ?? [])].sort((a, b) => {
      return componentScore(a) - componentScore(b) || a.id - b.id
    })
    const layerNodes = componentGroup.flatMap((component) =>
      component.nodeIDs
        .map((id) => nodesByID.get(id))
        .filter((node): node is AgentBoardGraphNode => node !== undefined)
        .sort((a, b) => nodeScore(a) - nodeScore(b) || a.id.localeCompare(b.id)),
    )
    setOrder(layerIndex, layerNodes)
  }
  const neighborOrder = (node: AgentBoardGraphNode, direction: "outgoing" | "incoming") => {
    const ids = Array.from((direction === "outgoing" ? outgoing : incoming).get(node.id) ?? [])
    const orders = ids.map((id) => orderByID.get(id)).filter((order): order is number => order !== undefined)
    if (orders.length === 0) return Number.POSITIVE_INFINITY
    return orders.reduce((sum, order) => sum + order, 0) / orders.length
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const layerIndex of layerIndexes) {
      const current = [...(orderedByLayer.get(layerIndex) ?? [])]
      setOrder(
        layerIndex,
        current.sort(
          (a, b) =>
            neighborOrder(a, "outgoing") - neighborOrder(b, "outgoing") ||
            nodeScore(a) - nodeScore(b) ||
            a.id.localeCompare(b.id),
        ),
      )
    }
    for (const layerIndex of [...layerIndexes].reverse()) {
      const current = [...(orderedByLayer.get(layerIndex) ?? [])]
      setOrder(
        layerIndex,
        current.sort(
          (a, b) =>
            neighborOrder(a, "incoming") - neighborOrder(b, "incoming") ||
            nodeScore(a) - nodeScore(b) ||
            a.id.localeCompare(b.id),
        ),
      )
    }
  }

  const maxRows = Math.max(1, ...Array.from(orderedByLayer.values()).map((nodes) => nodes.length))
  for (const layerIndex of layerIndexes) {
    const nodes = orderedByLayer.get(layerIndex) ?? []
    const x = center.x + (maxLayer - layerIndex) * options.columnGap
    const topOffset = ((maxRows - nodes.length) * options.rowGap) / 2
    nodes.forEach((node, index) => {
      positions.push({
        issueID: node.id,
        x: x - options.nodeWidth / 2,
        y: center.y + topOffset + index * options.rowGap - options.nodeHeight / 2,
        pinned: true,
      })
    })
  }

  const relaxed = resolvePositionCollisions(positions, options)
  const bounds = positionBounds(relaxed, options)
  const normalized = relaxed.map((position) => ({
    ...position,
    x: position.x - bounds.minX,
    y: position.y - bounds.minY,
  }))
  return { positions: normalized, layers, width: bounds.width, height: bounds.height }
}

export function buildGraphDependencyLayout(
  nodes: AgentBoardGraphNode[],
  edges: Array<{ sourceIssueID: string; targetIssueID: string }>,
  options: AgentBoardGraphDependencyOptions,
): AgentBoardGraphDependencyLayout {
  if (nodes.length === 0) return { positions: [], layers: {} }
  const nodesByID = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]))
  for (const edge of edges) {
    if (!nodesByID.has(edge.sourceIssueID) || !nodesByID.has(edge.targetIssueID)) continue
    outgoing.get(edge.sourceIssueID)?.add(edge.targetIssueID)
    incoming.get(edge.targetIssueID)?.add(edge.sourceIssueID)
  }

  const connected = nodes.filter((node) => (incoming.get(node.id)?.size ?? 0) + (outgoing.get(node.id)?.size ?? 0) > 0)
  const isolated = nodes.filter((node) => (incoming.get(node.id)?.size ?? 0) + (outgoing.get(node.id)?.size ?? 0) === 0)
  const currentBounds = nodeBounds(nodes, options)
  const origin = { x: currentBounds.minX, y: currentBounds.minY }
  const positions: AgentBoardGraphPosition[] = []
  const layers: Record<string, number> = {}

  const islands = weaklyConnectedIslands(connected, incoming, outgoing)
  let cursorX = origin.x
  let cursorY = origin.y
  let rowHeight = 0
  const maxRowWidth = Math.max(1200, Math.sqrt(Math.max(1, connected.length)) * (options.nodeWidth + options.columnGap))

  for (const island of islands) {
    const layout = layoutDependencyIsland(island, outgoing, options)
    if (cursorX > origin.x && cursorX + layout.width > origin.x + maxRowWidth) {
      cursorX = origin.x
      cursorY += rowHeight + options.rowGap * 1.5
      rowHeight = 0
    }
    for (const position of layout.positions) {
      positions.push({
        ...position,
        x: position.x + cursorX,
        y: position.y + cursorY,
      })
    }
    Object.assign(layers, layout.layers)
    cursorX += layout.width + options.columnGap
    rowHeight = Math.max(rowHeight, layout.height)
  }

  const connectedBounds = positions.length > 0 ? positionBounds(positions, options) : { maxX: origin.x, minY: origin.y, height: 1 }
  const isolatedSorted = [...isolated].sort(
    (a, b) =>
      priorityRank(a.card.issue.priority) - priorityRank(b.card.issue.priority) ||
      a.card.column.localeCompare(b.card.column) ||
      a.id.localeCompare(b.id),
  )
  if (isolatedSorted.length > 0) {
    const columns = isolatedSorted.length > 22 ? Math.ceil(isolatedSorted.length / 22) : 1
    const rows = Math.ceil(isolatedSorted.length / columns)
    const listX = connectedBounds.maxX + options.columnGap
    const listTop = connectedBounds.minY + Math.max(0, (connectedBounds.height - rows * options.rowGap) / 2)
    isolatedSorted.forEach((node, index) => {
      const column = Math.floor(index / rows)
      const row = index % rows
      positions.push({
        issueID: node.id,
        x: listX + column * options.columnGap,
        y: listTop + row * options.rowGap,
        pinned: true,
      })
      layers[node.id] = -1
    })
  }

  return { positions: resolvePositionCollisions(positions, options), layers }
}
