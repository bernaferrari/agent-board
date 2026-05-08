import type { AgentBoardBoard, AgentBoardCard, AgentBoardDependency } from "./api"
import { allCards } from "./board-state"

export type AgentBoardGraphEdge = AgentBoardDependency & {
  id: string
  sourceIssueID: string
  targetIssueID: string
  critical: boolean
}

export type AgentBoardGraphNode = {
  id: string
  card: AgentBoardCard
  x: number
  y: number
  depth: number
  pinned: boolean
  blockedBy: number
  unblocks: number
  critical: boolean
}

export type AgentBoardGraph = {
  nodes: AgentBoardGraphNode[]
  edges: AgentBoardGraphEdge[]
  width: number
  height: number
}

const COLUMN_RANK = {
  blocked: 0,
  ready: 1,
  running: 2,
  needs_review: 3,
  closed: 4,
}

function priorityRank(card: AgentBoardCard) {
  const priority = card.issue.priority
  if (typeof priority === "number") return priority
  if (typeof priority === "string") {
    const parsed = Number(priority.replace(/^P/i, ""))
    if (Number.isFinite(parsed)) return parsed
  }
  return 5
}

function uniqueDependencies(board: AgentBoardBoard, cards: AgentBoardCard[]) {
  const ids = new Set(cards.map((card) => card.issue.id))
  const seen = new Set<string>()
  return (board.graph?.dependencies ?? [])
    .filter((dependency) => ids.has(dependency.fromIssueID) && ids.has(dependency.toIssueID))
    .filter((dependency) => {
      const key = `${dependency.fromIssueID}:${dependency.toIssueID}:${dependency.type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function computeDepths(cards: AgentBoardCard[], dependencies: AgentBoardDependency[]) {
  const depths = new Map(cards.map((card) => [card.issue.id, 0]))
  const edges = dependencies.map((dependency) => ({
    sourceIssueID: dependency.toIssueID,
    targetIssueID: dependency.fromIssueID,
  }))
  for (let pass = 0; pass < cards.length; pass++) {
    let changed = false
    for (const edge of edges) {
      const sourceDepth = depths.get(edge.sourceIssueID) ?? 0
      const targetDepth = depths.get(edge.targetIssueID) ?? 0
      if (targetDepth >= sourceDepth + 1) continue
      depths.set(edge.targetIssueID, sourceDepth + 1)
      changed = true
    }
    if (!changed) break
  }
  return depths
}

function downstreamCounts(cards: AgentBoardCard[], dependencies: AgentBoardDependency[]) {
  const outgoing = new Map<string, string[]>()
  for (const card of cards) outgoing.set(card.issue.id, [])
  for (const dependency of dependencies) {
    if (dependency.type !== "blocks") continue
    outgoing.get(dependency.toIssueID)?.push(dependency.fromIssueID)
  }
  const count = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0
    seen.add(id)
    let total = 0
    for (const next of outgoing.get(id) ?? []) total += 1 + count(next, seen)
    return total
  }
  return new Map(cards.map((card) => [card.issue.id, count(card.issue.id)]))
}

export function buildAgentBoardGraph(board: AgentBoardBoard, query = ""): AgentBoardGraph {
  const term = query.trim().toLowerCase()
  const cards = allCards(board).filter((card) => {
    if (!term) return true
    return [card.issue.id, card.issue.title, card.issue.description, card.issue.status, card.latestRun?.status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(term)
  })
  const dependencies = uniqueDependencies(board, cards)
  const depths = computeDepths(cards, dependencies)
  const downstream = downstreamCounts(cards, dependencies)
  const blockedBy = new Map(cards.map((card) => [card.issue.id, 0]))
  for (const dependency of dependencies) {
    if (dependency.type !== "blocks") continue
    blockedBy.set(dependency.fromIssueID, (blockedBy.get(dependency.fromIssueID) ?? 0) + 1)
  }
  const byDepth = new Map<number, AgentBoardCard[]>()
  for (const card of cards) {
    const depth = depths.get(card.issue.id) ?? 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), card])
  }
  const compareCards = (a: AgentBoardCard, b: AgentBoardCard) => {
    const impact = (downstream.get(b.issue.id) ?? 0) - (downstream.get(a.issue.id) ?? 0)
    if (impact !== 0) return impact
    const column = COLUMN_RANK[a.column] - COLUMN_RANK[b.column]
    if (column !== 0) return column
    const priority = priorityRank(a) - priorityRank(b)
    if (priority !== 0) return priority
    return a.issue.id.localeCompare(b.issue.id)
  }
  for (const cardsInDepth of byDepth.values()) cardsInDepth.sort(compareCards)
  const nodes: AgentBoardGraphNode[] = []
  const xGap = cards.length > 120 ? 420 : cards.length > 60 ? 392 : 368
  const yGap = cards.length > 120 ? 232 : cards.length > 60 ? 208 : 184
  const padding = 112
  const depthEntries = Array.from(byDepth.entries()).sort((a, b) => a[0] - b[0])
  const blockersFor = new Map(cards.map((card) => [card.issue.id, [] as string[]]))
  for (const dependency of dependencies) {
    if (dependency.type !== "blocks") continue
    blockersFor.get(dependency.fromIssueID)?.push(dependency.toIssueID)
  }
  const visualOrder = new Map<string, number>()
  for (const [, cardsInDepth] of depthEntries) {
    cardsInDepth.sort((a, b) => {
      const anchor = (card: AgentBoardCard) => {
        const blockers = blockersFor.get(card.issue.id) ?? []
        const visible = blockers
          .map((id) => visualOrder.get(id))
          .filter((value): value is number => value !== undefined)
        if (visible.length === 0) return Number.POSITIVE_INFINITY
        return visible.reduce((sum, value) => sum + value, 0) / visible.length
      }
      const aAnchor = anchor(a)
      const bAnchor = anchor(b)
      if (aAnchor !== bAnchor) return aAnchor - bAnchor
      return compareCards(a, b)
    })
    cardsInDepth.forEach((card, index) => visualOrder.set(card.issue.id, index))
  }
  const maxRows = Math.max(1, ...depthEntries.map(([, cardsInDepth]) => cardsInDepth.length))
  for (const [depth, cardsInDepth] of depthEntries) {
    const yOffset = ((maxRows - cardsInDepth.length) * yGap) / 2
    cardsInDepth.forEach((card, index) => {
      const unblocks = downstream.get(card.issue.id) ?? 0
      const blockers = blockedBy.get(card.issue.id) ?? 0
      nodes.push({
        id: card.issue.id,
        card,
        x: padding + depth * xGap,
        y: padding + yOffset + index * yGap,
        depth,
        pinned: false,
        blockedBy: blockers,
        unblocks,
        critical: unblocks >= 2 || blockers >= 2 || card.column === "blocked",
      })
    })
  }
  const nodeIDs = new Set(nodes.map((node) => node.id))
  const edges = dependencies
    .filter((dependency) => nodeIDs.has(dependency.toIssueID) && nodeIDs.has(dependency.fromIssueID))
    .map(
      (dependency): AgentBoardGraphEdge => ({
        ...dependency,
        id: `${dependency.toIssueID}->${dependency.fromIssueID}:${dependency.type}`,
        sourceIssueID: dependency.toIssueID,
        targetIssueID: dependency.fromIssueID,
        critical:
          dependency.type === "blocks" &&
          ((downstream.get(dependency.toIssueID) ?? 0) >= 2 || (blockedBy.get(dependency.fromIssueID) ?? 0) >= 2),
      }),
    )
  const width = Math.max(1200, ...nodes.map((node) => node.x + 400))
  const height = Math.max(720, ...nodes.map((node) => node.y + 240))
  return { nodes, edges, width, height }
}
