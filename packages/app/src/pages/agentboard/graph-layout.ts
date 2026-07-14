import type { AgentBoardGraphPosition } from "./api"
import type { AgentBoardGraphNode } from "./graph-state"
import { issueUpdatedTimestamp } from "./issue-utils"

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

function reduceLongEdgeNodeCrossings(
  input: AgentBoardGraphPosition[],
  layers: Record<string, number>,
  outgoing: Map<string, Set<string>>,
  options: Pick<AgentBoardGraphDependencyOptions, "nodeWidth" | "nodeHeight" | "rowGap">,
) {
  const positions = input.map((position) => ({ ...position }))
  const byID = new Map(positions.map((position) => [position.issueID, position]))
  const safety = 24
  const push = Math.max(options.nodeHeight + 28, options.rowGap * 0.8)

  for (let pass = 0; pass < 6; pass++) {
    let moved = false
    for (const source of positions) {
      const sourceLayer = layers[source.issueID]
      if (sourceLayer === undefined) continue
      for (const targetID of outgoing.get(source.issueID) ?? []) {
        const target = byID.get(targetID)
        const targetLayer = target ? layers[target.issueID] : undefined
        if (!target || targetLayer === undefined || Math.abs(sourceLayer - targetLayer) <= 1) continue
        const left = Math.min(source.x + options.nodeWidth, target.x + options.nodeWidth)
        const right = Math.max(source.x, target.x)
        if (right <= left) continue
        const y = source.y + options.nodeHeight / 2
        for (const middle of positions) {
          if (middle.issueID === source.issueID || middle.issueID === target.issueID) continue
          const layer = layers[middle.issueID]
          if (layer === undefined) continue
          if (layer <= Math.min(sourceLayer, targetLayer) || layer >= Math.max(sourceLayer, targetLayer)) continue
          const middleLeft = middle.x - safety
          const middleRight = middle.x + options.nodeWidth + safety
          const middleTop = middle.y - safety
          const middleBottom = middle.y + options.nodeHeight + safety
          if (middleRight < left || middleLeft > right) continue
          if (y < middleTop || y > middleBottom) continue
          middle.y += push
          moved = true
        }
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
  const incomingComponents = new Map<number, Set<number>>(output.map((component) => [component.id, new Set<number>()]))

  for (const node of connected) {
    const sourceComponent = componentByNodeID.get(node.id)
    if (sourceComponent === undefined) continue
    for (const targetID of outgoing.get(node.id) ?? []) {
      const targetComponent = componentByNodeID.get(targetID)
      if (targetComponent === undefined || targetComponent === sourceComponent) continue
      output[sourceComponent]?.outgoing.add(targetComponent)
      incomingComponents.get(targetComponent)?.add(sourceComponent)
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
  for (const component of output) {
    if (component.outgoing.size > 0) continue
    const incoming = Array.from(incomingComponents.get(component.id) ?? [])
      .map((id) => output[id]?.layer)
      .filter((layer): layer is number => layer !== undefined)
    if (incoming.length === 0) continue
    const nearestParentLayer = Math.min(...incoming)
    component.layer = Math.max(component.layer, nearestParentLayer - 1)
  }
  return { components: output, componentByNodeID }
}

function nodeScore(node: AgentBoardGraphNode) {
  return priorityRank(node.card.issue.priority) * 100 - node.blockedBy * 10 - node.unblocks
}

function recencyRank(node: AgentBoardGraphNode) {
  return issueUpdatedTimestamp(node.card) ?? 0
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
  const terminalBias = (node: AgentBoardGraphNode) => ((outgoing.get(node.id)?.size ?? 0) > 0 ? 1 : 0)
  const componentTerminalBias = (component: DependencyComponent) => {
    const componentNodes = component.nodeIDs
      .map((id) => nodesByID.get(id))
      .filter((node): node is AgentBoardGraphNode => node !== undefined)
    return Math.min(...componentNodes.map(terminalBias))
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
      return componentTerminalBias(a) - componentTerminalBias(b) || componentScore(a) - componentScore(b) || a.id - b.id
    })
    const layerNodes = componentGroup.flatMap((component) =>
      component.nodeIDs
        .map((id) => nodesByID.get(id))
        .filter((node): node is AgentBoardGraphNode => node !== undefined)
        .sort(
          (a, b) =>
            terminalBias(a) - terminalBias(b) ||
            nodeScore(a) - nodeScore(b) ||
            recencyRank(b) - recencyRank(a) ||
            a.id.localeCompare(b.id),
        ),
    )
    setOrder(layerIndex, layerNodes)
  }
  const neighborOrder = (node: AgentBoardGraphNode, direction: "outgoing" | "incoming") => {
    const ids = Array.from((direction === "outgoing" ? outgoing : incoming).get(node.id) ?? [])
    const orders = ids.map((id) => orderByID.get(id)).filter((order): order is number => order !== undefined)
    if (orders.length === 0) return Number.POSITIVE_INFINITY
    return orders.reduce((sum, order) => sum + order, 0) / orders.length
  }
  const neighborBarycenter = (node: AgentBoardGraphNode) => {
    const values = [neighborOrder(node, "incoming"), neighborOrder(node, "outgoing")].filter(Number.isFinite)
    if (values.length === 0) return Number.POSITIVE_INFINITY
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  const orderPenalty = (layersToScore: Map<number, AgentBoardGraphNode[]>) => {
    const order = new Map<string, number>()
    for (const nodes of layersToScore.values()) nodes.forEach((node, index) => order.set(node.id, index))
    let score = 0
    for (const source of island) {
      const sourceLayer = layers[source.id]
      const sourceOrder = order.get(source.id)
      if (sourceLayer === undefined || sourceOrder === undefined) continue
      for (const targetID of outgoing.get(source.id) ?? []) {
        const target = nodesByID.get(targetID)
        const targetLayer = target ? layers[target.id] : undefined
        const targetOrder = order.get(targetID)
        if (!target || targetLayer === undefined || targetOrder === undefined) continue
        const distance = Math.abs(targetOrder - sourceOrder)
        score += distance * distance + Math.abs(targetLayer - sourceLayer) * distance * 0.35
      }
    }
    return score
  }
  const reduceOrderPenalty = () => {
    for (let pass = 0; pass < 4; pass++) {
      let improved = false
      for (const layerIndex of layerIndexes) {
        const current = [...(orderedByLayer.get(layerIndex) ?? [])]
        if (current.length < 2) continue
        for (let index = 0; index < current.length - 1; index++) {
          const before = orderPenalty(orderedByLayer)
          ;[current[index], current[index + 1]] = [current[index + 1], current[index]]
          const candidate = new Map(orderedByLayer)
          candidate.set(layerIndex, current)
          const after = orderPenalty(candidate)
          if (after < before) {
            setOrder(layerIndex, [...current])
            improved = true
          } else {
            ;[current[index], current[index + 1]] = [current[index + 1], current[index]]
          }
        }
      }
      if (!improved) break
    }
  }
  for (let pass = 0; pass < 6; pass++) {
    for (const layerIndex of layerIndexes) {
      const current = [...(orderedByLayer.get(layerIndex) ?? [])]
      setOrder(
        layerIndex,
        current.sort(
          (a, b) =>
            neighborOrder(a, "outgoing") - neighborOrder(b, "outgoing") ||
            neighborBarycenter(a) - neighborBarycenter(b) ||
            terminalBias(a) - terminalBias(b) ||
            nodeScore(a) - nodeScore(b) ||
            recencyRank(b) - recencyRank(a) ||
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
            neighborBarycenter(a) - neighborBarycenter(b) ||
            terminalBias(a) - terminalBias(b) ||
            nodeScore(a) - nodeScore(b) ||
            recencyRank(b) - recencyRank(a) ||
            a.id.localeCompare(b.id),
        ),
      )
    }
  }
  reduceOrderPenalty()

  const maxRows = Math.max(1, ...Array.from(orderedByLayer.values()).map((nodes) => nodes.length))
  const rowGap =
    maxRows > 36
      ? Math.max(options.nodeHeight + 28, options.rowGap * 0.72)
      : maxRows > 14
        ? Math.max(options.nodeHeight + 36, options.rowGap * 0.82)
        : options.rowGap
  const shouldTopAlign = maxRows > 14
  for (const layerIndex of layerIndexes) {
    const nodes = orderedByLayer.get(layerIndex) ?? []
    const x = center.x + (maxLayer - layerIndex) * options.columnGap
    const topOffset = shouldTopAlign ? 0 : ((maxRows - nodes.length) * rowGap) / 2
    nodes.forEach((node, index) => {
      positions.push({
        issueID: node.id,
        x: x - options.nodeWidth / 2,
        y: center.y + topOffset + index * rowGap - options.nodeHeight / 2,
        pinned: true,
      })
    })
  }

  const untangled = reduceLongEdgeNodeCrossings(positions, layers, outgoing, options)
  const relaxed = resolvePositionCollisions(untangled, options)
  const bounds = positionBounds(relaxed, options)
  const normalized = relaxed.map((position) => ({
    ...position,
    x: position.x - bounds.minX,
    y: position.y - bounds.minY,
  }))
  return { positions: normalized, layers, width: bounds.width, height: bounds.height }
}

type SkylineSegment = { x: number; width: number; top: number }

function applySkylineSpan(skyline: SkylineSegment[], x: number, width: number, top: number) {
  const end = x + width
  const result: SkylineSegment[] = []
  for (const segment of skyline) {
    const segmentEnd = segment.x + segment.width
    if (segmentEnd <= x || segment.x >= end) {
      result.push(segment)
      continue
    }
    if (segment.x < x) result.push({ x: segment.x, width: x - segment.x, top: segment.top })
    const overlapStart = Math.max(segment.x, x)
    const overlapEnd = Math.min(segmentEnd, end)
    result.push({ x: overlapStart, width: overlapEnd - overlapStart, top })
    if (segmentEnd > end) result.push({ x: end, width: segmentEnd - end, top: segment.top })
  }
  const merged: SkylineSegment[] = []
  for (const segment of result) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.top - segment.top) <= 0.01 && Math.abs(last.x + last.width - segment.x) <= 0.01) {
      last.width += segment.width
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

// Bottom-left skyline packing: places each rectangle at the lowest (then
// leftmost) free spot. Unlike row packing, a tall rectangle no longer reserves
// a full-width band — shorter rectangles fill the empty space beside it.
function packRectangles(
  sizes: Array<{ width: number; height: number }>,
  maxRowWidth: number,
  gapX: number,
  gapY: number,
): Array<{ x: number; y: number }> {
  if (sizes.length === 0) return []
  const totalWidth = Math.max(maxRowWidth, ...sizes.map((size) => size.width + gapX))
  let skyline: SkylineSegment[] = [{ x: 0, width: totalWidth, top: 0 }]
  const placements: Array<{ x: number; y: number }> = []

  const topForSpan = (startX: number, span: number) => {
    let top = 0
    let covered = 0
    for (const segment of skyline) {
      if (segment.x + segment.width <= startX) continue
      if (segment.x >= startX + span) break
      top = Math.max(top, segment.top)
      covered += Math.min(segment.x + segment.width, startX + span) - Math.max(segment.x, startX)
    }
    return covered + 0.01 >= span ? top : undefined
  }

  for (const size of sizes) {
    const width = size.width + gapX
    const height = size.height + gapY
    let best: { x: number; y: number } | undefined
    for (const segment of skyline) {
      if (segment.x + width > totalWidth + 0.01) continue
      const top = topForSpan(segment.x, width)
      if (top === undefined) continue
      if (!best || top < best.y - 0.01 || (top <= best.y + 0.01 && segment.x < best.x)) {
        best = { x: segment.x, y: top }
      }
    }
    if (!best) best = { x: 0, y: 0 }
    placements.push(best)
    skyline = applySkylineSpan(skyline, best.x, width, best.y + height)
  }
  return placements
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
  const maxRowWidth = Math.max(1200, Math.sqrt(Math.max(1, connected.length)) * (options.nodeWidth + options.columnGap))
  // Lay out every island, then skyline-pack them tallest-first so short islands
  // settle into the empty space beside a tall island instead of being pushed
  // onto a new row far below it.
  const islandLayouts = islands
    .map((island, index) => ({ layout: layoutDependencyIsland(island, outgoing, options), index }))
    .sort((a, b) => b.layout.height - a.layout.height || a.index - b.index)
  const islandPlacements = packRectangles(
    islandLayouts.map((entry) => ({ width: entry.layout.width, height: entry.layout.height })),
    maxRowWidth,
    options.columnGap,
    options.rowGap * 1.5,
  )
  islandLayouts.forEach((entry, packIndex) => {
    const placement = islandPlacements[packIndex]!
    for (const position of entry.layout.positions) {
      positions.push({
        ...position,
        x: position.x + origin.x + placement.x,
        y: position.y + origin.y + placement.y,
      })
    }
    Object.assign(layers, entry.layout.layers)
  })

  const connectedBounds = positions.length > 0 ? positionBounds(positions, options) : { maxX: origin.x, minY: origin.y, height: 1 }
  const isolatedSorted = [...isolated].sort(
    (a, b) =>
      (issueUpdatedTimestamp(b.card) ?? 0) - (issueUpdatedTimestamp(a.card) ?? 0) ||
      priorityRank(a.card.issue.priority) - priorityRank(b.card.issue.priority) ||
      a.card.column.localeCompare(b.card.column) ||
      a.id.localeCompare(b.id),
  )
  if (isolatedSorted.length > 0) {
    const targetRows = Math.max(8, Math.ceil(Math.sqrt(isolatedSorted.length * 1.35)))
    const columns = Math.max(1, Math.ceil(isolatedSorted.length / targetRows))
    const rows = Math.ceil(isolatedSorted.length / columns)
    const listX = connectedBounds.maxX + options.columnGap
    const rowGap =
      rows > 36
        ? Math.max(options.nodeHeight + 28, options.rowGap * 0.72)
        : rows > 14
          ? Math.max(options.nodeHeight + 36, options.rowGap * 0.82)
          : options.rowGap
    const listTop =
      rows > 14 ? connectedBounds.minY : connectedBounds.minY + Math.max(0, (connectedBounds.height - rows * rowGap) / 2)
    isolatedSorted.forEach((node, index) => {
      const column = Math.floor(index / rows)
      const row = index % rows
      positions.push({
        issueID: node.id,
        x: listX + column * options.columnGap,
        y: listTop + row * rowGap,
        pinned: true,
      })
      layers[node.id] = -1
    })
  }

  return { positions: resolvePositionCollisions(positions, options), layers }
}
