import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { AgentBoardBoard, AgentBoardCard, AgentBoardColumnID, AgentBoardGraphPosition } from "./api"
import { buildGraphDependencyLayout, getDependencyEdgeNodes } from "./graph-layout"
import { buildAgentBoardGraph, type AgentBoardGraphNode } from "./graph-state"

export type AgentBoardViewMode = "board" | "graph"

type GraphFilter = "focus" | "all" | "open" | "active" | "critical"

const GRAPH_NODE_WIDTH = 276
const GRAPH_NODE_HEIGHT = 124
const GRAPH_ARCHIVE_GROUP_WIDTH = 260
const GRAPH_ARCHIVE_GROUP_HEIGHT = 56
const GRAPH_ARCHIVE_GROUP_GAP = 16
const GRAPH_FOCUS_CLOSED_PER_DEPTH = 2
const GRAPH_FOCUS_CLOSED_TOTAL = 8
const GRAPH_FOCUS_COLUMN_GAP = 500
const GRAPH_FOCUS_ROW_GAP = 196
const GRAPH_FOCUS_PADDING = 96
const GRAPH_LAYOUT_NODE_GAP = 96
const GRAPH_LAYOUT_LAYER_GAP = 360
const GRAPH_EDGE_NODE_PADDING = 30
const GRAPH_EDGE_APPROACH_CLEARANCE = 52
const GRAPH_EDGE_LANE_STEP = 104
const GRAPH_EDGE_LANE_ATTEMPTS = 10
const GRAPH_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }
const GRAPH_EASE = "cubic-bezier(0.22,1,0.36,1)"

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

type GraphArchiveGroup = {
  id: string
  x: number
  y: number
  depth: number
  count: number
}

const COLUMN_ACCENT: Record<AgentBoardColumnID, { dot: string; tint: string; ring: string }> = {
  blocked: { dot: "bg-[#f85149]", tint: "bg-[#da3633]/10 text-[#ff7b72]", ring: "ring-[#f85149]/30" },
  ready: { dot: "bg-[#3fb950]", tint: "bg-[#238636]/12 text-[#7ee787]", ring: "ring-[#3fb950]/30" },
  running: { dot: "bg-[#d29922]", tint: "bg-[#9e6a03]/14 text-[#f2cc60]", ring: "ring-[#d29922]/30" },
  needs_review: { dot: "bg-[#58a6ff]", tint: "bg-[#58a6ff]/10 text-[#79c0ff]", ring: "ring-[#58a6ff]/30" },
  closed: { dot: "bg-[#8957e5]", tint: "bg-[#8957e5]/12 text-[#d2a8ff]", ring: "ring-[#a371f7]/30" },
}

function priorityTone(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  if (value === 0) return "bg-[#da3633]/10 text-[#ff7b72] ring-[#f85149]/35"
  if (value === 1) return "bg-[#9e6a03]/15 text-[#f2cc60] ring-[#d29922]/35"
  if (value === 2) return "bg-surface-raised-base text-text-base ring-border-strong-base"
  if (value === 3) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  if (value === 4) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
}

function priorityRank(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  return Number.isFinite(value) ? value : 5
}

function issueIDTone() {
  return "rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-10-semibold text-text-weak ring-1 ring-inset ring-border-weaker-base"
}

function statusLabel(status?: string) {
  const value = (status ?? "open").replaceAll("_", " ")
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function visibleStatus(card: AgentBoardCard) {
  const run = card.latestRun
  if (run && run.status !== "cancelled") return run.status
  if (card.issue.status) return card.issue.status
  if (card.column === "ready") return "open"
  if (card.column === "running") return "in_progress"
  if (card.column === "closed") return "closed"
  return card.column
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

function graphNodeBounds(nodes: AgentBoardGraphNode[], groups: GraphArchiveGroup[] = []) {
  const items = [
    ...nodes.map((node) => ({
      minX: node.x,
      minY: node.y,
      maxX: node.x + GRAPH_NODE_WIDTH,
      maxY: node.y + GRAPH_NODE_HEIGHT,
    })),
    ...groups.map((group) => ({
      minX: group.x,
      minY: group.y,
      maxX: group.x + GRAPH_ARCHIVE_GROUP_WIDTH,
      maxY: group.y + GRAPH_ARCHIVE_GROUP_HEIGHT,
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

function arrowPath(tip: GraphPoint, angle: number, active: boolean) {
  const arrowLength = active ? 18 : 16
  const arrowWidth = active ? 9 : 8
  const baseX = tip.x - Math.cos(angle) * arrowLength
  const baseY = tip.y - Math.sin(angle) * arrowLength
  const normalX = Math.cos(angle + Math.PI / 2)
  const normalY = Math.sin(angle + Math.PI / 2)
  return [
    `M ${baseX + normalX * arrowWidth} ${baseY + normalY * arrowWidth}`,
    `L ${tip.x} ${tip.y}`,
    `L ${baseX - normalX * arrowWidth} ${baseY - normalY * arrowWidth}`,
  ].join(" ")
}

type GraphSide = "left" | "right" | "top" | "bottom"

function sideAnchor(node: AgentBoardGraphNode, side: GraphSide, offset = 0): GraphPoint {
  if (side === "left") return { x: node.x - 8, y: node.y + GRAPH_NODE_HEIGHT / 2 + offset }
  if (side === "right") return { x: node.x + GRAPH_NODE_WIDTH + 8, y: node.y + GRAPH_NODE_HEIGHT / 2 + offset }
  if (side === "top") return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y - 8 }
  return { x: node.x + GRAPH_NODE_WIDTH / 2 + offset, y: node.y + GRAPH_NODE_HEIGHT + 8 }
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
  return {
    line: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    arrow: arrowPath(end, Math.atan2(arrowTangent.y, arrowTangent.x), active),
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
  const start = sideAnchor(source, sourceSide, 0)
  const end = sideAnchor(target, targetSide, 0)
  if (sideFlow) {
    const laneX = (start.x + end.x) / 2
    return {
      line: roundedElbowPath(start, laneX, end),
      arrow: arrowPath(end, sideAngle(targetSide), active),
    }
  }
  const control = Math.max(36, Math.min(90, Math.hypot(dx, dy) * 0.14))
  const c1 = sideOut(start, sourceSide, control)
  const c2 = sideOut(end, targetSide, control)
  return {
    line: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    arrow: arrowPath(end, sideAngle(targetSide), active),
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
    const line = roundedPolylinePath(
      [
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: end.y },
        end,
      ],
      34,
    )
    return {
      line,
      arrow: arrowPath(end, 0, active),
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
  if (bestDetour.score + 12 < elbowScore) {
    return {
      line: roundedPolylinePath(bestDetour.points, 30),
      arrow: arrowPath(end, forward ? 0 : Math.PI, active),
    }
  }
  return {
    line: roundedElbowPath(start, laneX, end),
    arrow: arrowPath(end, forward ? 0 : Math.PI, active),
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

function ArchiveGroupCard(props: { group: GraphArchiveGroup; onShowAll: () => void }) {
  return (
    <button
      type="button"
      class="absolute z-10 flex items-center gap-3 overflow-hidden rounded-lg border border-dashed border-border-weaker-base bg-surface-raised-base/75 px-3 text-left shadow-xs-border-base transition-[border-color,background,box-shadow] duration-150 hover:border-border-strong-base hover:bg-surface-raised-base hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base"
      style={{
        width: `${GRAPH_ARCHIVE_GROUP_WIDTH}px`,
        height: `${GRAPH_ARCHIVE_GROUP_HEIGHT}px`,
        transform: `translate3d(${props.group.x}px, ${props.group.y}px, 0)`,
      }}
      onClick={(event) => {
        event.stopPropagation()
        props.onShowAll()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={`Show ${props.group.count} archived graph items`}
    >
      <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-[#8957e5]/12 text-[#d2a8ff] ring-1 ring-inset ring-[#a371f7]/30">
        <Icon name="archive" class="size-4" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-13-semibold text-text-strong">
          {props.group.count} archived item{props.group.count === 1 ? "" : "s"}
        </span>
        <span class="block truncate text-11-regular text-text-weak">Switch to all nodes</span>
      </span>
      <Icon name="arrow-right" class="size-3.5 shrink-0 text-text-weak" />
    </button>
  )
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
          class={`inline-flex min-w-0 max-w-[8.5rem] items-center gap-1 rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset ${accent().tint} ${accent().ring}`}
        >
          <span class={`size-1.5 shrink-0 rounded-full ${accent().dot}`} />
          <span class="truncate">{statusLabel(status())}</span>
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
      <div class="mt-2 flex h-5 shrink-0 items-center justify-between gap-2 text-11-regular">
        <span class={`max-w-[8.5rem] truncate ${issueIDTone()}`}>{card().issue.id}</span>
        <Show when={props.node.blockedBy > 0}>
          <span
            class="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-text-weak"
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
  const [filter, setFilter] = createSignal<GraphFilter>("focus")
  const [hideClosed, setHideClosed] = createSignal(true)
  const [dependencyLayers, setDependencyLayers] = createSignal<Record<string, number>>({})
  const [hoveredID, setHoveredID] = createSignal<string>()
  const [localPositions, setLocalPositions] = createSignal<Record<string, AgentBoardGraphPosition>>({})
  const [manuallyMovedIDs, setManuallyMovedIDs] = createSignal<Set<string>>(new Set())
  const [userEditedGraph, setUserEditedGraph] = createSignal(false)
  let rootRef: HTMLDivElement | undefined
  let arrangedSignature = ""
  let didDrag = false
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
  const focusClosedIDs = createMemo(() => {
    const current = graph()
    const nonClosedIDs = new Set(current.nodes.filter((node) => node.card.column !== "closed").map((node) => node.id))
    const closedContextIDs = new Set<string>()
    for (const edge of current.edges) {
      if (nonClosedIDs.has(edge.sourceIssueID)) closedContextIDs.add(edge.targetIssueID)
      if (nonClosedIDs.has(edge.targetIssueID)) closedContextIDs.add(edge.sourceIssueID)
    }
    const forcedClosedIDs = new Set<string>()
    const focusedClosedByDepth = new Map<number, AgentBoardGraphNode[]>()
    for (const node of current.nodes) {
      if (node.card.column !== "closed") continue
      if (node.pinned || node.id === props.selectedID || node.id === hoveredID()) {
        forcedClosedIDs.add(node.id)
        continue
      }
      if (!closedContextIDs.has(node.id)) continue
      focusedClosedByDepth.set(node.depth, [...(focusedClosedByDepth.get(node.depth) ?? []), node])
    }
    const scoreClosedNode = (a: AgentBoardGraphNode, b: AgentBoardGraphNode) =>
      b.unblocks - a.unblocks ||
      b.blockedBy - a.blockedBy ||
      priorityRank(a.card.issue.priority) - priorityRank(b.card.issue.priority) ||
      a.id.localeCompare(b.id)
    const focusedClosedIDs = new Set(forcedClosedIDs)
    const candidates: AgentBoardGraphNode[] = []
    for (const nodes of focusedClosedByDepth.values()) {
      candidates.push(
        ...nodes
          .sort(scoreClosedNode)
          .slice(0, GRAPH_FOCUS_CLOSED_PER_DEPTH),
      )
    }
    for (const node of candidates.sort(scoreClosedNode)) {
      if (focusedClosedIDs.size >= GRAPH_FOCUS_CLOSED_TOTAL + forcedClosedIDs.size) break
      focusedClosedIDs.add(node.id)
    }
    return focusedClosedIDs
  })
  const graphFilterCounts = createMemo(() => {
    const current = graph()
    const focusedClosed = focusClosedIDs()
    const count = (value: GraphFilter) =>
      current.nodes.filter((node) => {
        if (hideClosed() && node.card.column === "closed") return false
        if (value === "active") return node.card.column === "running" || node.card.column === "needs_review"
        if (value === "critical") return node.critical
        if (value === "focus") return node.card.column !== "closed" || focusedClosed.has(node.id)
        if (value === "open") return node.card.column !== "closed"
        return true
      }).length
    return {
      focus: count("focus"),
      open: count("open"),
      active: count("active"),
      critical: count("critical"),
      all: count("all"),
      closed: current.nodes.filter((node) => node.card.column === "closed").length,
    }
  })
  const visibleGraph = createMemo(() => {
    const current = graph()
    const focusedClosedIDs = focusClosedIDs()
    const rawNodes = current.nodes.filter((node) => {
      if (hideClosed() && node.card.column === "closed") return false
      if (filter() === "active") return node.card.column === "running" || node.card.column === "needs_review"
      if (filter() === "critical") return node.critical
      if (filter() === "focus") {
        return node.card.column !== "closed" || focusedClosedIDs.has(node.id)
      }
      if (filter() === "open") return node.card.column !== "closed"
      return true
    })
    const ids = new Set(rawNodes.map((node) => node.id))
    const edges = reduceTransitiveGraphEdges(
      current.edges.filter((edge) => ids.has(edge.sourceIssueID) && ids.has(edge.targetIssueID)),
    )
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
    const nodes = automaticNodes.map((node) => {
      const position = localPositions()[node.id]
      if (!position || !manuallyMovedIDs().has(node.id)) return node
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
      edges,
      width: Math.max(960, ...nodes.map((node) => node.x + GRAPH_NODE_WIDTH + GRAPH_FOCUS_PADDING)),
      height: Math.max(560, ...nodes.map((node) => node.y + GRAPH_NODE_HEIGHT + GRAPH_FOCUS_PADDING)),
    }
  })
  const nodeMap = createMemo(() => new Map(visibleGraph().nodes.map((node) => [node.id, node])))
  const archiveGroups = createMemo(() => {
    if (filter() !== "focus" || hideClosed()) return []
    const visibleIDs = new Set(visibleGraph().nodes.map((node) => node.id))
    const hiddenClosed = graph().nodes.filter((node) => node.card.column === "closed" && !visibleIDs.has(node.id))
    if (hiddenClosed.length === 0) return []
    const visible = visibleGraph().nodes
    const anchorBounds =
      visible.length > 0
        ? graphNodeBounds(visible)
        : {
            minX: GRAPH_FOCUS_PADDING,
            minY: GRAPH_FOCUS_PADDING,
            maxX: GRAPH_FOCUS_PADDING + GRAPH_ARCHIVE_GROUP_WIDTH,
            maxY: GRAPH_FOCUS_PADDING + GRAPH_ARCHIVE_GROUP_HEIGHT,
            width: GRAPH_ARCHIVE_GROUP_WIDTH,
            height: GRAPH_ARCHIVE_GROUP_HEIGHT,
          }
    const rowStartX = anchorBounds.minX + Math.max(0, (anchorBounds.width - GRAPH_ARCHIVE_GROUP_WIDTH) / 2)
    const archiveY = visible.length > 0 ? anchorBounds.maxY + 32 : anchorBounds.minY
    return [
      {
        id: "archive:closed",
        depth: Math.min(...hiddenClosed.map((node) => node.depth)),
        count: hiddenClosed.length,
        x: rowStartX,
        y: archiveY,
      },
    ] satisfies GraphArchiveGroup[]
  })
  const graphBounds = createMemo(() => graphNodeBounds(visibleGraph().nodes, archiveGroups()))
  const graphArrangementSignature = createMemo(() => {
    const current = visibleGraph()
    if (current.nodes.length === 0) return ""
    return [
      filter(),
      hideClosed() ? "closed:hidden" : "closed:visible",
      current.nodes
        .map((node) => node.id)
        .sort()
        .join(","),
      current.edges
        .map((edge) => edge.id)
        .sort()
        .join(","),
    ].join("|")
  })
  const canvasSize = createMemo(() => {
    const bounds = graphBounds()
    return {
      width: Math.max(960, bounds.maxX + 96),
      height: Math.max(560, bounds.maxY + 96),
    }
  })
  const viewportBounds = createMemo(() => {
    const rect = rootRef?.getBoundingClientRect()
    if (!rect) return undefined
    const bounds = graphBounds()
    const current = viewport()
    const rawLeft = (-current.x / current.scale - bounds.minX) / bounds.width
    const rawTop = (-current.y / current.scale - bounds.minY) / bounds.height
    const rawWidth = rect.width / current.scale / bounds.width
    const rawHeight = rect.height / current.scale / bounds.height
    const width = clamp(rawWidth * 100, 8, 100)
    const height = clamp(rawHeight * 100, 8, 100)
    return {
      left: clamp(rawLeft * 100, 0, 100 - width),
      top: clamp(rawTop * 100, 0, 100 - height),
      width,
      height,
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
    return current.edges.map((edge) => {
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
        critical: edge.critical,
        shape: routeGraphEdge(
          source,
          target,
          nodes,
          active,
          layers,
          edgeOffset,
        ),
        tone: active
          ? "text-border-strong-base/90"
          : muted
            ? "text-border-weaker-base/78"
            : edge.critical
              ? "text-border-strong-base/90"
              : "text-border-weaker-base/88",
      }
    })
  })
  const stats = createMemo(() => {
    const current = graph()
    const visible = visibleGraph()
    return {
      nodes: current.nodes.length,
      edges: current.edges.length,
      visibleNodes: visible.nodes.length,
      hiddenNodes: Math.max(0, current.nodes.length - visible.nodes.length),
      archiveGroups: archiveGroups().length,
    }
  })
  const columnStats = createMemo(() => {
    const counts = new Map<AgentBoardColumnID, number>()
    for (const node of visibleGraph().nodes) counts.set(node.card.column, (counts.get(node.card.column) ?? 0) + 1)
    return (["blocked", "ready", "running", "needs_review", "closed"] as const)
      .map((column) => ({ column, count: counts.get(column) ?? 0 }))
      .filter((item) => item.count > 0)
  })

  function screenToWorld(clientX: number, clientY: number) {
    const rect = rootRef?.getBoundingClientRect()
    const current = viewport()
    return {
      x: (clientX - (rect?.left ?? 0) - current.x) / current.scale,
      y: (clientY - (rect?.top ?? 0) - current.y) / current.scale,
    }
  }

  function fitGraph() {
    const rect = rootRef?.getBoundingClientRect()
    if (!rect || (visibleGraph().nodes.length === 0 && archiveGroups().length === 0)) return
    const bounds = graphBounds()
    const scale = clamp(Math.min((rect.width - 96) / bounds.width, (rect.height - 96) / bounds.height), 0.18, 1.15)
    setViewport({
      scale,
      x: rect.width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
      y: rect.height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
    })
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
    if (filter() !== "all") {
      setManuallyMovedIDs((current) => new Set(current).add(issueID))
    }
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
    const scale = clamp(current.scale * Math.exp(-event.deltaY * 0.001), 0.25, 1.6)
    const rect = rootRef?.getBoundingClientRect()
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
    setManuallyMovedIDs(new Set(positions.map((position) => position.issueID)))
    setLocalPositions((current) => ({
      ...current,
      ...Object.fromEntries(positions.map((position) => [position.issueID, position])),
    }))
    props.onSavePositions(positions)
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
  })

  return (
    <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-background-base">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border-weaker-base bg-background-base/95 px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <span class="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-text-weak shadow-xs-border-base">
            <Icon name="branch" class="size-3.5" />
          </span>
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-12-semibold text-text-strong">
              <span>Dependency graph</span>
              <span class="rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-10-regular text-text-weak">
                {stats().visibleNodes}/{stats().nodes} nodes · {stats().edges} links
              </span>
            </div>
            <div class="mt-0.5 truncate text-11-regular text-text-weak">
              <Show when={stats().hiddenNodes > 0} fallback={<span>Drag nodes freely. Scroll to zoom.</span>}>
                <span>
                  {stats().hiddenNodes} archived item{stats().hiddenNodes === 1 ? "" : "s"} grouped
                  <Show when={stats().archiveGroups > 0}>
                    {" "}
                    into {stats().archiveGroups} stack{stats().archiveGroups === 1 ? "" : "s"}
                  </Show>
                </span>
              </Show>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <div class="hidden items-center rounded-md bg-surface-raised-base p-0.5 shadow-xs-border-base md:flex">
            <For
              each={
                [
                  ["focus", "Focus"],
                  ["open", "Open"],
                  ["active", "Active"],
                  ["critical", "Risk"],
                  ["all", "All"],
                ] as const
              }
            >
              {(value) => (
                <button
                  type="button"
                  class="inline-flex h-6 items-center gap-1 rounded px-1.5 text-10-semibold transition-colors"
                  classList={{
                    "bg-background-base text-text-strong shadow-xs-border-base": filter() === value[0],
                    "text-text-weak hover:text-text-base": filter() !== value[0],
                  }}
                  onClick={() => selectFilter(value[0])}
                >
                  <span>{value[1]}</span>
                  <span class="rounded bg-background-base px-1 font-mono text-10-regular tabular-nums text-text-weak shadow-xs-border-base">
                    {graphFilterCounts()[value[0]]}
                  </span>
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            class="hidden h-7 items-center gap-1.5 rounded-md bg-surface-raised-base px-2 text-11-semibold text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong lg:inline-flex"
            onClick={() => {
              setHideClosed(!hideClosed())
              requestAnimationFrame(() => requestAnimationFrame(fitGraph))
            }}
            aria-pressed={hideClosed()}
          >
            <Icon name="eye" class="size-3.5" />
            <span>{hideClosed() ? "Show closed" : "Hide closed"}</span>
            <span class="rounded bg-background-base px-1 font-mono text-10-regular tabular-nums text-text-weak shadow-xs-border-base">
              {graphFilterCounts().closed}
            </span>
          </button>
          <Button variant="secondary" size="small" icon="reset" onClick={fitGraph}>
            Fit
          </Button>
          <Button variant="secondary" size="small" icon="dot-grid" onClick={arrangeGraph}>
            Arrange
          </Button>
        </div>
      </div>

      <div
        ref={rootRef}
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
                  classList={{
                    "opacity-100": edge.active,
                    "opacity-95": !edge.active && focusID() !== undefined,
                  }}
                >
                  <Show when={edge.active}>
                    <path
                      d={edge.shape.line}
                      fill="none"
                      stroke="var(--background-base)"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width={8}
                      opacity={0.9}
                    />
                  </Show>
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
          <For each={archiveGroups()}>
            {(group) => <ArchiveGroupCard group={group} onShowAll={() => selectFilter("all")} />}
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

        <div class="pointer-events-none absolute bottom-4 right-4 hidden w-44 rounded-lg border border-border-weaker-base bg-background-base/95 p-2 shadow-lg backdrop-blur md:block">
          <div class="mb-1 flex items-center justify-between text-10-semibold uppercase tracking-wide text-text-weak">
            <span>Map</span>
            <span>{Math.round(viewport().scale * 100)}%</span>
          </div>
          <div class="relative h-24 overflow-hidden rounded bg-surface-raised-base">
            <For each={visibleGraph().nodes}>
              {(node) => {
                const bounds = () => graphBounds()
                return (
                  <span
                    class={`absolute h-1.5 w-2.5 rounded-sm ${COLUMN_ACCENT[node.card.column].dot}`}
                    style={{
                      left: `${clamp(((node.x - bounds().minX) / bounds().width) * 100, 1, 97)}%`,
                      top: `${clamp(((node.y - bounds().minY) / bounds().height) * 100, 1, 97)}%`,
                    }}
                  />
                )
              }}
            </For>
            <For each={archiveGroups()}>
              {(group) => {
                const bounds = () => graphBounds()
                return (
                  <span
                    class="absolute h-1.5 w-3 rounded-sm border border-[#a371f7]/50 bg-[#8957e5]/60"
                    style={{
                      left: `${clamp(((group.x - bounds().minX) / bounds().width) * 100, 1, 97)}%`,
                      top: `${clamp(((group.y - bounds().minY) / bounds().height) * 100, 1, 97)}%`,
                    }}
                  />
                )
              }}
            </For>
            <Show when={viewportBounds()}>
              {(bounds) => (
                <span
                  class="absolute rounded-sm border border-border-strong-base bg-background-base/30"
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
