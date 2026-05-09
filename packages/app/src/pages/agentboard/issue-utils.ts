import type { IconProps } from "@opencode-ai/ui/icon"
import type { AgentBoardCard, AgentBoardDependency, BeadsIssue } from "./api"

export function extractLabels(card: AgentBoardCard): string[] {
  return issueLabels(card.issue)
}

export function issueLabels(issue: BeadsIssue): string[] {
  const raw = issue.raw as { labels?: unknown; tags?: unknown }
  const source = Array.isArray(raw?.labels) ? raw.labels : Array.isArray(raw?.tags) ? raw.tags : []
  return source.filter((value): value is string => typeof value === "string" && value.length > 0)
}

export function issueType(issue: BeadsIssue): string | undefined {
  const raw = issue.raw as { issue_type?: unknown; type?: unknown }
  const value =
    typeof raw?.issue_type === "string"
      ? raw.issue_type
      : typeof raw?.type === "string"
        ? raw.type
        : undefined
  return value?.toLowerCase()
}

export type IssueTypeMeta = {
  label: string
  icon: IconProps["name"]
  tone: string
  iconClass: string
}

export const ISSUE_TYPE_META: Record<string, IssueTypeMeta> = {
  bug: {
    label: "Bug",
    icon: "warning",
    tone: "bg-[#da3633]/14 text-text-strong ring-[#f85149]/45",
    iconClass: "text-[#f85149]",
  },
  feature: {
    label: "Feature",
    icon: "plus",
    tone: "bg-[#238636]/14 text-text-strong ring-[#3fb950]/45",
    iconClass: "text-[#3fb950]",
  },
  task: {
    label: "Task",
    icon: "checklist",
    tone: "bg-[#58a6ff]/14 text-text-strong ring-[#58a6ff]/45",
    iconClass: "text-[#58a6ff]",
  },
  chore: {
    label: "Chore",
    icon: "edit",
    tone: "bg-[#9e6a03]/14 text-text-strong ring-[#d29922]/45",
    iconClass: "text-[#d29922]",
  },
  epic: {
    label: "Epic",
    icon: "branch",
    tone: "bg-[#8957e5]/14 text-text-strong ring-[#a371f7]/45",
    iconClass: "text-[#a371f7]",
  },
}

export function issueTypeMeta(issue: BeadsIssue): IssueTypeMeta | undefined {
  const type = issueType(issue)
  return type ? ISSUE_TYPE_META[type] : undefined
}

function readStringField(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function readIDArray(raw: Record<string, unknown>, keys: string[]): string[] {
  const ids: string[] = []
  for (const key of keys) {
    const arr = raw[key]
    if (!Array.isArray(arr)) continue
    for (const item of arr) {
      if (typeof item === "string" && item.length > 0) {
        ids.push(item)
      } else if (item && typeof item === "object" && "id" in item) {
        const id = (item as { id?: unknown }).id
        if (typeof id === "string" && id.length > 0) ids.push(id)
      }
    }
  }
  return ids
}

export function buildEpicChildren(
  dependencies: AgentBoardDependency[],
  cards: AgentBoardCard[],
  rootEpicID: string,
): Set<string> {
  const childMap = new Map<string, Set<string>>()
  const addChild = (parent: string, child: string) => {
    if (!parent || !child || parent === child) return
    const set = childMap.get(parent) ?? new Set<string>()
    set.add(child)
    childMap.set(parent, set)
  }
  for (const dep of dependencies) {
    if (dep.type !== "parent-child") continue
    addChild(dep.toIssueID, dep.fromIssueID)
  }
  for (const card of cards) {
    const raw = card.issue.raw
    if (!raw || typeof raw !== "object") continue
    const parentRef = readStringField(raw as Record<string, unknown>, [
      "parent",
      "parent_id",
      "parent_issue",
      "parent_issue_id",
      "epic",
      "epic_id",
    ])
    if (parentRef) addChild(parentRef, card.issue.id)
    const childIDs = readIDArray(raw as Record<string, unknown>, [
      "children",
      "child_ids",
      "child_issue_ids",
      "subtasks",
      "subtask_ids",
      "dependents",
    ])
    for (const id of childIDs) addChild(card.issue.id, id)
  }
  const children = new Set<string>()
  const queue = [rootEpicID]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const child of childMap.get(id) ?? []) {
      if (children.has(child) || child === rootEpicID) continue
      children.add(child)
      queue.push(child)
    }
  }
  return children
}

export function timestampValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input > 10_000_000_000 ? input : input * 1000
  }
  if (typeof input === "string" && input.trim()) {
    const numeric = Number(input)
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000
    const parsed = Date.parse(input)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function issueTimestamp(issue: BeadsIssue, keys: string[]) {
  const raw = issue.raw
  if (!raw || typeof raw !== "object") return undefined
  for (const key of keys) {
    const value = timestampValue((raw as Record<string, unknown>)[key])
    if (value) return value
  }
  return undefined
}

export function issueCreatedTimestamp(issue: BeadsIssue) {
  return issueTimestamp(issue, [
    "created_at",
    "createdAt",
    "created",
    "opened_at",
    "openedAt",
  ])
}

export function issueUpdatedTimestamp(card: AgentBoardCard) {
  return (
    issueTimestamp(card.issue, [
      "updated_at",
      "updatedAt",
      "updated",
      "modified_at",
      "modifiedAt",
      "last_modified",
      "lastModified",
    ]) ??
    card.latestRun?.time.updated ??
    card.latestRun?.time.ended
  )
}

export function closedSortTimestamp(card: AgentBoardCard) {
  return (
    card.latestRun?.time.ended ??
    issueTimestamp(card.issue, [
      "closed_at",
      "closedAt",
      "completed_at",
      "completedAt",
      "resolved_at",
      "resolvedAt",
      "done_at",
      "doneAt",
      "updated_at",
      "updatedAt",
      "modified_at",
      "modifiedAt",
    ]) ??
    card.latestRun?.time.updated ??
    0
  )
}
