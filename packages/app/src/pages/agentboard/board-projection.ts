import type { EpicSummary, TypeSummary } from "./agentboard-controls"
import type { AgentBoardBoard, AgentBoardCard } from "./api"
import { buildEpicChildren, extractLabels, issueType, ISSUE_TYPE_META } from "./issue-utils"

export function boardCards(board?: AgentBoardBoard) {
  return board?.columns.flatMap((column) => column.cards) ?? []
}

export function boardContentKey(board: AgentBoardBoard) {
  return JSON.stringify({
    project: {
      id: board.project.id,
      worktree: board.project.worktree,
      bdDbPath: board.project.bdDbPath,
      enabled: board.project.enabled,
    },
    columns: board.columns.map((column) => ({
      id: column.id,
      title: column.title,
      cards: column.cards.map((card) => ({
        column: card.column,
        issue: card.issue,
        latestRun: card.latestRun,
        activeRun: card.activeRun,
        artifacts: card.artifacts,
        events: card.events,
      })),
    })),
    graph: board.graph,
  })
}

export function boardLabels(cards: AgentBoardCard[]) {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const label of extractLabels(card)) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label]) => label)
}

export function boardIssueTypes(cards: AgentBoardCard[]): TypeSummary[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const type = issueType(card.issue)
    if (!type || type === "epic") continue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({
      id,
      label: ISSUE_TYPE_META[id]?.label ?? id.replaceAll(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function boardEpics(board: AgentBoardBoard | undefined, cards: AgentBoardCard[]): EpicSummary[] {
  const dependencies = board?.graph.dependencies ?? []
  const cardsByID = new Map(cards.map((card) => [card.issue.id, card] as const))
  return cards
    .filter((card) => issueType(card.issue) === "epic")
    .map((card) => {
      const childIDs = buildEpicChildren(dependencies, cards, card.issue.id)
      const closedCount = Array.from(childIDs).filter((id) => cardsByID.get(id)?.column === "closed").length
      return {
        id: card.issue.id,
        title: card.issue.title,
        childCount: childIDs.size,
        closedCount,
        childIDs,
      }
    })
    .filter((epic) => epic.childCount > 0)
    .sort((a, b) => a.title.localeCompare(b.title))
}

export function filterBoard(
  board: AgentBoardBoard | undefined,
  options: { query: string; childIDs?: Set<string>; issueType?: string },
) {
  if (!board) return undefined
  const term = options.query.trim().toLowerCase()
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => {
        const type = issueType(card.issue)
        if (type === "epic") return false
        if (options.childIDs && !options.childIDs.has(card.issue.id)) return false
        if (options.issueType && type !== options.issueType) return false
        if (!term) return true
        return [
          card.issue.id,
          card.issue.title,
          card.issue.description,
          card.issue.status,
          card.latestRun?.status,
          card.latestRun?.agent,
          card.latestRun?.model,
          card.events.at(-1)?.message,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(term)
      }),
    })),
  }
}
