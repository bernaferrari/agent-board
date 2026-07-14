import type { AgentBoardGraphNode } from "./graph-state"
import { getDependencyEdgeNodes } from "./graph-layout"

export const GRAPH_NODE_WIDTH = 276
export const GRAPH_NODE_HEIGHT = 124
export const GRAPH_FOCUS_COLUMN_GAP = 500
export const GRAPH_FOCUS_ROW_GAP = 196
export const GRAPH_FOCUS_PADDING = 96
export const GRAPH_LAYOUT_NODE_GAP = 96
export const GRAPH_LAYOUT_LAYER_GAP = 360
const GRAPH_EDGE_NODE_PADDING = 30
const GRAPH_EDGE_APPROACH_CLEARANCE = 52
const GRAPH_EDGE_TARGET_CLEARANCE = 92
const GRAPH_EDGE_LANE_STEP = 104
const GRAPH_EDGE_LANE_ATTEMPTS = 10
const GRAPH_EDGE_TERMINAL_GAP = 22
const GRAPH_EDGE_OUTSIDE_GAP = 72
export const GRAPH_EASE = "cubic-bezier(0.22,1,0.36,1)"
type GraphPoint = {
  x: number
  y: number
}

type GraphRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type GraphEdgeShape = {
  line: string
  arrow: string
}

type GraphRouteNodeRect = GraphRect & { id: string }

type GraphArrow = {
  path: string
  base: GraphPoint
}

function priorityRank(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  return Number.isFinite(value) ? value : 5
}

export function dependencyLabel(node: AgentBoardGraphNode) {
  if (node.blockedBy > 0 && node.unblocks > 0) {
    return `Blocked by ${node.blockedBy}`
  }
  if (node.blockedBy > 0) return `Blocked by ${node.blockedBy}`
  return "No visible dependencies"
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function graphNodeBounds(nodes: AgentBoardGraphNode[]) {
  const items = nodes.map((node) => ({
    minX: node.x,
    minY: node.y,
    maxX: node.x + GRAPH_NODE_WIDTH,
    maxY: node.y + GRAPH_NODE_HEIGHT,
  }))
  if (items.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 }
  const minX = Math.min(...items.map((item) => item.minX))
  const minY = Math.min(...items.map((item) => item.minY))
  const maxX = Math.max(...items.map((item) => item.maxX))
  const maxY = Math.max(...items.map((item) => item.maxY))
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function graphNodeRect(node: AgentBoardGraphNode, padding = 0): GraphRect {
  return {
    minX: node.x - padding,
    minY: node.y - padding,
    maxX: node.x + GRAPH_NODE_WIDTH + padding,
    maxY: node.y + GRAPH_NODE_HEIGHT + padding,
  }
}

export function graphRouteNodeRects(nodes: AgentBoardGraphNode[]) {
  return nodes.map((node) => ({
    id: node.id,
    ...graphNodeRect(node, GRAPH_EDGE_NODE_PADDING),
  }))
}

function obstacleRectsFor(nodeRects: GraphRouteNodeRect[], sourceID: string, targetID: string): GraphRect[] {
  return nodeRects.filter((rect) => rect.id !== sourceID && rect.id !== targetID)
}

function segmentCrossesRect(a: GraphPoint, b: GraphPoint, rect: GraphRect) {
  if (a.y === b.y) {
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    return a.y >= rect.minY && a.y <= rect.maxY && maxX >= rect.minX && minX <= rect.maxX
  }
  if (a.x === b.x) {
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    return a.x >= rect.minX && a.x <= rect.maxX && maxY >= rect.minY && minY <= rect.maxY
  }
  return false
}

function rectCenter(rect: GraphRect) {
  return {
    x: (rect.minX + rect.maxX) / 2,
    y: (rect.minY + rect.maxY) / 2,
  }
}

function segmentNearRect(a: GraphPoint, b: GraphPoint, rect: GraphRect, margin = 18) {
  return segmentCrossesRect(a, b, {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  })
}

function scoreGraphRouteSegments(
  segments: Array<[GraphPoint, GraphPoint]>,
  obstacleRects: GraphRect[],
  preferredX: number,
  preferredY: number,
) {
  let collisions = 0
  let nearMisses = 0
  let centerCuts = 0
  let columnGrazes = 0
  for (const rect of obstacleRects) {
    const center = rectCenter(rect)
    for (const [a, b] of segments) {
      if (segmentCrossesRect(a, b, rect)) collisions++
      if (segmentNearRect(a, b, rect)) nearMisses++
      if (a.x === b.x && Math.abs(a.x - center.x) < GRAPH_NODE_WIDTH * 0.38) centerCuts++
      if (a.y === b.y && Math.abs(a.y - center.y) < GRAPH_NODE_HEIGHT * 0.38) centerCuts++
      if (a.x === b.x) {
        const minY = Math.min(a.y, b.y)
        const maxY = Math.max(a.y, b.y)
        const yOverlap = maxY >= rect.minY && minY <= rect.maxY
        const distanceToSide = Math.min(Math.abs(a.x - rect.minX), Math.abs(a.x - rect.maxX))
        if (yOverlap && distanceToSide < GRAPH_EDGE_TARGET_CLEARANCE) columnGrazes++
      }
    }
  }
  const lengthPenalty = segments.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0) / 1600
  const positionPenalty =
    segments.reduce((sum, [a, b]) => sum + Math.abs((a.x + b.x) / 2 - preferredX) / 5000, 0) +
    segments.reduce((sum, [a, b]) => sum + Math.abs((a.y + b.y) / 2 - preferredY) / 5000, 0)
  return collisions * 1000 + centerCuts * 120 + columnGrazes * 42 + nearMisses * 28 + lengthPenalty + positionPenalty
}

function segmentsFromPoints(points: GraphPoint[]) {
  const segments: Array<[GraphPoint, GraphPoint]> = []
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index]
    const b = points[index + 1]
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue
    segments.push([a, b])
  }
  return segments
}

function roundedElbowPath(start: GraphPoint, laneX: number, end: GraphPoint) {
  const first = { x: laneX, y: start.y }
  const second = { x: laneX, y: end.y }
  const r = Math.min(28, Math.abs(laneX - start.x) / 2, Math.abs(end.x - laneX) / 2, Math.abs(end.y - start.y) / 2)
  if (r < 2) return `M ${start.x} ${start.y} C ${laneX} ${start.y}, ${laneX} ${end.y}, ${end.x} ${end.y}`
  const sx = Math.sign(laneX - start.x) || 1
  const sy = Math.sign(end.y - start.y) || 1
  const ex = Math.sign(end.x - laneX) || sx
  return [
    `M ${start.x} ${start.y}`,
    `L ${first.x - sx * r} ${first.y}`,
    `Q ${first.x} ${first.y} ${first.x} ${first.y + sy * r}`,
    `L ${second.x} ${second.y - sy * r}`,
    `Q ${second.x} ${second.y} ${second.x + ex * r} ${second.y}`,
    `L ${end.x} ${end.y}`,
  ].join(" ")
}

function roundedPolylinePath(points: GraphPoint[], radius = 28) {
  const compact = points.filter((point, index) => {
    const previous = points[index - 1]
    return !previous || Math.abs(previous.x - point.x) > 0.5 || Math.abs(previous.y - point.y) > 0.5
  })
  if (compact.length < 2) return ""
  const output = [`M ${compact[0].x} ${compact[0].y}`]
  for (let index = 1; index < compact.length; index++) {
    const previous = compact[index - 1]
    const current = compact[index]
    const next = compact[index + 1]
    if (!next) {
      output.push(`L ${current.x} ${current.y}`)
      continue
    }
    const v1 = { x: current.x - previous.x, y: current.y - previous.y }
    const v2 = { x: next.x - current.x, y: next.y - current.y }
    const l1 = Math.hypot(v1.x, v1.y)
    const l2 = Math.hypot(v2.x, v2.y)
    if (l1 < 2 || l2 < 2) continue
    const r = Math.min(radius, l1 / 2, l2 / 2)
    const before = { x: current.x - (v1.x / l1) * r, y: current.y - (v1.y / l1) * r }
    const after = { x: current.x + (v2.x / l2) * r, y: current.y + (v2.y / l2) * r }
    output.push(`L ${before.x} ${before.y}`, `Q ${current.x} ${current.y} ${after.x} ${after.y}`)
  }
  return output.join(" ")
}

function graphArrow(tip: GraphPoint, angle: number, active: boolean): GraphArrow {
  void active
  const arrowLength = 17
  const arrowWidth = 8.5
  const baseX = tip.x - Math.cos(angle) * arrowLength
  const baseY = tip.y - Math.sin(angle) * arrowLength
  const normalX = Math.cos(angle + Math.PI / 2)
  const normalY = Math.sin(angle + Math.PI / 2)
  return {
    base: { x: baseX, y: baseY },
    path: [
      `M ${baseX + normalX * arrowWidth} ${baseY + normalY * arrowWidth}`,
      `L ${tip.x} ${tip.y}`,
      `L ${baseX - normalX * arrowWidth} ${baseY - normalY * arrowWidth}`,
    ].join(" "),
  }
}

type GraphSide = "left" | "right" | "top" | "bottom"

function sideAnchor(node: AgentBoardGraphNode, side: GraphSide, offset = 0): GraphPoint {
  if (side === "left") return { x: node.x - GRAPH_EDGE_TERMINAL_GAP, y: node.y + GRAPH_NODE_HEIGHT / 2 + offset }
  if (side === "right")
    return { x: node.x + GRAPH_NODE_WIDTH + GRAPH_EDGE_TERMINAL_GAP, y: node.y + GRAPH_NODE_HEIGHT / 2 + offset }
  if (side === "top") return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y - GRAPH_EDGE_TERMINAL_GAP }
  return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y + GRAPH_NODE_HEIGHT + GRAPH_EDGE_TERMINAL_GAP }
}

function sideAngle(side: GraphSide) {
  if (side === "left") return 0
  if (side === "right") return Math.PI
  if (side === "top") return Math.PI / 2
  return -Math.PI / 2
}

function rectsOverlapOrNear(a: AgentBoardGraphNode, b: AgentBoardGraphNode, margin: number) {
  return !(
    a.x + GRAPH_NODE_WIDTH + margin < b.x ||
    b.x + GRAPH_NODE_WIDTH + margin < a.x ||
    a.y + GRAPH_NODE_HEIGHT + margin < b.y ||
    b.y + GRAPH_NODE_HEIGHT + margin < a.y
  )
}

function outsideLaneForNodes(a: AgentBoardGraphNode, b: AgentBoardGraphNode) {
  const left = Math.min(a.x, b.x) - GRAPH_EDGE_OUTSIDE_GAP
  const right = Math.max(a.x + GRAPH_NODE_WIDTH, b.x + GRAPH_NODE_WIDTH) + GRAPH_EDGE_OUTSIDE_GAP
  return Math.abs(left - (a.x + GRAPH_NODE_WIDTH / 2)) < Math.abs(right - (a.x + GRAPH_NODE_WIDTH / 2)) ? left : right
}

function figmaConnectorPath(start: GraphPoint, end: GraphPoint, direction: number) {
  const lead = 42
  const sourceLead = { x: start.x + direction * lead, y: start.y }
  const targetLead = { x: end.x - direction * lead, y: end.y }
  const availableWidth = Math.abs(targetLead.x - sourceLead.x)
  if (availableWidth < 76) {
    const laneY = (start.y + end.y) / 2
    return roundedPolylinePath(
      [start, sourceLead, { x: sourceLead.x, y: laneY }, { x: targetLead.x, y: laneY }, targetLead, end],
      28,
    )
  }
  const laneY = (start.y + end.y) / 2
  return roundedPolylinePath(
    [start, sourceLead, { x: sourceLead.x, y: laneY }, { x: targetLead.x, y: laneY }, targetLead, end],
    42,
  )
}

function dependencyGraphEdge(
  a: AgentBoardGraphNode | undefined,
  b: AgentBoardGraphNode | undefined,
  active: boolean,
  dependencyLayers: Record<string, number>,
  nodes: AgentBoardGraphNode[] = [],
  nodeRects: GraphRouteNodeRect[] = graphRouteNodeRects(nodes),
): GraphEdgeShape {
  const { source, target } = getDependencyEdgeNodes(a, b, dependencyLayers)
  if (!source || !target) return { line: "", arrow: "" }
  const sourceCenter = { x: source.x + GRAPH_NODE_WIDTH / 2, y: source.y + GRAPH_NODE_HEIGHT / 2 }
  const targetCenter = { x: target.x + GRAPH_NODE_WIDTH / 2, y: target.y + GRAPH_NODE_HEIGHT / 2 }
  const dx = targetCenter.x - sourceCenter.x
  const direction = Math.sign(dx) || 1
  const sourceSide: GraphSide = direction > 0 ? "right" : "left"
  const targetSide: GraphSide = direction > 0 ? "left" : "right"
  if (rectsOverlapOrNear(source, target, GRAPH_EDGE_APPROACH_CLEARANCE)) {
    const laneX = outsideLaneForNodes(source, target)
    const sourceSide: GraphSide = laneX < source.x ? "left" : "right"
    const targetSide: GraphSide = laneX < target.x ? "left" : "right"
    const start = sideAnchor(source, sourceSide, 0)
    const end = sideAnchor(target, targetSide, 0)
    const arrow = graphArrow(end, sideAngle(targetSide), active)
    return {
      line: roundedPolylinePath([start, { x: laneX, y: start.y }, { x: laneX, y: arrow.base.y }, arrow.base], 36),
      arrow: arrow.path,
    }
  }
  const start = sideAnchor(source, sourceSide, 0)
  const end = sideAnchor(target, targetSide, 0)
  const arrow = graphArrow(end, sideAngle(targetSide), active)
  {
    const midpoint = (start.x + end.x) / 2
    const sourceLaneX = start.x + direction * GRAPH_EDGE_APPROACH_CLEARANCE
    const targetLaneX = arrow.base.x - direction * GRAPH_EDGE_TARGET_CLEARANCE
    const minLaneX = Math.min(sourceLaneX, targetLaneX)
    const maxLaneX = Math.max(sourceLaneX, targetLaneX)
    const laneFitsBetweenNodes = direction > 0 ? sourceLaneX <= targetLaneX : targetLaneX <= sourceLaneX
    const outsideLaneX =
      direction > 0
        ? Math.min(source.x, target.x) - GRAPH_EDGE_OUTSIDE_GAP
        : Math.max(source.x + GRAPH_NODE_WIDTH, target.x + GRAPH_NODE_WIDTH) + GRAPH_EDGE_OUTSIDE_GAP
    const normalizeLane = (laneX: number) => (laneFitsBetweenNodes ? clamp(laneX, minLaneX, maxLaneX) : outsideLaneX)
    if (!laneFitsBetweenNodes) {
      return {
        line: figmaConnectorPath(start, arrow.base, direction),
        arrow: arrow.path,
      }
    }
    const candidates = [normalizeLane(midpoint)]
    for (let attempt = 1; attempt <= GRAPH_EDGE_LANE_ATTEMPTS; attempt++) {
      candidates.push(
        normalizeLane(midpoint + attempt * GRAPH_EDGE_LANE_STEP),
        normalizeLane(midpoint - attempt * GRAPH_EDGE_LANE_STEP),
      )
    }
    const obstacleRects = obstacleRectsFor(nodeRects, source.id, target.id)
    const candidateFor = (points: GraphPoint[]) => ({
      points,
      score: scoreGraphRouteSegments(segmentsFromPoints(points), obstacleRects, midpoint, (start.y + arrow.base.y) / 2),
    })
    const routeCandidates = candidates.map((laneX) =>
      candidateFor([start, { x: laneX, y: start.y }, { x: laneX, y: arrow.base.y }, arrow.base]),
    )
    const xMin = Math.min(start.x, arrow.base.x)
    const xMax = Math.max(start.x, arrow.base.x)
    const crossingRects = obstacleRects.filter((rect) => rect.maxX >= xMin && rect.minX <= xMax)
    if (crossingRects.length > 0) {
      const top = Math.min(...crossingRects.map((rect) => rect.minY), start.y, arrow.base.y) - 34
      const bottom = Math.max(...crossingRects.map((rect) => rect.maxY), start.y, arrow.base.y) + 34
      const sourceLaneX = start.x + direction * GRAPH_EDGE_APPROACH_CLEARANCE
      const targetLaneX = arrow.base.x - direction * GRAPH_EDGE_TARGET_CLEARANCE
      for (const laneY of [top, bottom]) {
        routeCandidates.push(
          candidateFor([
            start,
            { x: sourceLaneX, y: start.y },
            { x: sourceLaneX, y: laneY },
            { x: targetLaneX, y: laneY },
            { x: targetLaneX, y: arrow.base.y },
            arrow.base,
          ]),
        )
      }
    }
    const best = routeCandidates.reduce((best, candidate) => (candidate.score < best.score ? candidate : best))
    return {
      line: roundedPolylinePath(best.points, 36),
      arrow: arrow.path,
    }
  }
}

export function routeGraphEdge(
  source: AgentBoardGraphNode | undefined,
  target: AgentBoardGraphNode | undefined,
  nodes: AgentBoardGraphNode[],
  active: boolean,
  dependencyLayers: Record<string, number>,
  edgeOffset = 0,
  nodeRects: GraphRouteNodeRect[] = graphRouteNodeRects(nodes),
): GraphEdgeShape {
  if (!source || !target) return { line: "", arrow: "" }
  if (Object.keys(dependencyLayers).length > 0)
    return dependencyGraphEdge(source, target, active, dependencyLayers, nodes, nodeRects)
  const sourceCenter = { x: source.x + GRAPH_NODE_WIDTH / 2, y: source.y + GRAPH_NODE_HEIGHT / 2 }
  const targetCenter = { x: target.x + GRAPH_NODE_WIDTH / 2, y: target.y + GRAPH_NODE_HEIGHT / 2 }
  if (Math.abs(targetCenter.x - sourceCenter.x) < GRAPH_NODE_WIDTH * 0.35) {
    const laneX = Math.min(source.x, target.x) - GRAPH_EDGE_APPROACH_CLEARANCE - 52 - edgeOffset * 18
    const start = sideAnchor(source, "left", 0)
    const end = sideAnchor(target, "left", 0)
    const arrow = graphArrow(end, 0, active)
    const line = roundedPolylinePath([start, { x: laneX, y: start.y }, { x: laneX, y: arrow.base.y }, arrow.base], 34)
    return {
      line,
      arrow: arrow.path,
    }
  }
  const forward = targetCenter.x >= sourceCenter.x
  const side = forward ? 1 : -1
  const start = {
    x: source.x + (forward ? GRAPH_NODE_WIDTH + 8 : -8),
    y: sourceCenter.y,
  }
  const end = {
    x: target.x + (forward ? -8 : GRAPH_NODE_WIDTH + 8),
    y: targetCenter.y,
  }
  const arrow = graphArrow(end, forward ? 0 : Math.PI, active)
  const midpoint = (start.x + end.x) / 2
  const sourceLaneX = start.x + side * GRAPH_EDGE_APPROACH_CLEARANCE
  const targetLaneX = arrow.base.x - side * GRAPH_EDGE_TARGET_CLEARANCE
  const minLaneX = Math.min(sourceLaneX, targetLaneX)
  const maxLaneX = Math.max(sourceLaneX, targetLaneX)
  const laneFitsBetweenNodes = forward ? sourceLaneX <= targetLaneX : targetLaneX <= sourceLaneX
  const outsideLaneX = forward
    ? Math.min(source.x, target.x) - GRAPH_EDGE_OUTSIDE_GAP
    : Math.max(source.x + GRAPH_NODE_WIDTH, target.x + GRAPH_NODE_WIDTH) + GRAPH_EDGE_OUTSIDE_GAP
  const normalizeLane = (laneX: number) => {
    if (laneFitsBetweenNodes) return clamp(laneX, minLaneX, maxLaneX)
    return outsideLaneX
  }
  if (!laneFitsBetweenNodes) {
    return {
      line: figmaConnectorPath(start, arrow.base, side),
      arrow: arrow.path,
    }
  }
  const candidates = [normalizeLane(midpoint)]
  for (let attempt = 1; attempt <= GRAPH_EDGE_LANE_ATTEMPTS; attempt++) {
    candidates.push(
      normalizeLane(midpoint + attempt * GRAPH_EDGE_LANE_STEP),
      normalizeLane(midpoint - attempt * GRAPH_EDGE_LANE_STEP),
    )
  }
  candidates.push(
    normalizeLane(start.x + side * GRAPH_EDGE_APPROACH_CLEARANCE),
    normalizeLane(end.x - side * GRAPH_EDGE_APPROACH_CLEARANCE),
  )
  const obstacleRects = obstacleRectsFor(nodeRects, source.id, target.id)
  const scoreLane = (laneX: number) => {
    const routeSegments: Array<[GraphPoint, GraphPoint]> = [
      [start, { x: laneX, y: start.y }],
      [
        { x: laneX, y: start.y },
        { x: laneX, y: end.y },
      ],
      [{ x: laneX, y: end.y }, end],
    ]
    const distancePenalty = Math.abs(laneX - midpoint) / 1000
    const edgeCrowdingPenalty =
      Math.max(0, GRAPH_EDGE_APPROACH_CLEARANCE - Math.abs(laneX - start.x)) +
      Math.max(0, GRAPH_EDGE_APPROACH_CLEARANCE - Math.abs(end.x - laneX))
    const outsideColumnPenalty =
      laneFitsBetweenNodes &&
      laneX > minLaneX + GRAPH_EDGE_APPROACH_CLEARANCE &&
      laneX < maxLaneX - GRAPH_EDGE_APPROACH_CLEARANCE
        ? 8
        : 0
    return (
      scoreGraphRouteSegments(routeSegments, obstacleRects, midpoint, (start.y + end.y) / 2) +
      edgeCrowdingPenalty +
      outsideColumnPenalty +
      distancePenalty
    )
  }
  const laneX = candidates.reduce((best, candidate) => (scoreLane(candidate) < scoreLane(best) ? candidate : best))
  const elbowSegments: Array<[GraphPoint, GraphPoint]> = [
    [start, { x: laneX, y: start.y }],
    [
      { x: laneX, y: start.y },
      { x: laneX, y: end.y },
    ],
    [{ x: laneX, y: end.y }, end],
  ]
  const detourCandidates = [
    Math.min(source.y, target.y) - GRAPH_EDGE_APPROACH_CLEARANCE,
    Math.max(source.y + GRAPH_NODE_HEIGHT, target.y + GRAPH_NODE_HEIGHT) + GRAPH_EDGE_APPROACH_CLEARANCE,
    (start.y + end.y) / 2,
  ]
  const detours = detourCandidates.map((laneY) => {
    const sourceLaneX = start.x + side * GRAPH_EDGE_APPROACH_CLEARANCE
    const targetLaneX = end.x - side * GRAPH_EDGE_APPROACH_CLEARANCE
    const points = [
      start,
      { x: sourceLaneX, y: start.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: end.y },
      end,
    ]
    const segments = points.slice(1).map((point, index): [GraphPoint, GraphPoint] => [points[index], point])
    return {
      points,
      score:
        scoreGraphRouteSegments(segments, obstacleRects, midpoint, laneY) +
        Math.abs(laneY - (start.y + end.y) / 2) / 120,
    }
  })
  const elbowScore = scoreGraphRouteSegments(elbowSegments, obstacleRects, midpoint, (start.y + end.y) / 2)
  const bestDetour = detours.reduce((best, candidate) => (candidate.score < best.score ? candidate : best))
  if (bestDetour.score + 12 < elbowScore) {
    const points = [...bestDetour.points.slice(0, -1), arrow.base]
    return {
      line: roundedPolylinePath(points, 30),
      arrow: arrow.path,
    }
  }
  return {
    line: roundedElbowPath(start, laneX, arrow.base),
    arrow: arrow.path,
  }
}

export function buildGraphSeedNodes(
  nodes: AgentBoardGraphNode[],
  edges: Array<{ sourceIssueID: string; targetIssueID: string }> = [],
) {
  if (nodes.length === 0) return nodes
  const visibleIDs = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const edge of edges) {
    if (!visibleIDs.has(edge.sourceIssueID) || !visibleIDs.has(edge.targetIssueID)) continue
    outgoing.get(edge.sourceIssueID)?.push(edge.targetIssueID)
    incoming.get(edge.targetIssueID)?.push(edge.sourceIssueID)
  }
  const displayDepthByID = new Map(nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const edge of edges) {
      if (!visibleIDs.has(edge.sourceIssueID) || !visibleIDs.has(edge.targetIssueID)) continue
      const sourceDepth = displayDepthByID.get(edge.sourceIssueID) ?? 0
      const targetDepth = displayDepthByID.get(edge.targetIssueID) ?? 0
      if (targetDepth >= sourceDepth + 1) continue
      displayDepthByID.set(edge.targetIssueID, sourceDepth + 1)
      changed = true
    }
    if (!changed) break
  }
  const maxDisplayDepth = Math.max(0, ...displayDepthByID.values())
  for (const node of nodes) {
    if ((outgoing.get(node.id)?.length ?? 0) === 0 && (incoming.get(node.id)?.length ?? 0) > 0) {
      displayDepthByID.set(node.id, maxDisplayDepth)
    }
  }
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const edge of edges) {
      if (!visibleIDs.has(edge.sourceIssueID) || !visibleIDs.has(edge.targetIssueID)) continue
      const sourceDepth = displayDepthByID.get(edge.sourceIssueID) ?? 0
      const targetDepth = displayDepthByID.get(edge.targetIssueID) ?? 0
      if (targetDepth > sourceDepth) continue
      displayDepthByID.set(edge.targetIssueID, sourceDepth + 1)
      changed = true
    }
    if (!changed) break
  }
  const byDepth = new Map<number, AgentBoardGraphNode[]>()
  for (const node of nodes) {
    const depth = displayDepthByID.get(node.id) ?? 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), node])
  }
  const depthOrder = Array.from(byDepth.keys()).sort((a, b) => a - b)
  const orderByID = new Map<string, number>()
  const baseSort = (a: AgentBoardGraphNode, b: AgentBoardGraphNode) =>
    (outgoing.get(a.id)?.length ? 1 : 0) - (outgoing.get(b.id)?.length ? 1 : 0) ||
    a.y - b.y ||
    priorityRank(a.card.issue.priority) - priorityRank(b.card.issue.priority) ||
    a.card.issue.title.localeCompare(b.card.issue.title) ||
    a.id.localeCompare(b.id)
  const setDepthOrder = (depth: number, group: AgentBoardGraphNode[]) => {
    byDepth.set(depth, group)
    group.forEach((node, index) => orderByID.set(node.id, index))
  }
  for (const depth of depthOrder) setDepthOrder(depth, [...(byDepth.get(depth) ?? [])].sort(baseSort))
  const neighborAnchor = (node: AgentBoardGraphNode, direction: "incoming" | "outgoing") => {
    const ids = direction === "incoming" ? incoming.get(node.id) : outgoing.get(node.id)
    const anchors = (ids ?? [])
      .map((id) => {
        const depth = displayDepthByID.get(id)
        const order = orderByID.get(id)
        if (depth === undefined || order === undefined) return undefined
        return depth * 1000 + order
      })
      .filter((value): value is number => value !== undefined)
    if (anchors.length === 0) return Number.POSITIVE_INFINITY
    return anchors.reduce((sum, value) => sum + value, 0) / anchors.length
  }
  for (let pass = 0; pass < 8; pass++) {
    for (const depth of depthOrder) {
      setDepthOrder(
        depth,
        [...(byDepth.get(depth) ?? [])].sort(
          (a, b) => neighborAnchor(a, "incoming") - neighborAnchor(b, "incoming") || baseSort(a, b),
        ),
      )
    }
    for (const depth of [...depthOrder].reverse()) {
      setDepthOrder(
        depth,
        [...(byDepth.get(depth) ?? [])].sort(
          (a, b) => neighborAnchor(a, "outgoing") - neighborAnchor(b, "outgoing") || baseSort(a, b),
        ),
      )
    }
  }
  const maxRows = Math.max(1, ...Array.from(byDepth.values()).map((group) => group.length))
  const output: AgentBoardGraphNode[] = []
  depthOrder.forEach((depth, column) => {
    const group = byDepth.get(depth) ?? []
    const topOffset = ((maxRows - group.length) * GRAPH_FOCUS_ROW_GAP) / 2
    group.forEach((node, row) => {
      output.push({
        ...node,
        x: GRAPH_FOCUS_PADDING + column * GRAPH_FOCUS_COLUMN_GAP,
        y: GRAPH_FOCUS_PADDING + topOffset + row * GRAPH_FOCUS_ROW_GAP,
        depth,
      })
    })
  })
  return output
}

export function resolveGraphNodeOverlaps(nodes: AgentBoardGraphNode[]) {
  const columns = new Map<number, AgentBoardGraphNode[]>()
  for (const node of nodes) {
    const column = Math.round(node.x / GRAPH_FOCUS_COLUMN_GAP)
    columns.set(column, [...(columns.get(column) ?? []), node])
  }
  const shifted = new Map<string, number>()
  for (const group of columns.values()) {
    let nextY = Number.NEGATIVE_INFINITY
    for (const node of [...group].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))) {
      const y = Math.max(node.y, nextY)
      shifted.set(node.id, y)
      nextY = y + GRAPH_NODE_HEIGHT + 36
    }
  }
  return nodes.map((node) => {
    const y = shifted.get(node.id)
    return y === undefined || Math.abs(y - node.y) < 0.5 ? node : { ...node, y }
  })
}

export function reduceTransitiveGraphEdges<T extends { sourceIssueID: string; targetIssueID: string; type?: string }>(
  edges: T[],
) {
  const outgoing = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.type && edge.type !== "blocks") continue
    outgoing.set(edge.sourceIssueID, new Set([...(outgoing.get(edge.sourceIssueID) ?? []), edge.targetIssueID]))
  }
  const reaches = (from: string, to: string, skip: T) => {
    const seen = new Set<string>()
    const queue = Array.from(outgoing.get(from) ?? []).filter((next) => next !== skip.targetIssueID)
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const next of outgoing.get(id) ?? []) queue.push(next)
    }
    return false
  }
  return edges.filter((edge) => {
    if (edge.type && edge.type !== "blocks") return true
    return !reaches(edge.sourceIssueID, edge.targetIssueID, edge)
  })
}
