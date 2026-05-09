import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID, AgentBoardGraphPosition } from "./api"
import { buildGraphDependencyLayout, getDependencyEdgeNodes } from "./graph-layout"
import { buildAgentBoardGraph, type AgentBoardGraphNode } from "./graph-state"
import { COLUMN_ACCENT, issueIDTone, priorityTone, statusLabel, visibleStatus } from "./ui-tokens"

export type AgentBoardViewMode = "board" | "list" | "graph"

type GraphFilter = "all" | "open" | "critical"

const GRAPH_NODE_WIDTH = 276
const GRAPH_NODE_HEIGHT = 124
const GRAPH_FOCUS_COLUMN_GAP = 500
const GRAPH_FOCUS_ROW_GAP = 196
const GRAPH_FOCUS_PADDING = 96
const GRAPH_LAYOUT_NODE_GAP = 96
const GRAPH_LAYOUT_LAYER_GAP = 360
const GRAPH_EDGE_NODE_PADDING = 30
const GRAPH_EDGE_APPROACH_CLEARANCE = 52
const GRAPH_EDGE_LANE_STEP = 104
const GRAPH_EDGE_LANE_ATTEMPTS = 10
const GRAPH_EDGE_TERMINAL_GAP = 22
const GRAPH_EDGE_OUTSIDE_GAP = 72
const GRAPH_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }
const GRAPH_EASE = "cubic-bezier(0.22,1,0.36,1)"
const MINIMAP_STATUS_FILL: Record<AgentBoardColumnID, string> = {
  blocked: "#ff7b72",
  ready: "#7ee787",
  running: "#f2cc60",
  needs_review: "#79c0ff",
  closed: "#d2a8ff",
}

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

type GraphEdgeShape = {
  line: string
  arrow: string
}

type GraphArrow = {
  path: string
  base: GraphPoint
}

function priorityRank(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  return Number.isFinite(value) ? value : 5
}

function dependencyLabel(node: AgentBoardGraphNode) {
  if (node.blockedBy > 0 && node.unblocks > 0) {
    return `${node.blockedBy} blocker${node.blockedBy === 1 ? "" : "s"}`
  }
  if (node.blockedBy > 0) return `${node.blockedBy} blocker${node.blockedBy === 1 ? "" : "s"}`
  return "No visible blockers"
}

function graphNodeSubtitle(node: AgentBoardGraphNode) {
  if (node.blockedBy > 0) return `${node.blockedBy} blocker${node.blockedBy === 1 ? "" : "s"}`
  return ""
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function graphNodeBounds(nodes: AgentBoardGraphNode[]) {
  const items = [
    ...nodes.map((node) => ({
      minX: node.x,
      minY: node.y,
      maxX: node.x + GRAPH_NODE_WIDTH,
      maxY: node.y + GRAPH_NODE_HEIGHT,
    })),
  ]
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
  for (const rect of obstacleRects) {
    const center = rectCenter(rect)
    for (const [a, b] of segments) {
      if (segmentCrossesRect(a, b, rect)) collisions++
      if (segmentNearRect(a, b, rect)) nearMisses++
      if (a.x === b.x && Math.abs(a.x - center.x) < GRAPH_NODE_WIDTH * 0.38) centerCuts++
      if (a.y === b.y && Math.abs(a.y - center.y) < GRAPH_NODE_HEIGHT * 0.38) centerCuts++
    }
  }
  const lengthPenalty = segments.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0) / 1600
  const positionPenalty =
    segments.reduce((sum, [a, b]) => sum + Math.abs((a.x + b.x) / 2 - preferredX) / 5000, 0) +
    segments.reduce((sum, [a, b]) => sum + Math.abs((a.y + b.y) / 2 - preferredY) / 5000, 0)
  return collisions * 1000 + centerCuts * 120 + nearMisses * 28 + lengthPenalty + positionPenalty
}

function roundedElbowPath(start: GraphPoint, laneX: number, end: GraphPoint) {
  const first = { x: laneX, y: start.y }
  const second = { x: laneX, y: end.y }
  const r = Math.min(
    28,
    Math.abs(laneX - start.x) / 2,
    Math.abs(end.x - laneX) / 2,
    Math.abs(end.y - start.y) / 2,
  )
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
  const output = [`M ${compact[0]!.x} ${compact[0]!.y}`]
  for (let index = 1; index < compact.length; index++) {
    const previous = compact[index - 1]!
    const current = compact[index]!
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
  if (side === "right") return { x: node.x + GRAPH_NODE_WIDTH + GRAPH_EDGE_TERMINAL_GAP, y: node.y + GRAPH_NODE_HEIGHT / 2 + offset }
  if (side === "top") return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y - GRAPH_EDGE_TERMINAL_GAP }
  return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y + GRAPH_NODE_HEIGHT + GRAPH_EDGE_TERMINAL_GAP }
}

function sideAngle(side: GraphSide) {
  if (side === "left") return 0
  if (side === "right") return Math.PI
  if (side === "top") return Math.PI / 2
  return -Math.PI / 2
}

function sideOut(point: GraphPoint, side: GraphSide, distance: number): GraphPoint {
  if (side === "left") return { x: point.x - distance, y: point.y }
  if (side === "right") return { x: point.x + distance, y: point.y }
  if (side === "top") return { x: point.x, y: point.y - distance }
  return { x: point.x, y: point.y + distance }
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
  return Math.abs(left - (a.x + GRAPH_NODE_WIDTH / 2)) < Math.abs(right - (a.x + GRAPH_NODE_WIDTH / 2))
    ? left
    : right
}

function cubicTangent(start: GraphPoint, c1: GraphPoint, c2: GraphPoint, end: GraphPoint, t: number): GraphPoint {
  const mt = 1 - t
  return {
    x: 3 * mt ** 2 * (c1.x - start.x) + 6 * mt * t * (c2.x - c1.x) + 3 * t ** 2 * (end.x - c2.x),
    y: 3 * mt ** 2 * (c1.y - start.y) + 6 * mt * t * (c2.y - c1.y) + 3 * t ** 2 * (end.y - c2.y),
  }
}

function nodeAnchor(node: AgentBoardGraphNode, toward: GraphPoint, offset = 10): GraphPoint {
  const center = { x: node.x + GRAPH_NODE_WIDTH / 2, y: node.y + GRAPH_NODE_HEIGHT / 2 }
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: center.x + GRAPH_NODE_WIDTH / 2 + offset, y: center.y }
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? GRAPH_NODE_WIDTH / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.001 ? GRAPH_NODE_HEIGHT / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY,
  )
  return {
    x: center.x + dx * scale + Math.sign(dx || 1) * offset,
    y: center.y + dy * scale + Math.sign(dy || 0) * Math.min(offset, 4),
  }
}

function nodeBorderAnchor(node: AgentBoardGraphNode, toward: GraphPoint): GraphPoint {
  const center = { x: node.x + GRAPH_NODE_WIDTH / 2, y: node.y + GRAPH_NODE_HEIGHT / 2 }
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: center.x, y: center.y }
  const scale = Math.min(
    Math.abs(dx) > 0.001 ? GRAPH_NODE_WIDTH / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY,
    Math.abs(dy) > 0.001 ? GRAPH_NODE_HEIGHT / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY,
  )
  return {
    x: center.x + dx * scale,
    y: center.y + dy * scale,
  }
}

function directGraphEdge(
  source: AgentBoardGraphNode | undefined,
  target: AgentBoardGraphNode | undefined,
  active: boolean,
): GraphEdgeShape {
  if (!source || !target) return { line: "", arrow: "" }
  const sourceCenter = { x: source.x + GRAPH_NODE_WIDTH / 2, y: source.y + GRAPH_NODE_HEIGHT / 2 }
  const targetCenter = { x: target.x + GRAPH_NODE_WIDTH / 2, y: target.y + GRAPH_NODE_HEIGHT / 2 }
  const start = nodeAnchor(source, targetCenter, 18)
  const end = nodeAnchor(target, sourceCenter, 54)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const bend = clamp(distance * 0.24, 56, 180)
  const normal = distance > 0 ? { x: -dy / distance, y: dx / distance } : { x: 0, y: 0 }
  const curve = Math.sign((source.depth - target.depth) || dx || 1) * Math.min(48, bend * 0.3)
  const c1 = {
    x: start.x + dx * 0.35 + normal.x * curve,
    y: start.y + dy * 0.35 + normal.y * curve,
  }
  const c2 = {
    x: start.x + dx * 0.65 + normal.x * curve,
    y: start.y + dy * 0.65 + normal.y * curve,
  }
  const arrowTangent = cubicTangent(start, c1, c2, end, 1)
  const arrow = graphArrow(end, Math.atan2(arrowTangent.y, arrowTangent.x), active)
  const lineEnd = arrow.base
  const lineC2 = {
    x: start.x + (lineEnd.x - start.x) * 0.65 + normal.x * curve,
    y: start.y + (lineEnd.y - start.y) * 0.65 + normal.y * curve,
  }
  return {
    line: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${lineC2.x} ${lineC2.y}, ${lineEnd.x} ${lineEnd.y}`,
    arrow: arrow.path,
  }
}

function dependencyGraphEdge(
  a: AgentBoardGraphNode | undefined,
  b: AgentBoardGraphNode | undefined,
  active: boolean,
  dependencyLayers: Record<string, number>,
): GraphEdgeShape {
  const { source, target } = getDependencyEdgeNodes(a, b, dependencyLayers)
  if (!source || !target) return { line: "", arrow: "" }
  const sourceCenter = { x: source.x + GRAPH_NODE_WIDTH / 2, y: source.y + GRAPH_NODE_HEIGHT / 2 }
  const targetCenter = { x: target.x + GRAPH_NODE_WIDTH / 2, y: target.y + GRAPH_NODE_HEIGHT / 2 }
  const dx = targetCenter.x - sourceCenter.x
  const dy = targetCenter.y - sourceCenter.y
  const sideFlow = Math.abs(dx) >= GRAPH_NODE_WIDTH * 0.45
  const sourceSide: GraphSide = sideFlow ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top"
  const targetSide: GraphSide = sideFlow ? (dx >= 0 ? "left" : "right") : dy >= 0 ? "top" : "bottom"
  if (rectsOverlapOrNear(source, target, GRAPH_EDGE_APPROACH_CLEARANCE)) {
    const laneX = outsideLaneForNodes(source, target)
    const sourceSide: GraphSide = laneX < source.x ? "left" : "right"
    const targetSide: GraphSide = laneX < target.x ? "left" : "right"
    const start = sideAnchor(source, sourceSide, 0)
    const end = sideAnchor(target, targetSide, 0)
    const arrow = graphArrow(end, sideAngle(targetSide), active)
    return {
      line: roundedPolylinePath(
        [
          start,
          { x: laneX, y: start.y },
          { x: laneX, y: arrow.base.y },
          arrow.base,
        ],
        36,
      ),
      arrow: arrow.path,
    }
  }
  const start = sideAnchor(source, sourceSide, 0)
  const end = sideAnchor(target, targetSide, 0)
  const arrow = graphArrow(end, sideAngle(targetSide), active)
  if (sideFlow) {
    const laneX = (start.x + end.x) / 2
    return {
      line: roundedElbowPath(start, laneX, arrow.base),
      arrow: arrow.path,
    }
  }
  const control = Math.max(36, Math.min(90, Math.hypot(dx, dy) * 0.14))
  const c1 = sideOut(start, sourceSide, control)
  const c2 = sideOut(arrow.base, targetSide, control)
  return {
    line: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${arrow.base.x} ${arrow.base.y}`,
    arrow: arrow.path,
  }
}

function routeGraphEdge(
  source: AgentBoardGraphNode | undefined,
  target: AgentBoardGraphNode | undefined,
  nodes: AgentBoardGraphNode[],
  active: boolean,
  dependencyLayers: Record<string, number>,
  edgeOffset = 0,
): GraphEdgeShape {
  if (!source || !target) return { line: "", arrow: "" }
  if (Object.keys(dependencyLayers).length > 0) return dependencyGraphEdge(source, target, active, dependencyLayers)
  const sourceCenter = { x: source.x + GRAPH_NODE_WIDTH / 2, y: source.y + GRAPH_NODE_HEIGHT / 2 }
  const targetCenter = { x: target.x + GRAPH_NODE_WIDTH / 2, y: target.y + GRAPH_NODE_HEIGHT / 2 }
  if (Math.abs(targetCenter.x - sourceCenter.x) < GRAPH_NODE_WIDTH * 0.35) {
    const laneX = Math.min(source.x, target.x) - GRAPH_EDGE_APPROACH_CLEARANCE - 52 - edgeOffset * 18
    const start = sideAnchor(source, "left", 0)
    const end = sideAnchor(target, "left", 0)
    const arrow = graphArrow(end, 0, active)
    const line = roundedPolylinePath(
      [
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: arrow.base.y },
        arrow.base,
      ],
      34,
    )
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
  const midpoint = (start.x + end.x) / 2
  const minLaneX = forward
    ? start.x + GRAPH_EDGE_APPROACH_CLEARANCE
    : end.x + GRAPH_EDGE_APPROACH_CLEARANCE
  const maxLaneX = forward
    ? end.x - GRAPH_EDGE_APPROACH_CLEARANCE
    : start.x - GRAPH_EDGE_APPROACH_CLEARANCE
  const laneFitsBetweenNodes = minLaneX <= maxLaneX
  const normalizeLane = (laneX: number) => {
    if (laneFitsBetweenNodes) return clamp(laneX, minLaneX, maxLaneX)
    return forward
      ? Math.min(start.x + GRAPH_EDGE_APPROACH_CLEARANCE, end.x - GRAPH_EDGE_APPROACH_CLEARANCE)
      : Math.max(start.x - GRAPH_EDGE_APPROACH_CLEARANCE, end.x + GRAPH_EDGE_APPROACH_CLEARANCE)
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
  const obstacleRects = nodes
    .filter((node) => node.id !== source.id && node.id !== target.id)
    .map((node) => graphNodeRect(node, GRAPH_EDGE_NODE_PADDING))
  const scoreLane = (laneX: number) => {
    const routeSegments: Array<[GraphPoint, GraphPoint]> = [
      [start, { x: laneX, y: start.y }],
      [{ x: laneX, y: start.y }, { x: laneX, y: end.y }],
      [{ x: laneX, y: end.y }, end],
    ]
    const distancePenalty = Math.abs(laneX - midpoint) / 1000
    const edgeCrowdingPenalty =
      Math.max(0, GRAPH_EDGE_APPROACH_CLEARANCE - Math.abs(laneX - start.x)) +
      Math.max(0, GRAPH_EDGE_APPROACH_CLEARANCE - Math.abs(end.x - laneX))
    const outsideColumnPenalty =
      laneFitsBetweenNodes && laneX > minLaneX + GRAPH_EDGE_APPROACH_CLEARANCE && laneX < maxLaneX - GRAPH_EDGE_APPROACH_CLEARANCE
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
    [{ x: laneX, y: start.y }, { x: laneX, y: end.y }],
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
    const segments = points.slice(1).map((point, index) => [points[index]!, point] as [GraphPoint, GraphPoint])
    return {
      points,
      score: scoreGraphRouteSegments(segments, obstacleRects, midpoint, laneY) + Math.abs(laneY - (start.y + end.y) / 2) / 120,
    }
  })
  const elbowScore = scoreGraphRouteSegments(elbowSegments, obstacleRects, midpoint, (start.y + end.y) / 2)
  const bestDetour = detours.reduce((best, candidate) => (candidate.score < best.score ? candidate : best))
  const arrow = graphArrow(end, forward ? 0 : Math.PI, active)
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

function buildGraphSeedNodes(
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

function resolveGraphNodeOverlaps(nodes: AgentBoardGraphNode[]) {
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

function reduceTransitiveGraphEdges<T extends { sourceIssueID: string; targetIssueID: string; type?: string }>(edges: T[]) {
  const outgoing = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.type && edge.type !== "blocks") continue
    outgoing.set(edge.sourceIssueID, new Set([...(outgoing.get(edge.sourceIssueID) ?? []), edge.targetIssueID]))
  }
  const reaches = (from: string, to: string, skip: T) => {
    const seen = new Set<string>()
    const queue = Array.from(outgoing.get(from) ?? []).filter((next) => next !== skip.targetIssueID)
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]!
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

function GraphNodeCard(props: {
  node: AgentBoardGraphNode
  selected: boolean
  focused: boolean
  dimmed: boolean
  busy: boolean
  onSelect: () => void
  onChat: () => void
  onHover: () => void
  onLeave: () => void
  onDragStart: (event: PointerEvent) => void
}) {
  const card = () => props.node.card
  const run = () => card().latestRun
  const status = () => visibleStatus(card())
  const accent = () => COLUMN_ACCENT[card().column]
  const running = () => run()?.status === "queued" || run()?.status === "running"
  return (
    <article
      data-agentboard-graph-node={props.node.id}
      role="button"
      tabindex="0"
      class="group absolute z-10 flex flex-col overflow-hidden rounded-lg border border-border-weaker-base bg-background-base p-3 text-left shadow-xs-border-base transition-[border-color,box-shadow,background,opacity] duration-150 hover:border-border-strong-base hover:bg-surface-raised-base hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base motion-reduce:transition-none"
      classList={{
        "border-border-strong-base ring-1 ring-inset ring-border-strong-base shadow-lg":
          props.selected || props.focused,
        "z-20": props.selected || props.focused,
        "opacity-45": props.dimmed,
      }}
      style={{
        width: `${GRAPH_NODE_WIDTH}px`,
        height: `${GRAPH_NODE_HEIGHT}px`,
        transform: `translate3d(${props.node.x}px, ${props.node.y}px, 0)`,
        "transition-timing-function": GRAPH_EASE,
      }}
      onPointerDown={props.onDragStart}
      onClick={props.onSelect}
      onMouseEnter={props.onHover}
      onMouseLeave={props.onLeave}
      onFocus={props.onHover}
      onBlur={props.onLeave}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onSelect()
      }}
      aria-label={`${card().issue.id} - ${card().issue.title}`}
    >
      <Show when={running()}>
        <div class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          <div class="h-full w-1/3 animate-pulse bg-[#d29922]" />
        </div>
      </Show>
      <div class="flex h-5 items-center gap-1.5">
        <span
          class={`inline-flex min-w-0 max-w-[8.5rem] items-center rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset ${accent().tint} ${accent().ring}`}
        >
          <span class="truncate">{statusLabel(status(), { capitalize: true })}</span>
        </span>
        <Show when={card().issue.priority !== undefined}>
          <span
            class={`rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityTone(card().issue.priority)}`}
          >
            P{card().issue.priority}
          </span>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden pt-2">
        <h3 class="line-clamp-2 text-13-semibold leading-snug text-text-strong">{card().issue.title}</h3>
      </div>
      <div class="mt-2 flex h-5 shrink-0 items-center gap-2 text-11-regular">
        <span class={`max-w-[8.5rem] truncate ${issueIDTone()}`}>{card().issue.id}</span>
        <Show when={props.node.blockedBy > 0}>
          <span
            class="ml-auto inline-flex min-w-0 max-w-[7rem] items-center gap-1 text-text-weak"
            title={`${dependencyLabel(props.node)} visible in this graph view`}
          >
            <Icon name="branch" class="size-3 shrink-0" />
            <span class="truncate">{graphNodeSubtitle(props.node)}</span>
          </span>
        </Show>
        <Show when={card().column === "ready"}>
          <button
            type="button"
            class="hidden h-6 shrink-0 items-center gap-1 rounded bg-primary px-2 text-10-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 group-hover:inline-flex group-focus-within:inline-flex"
            disabled={props.busy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              props.onChat()
            }}
          >
            <Icon name="bubble-5" class="size-3" />
            Chat
          </button>
        </Show>
      </div>
    </article>
  )
}

export function GraphMode(props: {
  board: AgentBoardBoard
  query: string
  selectedID?: string
  busy?: string
  onSelect: (issueID: string) => void
  onChat: (issueID: string) => void
  onSavePositions: (positions: AgentBoardGraphPosition[]) => void
}) {
  const [viewport, setViewport] = createSignal({ x: 40, y: 40, scale: 1 })
  const [filter, setFilter] = createSignal<GraphFilter>("open")
  const [hideClosed, setHideClosed] = createSignal(true)
  const [dependencyLayers, setDependencyLayers] = createSignal<Record<string, number>>({})
  const [hoveredID, setHoveredID] = createSignal<string>()
  const [autoPositions, setAutoPositions] = createSignal<Record<string, AgentBoardGraphPosition>>({})
  const [autoPositionsSignature, setAutoPositionsSignature] = createSignal("")
  const [localPositions, setLocalPositions] = createSignal<Record<string, AgentBoardGraphPosition>>({})
  const [manuallyMovedIDs, setManuallyMovedIDs] = createSignal<Set<string>>(new Set())
  const [userEditedGraph, setUserEditedGraph] = createSignal(false)
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>()
  let arrangedSignature = ""
  let didDrag = false
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
      }
    | undefined

  const baseGraph = createMemo(() => buildAgentBoardGraph(props.board, props.query))
  const graph = createMemo(() => {
    const local = localPositions()
    const nodes = baseGraph().nodes.map((node) => {
      const position = local[node.id]
      return position ? { ...node, x: position.x, y: position.y, pinned: position.pinned } : node
    })
    return {
      ...baseGraph(),
      nodes,
      width: Math.max(baseGraph().width, ...nodes.map((node) => node.x + GRAPH_NODE_WIDTH + 96)),
      height: Math.max(baseGraph().height, ...nodes.map((node) => node.y + GRAPH_NODE_HEIGHT + 96)),
    }
  })
  const graphFilterCounts = createMemo(() => {
    const current = graph()
    const count = (value: GraphFilter) =>
      current.nodes.filter((node) => {
        if (hideClosed() && node.card.column === "closed") return false
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
      if (hideClosed() && node.card.column === "closed") return false
      if (filter() === "critical") return node.critical
      if (filter() === "open") return node.card.column !== "closed"
      return true
    })
    const ids = new Set(rawNodes.map((node) => node.id))
    const edges = reduceTransitiveGraphEdges(
      current.edges.filter((edge) => ids.has(edge.sourceIssueID) && ids.has(edge.targetIssueID)),
    )
    const signature = [
      filter(),
      hideClosed() ? "closed:hidden" : "closed:visible",
      rawNodes
        .map((node) => node.id)
        .sort()
        .join(","),
      edges
        .map((edge) => edge.id)
        .sort()
        .join(","),
    ].join("|")
    return { current, rawNodes, edges, signature }
  })
  const visibleGraph = createMemo(() => {
    const input = visibleGraphInput()
    const { current, rawNodes, edges } = input
    const visibleBlockedBy = new Map(rawNodes.map((node) => [node.id, 0]))
    const visibleUnblocks = new Map(rawNodes.map((node) => [node.id, 0]))
    for (const edge of edges) {
      visibleUnblocks.set(edge.sourceIssueID, (visibleUnblocks.get(edge.sourceIssueID) ?? 0) + 1)
      visibleBlockedBy.set(edge.targetIssueID, (visibleBlockedBy.get(edge.targetIssueID) ?? 0) + 1)
    }
    const nodesWithVisibleCounts = rawNodes.map((node) => ({
      ...node,
      blockedBy: visibleBlockedBy.get(node.id) ?? 0,
      unblocks: visibleUnblocks.get(node.id) ?? 0,
    }))
    const automaticNodes = resolveGraphNodeOverlaps(buildGraphSeedNodes(nodesWithVisibleCounts, edges))
    const auto = autoPositionsSignature() === input.signature ? autoPositions() : {}
    const nodes = automaticNodes.map((node) => {
      const autoPosition = auto[node.id]
      const automatic = autoPosition
        ? {
            ...node,
            x: autoPosition.x,
            y: autoPosition.y,
            pinned: autoPosition.pinned,
          }
        : node
      const position = localPositions()[node.id]
      if (!position || !manuallyMovedIDs().has(node.id)) return automatic
      return {
        ...automatic,
        x: position.x,
        y: position.y,
        pinned: position.pinned,
      }
    })
    return {
      ...current,
      nodes,
      edges,
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
    const layers = dependencyLayers()
    const pairCounts = new Map<string, number>()
    return current.edges.map((edge, index) => {
      const active = id !== undefined && (edge.sourceIssueID === id || edge.targetIssueID === id)
      const muted = id !== undefined && edge.sourceIssueID !== id && edge.targetIssueID !== id
      const source = nodesByID.get(edge.sourceIssueID)
      const target = nodesByID.get(edge.targetIssueID)
      const pairKey = [source?.depth ?? 0, target?.depth ?? 0].join(":")
      const edgeOffset = pairCounts.get(pairKey) ?? 0
      pairCounts.set(pairKey, edgeOffset + 1)
      return {
        id: edge.id,
        active,
        muted,
        critical: edge.critical,
        paintOrder: active ? 3 : edge.critical ? 2 : muted ? 0 : 1,
        sourceOrder: index,
        shape: routeGraphEdge(
          source,
          target,
          nodes,
          active,
          layers,
          edgeOffset,
        ),
        tone: active ? "text-border-strong-base" : edge.critical ? "text-border-strong-base" : "text-border-weaker-base",
        opacity: active ? 1 : muted ? 0.28 : id !== undefined ? 0.66 : 0.92,
      }
    }).sort((a, b) => a.paintOrder - b.paintOrder || a.sourceOrder - b.sourceOrder)
  })
  const stats = createMemo(() => {
    const current = graph()
    const visible = visibleGraph()
    return {
      nodes: current.nodes.length,
      edges: current.edges.length,
      visibleNodes: visible.nodes.length,
      hiddenNodes: Math.max(0, current.nodes.length - visible.nodes.length),
    }
  })
  const columnStats = createMemo(() => {
    const counts = new Map<AgentBoardColumnID, number>()
    for (const node of visibleGraph().nodes) counts.set(node.card.column, (counts.get(node.card.column) ?? 0) + 1)
    return (["blocked", "ready", "running", "needs_review", "closed"] as const)
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
      return [{ id: edge.id, x1: source.x, y1: source.y, x2: target.x, y2: target.y, critical: edge.critical, active, muted }]
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

  function moveViewportToMinimapPoint(clientX: number, clientY: number, rect: DOMRect, bounds: ReturnType<typeof graphBounds>) {
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

  function selectFilter(value: GraphFilter) {
    setFilter(value)
    requestAnimationFrame(() => requestAnimationFrame(fitGraph))
  }

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
    const scale = viewport().scale
    const x = pointer.originX + (event.clientX - pointer.startX) / scale
    const y = pointer.originY + (event.clientY - pointer.startY) / scale
    const issueID = pointer.issueID
    setManuallyMovedIDs((current) => new Set(current).add(issueID))
    setUserEditedGraph(true)
    setLocalPositions((current) => ({
      ...current,
      [issueID]: {
        issueID,
        x,
        y,
        pinned: true,
      },
    }))
  }

  function onPointerUp() {
    if (pointer?.type === "node") {
      const position = localPositions()[pointer.issueID]
      if (position) props.onSavePositions([position])
    }
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
    const { positions, layers } = buildGraphDependencyLayout(visibleGraph().nodes, visibleGraph().edges, {
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
    setAutoPositions(Object.fromEntries(positions.map((position) => [position.issueID, { ...position, pinned: false }])))
    requestAnimationFrame(() => requestAnimationFrame(fitGraph))
  }

  createEffect(() => {
    const signature = graphArrangementSignature()
    if (!signature || userEditedGraph() || arrangedSignature === signature) return
    arrangedSignature = signature
    requestAnimationFrame(arrangeGraph)
  })

  onCleanup(() => {
    window.removeEventListener("pointermove", onPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onPointerUp, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointermove", onMinimapPointerMove, GRAPH_POINTER_OPTIONS)
    window.removeEventListener("pointerup", onMinimapPointerUp, GRAPH_POINTER_OPTIONS)
  })

  return (
    <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-background-base">
      <div class="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-border-weaker-base bg-background-base/95 px-4">
        <div class="flex shrink-0 items-center gap-2">
          <div class="hidden h-[24px] items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel md:flex">
            <For
              each={
                [
                  ["open", "Open"],
                  ["critical", "Risk"],
                  ["all", "All"],
                ] as const
              }
            >
              {(value) => {
                const count = () => graphFilterCounts()[value[0]]
                const isActive = () => filter() === value[0]
                const showRiskDot = () => value[0] === "critical" && count() > 0
                return (
                  <button
                    type="button"
                    class="inline-flex h-full items-center gap-1.5 border-r border-border-weak-base px-2 text-11-semibold transition-colors last:border-r-0"
                    classList={{
                      "bg-surface-raised-base-active text-text-strong": isActive(),
                      "text-text-weak hover:bg-surface-raised-base-hover hover:text-text-base": !isActive(),
                    }}
                    onClick={() => selectFilter(value[0])}
                  >
                    <Show when={showRiskDot()}>
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
          <Tooltip placement="top" value={hideClosed() ? "Show closed issues" : "Hide closed issues"}>
            <button
              type="button"
              class="hidden h-7 items-center gap-1.5 rounded-md px-2 text-11-semibold transition-colors hover:bg-surface-raised-base lg:inline-flex"
              classList={{
                "text-text-strong": !hideClosed(),
                "text-text-weak hover:text-text-base": hideClosed(),
              }}
              onClick={() => {
                setHideClosed(!hideClosed())
                requestAnimationFrame(() => requestAnimationFrame(fitGraph))
              }}
              aria-pressed={!hideClosed()}
            >
              <Icon name={hideClosed() ? "eye-off" : "eye"} class="size-3.5" />
              <span>Closed</span>
              <span class="font-mono text-10-regular tabular-nums opacity-60">
                {graphFilterCounts().closed}
              </span>
            </button>
          </Tooltip>
          <span class="hidden h-4 w-px bg-border-weaker-base lg:block" aria-hidden="true" />
          <Tooltip placement="top" value="Auto-arrange graph">
            <IconButton
              icon="file-tree"
              variant="ghost"
              size="normal"
              onClick={arrangeGraph}
              aria-label="Auto-arrange graph"
            />
          </Tooltip>
        </div>
      </div>

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
                <g
                  class={edge.tone}
                  opacity={edge.opacity}
                >
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
                  beginPointer({
                    type: "node",
                    issueID: node.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: node.x,
                    originY: node.y,
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
              <h3 class="text-14-semibold text-text-strong">No graph nodes match this view.</h3>
              <p class="mt-1 text-12-regular text-text-weak">Clear search or switch filters.</p>
            </div>
          </div>
        </Show>

        <div class="absolute bottom-4 right-4 hidden w-44 rounded-lg border border-border-weaker-base bg-background-base/95 p-2 shadow-lg backdrop-blur md:block">
          <div class="mb-1 flex items-center justify-between text-10-semibold uppercase tracking-wide text-text-weak">
            <span>Map</span>
            <div class="-mr-1 flex items-center gap-1">
              <span class="tabular-nums">{Math.round(viewport().scale * 100)}%</span>
              <Tooltip placement="top" value="Fit graph to view">
                <IconButton
                  icon="expand"
                  variant="ghost"
                  size="small"
                  onClick={fitGraph}
                  aria-label="Fit graph to view"
                />
              </Tooltip>
            </div>
          </div>
          <div
            class="relative h-24 cursor-crosshair overflow-hidden rounded-md bg-surface-raised-base shadow-xs-border-base touch-none"
            onPointerDown={beginMinimapPointer}
          >
            <svg class="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <For each={minimapEdges()}>
                {(edge) => (
                  <line
                    x1={edge.x1}
                    y1={edge.y1}
                    x2={edge.x2}
                    y2={edge.y2}
                    stroke={
                      edge.active
                        ? "rgba(255, 255, 255, 0.72)"
                        : edge.critical
                          ? "rgba(255, 123, 114, 0.50)"
                          : "rgba(139, 148, 158, 0.34)"
                    }
                    stroke-opacity={edge.muted ? 0.28 : 1}
                    stroke-width={edge.active ? 0.9 : edge.critical ? 0.7 : 0.45}
                    vector-effect="non-scaling-stroke"
                  />
                )}
              </For>
              <For each={minimapNodes()}>
                {(node) => (
                  <rect
                    x={node.x - (node.active || node.selected ? 2.6 : node.column === "closed" ? 1.7 : 2.1)}
                    y={node.y - (node.active || node.selected ? 1.8 : node.column === "closed" ? 1.1 : 1.35)}
                    width={node.active || node.selected ? 5.2 : node.column === "closed" ? 3.4 : 4.2}
                    height={node.active || node.selected ? 3.6 : node.column === "closed" ? 2.2 : 2.7}
                    rx={0.8}
                    fill={MINIMAP_STATUS_FILL[node.column]}
                    fill-opacity={node.muted ? 0.22 : node.column === "closed" ? 0.64 : 0.95}
                    stroke={
                      node.active || node.selected
                        ? "rgba(255, 255, 255, 0.92)"
                        : node.related
                          ? "rgba(255, 255, 255, 0.52)"
                          : "rgba(13, 17, 23, 0.72)"
                    }
                    stroke-width={node.active || node.selected ? 0.95 : node.related ? 0.6 : 0.35}
                    vector-effect="non-scaling-stroke"
                  />
                )}
              </For>
            </svg>
            <Show when={viewportBounds()}>
              {(bounds) => (
                <div
                  class="pointer-events-none absolute z-20 rounded border border-[#58a6ff] bg-[#58a6ff]/12 shadow-[0_0_0_999px_rgba(0,0,0,0.16),0_0_0_1px_rgba(255,255,255,0.16)_inset,0_0_12px_rgba(88,166,255,0.30)]"
                  style={{
                    left: `${bounds().left}%`,
                    top: `${bounds().top}%`,
                    width: `${bounds().width}%`,
                    height: `${bounds().height}%`,
                  }}
                />
              )}
            </Show>
          </div>
        </div>
        <div class="pointer-events-none absolute bottom-4 left-4 hidden max-w-[calc(100%-14rem)] rounded-lg border border-border-weaker-base bg-background-base/92 px-2.5 py-2 shadow-lg backdrop-blur md:flex">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <For each={columnStats()}>
              {(item) => (
                <span class="inline-flex items-center gap-1.5 text-11-regular text-text-weak">
                  <span class={`size-2 rounded-full ${COLUMN_ACCENT[item.column].dot}`} />
                  <span class="capitalize">{item.column.replaceAll("_", " ")}</span>
                  <span class="font-mono text-10-semibold tabular-nums text-text-base">{item.count}</span>
                </span>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  )
}
