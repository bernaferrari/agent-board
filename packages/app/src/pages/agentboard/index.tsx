import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import {
  createDroppable,
  createDraggable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  type DragEvent,
} from "@thisbeyond/solid-dnd"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { setSessionHandoff } from "@/pages/session/handoff"
import { getDraggableId } from "@/utils/solid-dnd"
import {
  type AgentBoardArtifact,
  type AgentBoardBoard,
  type AgentBoardCard,
  type AgentBoardColumnID,
  type AgentBoardDependency,
  type AgentBoardRunEvent,
  type BeadsIssue,
  createAgentBoardClient,
} from "./api"
import { BOARD_COLUMN_IDS, canMoveCardTo, findCard, isBoardColumnID, moveCardOnBoard } from "./board-state"
import { GraphMode, type AgentBoardViewMode } from "./graph-view"

const RUNNING = new Set(["queued", "running"])
const BEADS_DOCS_URL = "https://github.com/steveyegge/beads"
const NOTIFY_STORAGE_KEY = "agentboard.notify"
const BOARD_ORDER_STORAGE_PREFIX = "agentboard.order"
const COLUMN_DRAG_PREFIX = "agentboard-column:"
const NOTIFY_STATUSES = new Set(["needs_review", "failed", "done"])
const CARD_INSERT_RATIO = 0.5
const CARD_DRAG_THRESHOLD = 5
const NOTIFY_TITLES: Record<string, string> = {
  needs_review: "Ready for review",
  failed: "Run failed",
  done: "Run finished",
}

let boardDragPointer: { x: number; y: number } | undefined
let boardDragGrabOffset: { x: number; y: number } | undefined
let boardDragSourceSize: { width: number; height: number } | undefined
const BOARD_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }

function trackBoardDragPointer(event: PointerEvent) {
  boardDragPointer = { x: event.clientX, y: event.clientY }
}

function stopBoardPointerTracking() {
  window.removeEventListener("pointermove", trackBoardDragPointer, BOARD_POINTER_OPTIONS)
  boardDragGrabOffset = undefined
  boardDragSourceSize = undefined
}

function startBoardPointerTracking(event: PointerEvent) {
  trackBoardDragPointer(event)
  const current = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const target = current?.closest<HTMLElement>("[data-agentboard-card],[data-agentboard-column]") ?? current
  const rect = target?.getBoundingClientRect()
  boardDragGrabOffset = rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : undefined
  boardDragSourceSize = rect ? { width: rect.width, height: rect.height } : undefined
  window.addEventListener("pointermove", trackBoardDragPointer, BOARD_POINTER_OPTIONS)
}

const EVENT_LABEL: Record<string, string> = {
  queued: "Queued from Ready",
  lease_acquired: "Picked up the work",
  beads_status_updated: "Updated tracker status",
  session_created: "Opened a chat session",
  prompt_started: "Sent implementation prompt",
  artifacts_collected: "Collected artifacts",
  needs_review: "Ready for review",
  request_changes: "Reviewer asked for changes",
  cancelled: "Run cancelled",
  done: "Marked as done",
  failed: "Run failed",
  lease_released: "Wrapped up",
}

type EventTone = {
  icon: IconProps["name"]
  dot: string
  halo: string
  line: string
  badge: string
}

const EVENT_TONE: Record<string, EventTone> = {
  queued: {
    icon: "arrow-right",
    dot: "bg-[#dbeafe] text-[#0969da] ring-1 ring-inset ring-[#58a6ff]/45",
    halo: "ring-[#58a6ff]/20",
    line: "bg-[#58a6ff]/25",
    badge: "bg-[#58a6ff]/14 text-text-strong ring-[#58a6ff]/45",
  },
  lease_acquired: {
    icon: "shield",
    dot: "bg-[#dafbe1] text-[#1a7f37] ring-1 ring-inset ring-[#3fb950]/45",
    halo: "ring-[#3fb950]/20",
    line: "bg-[#3fb950]/25",
    badge: "bg-[#238636]/14 text-text-strong ring-[#3fb950]/45",
  },
  beads_status_updated: {
    icon: "status",
    dot: "bg-[#dafbe1] text-[#1a7f37] ring-1 ring-inset ring-[#3fb950]/45",
    halo: "ring-[#3fb950]/20",
    line: "bg-[#3fb950]/25",
    badge: "bg-[#238636]/14 text-text-strong ring-[#3fb950]/45",
  },
  session_created: {
    icon: "bubble-5",
    dot: "bg-[#dbeafe] text-[#0969da] ring-1 ring-inset ring-[#58a6ff]/45",
    halo: "ring-[#58a6ff]/20",
    line: "bg-[#58a6ff]/25",
    badge: "bg-[#58a6ff]/14 text-text-strong ring-[#58a6ff]/45",
  },
  prompt_started: {
    icon: "brain",
    dot: "bg-[#fff8c5] text-[#9a6700] ring-1 ring-inset ring-[#d29922]/45",
    halo: "ring-[#d29922]/20",
    line: "bg-[#d29922]/25",
    badge: "bg-[#9e6a03]/14 text-text-strong ring-[#d29922]/45",
  },
  artifacts_collected: {
    icon: "code-lines",
    dot: "bg-[#f3e8ff] text-[#8250df] ring-1 ring-inset ring-[#a371f7]/45",
    halo: "ring-[#a371f7]/20",
    line: "bg-[#a371f7]/25",
    badge: "bg-[#8957e5]/14 text-text-strong ring-[#a371f7]/45",
  },
  needs_review: {
    icon: "review",
    dot: "bg-[#dbeafe] text-[#0969da] ring-1 ring-inset ring-[#58a6ff]/45",
    halo: "ring-[#58a6ff]/20",
    line: "bg-[#58a6ff]/25",
    badge: "bg-[#58a6ff]/14 text-text-strong ring-[#58a6ff]/45",
  },
  request_changes: {
    icon: "arrow-undo-down",
    dot: "bg-[#fff8c5] text-[#9a6700] ring-1 ring-inset ring-[#d29922]/45",
    halo: "ring-[#d29922]/20",
    line: "bg-[#d29922]/25",
    badge: "bg-[#9e6a03]/14 text-text-strong ring-[#d29922]/45",
  },
  cancelled: {
    icon: "circle-x",
    dot: "bg-[#ffebe9] text-[#cf222e] ring-1 ring-inset ring-[#f85149]/45",
    halo: "ring-[#f85149]/20",
    line: "bg-[#f85149]/25",
    badge: "bg-[#da3633]/14 text-text-strong ring-[#f85149]/45",
  },
  done: {
    icon: "check",
    dot: "bg-[#f3e8ff] text-[#8250df] ring-1 ring-inset ring-[#a371f7]/45",
    halo: "ring-[#a371f7]/20",
    line: "bg-[#a371f7]/25",
    badge: "bg-[#8957e5]/14 text-text-strong ring-[#a371f7]/45",
  },
  failed: {
    icon: "warning",
    dot: "bg-[#ffebe9] text-[#cf222e] ring-1 ring-inset ring-[#f85149]/45",
    halo: "ring-[#f85149]/20",
    line: "bg-[#f85149]/25",
    badge: "bg-[#da3633]/14 text-text-strong ring-[#f85149]/45",
  },
  lease_released: {
    icon: "archive",
    dot: "bg-surface-raised-strong text-text-strong ring-1 ring-inset ring-border-base",
    halo: "ring-border-strong-base",
    line: "bg-border-weaker-base",
    badge: "bg-surface-raised-base text-text-strong ring-border-base",
  },
  reconciled: {
    icon: "reset",
    dot: "bg-[#dbeafe] text-[#0969da] ring-1 ring-inset ring-[#58a6ff]/45",
    halo: "ring-[#58a6ff]/20",
    line: "bg-[#58a6ff]/25",
    badge: "bg-[#58a6ff]/14 text-text-strong ring-[#58a6ff]/45",
  },
}

const DEFAULT_EVENT_TONE: EventTone = {
  icon: "dot-grid",
  dot: "bg-surface-raised-strong text-text-strong ring-1 ring-inset ring-border-base",
  halo: "ring-border-strong-base",
  line: "bg-border-weaker-base",
  badge: "bg-surface-raised-base text-text-strong ring-border-base",
}

const PRIORITY_OPTIONS = [
  {
    value: 0,
    label: "P0",
    tone: "bg-[#da3633]/14 text-text-strong ring-[#f85149]/45",
  },
  {
    value: 1,
    label: "P1",
    tone: "bg-[#bc4c00]/14 text-text-strong ring-[#f0883e]/45",
  },
  {
    value: 2,
    label: "P2",
    tone: "bg-[#9e6a03]/14 text-text-strong ring-[#d29922]/45",
  },
  {
    value: 3,
    label: "P3",
    tone: "bg-surface-raised-base text-text-weak ring-border-weaker-base",
  },
] as const

function eventLabel(type: string) {
  return EVENT_LABEL[type] ?? type.replaceAll("_", " ")
}

function eventTone(type: string) {
  return EVENT_TONE[type] ?? DEFAULT_EVENT_TONE
}

function extractLabels(card: AgentBoardCard): string[] {
  return issueLabels(card.issue)
}

function issueLabels(issue: BeadsIssue): string[] {
  const raw = issue.raw as { labels?: unknown; tags?: unknown }
  const source = Array.isArray(raw?.labels) ? raw.labels : Array.isArray(raw?.tags) ? raw.tags : []
  return source.filter((value): value is string => typeof value === "string" && value.length > 0)
}

function issueType(issue: BeadsIssue): string | undefined {
  const raw = issue.raw as { issue_type?: unknown; type?: unknown }
  const value =
    typeof raw?.issue_type === "string"
      ? raw.issue_type
      : typeof raw?.type === "string"
        ? raw.type
        : undefined
  return value?.toLowerCase()
}

type IssueTypeMeta = {
  label: string
  icon: IconProps["name"]
  tone: string
  iconClass: string
}

const ISSUE_TYPE_META: Record<string, IssueTypeMeta> = {
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

function issueTypeMeta(issue: BeadsIssue): IssueTypeMeta | undefined {
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

function buildEpicChildren(
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

type EpicSummary = {
  id: string
  title: string
  childCount: number
  closedCount: number
  childIDs: Set<string>
}
const ADVANCEMENT: Partial<Record<AgentBoardColumnID, AgentBoardColumnID>> = {
  ready: "running",
  running: "needs_review",
  needs_review: "closed",
}
const REVIEW_PRESETS = [
  "Please run the relevant tests and report the exact command output.",
  "Please tighten the implementation, remove unnecessary changes, and keep the patch scoped to this issue.",
  "Please inspect the diff for edge cases, regressions, and missing error states before handing back.",
]

type ColumnAccent = {
  dot: string
  text: string
  pill: string
  ring: string
  glow: string
  drop: string
}

type PendingCardDrag = {
  card: AgentBoardCard
  current: AgentBoardBoard
  rect: DOMRect
  startX: number
  startY: number
}

const COLUMN_ACCENT: Record<AgentBoardColumnID, ColumnAccent> = {
  blocked: {
    dot: "bg-[#f85149]",
    text: "text-[#cf222e]",
    pill: "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45",
    ring: "ring-[#f85149]/35",
    glow: "shadow-xs-border-critical-base",
    drop: "bg-[#da3633]/10 ring-[#f85149]/30",
  },
  ready: {
    dot: "bg-[#3fb950]",
    text: "text-[#1a7f37]",
    pill: "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45",
    ring: "ring-[#3fb950]/35",
    glow: "shadow-xs-border-base",
    drop: "bg-[#238636]/10 ring-[#3fb950]/30",
  },
  running: {
    dot: "bg-[#d29922]",
    text: "text-[#9a6700]",
    pill: "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45",
    ring: "ring-[#d29922]/45",
    glow: "shadow-xs-border-base",
    drop: "bg-[#9e6a03]/10 ring-[#d29922]/30",
  },
  needs_review: {
    dot: "bg-[#58a6ff]",
    text: "text-[#0969da]",
    pill: "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45",
    ring: "ring-[#58a6ff]/35",
    glow: "shadow-xs-border-base",
    drop: "bg-[#58a6ff]/10 ring-[#58a6ff]/30",
  },
  closed: {
    dot: "bg-[#8957e5]",
    text: "text-[#8250df]",
    pill: "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45",
    ring: "ring-[#a371f7]/45",
    glow: "shadow-xs-border-base",
    drop: "bg-[#8957e5]/10 ring-[#a371f7]/30",
  },
}

const COLUMN_ICON: Record<AgentBoardColumnID, IconProps["name"]> = {
  blocked: "circle-ban-sign",
  ready: "circle-check",
  running: "brain",
  needs_review: "review",
  closed: "archive",
}

const COLUMN_DRAG_DISABLED = new Set<AgentBoardColumnID>(["blocked"])

const COLUMN_HINT: Record<AgentBoardColumnID, string> = {
  blocked: "Dependency-derived",
  ready: "Runnable now",
  running: "Owned by an agent",
  needs_review: "Awaiting humans",
  closed: "Done",
}

const COLUMN_EMPTY: Record<AgentBoardColumnID, { idle: string; managed?: string }> = {
  blocked: { idle: "Nothing blocked", managed: "Beads manages this column" },
  ready: { idle: "No cards ready" },
  running: { idle: "No active runs" },
  needs_review: { idle: "Nothing to review" },
  closed: { idle: "No closed work yet" },
}

function formatTime(value?: number) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value)
}

function formatRelative(value?: number) {
  if (!value) return ""
  const diff = Date.now() - value
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value)
}

function statusTone(status?: string) {
  const value = status?.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
  if (!value) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  if (value === "failed" || value === "cancelled") {
    return "bg-[#da3633]/14 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-[#f85149]/45"
  }
  if (value === "needs_review" || value === "review") {
    return "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45"
  }
  if (value === "running" || value === "in_progress") {
    return "bg-[#9e6a03]/14 text-[color-mix(in_oklch,#9a6700_62%,var(--text-strong))] ring-[#d29922]/45"
  }
  if (value === "queued") return "bg-[#58a6ff]/14 text-[color-mix(in_oklch,#0969da_62%,var(--text-strong))] ring-[#58a6ff]/45"
  if (value === "ready" || value === "open") {
    return "bg-[#238636]/14 text-[color-mix(in_oklch,#1a7f37_62%,var(--text-strong))] ring-[#3fb950]/45"
  }
  if (value === "done" || value === "closed") {
    return "bg-[#8957e5]/14 text-[color-mix(in_oklch,#8250df_62%,var(--text-strong))] ring-[#a371f7]/45"
  }
  return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
}

function priorityTone(priority?: number | string) {
  const value = typeof priority === "number" ? priority : Number(priority)
  if (!Number.isFinite(value)) return "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  return (
    PRIORITY_OPTIONS.find((option) => option.value === value)?.tone ??
    "bg-surface-raised-base text-text-weak ring-border-weaker-base"
  )
}

function issueIDTone() {
  return "rounded bg-surface-raised-base px-1.5 py-0.5 font-mono text-10-semibold text-text-weak ring-1 ring-inset ring-border-weaker-base"
}

function statusLabel(status?: string) {
  return (status ?? "open").replaceAll("_", " ")
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

function cardSummary(card: AgentBoardCard) {
  const desc = card.issue.description?.trim()
  if (!desc) return ""
  return desc.length > 140 ? `${desc.slice(0, 137)}…` : desc
}

function latestEvent(card: AgentBoardCard) {
  return card.events.at(-1)
}

function canDragCard(card: AgentBoardCard) {
  return card.column !== "blocked"
}

function isMissingBeads(message?: string) {
  return message?.toLowerCase().includes("no beads database found") ?? false
}

function shortError(message?: string) {
  if (!message) return "AgentBoard could not load this project."
  if (isMissingBeads(message)) return "This project does not have a Beads database yet."
  return message.replace(/\s+/g, " ").trim()
}

type ArtifactDiff = {
  file?: string
  path?: string
  name?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

type ReviewBrief = {
  summary?: string
  items?: string[]
  tests?: string[]
  risks?: string[]
  notes?: string[]
  totals?: {
    files?: number
    additions?: number
    deletions?: number
  }
}

function diffName(diff: ArtifactDiff) {
  return String(diff.file ?? diff.path ?? diff.name ?? "changed file")
}

function diffStatus(diff: ArtifactDiff) {
  return String(diff.status ?? "modified")
}

function ArtifactView(props: { artifact: AgentBoardArtifact }) {
  const diffs = createMemo(() => {
    if (props.artifact.kind !== "diff") return []
    const data = props.artifact.data as { diffs?: ArtifactDiff[] } | undefined
    return Array.isArray(data?.diffs) ? data.diffs : []
  })
  const diffTotals = createMemo(() => {
    const data = props.artifact.data as { summary?: { totals?: ReviewBrief["totals"] } } | undefined
    const totals = data?.summary?.totals
    if (totals) return totals
    return {
      files: diffs().length,
      additions: diffs().reduce((total, diff) => total + (diff.additions ?? 0), 0),
      deletions: diffs().reduce((total, diff) => total + (diff.deletions ?? 0), 0),
    }
  })
  const text = createMemo(() => {
    const data = props.artifact.data as { text?: unknown } | undefined
    return typeof data?.text === "string" ? data.text : undefined
  })
  const brief = createMemo(() => {
    if (props.artifact.kind !== "todo") return
    const data = props.artifact.data as ReviewBrief | undefined
    if (!data || typeof data !== "object") return
    return data
  })
  return (
    <div class="rounded-md bg-background-base p-3 shadow-xs-border-base">
      <div class="flex items-center justify-between gap-2">
        <span class="text-12-semibold text-text-strong">{props.artifact.title}</span>
        <span class="rounded bg-surface-raised-base px-1.5 py-0.5 text-10-semibold uppercase tracking-wide text-text-weak">
          {props.artifact.kind}
        </span>
      </div>
      <Show when={props.artifact.path}>
        {(path) => <div class="mt-2 truncate font-mono text-11-regular text-text-weak">{path()}</div>}
      </Show>
      <Show when={brief()}>
        {(value) => (
          <div class="mt-3 space-y-3">
            <Show when={value().summary}>
              {(summary) => <p class="text-12-regular leading-relaxed text-text-base">{summary()}</p>}
            </Show>
            <div class="grid grid-cols-3 gap-1.5">
              <div class="rounded bg-surface-raised-base px-2 py-1.5">
                <div class="text-10-regular uppercase tracking-wide text-text-weak">Files</div>
                <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-strong">
                  {value().totals?.files ?? 0}
                </div>
              </div>
              <div class="rounded bg-surface-raised-base px-2 py-1.5">
                <div class="text-10-regular uppercase tracking-wide text-text-weak">Added</div>
                <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-diff-add-base">
                  +{value().totals?.additions ?? 0}
                </div>
              </div>
              <div class="rounded bg-surface-raised-base px-2 py-1.5">
                <div class="text-10-regular uppercase tracking-wide text-text-weak">Removed</div>
                <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-diff-delete-base">
                  −{value().totals?.deletions ?? 0}
                </div>
              </div>
            </div>
            <Show when={value().items?.length}>
              <ul class="space-y-1.5">
                <For each={value().items}>
                  {(item) => (
                    <li class="flex gap-2 text-12-regular leading-relaxed text-text-base">
                      <Icon name="check-small" class="mt-0.5 size-3.5 shrink-0 text-icon-success-base" />
                      <span>{item}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={value().tests?.length || value().risks?.length || value().notes?.length}>
              <div class="space-y-2 rounded bg-surface-raised-base p-2.5">
                <Show when={value().tests?.length}>
                  <div>
                    <div class="text-10-semibold uppercase tracking-wider text-text-weak">Tests</div>
                    <ul class="mt-1 space-y-0.5 text-11-regular leading-relaxed text-text-base">
                      <For each={value().tests}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <Show when={value().risks?.length}>
                  <div>
                    <div class="text-10-semibold uppercase tracking-wider text-icon-warning-base">Risks</div>
                    <ul class="mt-1 space-y-0.5 text-11-regular leading-relaxed text-text-base">
                      <For each={value().risks}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
                <Show when={value().notes?.length}>
                  <div>
                    <div class="text-10-semibold uppercase tracking-wider text-text-weak">Notes</div>
                    <ul class="mt-1 space-y-0.5 text-11-regular leading-relaxed text-text-base">
                      <For each={value().notes}>{(item) => <li>{item}</li>}</For>
                    </ul>
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={diffs().length > 0}>
        <div class="mt-3 space-y-2">
          <div class="grid grid-cols-3 gap-1.5">
            <div class="rounded bg-surface-raised-base px-2 py-1.5">
              <div class="text-10-regular uppercase tracking-wide text-text-weak">Files</div>
              <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-strong">
                {diffTotals().files ?? 0}
              </div>
            </div>
            <div class="rounded bg-surface-raised-base px-2 py-1.5">
              <div class="text-10-regular uppercase tracking-wide text-text-weak">Added</div>
              <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-diff-add-base">
                +{diffTotals().additions ?? 0}
              </div>
            </div>
            <div class="rounded bg-surface-raised-base px-2 py-1.5">
              <div class="text-10-regular uppercase tracking-wide text-text-weak">Removed</div>
              <div class="mt-0.5 font-mono text-13-semibold tabular-nums text-text-diff-delete-base">
                −{diffTotals().deletions ?? 0}
              </div>
            </div>
          </div>
          <For each={diffs()}>
            {(diff) => (
              <details class="group rounded bg-surface-raised-base text-11-regular">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-1.5">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="rounded bg-background-base px-1.5 py-0.5 text-10-semibold uppercase text-text-weak">
                      {diffStatus(diff)}
                    </span>
                    <span class="truncate font-mono text-text-base">{diffName(diff)}</span>
                  </span>
                  <span class="shrink-0 tabular-nums text-text-weak">
                    <span class="text-text-diff-add-base">+{String(diff.additions ?? 0)}</span>{" "}
                    <span class="text-text-diff-delete-base">−{String(diff.deletions ?? 0)}</span>
                  </span>
                </summary>
                <Show when={diff.patch}>
                  {(patch) => (
                    <pre class="max-h-80 overflow-auto border-t border-border-weaker-base p-2 font-mono text-10-regular leading-relaxed text-text-base">
                      {patch()}
                    </pre>
                  )}
                </Show>
              </details>
            )}
          </For>
        </div>
      </Show>
      <Show when={text()}>
        {(value) => (
          <div class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-surface-raised-base p-3 text-12-regular leading-relaxed text-text-base">
            {value()}
          </div>
        )}
      </Show>
      <Show when={props.artifact.data && diffs().length === 0 && !text()}>
        {(data) => (
          <pre class="mt-3 max-h-64 overflow-auto rounded bg-surface-raised-base p-3 text-11-regular text-text-base">
            {JSON.stringify(data(), null, 2)}
          </pre>
        )}
      </Show>
    </div>
  )
}

function Timeline(props: { events: AgentBoardRunEvent[] }) {
  return (
    <Show
      when={props.events.length > 0}
      fallback={
        <div class="flex flex-col items-center px-4 py-16 text-center">
          <div class="flex size-10 items-center justify-center rounded-full bg-surface-raised-base text-text-weak">
            <Icon name="status" class="size-4" />
          </div>
          <p class="mt-3 text-13-medium text-text-base">No activity yet</p>
          <p class="mt-1 text-11-regular text-text-muted">
            Events will appear here once an agent picks this up.
          </p>
        </div>
      }
    >
      <ol>
        <For each={props.events}>
          {(event, index) => {
            const tone = () => eventTone(event.type)
            const isLast = () => index() === props.events.length - 1
            const messageText = () => event.message?.trim()
            const showMessage = () => {
              const value = messageText()
              return !!value && value !== eventLabel(event.type)
            }
            const wallClock = () => new Date(event.time.created).toLocaleString()
            const isoTime = () => new Date(event.time.created).toISOString()
            const relative = () => formatRelative(event.time.created) || formatTime(event.time.created)
            return (
              <li class="group/event relative flex gap-3 pb-4 last:pb-0">
                <Show when={!isLast()}>
                  <span
                    aria-hidden
                    class="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border-strong-base"
                  />
                </Show>
                <span
                  class={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full shadow-xs-border-base transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] [&_[data-component=icon]]:text-inherit group-hover/event:scale-110 motion-reduce:transition-none ${tone().dot}`}
                >
                  <Icon name={tone().icon} class="size-3" />
                </span>
                <div class="min-w-0 flex-1 pt-0.5">
                  <div class="flex min-w-0 items-baseline justify-between gap-3">
                    <h4 class="truncate text-13-semibold leading-snug text-text-strong">
                      {eventLabel(event.type)}
                    </h4>
                    <time
                      class="shrink-0 text-11-regular tabular-nums text-text-strong"
                      title={wallClock()}
                      datetime={isoTime()}
                    >
                      {relative()}
                    </time>
                  </div>
                  <Show when={showMessage()}>
                    <p class="mt-0.5 text-12-regular leading-relaxed text-text-strong [text-wrap:pretty]">
                      {messageText()}
                    </p>
                  </Show>
                  <Show when={event.data}>
                    {(data) => (
                      <details class="group/data mt-1.5">
                        <summary class="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-border-base bg-surface-raised-base px-2 py-0.5 text-10-semibold uppercase tracking-wider text-text-base transition-colors hover:border-border-strong-base hover:bg-surface-raised-base-hover hover:text-text-strong">
                          <Icon
                            name="chevron-down"
                            class="size-3 transition-transform duration-150 group-open/data:rotate-180"
                          />
                          <span>Data</span>
                        </summary>
                        <pre class="mt-2 max-h-48 overflow-auto rounded-md bg-surface-raised-base p-2.5 font-mono text-10-regular leading-relaxed text-text-base">
                          {JSON.stringify(data(), null, 2)}
                        </pre>
                      </details>
                    )}
                  </Show>
                </div>
              </li>
            )
          }}
        </For>
      </ol>
    </Show>
  )
}

function BoardCardContent(props: {
  card: AgentBoardCard
  busy: boolean
  preview?: boolean
  onChat?: () => void
  onAdvance?: () => void
}) {
  const run = () => props.card.latestRun
  const last = () => latestEvent(props.card)
  const accent = () => COLUMN_ACCENT[props.card.column]
  const status = () => visibleStatus(props.card)
  const isLive = () => {
    const value = run()
    return !!value && RUNNING.has(value.status)
  }
  return (
    <>
      <Show when={isLive()}>
        <div class="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden rounded-b-md">
          <div class={`h-full w-1/3 animate-pulse ${accent().dot}`} />
        </div>
      </Show>

      <div class="flex items-center gap-1.5">
        <Show
          when={isLive()}
          fallback={
            <span
              class={`shrink-0 rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset ${statusTone(status())}`}
            >
              {statusLabel(status())}
            </span>
          }
        >
          <span class="flex shrink-0 items-center rounded-full bg-[#9e6a03]/14 px-1.5 py-0.5 text-10-semibold text-text-strong ring-1 ring-inset ring-[#d29922]/45">
            Running
          </span>
        </Show>
        <Show when={props.card.issue.priority !== undefined}>
          <span
            class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityTone(props.card.issue.priority)}`}
          >
            P{props.card.issue.priority}
          </span>
        </Show>
      </div>

      <h3 class="mt-2.5 text-13-semibold leading-snug text-text-strong [text-wrap:balance]">
        {props.card.issue.title}
      </h3>

      <Show when={cardSummary(props.card)}>
        {(summary) => <p class="mt-1.5 line-clamp-2 text-12-regular leading-relaxed text-text-weak">{summary()}</p>}
      </Show>

      <Show when={run()?.agent || run()?.model || last()}>
        <div class="mt-2.5 space-y-1 text-11-regular text-text-weak">
          <Show when={run()?.agent || run()?.model}>
            <div class="flex items-center gap-1.5">
              <Icon name="brain" class="size-3 shrink-0" />
              <span class="truncate">
                <Show when={run()?.agent}>{(agent) => <span class="text-text-base">{agent()}</span>}</Show>
                <Show when={run()?.model}>{(model) => <span class="font-mono"> · {model()}</span>}</Show>
              </span>
            </div>
          </Show>
          <Show when={last()}>
            {(event) => (
              <div class="flex items-center gap-1.5">
                <span class={`size-1.5 shrink-0 rounded-full ${accent().dot} opacity-70`} />
                <span class="truncate">{eventLabel(event().type)}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="mt-3 flex min-h-8 items-center justify-between gap-2 border-t border-border-weaker-base/50 pt-2">
        <span class={`max-w-[10rem] truncate ${issueIDTone()}`}>{props.card.issue.id}</span>
        <Show when={!props.preview}>
          <div class="flex h-6 min-w-[3.75rem] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <Show when={props.card.column === "ready" && props.onChat}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-10-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={props.busy}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onChat?.()
                }}
                aria-label={`Open chat for ${props.card.issue.id}`}
              >
                <Icon name="bubble-5" class="size-3" />
                Chat
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </>
  )
}

function BlockedStripeOverlay(props: { subtle?: boolean }) {
  return (
    <div
      class="pointer-events-none absolute inset-0"
      style={{
        "background-image": `repeating-linear-gradient(135deg, rgba(248, 81, 73, ${
          props.subtle ? "0.035" : "0.075"
        }) 0px, rgba(248, 81, 73, ${props.subtle ? "0.035" : "0.075"}) 1px, transparent 1px, transparent 9px)`,
      }}
    />
  )
}

function BoardCard(props: {
  card: AgentBoardCard
  selected: boolean
  busy: boolean
  dragging: boolean
  boardDragging: boolean
  onSelect: () => void
  onChat: () => void
  onAdvance: () => void
  onDragStart: (event: PointerEvent, card: AgentBoardCard) => void
}) {
  const run = () => props.card.latestRun
  const draggable = () => canDragCard(props.card)
  const isLive = () => {
    const value = run()
    return !!value && RUNNING.has(value.status)
  }
  const cardClass =
    "group relative w-full overflow-hidden rounded-md border border-transparent bg-background-base p-3.5 text-left shadow-xs-border-base transition-[border-color,box-shadow,background,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base motion-reduce:transition-none"
  const cardClassList = () => ({
    "ring-1 ring-inset ring-border-strong-base": props.selected,
    "ring-1 ring-inset ring-[#d29922]/40": isLive() && !props.selected,
    "!fixed !left-0 !top-0 !h-0 !min-h-0 !w-0 !border-0 !p-0 opacity-0 pointer-events-none shadow-none hover:bg-background-base":
      props.dragging,
    "hover:border-border-base hover:bg-surface-raised-base/80 hover:shadow-xs-border-hover": !props.boardDragging,
    "pointer-events-none": props.boardDragging && !props.dragging,
    "cursor-grab active:cursor-grabbing": draggable(),
    "cursor-default": !draggable(),
  })
  return draggable() ? (
    <article
      data-agentboard-card={props.card.issue.id}
      role="button"
      tabindex="0"
      aria-grabbed={props.dragging}
      aria-label={`${props.card.issue.id} — ${props.card.issue.title}`}
      class={cardClass}
      classList={cardClassList()}
      onPointerDown={(event) => {
        props.onDragStart(event, props.card)
      }}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onSelect()
      }}
    >
      <Show when={props.card.column === "blocked"}>
        <BlockedStripeOverlay />
      </Show>
      <div class="relative">
        <BoardCardContent card={props.card} busy={props.busy} onChat={props.onChat} onAdvance={props.onAdvance} />
      </div>
    </article>
  ) : (
    <article
      data-agentboard-card={props.card.issue.id}
      role="button"
      tabindex="0"
      aria-grabbed={false}
      aria-label={`${props.card.issue.id} — ${props.card.issue.title}. Blocked by dependencies.`}
      title="Blocked by dependencies. Resolve the dependency chain in Beads to move it."
      class={cardClass}
      classList={cardClassList()}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onSelect()
      }}
    >
      <Show when={props.card.column === "blocked"}>
        <BlockedStripeOverlay />
      </Show>
      <div class="relative">
        <BoardCardContent card={props.card} busy={props.busy} onChat={props.onChat} onAdvance={props.onAdvance} />
      </div>
    </article>
  )
}

function DragPreview(props: { card: AgentBoardCard; width?: number; height?: number }) {
  if (!props.width) return null
  return (
    <div
      class="pointer-events-none relative box-border flex-none overflow-hidden rounded-md border border-transparent bg-background-base p-3.5 text-left opacity-95 shadow-2xl ring-1 ring-border-strong-base"
      style={{
        width: `${props.width}px`,
        "max-width": "calc(100vw - 32px)",
        height: props.height ? `${props.height}px` : undefined,
      }}
    >
      <BoardCardContent card={props.card} busy={false} preview />
    </div>
  )
}

function ColumnPreview(props: { column: AgentBoardBoard["columns"][number]; width?: number; height?: number }) {
  if (!props.width) return null
  const accent = () => COLUMN_ACCENT[props.column.id]
  return (
    <div
      class="pointer-events-none box-border flex min-h-0 flex-none flex-col overflow-hidden rounded-lg border border-border-strong-base bg-surface-raised-base text-left opacity-95 shadow-2xl"
      style={{
        width: `${props.width}px`,
        height: props.height ? `${props.height}px` : undefined,
      }}
    >
      <div class="flex items-center gap-2 px-3 py-2.5">
        <span class="flex size-5 shrink-0 items-center justify-center rounded bg-background-base shadow-xs-border-base">
          <Icon name={COLUMN_ICON[props.column.id]} size="small" class={accent().text} />
        </span>
        <span class="truncate text-12-semibold uppercase tracking-wider text-text-strong">{props.column.title}</span>
        <span class={`rounded px-1.5 py-0.5 text-10-semibold tabular-nums ring-1 ring-inset ${accent().pill}`}>
          {props.column.cards.length}
        </span>
      </div>
      <div class="min-h-0 flex-1 space-y-2.5 overflow-hidden px-2.5 pb-4">
        <For each={props.column.cards}>
          {(card) => (
            <div class="relative overflow-hidden rounded-md border border-transparent bg-background-base p-3.5 text-left shadow-xs-border-base">
              <BoardCardContent card={card} busy={false} preview />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function CardDragLayer(props: {
  card: AgentBoardCard
  point: { x: number; y: number }
  offset: { x: number; y: number }
  width: number
  height?: number
}) {
  return (
    <div
      class="pointer-events-none fixed z-[10000]"
      style={{
        left: `${props.point.x - props.offset.x}px`,
        top: `${props.point.y - props.offset.y}px`,
        width: `${props.width}px`,
      }}
    >
      <DragPreview card={props.card} width={props.width} height={props.height} />
    </div>
  )
}

type DrawerTab = "details" | "timeline" | "artifacts" | "raw"

function DetailDrawer(props: {
  card: AgentBoardCard
  busy: boolean
  open: boolean
  tab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
  onClose: () => void
  onChat: () => void
  onMove: (column: AgentBoardColumnID) => void
  onCancel: () => void
  onMarkDone: () => void
  onRequestChanges: (message: string) => void
  onRefreshArtifacts: () => void
  onOpenSession: () => void
}) {
  const [message, setMessage] = createSignal("")
  const run = () => props.card.latestRun
  const canOpen = () => !!run()?.opencodeSessionID
  const canChat = () => props.card.column !== "closed"
  const canCancel = () => !!run() && RUNNING.has(run()!.status)
  const canReview = () => run()?.status === "needs_review" || run()?.status === "failed"
  const accent = () => COLUMN_ACCENT[props.card.column]
  const moveLabel = (column: AgentBoardColumnID) =>
    column === "needs_review" ? "Review" : column === "ready" ? "Ready" : column === "running" ? "Running" : "Closed"
  const moveDisabled = (column: AgentBoardColumnID) => props.busy || !canMoveCardTo(props.card, column).ok
  const applyPreset = (preset: string) => {
    const current = message().trim()
    setMessage(current ? `${current}\n\n${preset}` : preset)
  }
  const requestChanges = () => {
    props.onRequestChanges(message())
    setMessage("")
  }
  const tabs = createMemo(() =>
    [
      { id: "details" as const, label: "Details" },
      ...(props.card.events.length > 0
        ? [{ id: "timeline" as const, label: "Timeline", count: props.card.events.length }]
        : []),
      ...(props.card.artifacts.length > 0
        ? [{ id: "artifacts" as const, label: "Artifacts", count: props.card.artifacts.length }]
        : []),
      { id: "raw" as const, label: "Raw" },
    ] satisfies Array<{ id: DrawerTab; label: string; count?: number }>
  )

  createEffect(() => {
    if (tabs().some((tab) => tab.id === props.tab)) return
    props.onTabChange("details")
  })

  return (
    <aside
      class="flex h-full w-[420px] shrink-0 flex-col border-l border-border-weaker-base bg-background-base transition-[opacity,transform] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
      classList={{
        "translate-x-0 opacity-100": props.open,
        "translate-x-8 opacity-0 pointer-events-none": !props.open,
      }}
    >
      <div class="h-px shrink-0 bg-border-weaker-base" />
      <div class="shrink-0 px-5 py-4">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class={`size-2 rounded-full ${accent().dot}`} />
            <span class={`max-w-[11rem] truncate ${issueIDTone()}`}>{props.card.issue.id}</span>
            <span class="text-11-regular text-text-weak">{COLUMN_HINT[props.card.column]}</span>
          </div>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong"
            onClick={props.onClose}
            aria-label="Close"
          >
            <Icon name="close" class="size-4" />
          </button>
        </div>
        <h2 class="mt-3 text-18-semibold leading-tight text-text-strong [text-wrap:balance]">
          {props.card.issue.title}
        </h2>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <Show when={issueTypeMeta(props.card.issue)}>
            {(meta) => (
              <span
                class={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset ${meta().tone}`}
              >
                <Icon name={meta().icon} class={`size-3 ${meta().iconClass}`} />
                {meta().label}
              </span>
            )}
          </Show>
          <span
            class={`rounded px-1.5 py-0.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset ${statusTone(run()?.status ?? props.card.issue.status)}`}
          >
            {statusLabel(run()?.status ?? props.card.issue.status ?? props.card.column)}
          </span>
          <Show when={props.card.issue.priority !== undefined}>
            <span
              class={`rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityTone(props.card.issue.priority)}`}
            >
              P{props.card.issue.priority}
            </span>
          </Show>
          <Show when={run()?.agent}>
            {(agent) => (
              <span class="rounded bg-surface-raised-base px-1.5 py-0.5 text-10-semibold text-text-base">
                {agent()}
              </span>
            )}
          </Show>
        </div>
      </div>

      <div class="flex shrink-0 gap-1 border-b border-border-weaker-base px-3 py-2">
        <For each={tabs()}>
          {(value) => (
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-12-semibold transition-colors"
              classList={{
                "bg-surface-raised-base text-text-strong": props.tab === value.id,
                "text-text-base hover:bg-surface-raised-base-hover hover:text-text-strong": props.tab !== value.id,
              }}
              onClick={() => props.onTabChange(value.id)}
            >
              <span>{value.label}</span>
              <Show when={value.count !== undefined && value.count > 0}>
                <span class="rounded bg-surface-raised-strong px-1 py-0.5 text-10-semibold tabular-nums text-text-strong ring-1 ring-inset ring-border-base">
                  {value.count}
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <div class="min-h-0 flex-1 overflow-auto p-4">
        <Show when={props.tab === "details"}>
          <div class="space-y-3">
            <section>
              <h3 class="text-10-semibold uppercase tracking-wider text-text-weak">Description</h3>
              <p class="mt-2 whitespace-pre-wrap text-13-regular leading-relaxed text-text-base">
                {props.card.issue.description || "No description provided."}
              </p>
            </section>
            <Show when={run()}>
              {(current) => (
                <section class="rounded-md bg-surface-raised-base p-3">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="text-10-semibold uppercase tracking-wider text-text-weak">Latest run</h3>
                    <span
                      class={`rounded px-1.5 py-0.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset ${statusTone(current().status)}`}
                    >
                      {statusLabel(current().status)}
                    </span>
                  </div>
                  <Show when={current().opencodeSessionID}>
                    {(sessionID) => (
                      <div class="mt-2.5 flex items-center justify-between gap-4 text-12-regular">
                        <span class="text-text-weak">Session</span>
                        <span class="truncate font-mono text-text-base">{sessionID()}</span>
                      </div>
                    )}
                  </Show>
                  <Show when={current().model}>
                    {(model) => (
                      <div class="mt-1.5 flex items-center justify-between gap-4 text-12-regular">
                        <span class="text-text-weak">Model</span>
                        <span class="truncate font-mono text-text-base">{model()}</span>
                      </div>
                    )}
                  </Show>
                  <div class="mt-1.5 flex items-center justify-between gap-4 text-12-regular">
                    <span class="text-text-weak">Updated</span>
                    <span class="text-text-base">{formatRelative(current().time.updated)}</span>
                  </div>
                  <Show when={current().error}>
                    {(err) => (
                      <div class="mt-3 rounded bg-[#da3633]/14 p-2 text-12-regular text-text-strong ring-1 ring-[#f85149]/45">
                        {err()}
                      </div>
                    )}
                  </Show>
                </section>
              )}
            </Show>
          </div>
        </Show>

        <Show when={props.tab === "timeline"}>
          <Timeline events={props.card.events} />
        </Show>

        <Show when={props.tab === "artifacts"}>
          <Show
            when={props.card.artifacts.length > 0}
            fallback={
              <div class="rounded-md bg-surface-raised-base p-3">
                <p class="text-13-regular text-text-weak">No artifacts yet.</p>
                <Show when={canOpen()}>
                  <div class="mt-3">
                    <Button
                      variant="secondary"
                      size="small"
                      icon="reset"
                      disabled={props.busy}
                      onClick={props.onRefreshArtifacts}
                    >
                      Refresh Artifacts
                    </Button>
                  </div>
                </Show>
              </div>
            }
          >
            <div class="space-y-3">
              <div class="flex items-center justify-between gap-3">
                <p class="text-12-regular text-text-weak">Latest review handoff, diff, and session output.</p>
                <Button
                  variant="secondary"
                  size="small"
                  icon="reset"
                  disabled={props.busy || !canOpen()}
                  onClick={props.onRefreshArtifacts}
                >
                  Refresh
                </Button>
              </div>
              <For each={props.card.artifacts}>{(artifact) => <ArtifactView artifact={artifact} />}</For>
            </div>
          </Show>
        </Show>

        <Show when={props.tab === "raw"}>
          <pre class="overflow-auto rounded-md bg-surface-raised-base p-3 font-mono text-11-regular text-text-base">
            {JSON.stringify(props.card.issue.raw, null, 2)}
          </pre>
        </Show>
      </div>

      <div class="shrink-0 border-t border-border-weaker-base p-4">
        <Show when={canReview()}>
          <div class="mb-3 space-y-2">
            <textarea
              class="h-24 w-full resize-none rounded-md bg-surface-raised-base p-2.5 text-13-regular text-text-strong outline-none placeholder:text-text-weak focus:ring-1 focus:ring-border-strong-base"
              value={message()}
              onInput={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault()
                  requestChanges()
                }
              }}
              placeholder="Request specific changes…"
            />
            <div class="flex flex-wrap gap-1.5">
              <For each={REVIEW_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="rounded bg-surface-raised-base px-2 py-1 text-11-semibold text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.startsWith("Please run")
                      ? "Ask for tests"
                      : preset.startsWith("Please tighten")
                        ? "Tighten scope"
                        : "Inspect edge cases"}
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
        <div class="mb-3">
          <div class="mb-1.5 text-10-semibold uppercase tracking-wider text-text-weak">Move to</div>
          <div class="flex flex-wrap gap-1">
            <For each={["ready", "running", "needs_review", "closed"] as const}>
              {(column) => (
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded bg-surface-raised-base px-2.5 py-1 text-11-semibold text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-raised-base"
                  disabled={moveDisabled(column)}
                  aria-label={`Move ${props.card.issue.id} to ${moveLabel(column)}`}
                  title={canMoveCardTo(props.card, column).reason}
                  onClick={() => props.onMove(column)}
                >
                  <Icon name={COLUMN_ICON[column]} size="small" class={COLUMN_ACCENT[column].text} />
                  {moveLabel(column)}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 border-t border-border-weaker-base/60 pt-3">
          <Show when={canChat()}>
            <Button variant="primary" size="small" icon="bubble-5" disabled={props.busy} onClick={props.onChat}>
              Chat
            </Button>
          </Show>
          <Show when={canOpen()}>
            <Button variant="secondary" size="small" icon="bubble-5" onClick={props.onOpenSession}>
              Open Session
            </Button>
          </Show>
          <Show when={canReview() && run()?.status !== "failed"}>
            <Button variant="secondary" size="small" disabled={props.busy} onClick={requestChanges}>
              Request Changes
            </Button>
          </Show>
          <Show when={canReview()}>
            <Button variant="primary" size="small" icon="check-small" disabled={props.busy} onClick={props.onMarkDone}>
              Mark Done
            </Button>
          </Show>
          <Show when={canCancel()}>
            <Button variant="secondary" size="small" icon="stop" disabled={props.busy} onClick={props.onCancel}>
              Cancel
            </Button>
          </Show>
        </div>
      </div>
    </aside>
  )
}

type ComposerSubmit = {
  title: string
  description?: string
  priority?: number
  labels?: string[]
  runImmediately: boolean
}

type ComposerDraft = Omit<ComposerSubmit, "runImmediately">
type BoardDragTarget = {
  current: AgentBoardBoard
  card: AgentBoardCard
  issueID: string
  target: AgentBoardColumnID
  beforeIssueID?: string
}
type BoardDropPlacement = {
  column: AgentBoardColumnID
  beforeIssueID?: string
}
type ColumnDropPlacement = {
  beforeColumnID?: AgentBoardColumnID
}
type BoardLocalOrder = {
  columns: AgentBoardColumnID[]
  cards: Partial<Record<AgentBoardColumnID, string[]>>
}

function defaultBoardOrder(): BoardLocalOrder {
  return {
    columns: [...BOARD_COLUMN_IDS],
    cards: {},
  }
}

function columnDragID(column: AgentBoardColumnID) {
  return `${COLUMN_DRAG_PREFIX}${column}`
}

function parseColumnDragID(value: string | undefined) {
  if (!value?.startsWith(COLUMN_DRAG_PREFIX)) return
  const column = value.slice(COLUMN_DRAG_PREFIX.length)
  return isBoardColumnID(column) ? column : undefined
}

function boardOrderKey(directory: string) {
  return `${BOARD_ORDER_STORAGE_PREFIX}:${directory}`
}

function normalizeColumnOrder(input?: AgentBoardColumnID[]) {
  const seen = new Set<AgentBoardColumnID>()
  const output: AgentBoardColumnID[] = []
  for (const column of input ?? []) {
    if (!isBoardColumnID(column) || seen.has(column)) continue
    seen.add(column)
    output.push(column)
  }
  for (const column of BOARD_COLUMN_IDS) {
    if (!seen.has(column)) output.push(column)
  }
  return output
}

function loadBoardOrder(directory: string): BoardLocalOrder {
  if (typeof localStorage === "undefined") return defaultBoardOrder()
  try {
    const raw = localStorage.getItem(boardOrderKey(directory))
    if (!raw) return defaultBoardOrder()
    const parsed = JSON.parse(raw) as Partial<BoardLocalOrder>
    const cards: BoardLocalOrder["cards"] = {}
    for (const column of BOARD_COLUMN_IDS) {
      const order = parsed.cards?.[column]
      if (Array.isArray(order)) cards[column] = order.filter((id): id is string => typeof id === "string")
    }
    return {
      columns: normalizeColumnOrder(parsed.columns),
      cards,
    }
  } catch {
    return defaultBoardOrder()
  }
}

function saveBoardOrder(directory: string, order: BoardLocalOrder) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(
      boardOrderKey(directory),
      JSON.stringify({
        columns: normalizeColumnOrder(order.columns),
        cards: order.cards,
      }),
    )
  } catch {
    /* storage can be unavailable */
  }
}

function orderCards(cards: AgentBoardCard[], order?: string[]) {
  if (!order?.length) return cards
  const rank = new Map(order.map((id, index) => [id, index]))
  return cards
    .map((card, index) => ({ card, index, rank: rank.get(card.issue.id) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.index - b.index
      if (a.rank === undefined) return 1
      if (b.rank === undefined) return -1
      return a.rank - b.rank
    })
    .map((item) => item.card)
}

function applyBoardOrder(board: AgentBoardBoard, order: BoardLocalOrder): AgentBoardBoard {
  const columns = new Map(board.columns.map((column) => [column.id, column]))
  return {
    ...board,
    columns: normalizeColumnOrder(order.columns)
      .map((id) => columns.get(id))
      .filter((column): column is AgentBoardBoard["columns"][number] => !!column)
      .map((column) => ({
        ...column,
        cards: orderCards(column.cards, order.cards[column.id]),
      })),
  }
}

function orderFromBoard(board: AgentBoardBoard, columns?: AgentBoardColumnID[]): BoardLocalOrder {
  return {
    columns: normalizeColumnOrder(columns ?? board.columns.map((column) => column.id)),
    cards: Object.fromEntries(
      board.columns.map((column) => [column.id, column.cards.map((card) => card.issue.id)]),
    ) as BoardLocalOrder["cards"],
  }
}

function insertArrayItemBefore<T>(items: T[], item: T, before?: T) {
  if (before === item) return items
  const next = items.filter((value) => value !== item)
  const index = before === undefined ? next.length : next.indexOf(before)
  next.splice(index === -1 ? next.length : index, 0, item)
  return next
}

function DropPlaceholder(props: { card?: AgentBoardCard; height?: number }) {
  return (
    <Show
      when={props.card}
      fallback={
        <div
          class="rounded-md bg-background-base opacity-35 shadow-xs-border-base"
          style={{ height: `${props.height ?? 128}px` }}
        />
      }
    >
      {(card) => (
        <div
          class="pointer-events-none relative box-border w-full overflow-hidden rounded-md border border-border-weaker-base bg-background-base p-3.5 text-left opacity-35 shadow-xs-border-base"
          style={{ height: `${props.height ?? 128}px` }}
          aria-hidden="true"
        >
          <BoardCardContent card={card()} busy={false} preview />
        </div>
      )}
    </Show>
  )
}

function ColumnDropPlaceholder(props: { height?: number }) {
  return (
    <div
      class="box-border h-full min-h-0 w-full rounded-lg border border-border-weaker-base bg-surface-raised-base opacity-45 shadow-xs-border-base"
      style={{ height: props.height ? `${props.height}px` : undefined }}
    />
  )
}

function IssueComposer(props: {
  variant?: "inline" | "hero"
  knownLabels: string[]
  busy: boolean
  onSubmit: (input: ComposerSubmit) => Promise<void>
  onPlan: (input: ComposerDraft) => void
  onSuggest: () => void
}) {
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [labels, setLabels] = createSignal<string[]>([])
  const [labelDraft, setLabelDraft] = createSignal("")
  const [priority, setPriority] = createSignal(2)
  const [expanded, setExpanded] = createSignal(props.variant === "hero")
  const [submitting, setSubmitting] = createSignal(false)
  const [showSuggestions, setShowSuggestions] = createSignal(false)
  let titleRef: HTMLTextAreaElement | undefined
  let descRef: HTMLTextAreaElement | undefined
  let labelInputRef: HTMLInputElement | undefined
  let composerRef: HTMLFormElement | undefined

  const isHero = () => props.variant === "hero"
  const filled = () => title().trim().length > 0
  const priorityMeta = () => PRIORITY_OPTIONS.find((option) => option.value === priority()) ?? PRIORITY_OPTIONS[2]
  const suggestions = createMemo(() => {
    const draft = labelDraft().trim().toLowerCase().replace(/^#+/, "")
    const taken = new Set(labels())
    return props.knownLabels
      .filter((label) => !taken.has(label))
      .filter((label) => !draft || label.toLowerCase().includes(draft))
      .slice(0, 6)
  })

  function reset() {
    setTitle("")
    setDescription("")
    setLabels([])
    setLabelDraft("")
    setPriority(2)
    if (!isHero()) setExpanded(false)
  }

  function addLabel(value: string) {
    const trimmed = value.trim().replace(/^#+/, "")
    if (!trimmed || labels().includes(trimmed)) return
    setLabels([...labels(), trimmed])
    setLabelDraft("")
    setShowSuggestions(false)
  }

  function collapse() {
    if (isHero()) return
    setShowSuggestions(false)
    setExpanded(false)
    titleRef?.blur()
    descRef?.blur()
    labelInputRef?.blur()
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || isHero()) return
    if (showSuggestions()) {
      event.preventDefault()
      setShowSuggestions(false)
      return
    }
    if (!expanded()) return
    event.preventDefault()
    event.stopPropagation()
    collapse()
  }

  function removeLabel(value: string) {
    setLabels(labels().filter((existing) => existing !== value))
  }

  async function submit(runImmediately: boolean) {
    const trimmed = title().trim()
    if (!trimmed || submitting() || props.busy) return
    setSubmitting(true)
    try {
      await props.onSubmit({
        title: trimmed,
        description: description().trim() || undefined,
        priority: priority(),
        labels: labels().length > 0 ? labels() : undefined,
        runImmediately,
      })
      reset()
      titleRef?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  function planInChat() {
    const trimmed = title().trim()
    if (!trimmed || submitting() || props.busy) return
    props.onPlan({
      title: trimmed,
      description: description().trim() || undefined,
      priority: priority(),
      labels: labels().length > 0 ? labels() : undefined,
    })
  }

  function onTitleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submit(event.metaKey || event.ctrlKey)
    }
  }

  function onDescriptionKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit(true)
    } else if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      // Plain Enter inside description still inserts a newline; Cmd+Enter files and opens chat.
    }
  }

  function onLabelKeyDown(event: KeyboardEvent) {
    const draft = labelDraft()
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      if (draft.trim()) {
        event.preventDefault()
        addLabel(draft)
      }
    } else if (event.key === "Backspace" && !draft && labels().length > 0) {
      event.preventDefault()
      removeLabel(labels()[labels().length - 1]!)
    }
  }

  function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  function cyclePriority() {
    const next = (priority() + 1) % PRIORITY_OPTIONS.length
    setPriority(next)
  }

  return (
    <form
      ref={composerRef}
      class="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
      onKeyDown={handleEscape}
    >
      <div
        class="group relative overflow-hidden rounded-xl bg-background-base shadow-md transition-[box-shadow,background] duration-150"
        classList={{
          "ring-1 ring-inset ring-border-weak-base": !filled() && !expanded(),
          "ring-1 ring-inset ring-border-strong-base shadow-lg": filled() || expanded(),
        }}
      >
        <div class="flex items-start gap-2 px-3 py-2.5">
          <Show when={!expanded()}>
            <button
              type="button"
              class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
              onClick={() => {
                setExpanded(true)
                titleRef?.focus()
              }}
              aria-label="Add issue"
            >
              <Icon name="plus-small" class="size-3.5" />
            </button>
          </Show>
          <textarea
            ref={titleRef}
            rows="1"
            value={title()}
            disabled={submitting() || props.busy}
            placeholder={isHero() ? "What needs to get done?" : "Tell AgentBoard what to work on…"}
            class="min-h-6 flex-1 resize-none bg-transparent text-14-regular leading-6 text-text-strong outline-none placeholder:text-text-weak disabled:opacity-60"
            onFocus={() => setExpanded(true)}
            onInput={(event) => {
              setTitle(event.currentTarget.value)
              autosize(event.currentTarget)
            }}
            onKeyDown={onTitleKeyDown}
          />
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class={`flex h-6 items-center gap-1 rounded px-1.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset transition-colors hover:bg-surface-raised-base-hover ${priorityMeta().tone}`}
              onClick={cyclePriority}
              title="Priority — click to cycle"
            >
              {priorityMeta().label}
            </button>
            <Show when={!filled()}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-md bg-surface-raised-base px-2 text-11-semibold text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong disabled:opacity-50"
                disabled={submitting() || props.busy}
                onClick={props.onSuggest}
                title="Ask Chat to inspect Beads and the codebase, then suggest useful tickets"
                aria-label="Suggest AgentBoard work"
              >
                <Icon name="brain" class="size-3" />
                Suggest
              </button>
            </Show>
            <Show when={filled()}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-11-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                disabled={submitting() || props.busy}
                onClick={() => void submit(false)}
                title="Create one Beads issue"
              >
                Create issue
              </button>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-md bg-surface-raised-base px-2 text-11-semibold text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong disabled:opacity-50"
                disabled={submitting() || props.busy}
                onClick={() => void submit(true)}
                title="Create one Beads issue, then open chat with that issue context"
              >
                <Icon name="bubble-5" class="size-3" />
                Create & chat
              </button>
            </Show>
          </div>
        </div>

        <Show when={expanded()}>
          <div class="border-t border-border-weaker-base px-3 py-2.5">
            <textarea
              ref={descRef}
              rows="2"
              value={description()}
              disabled={submitting() || props.busy}
              placeholder="Add detail (optional) — what done looks like, constraints, links…"
              class="min-h-12 w-full resize-none bg-transparent text-13-regular leading-relaxed text-text-base outline-none placeholder:text-text-weak disabled:opacity-60"
              onInput={(event) => {
                setDescription(event.currentTarget.value)
                autosize(event.currentTarget)
              }}
              onKeyDown={onDescriptionKeyDown}
            />
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <For each={labels()}>
                {(label) => (
                  <span class="inline-flex items-center gap-1 rounded-full bg-surface-raised-base px-2 py-0.5 text-11-regular text-text-base">
                    <span class="font-mono text-text-weak">#</span>
                    {label}
                    <button
                      type="button"
                      class="flex size-3 items-center justify-center rounded-full text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
                      onClick={() => removeLabel(label)}
                      aria-label={`Remove ${label}`}
                    >
                      <Icon name="close-small" class="size-2.5" />
                    </button>
                  </span>
                )}
              </For>
              <div class="relative">
                <input
                  ref={labelInputRef}
                  type="text"
                  value={labelDraft()}
                  disabled={submitting() || props.busy}
                  placeholder={labels().length === 0 ? "Add tag…" : "+"}
                  class="h-6 w-24 bg-transparent text-12-regular text-text-base outline-none placeholder:text-text-weak disabled:opacity-60"
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onInput={(event) => {
                    setLabelDraft(event.currentTarget.value)
                    setShowSuggestions(true)
                  }}
                  onKeyDown={onLabelKeyDown}
                />
                <Show when={showSuggestions() && suggestions().length > 0}>
                  <div class="absolute bottom-7 left-0 z-20 flex flex-wrap gap-1 rounded-md bg-surface-raised-base p-1.5 shadow-lg ring-1 ring-inset ring-border-weak-base">
                    <For each={suggestions()}>
                      {(label) => (
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full bg-background-base px-2 py-0.5 text-11-regular text-text-base transition-colors hover:text-text-strong"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            addLabel(label)
                            labelInputRef?.focus()
                          }}
                        >
                          <span class="font-mono text-text-weak">#</span>
                          {label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <span class="ml-auto hidden items-center gap-1.5 text-10-regular text-text-weak md:flex">
                <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono">⏎</kbd>
                create
                <span class="opacity-50">·</span>
                <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono">⌘⏎</kbd>
                create &amp; chat
                <Show when={!isHero()}>
                  <span class="opacity-50">·</span>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-text-weak underline-offset-2 hover:bg-surface-raised-base hover:text-text-strong hover:underline"
                    onClick={collapse}
                  >
                    <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono">esc</kbd>
                    collapse
                  </button>
                </Show>
              </span>
            </div>
          </div>
        </Show>
      </div>
    </form>
  )
}

function BoardListView(props: {
  columns: AgentBoardBoard["columns"]
  dependencies: AgentBoardBoard["graph"]["dependencies"]
  selectedID?: string
  busy?: string
  knownLabels: string[]
  onSelect: (issueID: string) => void
  onChat: (issueID: string) => void
  onSubmit: (input: ComposerSubmit) => Promise<void>
  onPlan: (input: ComposerDraft) => void
  onSuggest: () => void
}) {
  const groups = createMemo(() => props.columns.filter((column) => column.cards.length > 0))
  const totalRows = createMemo(() => props.columns.reduce((sum, column) => sum + column.cards.length, 0))
  const blockerCounts = createMemo(() => {
    const counts = new Map<string, number>()
    for (const dependency of props.dependencies) {
      if (dependency.type !== "blocks") continue
      counts.set(dependency.fromIssueID, (counts.get(dependency.fromIssueID) ?? 0) + 1)
    }
    return counts
  })
  return (
    <div class="flex h-full flex-col">
      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-5xl px-4 py-5">
          <Show
            when={totalRows() > 0}
            fallback={
              <div class="rounded-lg border border-dashed border-border-weaker-base bg-surface-panel px-6 py-16 text-center text-13-regular text-text-weak">
                No matching issues.
              </div>
            }
          >
            <div class="space-y-5">
              <For each={groups()}>
                {(column) => {
                  const accent = COLUMN_ACCENT[column.id]
                  return (
                    <section>
                      <header class="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-background-base/85 px-1 pb-2 pt-1 backdrop-blur">
                        <span class="inline-flex size-5 items-center justify-center rounded-md bg-surface-raised-base shadow-xs-border-base">
                          <Icon name={COLUMN_ICON[column.id]} class={`size-3 ${accent.text}`} />
                        </span>
                        <h2 class="text-12-semibold uppercase tracking-wider text-text-strong">{column.title}</h2>
                        <span
                          class={`rounded-full px-1.5 py-0.5 text-10-semibold tabular-nums ring-1 ring-inset ${accent.pill}`}
                        >
                          {column.cards.length}
                        </span>
                        <span class="ml-1 hidden truncate text-11-regular text-text-weak sm:inline">
                          {COLUMN_HINT[column.id]}
                        </span>
                      </header>
                      <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-surface-panel shadow-xs-border-base">
                        <For each={column.cards}>
                          {(card) => (
                            <BoardListRow
                              card={card}
                              accent={accent}
                              selected={props.selectedID === card.issue.id}
                              busy={props.busy === card.issue.id}
                              blockerCount={blockerCounts().get(card.issue.id) ?? 0}
                              onSelect={() => props.onSelect(card.issue.id)}
                              onChat={() => props.onChat(card.issue.id)}
                            />
                          )}
                        </For>
                      </ul>
                    </section>
                  )
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="shrink-0 border-t border-border-weaker-base bg-background-base px-4 py-3">
        <IssueComposer
          variant="inline"
          knownLabels={props.knownLabels}
          busy={!!props.busy}
          onSubmit={props.onSubmit}
          onPlan={props.onPlan}
          onSuggest={props.onSuggest}
        />
      </div>
    </div>
  )
}

function BoardListRow(props: {
  card: AgentBoardCard
  accent: ColumnAccent
  selected: boolean
  busy: boolean
  blockerCount: number
  onSelect: () => void
  onChat: () => void
}) {
  const run = () => props.card.latestRun
  const isLive = () => {
    const value = run()
    return !!value && RUNNING.has(value.status)
  }
  const last = () => latestEvent(props.card)
  const summary = () => cardSummary(props.card)
  const labels = () => extractLabels(props.card)
  const latestText = () => {
    const event = last()
    if (event) return eventLabel(event.type)
    return formatRelative(props.card.latestRun?.time.updated ?? props.card.latestRun?.time.ended)
  }
  return (
    <li class="border-b border-border-weaker-base last:border-b-0">
      <article
        role="button"
        tabindex="0"
        aria-label={`${props.card.issue.id} — ${props.card.issue.title}`}
        class="group relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-raised-base/55 focus-visible:bg-surface-raised-base/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-strong-base"
        classList={{
          "bg-surface-raised-base/70": props.selected,
        }}
        onClick={props.onSelect}
        onDblClick={(event) => {
          event.preventDefault()
          props.onChat()
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return
          event.preventDefault()
          props.onSelect()
        }}
      >
        <span
          aria-hidden
          class={`absolute inset-y-0 left-0 w-1 origin-left rounded-r-full ${props.accent.dot} scale-x-0 transition-transform duration-200 ease-out motion-reduce:transition-none`}
          classList={{
            "scale-x-100": props.selected,
            "group-hover:scale-x-100 group-focus-visible:scale-x-100": !props.selected,
          }}
        />

        <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden>
          <Show
            when={isLive()}
            fallback={<span class={`size-2 rounded-full ${props.accent.dot}`} />}
          >
            <span class="relative flex size-2">
              <span
                class={`absolute inline-flex h-full w-full animate-ping rounded-full ${props.accent.dot} opacity-60`}
              />
              <span class={`relative inline-flex size-2 rounded-full ${props.accent.dot}`} />
            </span>
          </Show>
        </span>

        <span class={`shrink-0 ${issueIDTone()}`}>{props.card.issue.id}</span>

        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-13-semibold text-text-strong">{props.card.issue.title}</span>
            <Show when={labels().length > 0}>
              <span class="hidden shrink min-w-0 items-center gap-1 md:inline-flex">
                <For each={labels().slice(0, 2)}>
                  {(label) => (
                    <span class="shrink-0 truncate rounded bg-surface-raised-base px-1.5 py-0.5 text-10-regular text-text-weak ring-1 ring-inset ring-border-weaker-base">
                      {label}
                    </span>
                  )}
                </For>
                <Show when={labels().length > 2}>
                  <span class="shrink-0 text-10-regular text-text-muted">+{labels().length - 2}</span>
                </Show>
              </span>
            </Show>
          </div>
          <Show when={summary()}>
            {(text) => <p class="mt-0.5 truncate text-12-regular text-text-weak">{text()}</p>}
          </Show>
        </div>

        <div class="ml-auto flex shrink-0 items-center gap-2">
          <Show when={props.blockerCount > 0}>
            <span
              class="inline-flex items-center gap-1 rounded bg-[#da3633]/12 px-1.5 py-0.5 text-10-semibold text-[#cf222e] ring-1 ring-inset ring-[#f85149]/40 [&_[data-component=icon]]:text-inherit"
              title={`${props.blockerCount} blocking dependenc${props.blockerCount === 1 ? "y" : "ies"}`}
            >
              <Icon name="circle-ban-sign" class="size-3" />
              {props.blockerCount}
            </span>
          </Show>
          <Show when={props.card.issue.priority !== undefined}>
            <span
              class={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityTone(props.card.issue.priority)}`}
            >
              P{props.card.issue.priority}
            </span>
          </Show>
          <Show when={latestText()}>
            {(text) => (
              <span class="hidden min-w-[5rem] truncate text-right text-11-regular tabular-nums text-text-weak lg:inline">
                {text()}
              </span>
            )}
          </Show>
        </div>
      </article>
    </li>
  )
}

function BoardColumn(props: {
  column: AgentBoardBoard["columns"][number]
  selectedID?: string
  busy?: string
  activeDrag?: string
  activeDragCard?: AgentBoardCard
  activeColumnDrag?: AgentBoardColumnID
  activeTarget?: AgentBoardColumnID
  dropPlacement?: BoardDropPlacement
  placeholderHeight?: number
  onSelect: (issueID: string) => void
  onChat: (issueID: string) => void
  onAdvance: (issueID: string, target: AgentBoardColumnID) => void
  onCardDragStart: (event: PointerEvent, card: AgentBoardCard) => void
}) {
  const droppable = createDroppable(props.column.id)
  const columnDraggable = createDraggable(columnDragID(props.column.id))
  const disabled = () => COLUMN_DRAG_DISABLED.has(props.column.id)
  const accent = () => COLUMN_ACCENT[props.column.id]
  const dragging = () => !!props.activeDrag
  const columnDragActive = () => !!props.activeColumnDrag
  const targeted = () => props.activeTarget === props.column.id
  const columnDragging = () => props.activeColumnDrag === props.column.id
  const empty = () => COLUMN_EMPTY[props.column.id]
  const placeholderBefore = (issueID: string) =>
    props.dropPlacement?.column === props.column.id && props.dropPlacement.beforeIssueID === issueID
  const placeholderAtEnd = () => props.dropPlacement?.column === props.column.id && !props.dropPlacement.beforeIssueID
  return (
    <section
      ref={(element) => {
        droppable.ref(element)
        columnDraggable.ref(element)
      }}
      data-agentboard-column={props.column.id}
      class="relative flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-raised-base transition-[background,box-shadow,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
      classList={{
        "ring-1 ring-inset ring-border-weaker-base": (dragging() || columnDragActive()) && !targeted(),
        [`${accent().drop} ring-1 ring-inset shadow-lg ${accent().glow}`]:
          targeted() && (!disabled() || columnDragActive()),
        "opacity-55 ring-1 ring-inset ring-border-critical-base": targeted() && disabled() && !columnDragActive(),
        "!fixed !left-0 !top-0 !h-0 !min-h-0 !w-0 !border-0 opacity-0 pointer-events-none shadow-none overflow-hidden":
          columnDragging(),
      }}
    >
      <Show when={props.column.id === "blocked"}>
        <BlockedStripeOverlay subtle />
      </Show>
      <header
        class="sticky top-0 z-10 flex shrink-0 items-center gap-2 px-3 py-2 transition-colors duration-150"
        classList={{
          [accent().drop]: targeted() && (!disabled() || columnDragActive()),
          "cursor-grab active:cursor-grabbing": !props.activeDrag,
        }}
        onPointerDown={(event) => {
          if (props.activeDrag) return
          startBoardPointerTracking(event)
          columnDraggable.dragActivators.onpointerdown?.(event)
        }}
        title="Drag to reorder list"
      >
        <span class="flex size-5 shrink-0 items-center justify-center rounded bg-background-base shadow-xs-border-base">
          <Icon name={COLUMN_ICON[props.column.id]} size="small" class={accent().text} />
        </span>
        <h2 class="truncate text-12-semibold uppercase tracking-wider text-text-strong">{props.column.title}</h2>
        <span class={`rounded px-1.5 py-0.5 text-10-semibold tabular-nums ring-1 ring-inset ${accent().pill}`}>
          {props.column.cards.length}
        </span>
      </header>
      <div class="relative z-10 min-h-0 flex-1 space-y-2.5 overflow-auto px-2.5 py-2" data-scrollable>
        <Show
          when={props.column.cards.length > 0}
          fallback={
            <Show
              when={placeholderAtEnd()}
              fallback={
                <div class="flex min-h-32 flex-col items-center justify-center rounded-md border border-dashed border-border-weaker-base px-3 py-8 text-center">
                  <div class={`mb-2 size-2 rounded-full ${accent().dot} opacity-60`} />
                  <div class="text-12-regular text-text-weak">{empty().idle}</div>
                  <Show when={empty().managed}>
                    {(label) => <div class="mt-1 text-10-regular text-text-weak opacity-70">{label()}</div>}
                  </Show>
                </div>
              }
            >
              <DropPlaceholder card={props.activeDragCard} height={props.placeholderHeight} />
            </Show>
          }
        >
          <For each={props.column.cards}>
            {(card) => (
              <>
                <Show when={placeholderBefore(card.issue.id)}>
                  <DropPlaceholder card={props.activeDragCard} height={props.placeholderHeight} />
                </Show>
                <BoardCard
                  card={card}
                  selected={props.selectedID === card.issue.id}
                  busy={props.busy === card.issue.id}
                  dragging={props.activeDrag === card.issue.id}
                  boardDragging={!!props.activeDrag}
                  onSelect={() => props.onSelect(card.issue.id)}
                  onChat={() => props.onChat(card.issue.id)}
                  onAdvance={() => {
                    const target = ADVANCEMENT[card.column]
                    if (!target) return
                    props.onAdvance(card.issue.id, target)
                  }}
                  onDragStart={props.onCardDragStart}
                />
              </>
            )}
          </For>
          <Show when={placeholderAtEnd()}>
            <DropPlaceholder card={props.activeDragCard} height={props.placeholderHeight} />
          </Show>
        </Show>
      </div>
    </section>
  )
}

function LoadingState() {
  return (
    <div class="h-full overflow-hidden p-4">
      <div class="grid h-full min-w-[1200px] grid-cols-5 gap-3">
        <For each={[0, 1, 2, 3, 4]}>
          {(index) => (
            <div class="flex min-h-0 flex-col rounded-lg bg-surface-raised-base">
              <div class="flex items-center justify-between px-3 py-2.5">
                <div class="h-2.5 w-20 rounded bg-surface-raised-stronger" />
                <div class="h-4 w-6 rounded bg-surface-raised-stronger" />
              </div>
              <div class="space-y-2.5 px-2.5 pb-3">
                <For each={[0, 1, 2]}>
                  {(row) => (
                    <div
                      class="rounded-md bg-background-base p-3.5 shadow-xs-border-base"
                      classList={{ "opacity-50": row > index % 3 }}
                    >
                      <div class="h-2.5 w-12 rounded bg-surface-raised-base" />
                      <div class="mt-2.5 h-3 w-4/5 rounded bg-surface-raised-base" />
                      <div class="mt-1.5 h-3 w-2/3 rounded bg-surface-raised-base" />
                      <div class="mt-3 flex gap-1.5">
                        <div class="h-2 w-12 rounded bg-surface-raised-base" />
                        <div class="h-2 w-8 rounded bg-surface-raised-base" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function EpicFilterMenu(props: {
  epics: EpicSummary[]
  activeID?: string
  onSelect: (id: string | undefined) => void
}) {
  const epicAccent = ISSUE_TYPE_META.epic
  const activeEpic = () => props.epics.find((epic) => epic.id === props.activeID)
  const buttonLabel = () => activeEpic()?.title ?? "Epics"
  return (
    <DropdownMenu gutter={6} placement="bottom-end">
      <DropdownMenu.Trigger
        class="inline-flex h-6 max-w-36 items-center gap-1.5 rounded-md px-2 text-10-semibold ring-1 ring-inset transition-colors data-[expanded]:bg-surface-raised-base-active data-[expanded]:text-text-strong data-[expanded]:ring-border-base"
        classList={{
          "bg-surface-raised-base-active text-text-strong ring-border-base": !!props.activeID,
          "text-text-weak ring-transparent hover:bg-surface-raised-base hover:text-text-base": !props.activeID,
        }}
      >
        <Icon name={epicAccent.icon} class={`size-3 ${props.activeID ? epicAccent.iconClass : ""}`} />
        <span class="truncate">{buttonLabel()}</span>
        <Show when={!props.activeID}>
          <span class="rounded bg-surface-raised-base px-1 py-0.5 text-10-semibold tabular-nums text-text-base ring-1 ring-inset ring-border-weaker-base">
            {props.epics.length}
          </span>
        </Show>
        <Icon name="chevron-down" class="size-3 text-text-muted" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="w-80">
          <div class="flex items-center justify-between px-2 py-1">
            <div class="text-11-semibold uppercase tracking-wider text-text-muted">Epics</div>
            <DropdownMenu.Item disabled={!props.activeID} onSelect={() => props.onSelect(undefined)}>
              <DropdownMenu.ItemLabel>All work</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </div>
          <DropdownMenu.Separator />
          <div class="max-h-72 overflow-y-auto">
            <For each={props.epics}>
              {(epic) => {
                const active = () => props.activeID === epic.id
                const progress = () => `${epic.closedCount}/${epic.childCount}`
                return (
                  <DropdownMenu.Item
                    class="min-w-0"
                    title={`${epic.id} · ${epic.title}`}
                    onSelect={() => props.onSelect(active() ? undefined : epic.id)}
                  >
                    <Icon name={epicAccent.icon} class={`size-3.5 ${epicAccent.iconClass}`} />
                    <DropdownMenu.ItemLabel class="min-w-0 truncate">{epic.title}</DropdownMenu.ItemLabel>
                    <span class="ml-2 shrink-0 rounded bg-surface-raised-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak ring-1 ring-inset ring-border-weaker-base">
                      {progress()}
                    </span>
                  </DropdownMenu.Item>
                )
              }}
            </For>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

function SearchField(props: {
  value: string
  visible: number
  total: number
  onInput: (value: string) => void
  onClear: () => void
}) {
  let inputRef: HTMLInputElement | undefined
  return (
    <label class="relative hidden lg:block">
      <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-weak">
        <Icon name="magnifying-glass" class="size-3.5" />
      </span>
      <input
        ref={inputRef}
        type="text"
        autocomplete="off"
        spellcheck={false}
        class="h-7 w-72 rounded-md bg-surface-raised-base pl-8 pr-20 text-13-regular text-text-strong outline-none placeholder:text-text-weak focus:ring-1 focus:ring-border-strong-base"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder="Search cards"
      />
      <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <Show
          when={props.value}
          fallback={
            <span class="rounded bg-background-base px-1.5 py-0.5 font-mono text-10-regular text-text-weak">/</span>
          }
        >
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
            aria-label="Clear search"
            onClick={props.onClear}
          >
            <Icon name="close-small" class="size-3" />
          </button>
        </Show>
        <span class="rounded bg-background-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak">
          {props.visible}/{props.total}
        </span>
      </div>
    </label>
  )
}

function SetupState(props: {
  error?: string
  initError?: string
  initializing: boolean
  onInit: () => void
  onChat: () => void
  onDocs: () => void
}) {
  const missing = () => isMissingBeads(props.error)
  const message = () => props.initError ?? shortError(props.error)
  return (
    <div class="flex h-full items-center justify-center px-6 pb-32">
      <div class="-mt-4 w-full max-w-2xl rounded-xl border border-border-weaker-base bg-surface-panel p-6 shadow-xs-border-base">
        <div class="flex items-start gap-4">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised-base text-text-strong shadow-xs-border-base">
            <Icon name={missing() ? "checklist" : "warning"} class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="text-18-semibold text-text-strong">
              {missing() ? "Set up Beads for this project" : "AgentBoard could not load"}
            </h2>
            <p class="mt-2 text-13-regular leading-relaxed text-text-base">
              <Show
                when={missing()}
                fallback={message()}
              >
                AgentBoard stores its tickets in Beads, a local issue tracker designed for coding agents. This project
                needs a Beads database before the board can show work.
              </Show>
            </p>
          </div>
        </div>

        <Show when={missing()}>
          <div class="mt-5 grid gap-2 text-12-regular text-text-base md:grid-cols-3">
            <div class="rounded-lg bg-background-base p-3 ring-1 ring-inset ring-border-weaker-base">
              <div class="text-11-semibold uppercase tracking-wider text-text-weak">1. Install</div>
              <p class="mt-1 leading-relaxed">Install the Beads CLI, or open the docs if it is not available yet.</p>
            </div>
            <div class="rounded-lg bg-background-base p-3 ring-1 ring-inset ring-border-weaker-base">
              <div class="text-11-semibold uppercase tracking-wider text-text-weak">2. Initialize</div>
              <p class="mt-1 leading-relaxed">
                Run <code class="rounded bg-surface-raised-base px-1 font-mono">bd init</code> in this project.
              </p>
            </div>
            <div class="rounded-lg bg-background-base p-3 ring-1 ring-inset ring-border-weaker-base">
              <div class="text-11-semibold uppercase tracking-wider text-text-weak">3. Use the skill</div>
              <p class="mt-1 leading-relaxed">
                In Codex, you can ask Chat to help install or use the Beads skill. Try{" "}
                <code class="rounded bg-surface-raised-base px-1 font-mono">npx skills beads</code>.
              </p>
            </div>
          </div>
        </Show>

        <Show when={props.initError}>
          {(error) => (
            <div class="mt-4 rounded-lg bg-[#da3633]/14 p-3 text-12-regular leading-relaxed text-text-strong ring-1 ring-inset ring-[#f85149]/45">
              {error()}
            </div>
          )}
        </Show>

        <div class="mt-5 flex flex-wrap items-center gap-2">
          <Show when={missing()}>
            <Button size="large" icon="plus-small" disabled={props.initializing} onClick={props.onInit}>
              {props.initializing ? "Initializing…" : "Run bd init"}
            </Button>
          </Show>
          <Button variant={missing() ? "secondary" : "ghost"} size="large" icon="bubble-5" onClick={props.onChat}>
            Ask Chat to help
          </Button>
          <Button variant="ghost" size="large" icon="square-arrow-top-right" onClick={props.onDocs}>
            Beads on GitHub
          </Button>
        </div>
      </div>
    </div>
  )
}

function agentBoardPlanningPrompt(input: ComposerDraft) {
  const lines = ["You are planning work with Beads.", "", "User request:", input.title]
  if (input.description) {
    lines.push("", "Additional detail:", input.description)
  }
  lines.push(
    "",
    "Turn this into useful Beads issues.",
    "",
    "Workflow:",
    "1. Inspect the existing Beads state before creating duplicates. Start with `bd list --json --tree=false` and `bd ready --json`.",
    "2. If this is one concrete task, create one issue. If it is broad, split it into a small dependency-aware set of issues.",
    "3. Use `bd create --title ... --description ... --priority ... --labels ...` for new work. Prefer actionable titles and descriptions with acceptance criteria.",
    "4. If dependencies or labels need exact syntax, check `bd help` first instead of guessing.",
    "5. Do not implement the work yet unless I explicitly ask. End by listing the issue IDs you created and tell me to return to the board and press Refresh.",
  )
  if (input.priority !== undefined || input.labels?.length) {
    lines.push("", "Defaults to apply when they make sense:")
    if (input.priority !== undefined) lines.push(`- priority: P${input.priority}`)
    if (input.labels?.length) lines.push(`- labels: ${input.labels.join(", ")}`)
  }
  return lines.join("\n")
}

function timestampValue(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return input > 10_000_000_000 ? input : input * 1000
  if (typeof input !== "string" || input.trim().length === 0) return
  const numeric = Number(input)
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000
  const parsed = Date.parse(input)
  return Number.isFinite(parsed) ? parsed : undefined
}

function issueTimestamp(issue: BeadsIssue, keys: string[]) {
  for (const key of keys) {
    const value = timestampValue(issue.raw[key])
    if (value !== undefined) return value
  }
}

function closedSortTimestamp(card: AgentBoardCard) {
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

function promptSnapshotCards(column: AgentBoardBoard["columns"][number]) {
  if (column.id !== "closed") return column.cards
  return [...column.cards].sort(
    (a, b) => closedSortTimestamp(b) - closedSortTimestamp(a) || a.issue.id.localeCompare(b.issue.id),
  )
}

function agentBoardSuggestionPrompt(current: AgentBoardBoard | undefined) {
  const lines = [
    "You are helping improve this project.",
    "",
    "Goal:",
    "Inspect the current Beads tracker and the codebase, then suggest the next useful tickets.",
    "",
    "Start by gathering context:",
    "1. Run `bd list --json --tree=false` and `bd ready --json` to understand current work and avoid duplicates.",
    "2. Inspect the repository structure and recent changes enough to identify real gaps, not generic chores.",
    "3. Look for small, demoable improvements, obvious bugs, missing tests, UX polish, or integration gaps.",
    "",
    "Important:",
    "- Do not create issues yet.",
    "- First propose 5-8 candidate tickets.",
    "- For each ticket include title, why it matters, acceptance criteria, suggested priority, and dependencies if any.",
    "- Prefer work that can make the project more useful, more delightful, or more shippable within one focused agent run.",
    "- End by asking which tickets I want you to create in Beads.",
  ]

  if (current?.columns.length) {
    lines.push("", "Current Beads board snapshot:")
    for (const column of current.columns) {
      const cards = promptSnapshotCards(column)
      const detail = column.id === "closed" ? " (most recently closed first)" : ""
      lines.push(`- ${column.title}: ${cards.length}${detail}`)
      for (const card of cards.slice(0, 5)) {
        const status = visibleStatus(card)
        const priority = card.issue.priority !== undefined ? `P${card.issue.priority}` : "no priority"
        lines.push(`  - ${card.issue.id} [${status}, ${priority}]: ${card.issue.title}`)
      }
      if (cards.length > 5) lines.push(`  - ...${cards.length - 5} more`)
    }
  }

  return lines.join("\n")
}

function agentBoardIssueChatPrompt(input: { issue: BeadsIssue; column?: AgentBoardColumnID }) {
  const labels = issueLabels(input.issue)
  const priority = input.issue.priority !== undefined ? `P${input.issue.priority}` : "unset"
  const status = input.issue.status || input.column || "open"
  const lines = [
    "Please implement this Beads issue.",
    "",
    `Issue: ${input.issue.id}`,
    `Title: ${input.issue.title}`,
    `Status: ${status}`,
    `Priority: ${priority}`,
  ]
  if (labels.length) lines.push(`Labels: ${labels.join(", ")}`)
  if (input.issue.description?.trim()) {
    lines.push("", "Description:", input.issue.description.trim())
  }
  lines.push(
    "",
    "Workflow:",
    `1. Inspect the issue first with \`bd show ${input.issue.id}\` or the closest supported Beads command.`,
    "2. Use the codebase context to implement the issue with the smallest coherent patch.",
    "3. Run the most relevant tests or checks you can.",
    "4. Update Beads status/comments when appropriate. If the exact bd syntax differs, check `bd help` instead of guessing.",
    "5. End with a concise summary of files changed, tests run, and any follow-up needed.",
  )
  return lines.join("\n")
}

function agentBoardSetupPrompt() {
  return [
    "Help me set up Beads for this project so AgentBoard can work.",
    "",
    "Please:",
    "1. Check whether the `bd` CLI is installed and available on PATH.",
    "2. If it is not installed, explain the safest install option for this machine and ask before making system changes.",
    "3. If it is installed, initialize Beads in this project with `bd init`.",
    "4. Run a quick Beads command such as `bd list --json --tree=false` or `bd doctor` to verify it works.",
    "5. End with what changed and what I should do next in AgentBoard.",
    "",
    "If the Codex Beads skill is needed, use or install it. The user mentioned `npx skills beads` as a possible path.",
  ].join("\n")
}

export default function AgentBoardPage() {
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const navigate = useNavigate()
  const [board, setBoard] = createSignal<AgentBoardBoard>()
  const [selectedID, setSelectedID] = createSignal<string>()
  const [loading, setLoading] = createSignal(true)
  const [initializing, setInitializing] = createSignal(false)
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const [initError, setInitError] = createSignal<string>()
  const [activeDrag, setActiveDrag] = createSignal<string>()
  const [activeDragOrigin, setActiveDragOrigin] = createSignal<AgentBoardColumnID>()
  const [activeDropTarget, setActiveDropTarget] = createSignal<AgentBoardColumnID>()
  const [activeDropPlacement, setActiveDropPlacement] = createSignal<BoardDropPlacement>()
  const [activeColumnDropPlacement, setActiveColumnDropPlacement] = createSignal<ColumnDropPlacement>()
  const [dragSnapshot, setDragSnapshot] = createSignal<AgentBoardBoard>()
  const [cardDragPointer, setCardDragPointer] = createSignal<{ x: number; y: number }>()
  let pendingCardDrag: PendingCardDrag | undefined
  const [dragPreviewWidth, setDragPreviewWidth] = createSignal<number>()
  const [dragPlaceholderHeight, setDragPlaceholderHeight] = createSignal<number>()
  const [activeColumnDrag, setActiveColumnDrag] = createSignal<AgentBoardColumnID>()
  const [boardOrder, setBoardOrder] = createSignal<BoardLocalOrder>(loadBoardOrder(sdk.directory))
  const [query, setQuery] = createSignal("")
  const [timelineOnly, setTimelineOnly] = createSignal(false)
  const [viewMode, setViewMode] = createSignal<AgentBoardViewMode>("board")
  const [activeEpicID, setActiveEpicID] = createSignal<string>()
  const [drawerTab, setDrawerTab] = createSignal<DrawerTab>("details")
  const [drawerID, setDrawerID] = createSignal<string>()
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const [titlebarCenterMount, setTitlebarCenterMount] = createSignal<HTMLElement | null>(null)
  const [titlebarRightMount, setTitlebarRightMount] = createSignal<HTMLElement | null>(null)
  const [notifyEnabled, setNotifyEnabled] = createSignal(false)
  const [notifyPermission, setNotifyPermission] = createSignal<NotificationPermission>("default")
  let searchRef: HTMLInputElement | undefined
  let lastRunStatus = new Map<string, string>()
  let initialized = false
  let loadVersion = 0
  const openNotifications = new Set<Notification>()

  const client = createMemo(() => {
    if (!server.current) throw new Error("No active OpenCode server")
    return createAgentBoardClient({ server: server.current.http, directory: sdk.directory })
  })

  const selected = createMemo(() => {
    const id = selectedID()
    if (!id) return
    return findCard(board(), id)
  })
  const drawerCard = createMemo(() => {
    const id = drawerID()
    if (!id) return
    return findCard(board(), id)
  })
  const activeDragCard = createMemo(() => findCard(dragSnapshot() ?? board(), activeDrag()))
  const cardDragPoint = createMemo(() => {
    const point = cardDragPointer()
    const offset = boardDragGrabOffset
    const size = boardDragSourceSize
    if (!point || !offset || !size) return
    return { point, offset, width: size.width, height: size.height }
  })
  const activeCardDragLayer = createMemo(() => {
    const card = activeDragCard()
    const drag = cardDragPoint()
    if (!card || !drag) return
    return { card, ...drag }
  })
  const activeColumnPreview = createMemo(() => {
    const column = activeColumnDrag()
    if (!column) return
    return (dragSnapshot() ?? board())?.columns.find((item) => item.id === column)
  })
  const allCards = createMemo(() => board()?.columns.flatMap((column) => column.cards) ?? [])
  const stats = createMemo(() => {
    const current = board()
    const cards = allCards()
    const get = (id: AgentBoardColumnID) => current?.columns.find((column) => column.id === id)?.cards.length ?? 0
    return {
      total: cards.length,
      ready: get("ready"),
      running: get("running"),
      review: get("needs_review"),
      failed: cards.filter((card) => card.latestRun?.status === "failed").length,
    }
  })
  const readyCards = createMemo(() => board()?.columns.find((column) => column.id === "ready")?.cards ?? [])
  const isBoardEmpty = createMemo(() => allCards().length === 0)
  const knownLabels = createMemo(() => {
    const counts = new Map<string, number>()
    for (const card of allCards()) {
      for (const label of extractLabels(card)) counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label)
  })
  const epicMeta = createMemo<EpicSummary[]>(() => {
    const cards = allCards()
    const deps = board()?.graph.dependencies ?? []
    const idToCard = new Map(cards.map((card) => [card.issue.id, card] as const))
    return cards
      .filter((card) => issueType(card.issue) === "epic")
      .map((card) => {
        const childIDs = buildEpicChildren(deps, cards, card.issue.id)
        let closed = 0
        for (const id of childIDs) {
          const child = idToCard.get(id)
          if (child?.column === "closed") closed++
        }
        return {
          id: card.issue.id,
          title: card.issue.title,
          childCount: childIDs.size,
          closedCount: closed,
          childIDs,
        }
      })
      .filter((epic) => epic.childCount > 0)
      .sort((a, b) => a.title.localeCompare(b.title))
  })
  const activeEpic = createMemo(() => {
    const id = activeEpicID()
    if (!id) return undefined
    return epicMeta().find((meta) => meta.id === id)
  })
  createEffect(() => {
    const id = activeEpicID()
    if (!id) return
    if (epicMeta().some((meta) => meta.id === id)) return
    setActiveEpicID(undefined)
  })
  const filteredColumns = createMemo(() => {
    const term = query().trim().toLowerCase()
    const current = board()
    const childIDs = activeEpic()?.childIDs
    if (!current) return []
    return current.columns.map((column) => ({
      ...column,
      cards: column.cards.filter((card) => {
        if (issueType(card.issue) === "epic") return false
        if (childIDs && !childIDs.has(card.issue.id)) return false
        if (timelineOnly() && card.events.length === 0) return false
        if (!term) return true
        const haystack = [
          card.issue.id,
          card.issue.title,
          card.issue.description,
          card.issue.status,
          card.latestRun?.status,
          card.latestRun?.agent,
          card.latestRun?.model,
          latestEvent(card)?.message,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(term)
      }),
    }))
  })
  const visibleCardCount = createMemo(() => filteredColumns().reduce((total, column) => total + column.cards.length, 0))
  let drawerTimer: number | undefined
  let drawerFrame: number | undefined
  let lastValidDragTarget: BoardDragTarget | undefined
  let lastDragKey: string | undefined

  createEffect(() => {
    const id = selectedID()
    if (drawerTimer !== undefined) {
      window.clearTimeout(drawerTimer)
      drawerTimer = undefined
    }
    if (drawerFrame !== undefined) {
      window.cancelAnimationFrame(drawerFrame)
      drawerFrame = undefined
    }
    if (id) {
      setDrawerID(id)
      drawerFrame = window.requestAnimationFrame(() => {
        drawerFrame = undefined
        setDrawerOpen(true)
      })
      return
    }
    setDrawerOpen(false)
    drawerTimer = window.setTimeout(() => {
      setDrawerID(undefined)
      drawerTimer = undefined
    }, 260)
  })

  function notifyRunTransition(card: AgentBoardCard) {
    const run = card.latestRun
    if (!run) return
    if (typeof Notification === "undefined") return
    if (Notification.permission !== "granted") return
    const title = `${NOTIFY_TITLES[run.status] ?? "Run updated"} · ${card.issue.id}`
    const body = run.status === "failed" && run.error ? run.error : card.issue.title
    try {
      const notification = new Notification(title, {
        body,
        tag: `agentboard:${run.id}:${run.status}`,
        silent: false,
      })
      openNotifications.add(notification)
      notification.onclick = () => {
        window.focus()
        selectCard(card.issue.id)
        setDrawerTab(run.status === "failed" || run.status === "needs_review" ? "timeline" : "details")
        notification.close()
      }
      notification.onclose = () => openNotifications.delete(notification)
    } catch {
      // Some platforms throw if the page isn't a secure context — ignore
    }
  }

  function processTransitions(next: AgentBoardBoard) {
    const cards = next.columns.flatMap((column) => column.cards)
    const nextStatus = new Map<string, string>()
    for (const card of cards) {
      if (card.latestRun) nextStatus.set(card.latestRun.id, card.latestRun.status)
    }
    if (initialized && notifyEnabled()) {
      for (const card of cards) {
        const run = card.latestRun
        if (!run) continue
        const previous = lastRunStatus.get(run.id)
        if (previous === run.status) continue
        if (NOTIFY_STATUSES.has(run.status)) notifyRunTransition(card)
      }
    }
    lastRunStatus = nextStatus
    initialized = true
  }

  function setOrderedBoard(next: AgentBoardBoard) {
    const ordered = applyBoardOrder(next, boardOrder())
    processTransitions(ordered)
    setBoard(ordered)
    return ordered
  }

  function commitPresentationOrder(next: AgentBoardBoard) {
    const order = orderFromBoard(next)
    setBoardOrder(order)
    saveBoardOrder(sdk.directory, order)
    setBoard(next)
  }

  async function load(silent = false) {
    if (silent && (activeDrag() || activeColumnDrag())) return
    const version = ++loadVersion
    if (!silent) setLoading(true)
    try {
      const next = await client().board()
      if (version !== loadVersion) return
      const ordered = setOrderedBoard(next)
      setError(undefined)
      setInitError(undefined)
      const cards = ordered.columns.flatMap((column) => column.cards)
      if (selectedID() && !cards.some((card) => card.issue.id === selectedID())) setSelectedID(undefined)
    } catch (err) {
      if (version !== loadVersion) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      if (!silent) showToast({ variant: "error", title: "AgentBoard failed", description: message })
    } finally {
      if (version === loadVersion) setLoading(false)
    }
  }

  async function toggleNotifications() {
    if (typeof Notification === "undefined") {
      showToast({
        variant: "error",
        title: "Notifications not supported",
        description: "This browser does not support desktop notifications.",
      })
      return
    }
    if (notifyEnabled()) {
      setNotifyEnabled(false)
      try {
        localStorage.setItem(NOTIFY_STORAGE_KEY, "false")
      } catch {
        /* storage might be unavailable */
      }
      return
    }
    let permission = Notification.permission
    if (permission === "default") {
      permission = await Notification.requestPermission()
      setNotifyPermission(permission)
    }
    if (permission !== "granted") {
      showToast({
        variant: "error",
        title: "Notifications blocked",
        description: "Allow notifications for this site in your browser settings, then try again.",
      })
      return
    }
    setNotifyEnabled(true)
    try {
      localStorage.setItem(NOTIFY_STORAGE_KEY, "true")
    } catch {
      /* storage might be unavailable */
    }
    showToast({
      variant: "success",
      title: "Notifications on",
      description: "We'll ping you when an agent needs review or fails.",
    })
  }

  async function initBeads() {
    setInitializing(true)
    setInitError(undefined)
    try {
      await client().initBeads()
      await load(true)
      showToast({
        variant: "success",
        title: "Beads initialized",
        description: "AgentBoard is ready for this project.",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setInitError(
        `Could not initialize Beads. Make sure the bd CLI is installed and available, then try again. ${message}`,
      )
      showToast({ variant: "error", title: "Beads init failed", description: message })
    } finally {
      setInitializing(false)
    }
  }

  function openSession(sessionID: string) {
    navigate(`/${base64Encode(sdk.directory)}/session/${sessionID}`)
  }

  function planInChat(input: ComposerDraft) {
    const slug = base64Encode(sdk.directory)
    const prompt = agentBoardPlanningPrompt(input)
    setSessionHandoff(slug, { prompt })
    navigate(`/${slug}/session?prompt=${encodeURIComponent(prompt)}`)
  }

  function suggestInChat() {
    const slug = base64Encode(sdk.directory)
    const prompt = agentBoardSuggestionPrompt(board())
    setSessionHandoff(slug, { prompt })
    navigate(`/${slug}/session?prompt=${encodeURIComponent(prompt)}`)
  }

  function setupInChat() {
    const slug = base64Encode(sdk.directory)
    const prompt = agentBoardSetupPrompt()
    setSessionHandoff(slug, { prompt })
    navigate(`/${slug}/session?prompt=${encodeURIComponent(prompt)}`)
  }

  function openIssueChat(issueID: string, fallbackIssue?: BeadsIssue) {
    const card = findCard(board(), issueID)
    const issue = card?.issue ?? fallbackIssue
    if (!issue) {
      showToast({
        variant: "error",
        title: "Could not open chat",
        description: "Refresh the board and try again.",
      })
      return
    }
    const slug = base64Encode(sdk.directory)
    const prompt = agentBoardIssueChatPrompt({ issue, column: card?.column })
    setSessionHandoff(slug, { prompt })
    navigate(`/${slug}/session?prompt=${encodeURIComponent(prompt)}`)
  }

  function selectCard(issueID: string | undefined) {
    setSelectedID(issueID)
    setDrawerTab("details")
  }

  async function createIssue(input: ComposerSubmit) {
    try {
      const result = await client().createIssue({
        title: input.title,
        description: input.description,
        priority: input.priority,
        labels: input.labels,
        runImmediately: false,
      })
      await load(true)
      const issueID = result.issue.id
      if (issueID) selectCard(issueID)
      if (input.runImmediately && issueID) {
        openIssueChat(issueID, result.issue)
        return
      }
      showToast({
        variant: "success",
        title: `Filed ${issueID || "issue"}`,
        description: "Stays in Ready until you open a chat or move it.",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isMissingRoute = /404|not found/i.test(message)
      showToast({
        variant: "error",
        title: isMissingRoute ? "Issue creation isn't wired up yet" : "Could not file issue",
        description: isMissingRoute
          ? "The frontend is ready — finish the POST /agentboard/issues route to enable filing."
          : message,
      })
    }
  }

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      await load(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: "AgentBoard action failed", description: message })
      await load(true)
    } finally {
      setBusy(undefined)
    }
  }

  function handleDragStart(event: DragEvent) {
    const dragID = getDraggableId(event)
    const columnID = parseColumnDragID(dragID)
    if (columnID) {
      const element = document.querySelector<HTMLElement>(`[data-agentboard-column="${CSS.escape(columnID)}"]`)
      const rect = element?.getBoundingClientRect()
      setActiveColumnDrag(columnID)
      setDragSnapshot(board())
      setActiveDrag(undefined)
      setActiveDragOrigin(undefined)
      setActiveDropTarget(undefined)
      setActiveDropPlacement(undefined)
      setActiveColumnDropPlacement({ beforeColumnID: columnID })
      setDragPreviewWidth(rect?.width ?? boardDragSourceSize?.width)
      setDragPlaceholderHeight(rect?.height ?? boardDragSourceSize?.height)
      window.addEventListener("pointermove", trackBoardDragPointer, BOARD_POINTER_OPTIONS)
      lastValidDragTarget = undefined
      lastDragKey = undefined
      return
    }
  }

  function clearDragState(snapshot?: AgentBoardBoard) {
    cleanupCardPointerDrag()
    pendingCardDrag = undefined
    setActiveDrag(undefined)
    setActiveDragOrigin(undefined)
    setActiveDropTarget(undefined)
    setActiveDropPlacement(undefined)
    setActiveColumnDrag(undefined)
    setActiveColumnDropPlacement(undefined)
    setDragPreviewWidth(undefined)
    setDragPlaceholderHeight(undefined)
    setDragSnapshot(undefined)
    setCardDragPointer(undefined)
    boardDragPointer = undefined
    boardDragGrabOffset = undefined
    boardDragSourceSize = undefined
    stopBoardPointerTracking()
    lastValidDragTarget = undefined
    lastDragKey = undefined
    if (snapshot) setBoard(snapshot)
  }

  function placeColumn(active: AgentBoardColumnID, before?: AgentBoardColumnID) {
    const columns = insertArrayItemBefore(normalizeColumnOrder(boardOrder().columns), active, before)
    const nextOrder = {
      ...boardOrder(),
      columns,
    }
    setBoardOrder(nextOrder)
    const current = board()
    if (current) setBoard(applyBoardOrder(current, nextOrder))
    return nextOrder
  }

  function dragPoint() {
    return boardDragPointer
  }

  function boardColumnRects(exclude?: AgentBoardColumnID) {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-agentboard-column]"))
      .map((element) => {
        const id = element.dataset.agentboardColumn
        if (!id || !isBoardColumnID(id) || id === exclude) return
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        return { id, rect }
      })
      .filter((item): item is { id: AgentBoardColumnID; rect: DOMRect } => !!item)
      .sort((a, b) => a.rect.left - b.rect.left)
  }

  function columnIDAtPoint(point: { x: number; y: number }): AgentBoardColumnID | undefined {
    const columns = boardColumnRects()
    if (!columns.length) return
    const direct = columns.find(
      (column) =>
        point.x >= column.rect.left &&
        point.x <= column.rect.right &&
        point.y >= column.rect.top &&
        point.y <= column.rect.bottom,
    )
    if (direct) return direct.id

    const horizontal = columns.find((column) => point.x >= column.rect.left && point.x <= column.rect.right)
    if (horizontal) return horizontal.id

    if (point.x < columns[0].rect.left) return columns[0].id
    const last = columns.at(-1)!
    if (point.x > last.rect.right) return last.id

    for (let index = 0; index < columns.length - 1; index++) {
      const current = columns[index]
      const next = columns[index + 1]
      if (point.x > current.rect.right && point.x < next.rect.left) {
        return point.x < current.rect.right + (next.rect.left - current.rect.right) / 2 ? current.id : next.id
      }
    }
  }

  function beforeColumnIDAtPoint(moving: AgentBoardColumnID) {
    const point = dragPoint()
    if (!point) return activeColumnDropPlacement()?.beforeColumnID ?? moving
    const columns = boardColumnRects(moving)
    for (let index = 0; index < columns.length; index++) {
      const column = columns[index]
      if (point.x < column.rect.left) return column.id
      if (point.x <= column.rect.right) {
        const next = columns[index + 1]?.id
        return point.x < column.rect.left + column.rect.width / 2 ? column.id : next
      }
    }
    return undefined
  }

  function cardInsertionPoint(point: { x: number; y: number }) {
    if (!boardDragGrabOffset || !boardDragSourceSize) return point
    return {
      x: point.x,
      y: point.y - boardDragGrabOffset.y + boardDragSourceSize.height / 2,
    }
  }

  function beforeIssueIDAtPoint(column: AgentBoardColumnID, movingIssueID: string, point: { x: number; y: number }) {
    const insertion = cardInsertionPoint(point)
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-agentboard-column="${column}"] [data-agentboard-card]`),
    ).filter((card) => card.dataset.agentboardCard !== movingIssueID)
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index]
      const issueID = card.dataset.agentboardCard
      if (!issueID) continue
      const rect = card.getBoundingClientRect()
      if (rect.height <= 0 || rect.width <= 0) continue
      if (insertion.y < rect.top) return issueID
      if (insertion.y <= rect.bottom) {
        const insertAfterCard = insertion.y >= rect.top + rect.height * CARD_INSERT_RATIO
        return insertAfterCard ? cards[index + 1]?.dataset.agentboardCard : issueID
      }
    }
    return undefined
  }

  function resolveCardDragTarget(
    issueID: string | undefined,
    source = dragSnapshot() ?? board(),
  ): BoardDragTarget | undefined {
    if (!issueID || !source) return
    const card = findCard(source, issueID)
    if (!card) return
    const point = dragPoint()
    if (!point) return
    const target = columnIDAtPoint(point)
    if (!target) return
    return {
      current: source,
      card,
      issueID,
      target,
      beforeIssueID: beforeIssueIDAtPoint(target, issueID, point),
    }
  }

  function updateCardDropTarget(issueID = activeDrag()) {
    const target = resolveCardDragTarget(issueID)
    if (!target) {
      setActiveDropTarget(undefined)
      setActiveDropPlacement(undefined)
      lastValidDragTarget = undefined
      lastDragKey = undefined
      return
    }
    const key = `${target.issueID}:${target.target}:${target.beforeIssueID ?? ""}`
    if (key === lastDragKey) return
    lastDragKey = key
    const original = findCard(dragSnapshot(), target.issueID) ?? target.card
    const move = canMoveCardTo(original, target.target, { allowSameColumn: true })
    if (!move.ok) {
      setActiveDropTarget(undefined)
      setActiveDropPlacement(undefined)
      lastValidDragTarget = undefined
      lastDragKey = undefined
      return
    }
    setActiveDropTarget(target.target)
    setActiveDropPlacement({ column: target.target, beforeIssueID: target.beforeIssueID })
    lastValidDragTarget = target
  }

  function startCardDrag(event: PointerEvent, card: AgentBoardCard) {
    if (event.button !== 0) return
    const element =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.closest<HTMLElement>("[data-agentboard-card]")
        : undefined
    const rect = element?.getBoundingClientRect()
    const current = board()
    if (!rect || !current) return
    pendingCardDrag = {
      card,
      current,
      rect,
      startX: event.clientX,
      startY: event.clientY,
    }
    window.addEventListener("pointermove", handleCardPointerMove, BOARD_POINTER_OPTIONS)
    window.addEventListener("pointerup", handleCardPointerUp, BOARD_POINTER_OPTIONS)
  }

  function activatePendingCardDrag(event: PointerEvent, pending: PendingCardDrag) {
    event.preventDefault()
    event.stopPropagation()
    boardDragPointer = { x: event.clientX, y: event.clientY }
    setCardDragPointer(boardDragPointer)
    boardDragGrabOffset = { x: pending.startX - pending.rect.left, y: pending.startY - pending.rect.top }
    boardDragSourceSize = { width: pending.rect.width, height: pending.rect.height }
    setActiveDrag(pending.card.issue.id)
    setActiveDragOrigin(pending.card.column)
    setActiveDropTarget(pending.card.column)
    setActiveDropPlacement({ column: pending.card.column, beforeIssueID: pending.card.issue.id })
    setActiveColumnDropPlacement(undefined)
    setDragPreviewWidth(pending.rect.width)
    setDragPlaceholderHeight(pending.rect.height)
    setDragSnapshot(pending.current)
    lastValidDragTarget = undefined
    lastDragKey = undefined
    pendingCardDrag = undefined
    updateCardDropTarget(pending.card.issue.id)
  }

  function cleanupCardPointerDrag() {
    window.removeEventListener("pointermove", handleCardPointerMove, BOARD_POINTER_OPTIONS)
    window.removeEventListener("pointerup", handleCardPointerUp, BOARD_POINTER_OPTIONS)
  }

  function handleCardPointerMove(event: PointerEvent) {
    const pending = pendingCardDrag
    if (pending && !activeDrag()) {
      const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY)
      if (moved < CARD_DRAG_THRESHOLD) return
      activatePendingCardDrag(event, pending)
    }
    if (!activeDrag()) return
    event.preventDefault()
    trackBoardDragPointer(event)
    setCardDragPointer(boardDragPointer)
    updateCardDropTarget()
  }

  function finishCardDrag(event?: PointerEvent) {
    if (event) {
      trackBoardDragPointer(event)
      setCardDragPointer(boardDragPointer)
    }
    cleanupCardPointerDrag()
    const snapshot = dragSnapshot()
    const issueID = activeDrag()
    const target = resolveCardDragTarget(issueID, snapshot ?? board()) ?? lastValidDragTarget
    const origin = activeDragOrigin()
    if (!target) {
      clearDragState(snapshot)
      return
    }
    const original = findCard(snapshot, target.issueID) ?? target.card
    const move = canMoveCardTo(original, target.target, { allowSameColumn: true })
    if (!move.ok) {
      showToast({ variant: "error", title: "Cannot move card", description: move.reason })
      clearDragState(snapshot)
      return
    }
    clearDragState()
    const current = snapshot ?? board() ?? target.current
    const next = moveCardOnBoard(current, target.issueID, target.target, target.beforeIssueID)
    commitPresentationOrder(next)
    const moved = findCard(next, target.issueID)
    if (origin && moved && origin !== moved.column) {
      void act(target.issueID, () => client().moveCard(target.issueID, moved.column))
    }
  }

  function handleCardPointerUp(event: PointerEvent) {
    if (pendingCardDrag && !activeDrag()) {
      pendingCardDrag = undefined
      cleanupCardPointerDrag()
      return
    }
    if (!activeDrag()) {
      cleanupCardPointerDrag()
      return
    }
    event.preventDefault()
    finishCardDrag(event)
  }

  function handleDragMove(event: DragEvent) {
    const columnID = activeColumnDrag()
    if (columnID) {
      const point = dragPoint()
      const target = point ? columnIDAtPoint(point) : undefined
      setActiveDropTarget(target)
      setActiveColumnDropPlacement({ beforeColumnID: beforeColumnIDAtPoint(columnID) })
      return
    }
  }

  function handleDragEnd(_event: DragEvent) {
    const columnID = activeColumnDrag()
    if (columnID) {
      const nextOrder = placeColumn(columnID, beforeColumnIDAtPoint(columnID))
      saveBoardOrder(sdk.directory, nextOrder)
      clearDragState()
      return
    }

    if (activeDrag()) finishCardDrag()
  }

  function handleAdvance(issueID: string, target: AgentBoardColumnID) {
    const current = board()
    const card = findCard(current, issueID)
    if (!card) return
    const move = canMoveCardTo(card, target)
    if (!move.ok) {
      showToast({ variant: "error", title: "Cannot move card", description: move.reason })
      return
    }
    if (current) commitPresentationOrder(moveCardOnBoard(current, issueID, target))
    void act(issueID, () => client().moveCard(issueID, target))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
    event.preventDefault()
    searchRef?.focus()
    searchRef?.select()
  }

  onMount(() => {
    setTitlebarCenterMount(document.getElementById("opencode-titlebar-center"))
    setTitlebarRightMount(document.getElementById("opencode-titlebar-right"))
    if (typeof Notification !== "undefined") {
      setNotifyPermission(Notification.permission)
      try {
        const stored = localStorage.getItem(NOTIFY_STORAGE_KEY) === "true"
        if (stored && Notification.permission === "granted") setNotifyEnabled(true)
      } catch {
        /* storage might be unavailable */
      }
    }
    void load()
    const controller = new AbortController()
    void client()
      .events(controller.signal, (event) => {
        if (event.type === "board.updated" || event.type === "run.updated") void load(true)
      })
      .catch(() => undefined)
    const fallback = setInterval(() => void load(true), 15000)
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      controller.abort()
      clearInterval(fallback)
      if (drawerTimer !== undefined) window.clearTimeout(drawerTimer)
      if (drawerFrame !== undefined) window.cancelAnimationFrame(drawerFrame)
      window.removeEventListener("keydown", onKeyDown)
      cleanupCardPointerDrag()
      stopBoardPointerTracking()
      boardDragPointer = undefined
      boardDragGrabOffset = undefined
      for (const notification of openNotifications) notification.close()
      openNotifications.clear()
    })
  })

  const modeSwitch = () => (
    <div class="hidden h-6 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel shadow-xs-border-base md:flex">
      <For
        each={
          [
            { id: "board" as const, label: "Board", icon: "checklist" as const },
            { id: "list" as const, label: "List", icon: "bullet-list" as const },
            { id: "graph" as const, label: "Graph", icon: "branch" as const },
          ] as const
        }
      >
        {(value) => (
          <button
            type="button"
            class="inline-flex h-full items-center gap-1.5 border-r border-border-weak-base px-2 text-10-semibold transition-colors last:border-r-0 [&_[data-component=icon]]:text-inherit"
            classList={{
              "bg-surface-raised-base-active text-text-strong": viewMode() === value.id,
              "text-text-weak hover:bg-surface-raised-base hover:text-text-base": viewMode() !== value.id,
            }}
            onClick={() => setViewMode(value.id)}
          >
            <Icon name={value.icon} size="small" class="size-3" />
            <span>{value.label}</span>
          </button>
        )}
      </For>
    </div>
  )

  return (
    <>
      <Show when={titlebarCenterMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <SearchField
              value={query()}
              visible={visibleCardCount()}
              total={stats().total}
              onInput={(value) => {
                setQuery(value)
              }}
              onClear={() => setQuery("")}
            />
          </Portal>
        )}
      </Show>
      <Show when={titlebarRightMount()}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <Show when={epicMeta().length > 0}>
                <EpicFilterMenu
                  epics={epicMeta()}
                  activeID={activeEpicID()}
                  onSelect={(id) => setActiveEpicID(id)}
                />
              </Show>
              {/* Temporary timeline debug filter; keep the state wired for quick local debugging.
              <Button
                variant={timelineOnly() ? "secondary" : "ghost"}
                size="small"
                class="h-6 px-2 text-10-semibold"
                onClick={() => setTimelineOnly(!timelineOnly())}
                aria-pressed={timelineOnly()}
                title="Temporary debug filter: show only cards with timeline events"
              >
                Timeline
              </Button>
              */}
              <Button
                variant="ghost"
                icon="reset"
                class="titlebar-icon h-6 w-8 p-0"
                onClick={() => void load()}
                disabled={loading()}
                aria-label="Refresh AgentBoard"
                title="Refresh AgentBoard"
              >
              </Button>
              {modeSwitch()}
            </div>
          </Portal>
        )}
      </Show>
      <div class="isolate flex size-full min-h-0 bg-background-base text-text-base">
      <main class="flex min-w-0 flex-1 flex-col">
        <Show when={!titlebarCenterMount() || !titlebarRightMount()}>
        <header class="shrink-0 border-b border-border-weaker-base bg-background-base px-5 py-3">
          <div class="flex items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-2.5">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-text-strong shadow-xs-border-base">
                <Icon name="checklist" class="size-3.5" />
              </div>
              <div class="flex min-w-0 items-center gap-2">
                <h1 class="text-14-semibold text-text-strong">AgentBoard</h1>
              </div>
            </div>

            <div class="flex shrink-0 items-center gap-2">
              <Show when={!titlebarCenterMount()}>
                <SearchField
                  value={query()}
                  visible={visibleCardCount()}
                  total={stats().total}
                  onInput={(value) => {
                    setQuery(value)
                  }}
                  onClear={() => setQuery("")}
                />
              </Show>
              <Show when={!titlebarRightMount()}>
                <Show when={epicMeta().length > 0}>
                  <EpicFilterMenu
                    epics={epicMeta()}
                    activeID={activeEpicID()}
                    onSelect={(id) => setActiveEpicID(id)}
                  />
                </Show>
                <Button variant="secondary" size="small" icon="reset" onClick={() => void load()} disabled={loading()}>
                  Refresh
                </Button>
                {/* Temporary timeline debug filter; keep the state wired for quick local debugging.
                <Button
                  variant={timelineOnly() ? "secondary" : "ghost"}
                  size="small"
                  onClick={() => setTimelineOnly(!timelineOnly())}
                  aria-pressed={timelineOnly()}
                  title="Temporary debug filter: show only cards with timeline events"
                >
                  Timeline
                </Button>
                */}
                {modeSwitch()}
              </Show>
            </div>
          </div>
        </header>
        </Show>

        <div class="min-h-0 flex-1 overflow-hidden">
          <Show
            when={board()}
            fallback={
              loading() ? (
                <LoadingState />
              ) : (
                <SetupState
                  error={error()}
                  initError={initError()}
                  initializing={initializing()}
                  onInit={() => void initBeads()}
                  onChat={setupInChat}
                  onDocs={() => platform.openLink(BEADS_DOCS_URL)}
                />
              )
            }
          >
            {(current) => (
              <Show
                when={!isBoardEmpty()}
                fallback={
                  <div class="flex h-full items-center justify-center px-6 py-10">
                    <div class="w-full max-w-2xl">
                      <div class="mb-6 flex flex-col items-center text-center">
                        <div class="mb-4 flex size-12 items-center justify-center rounded-xl bg-surface-raised-base text-text-strong shadow-md">
                          <Icon name="checklist" class="size-5" />
                        </div>
                        <h2 class="text-20-medium text-text-strong [text-wrap:balance]">
                          Tell AgentBoard what to work on.
                        </h2>
                        <p class="mt-2 max-w-md text-13-regular leading-relaxed text-text-weak">
                          Type a task below.{" "}
                          <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono text-11-regular">⏎</kbd>{" "}
                          files it.{" "}
                          <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono text-11-regular">⌘⏎</kbd>{" "}
                          files it and opens a chat with the issue context.
                        </p>
                      </div>
                      <IssueComposer
                        variant="hero"
                        knownLabels={knownLabels()}
                        busy={!!busy()}
                        onSubmit={createIssue}
                        onPlan={planInChat}
                        onSuggest={suggestInChat}
                      />
                    </div>
                  </div>
                }
              >
                <div class="flex h-full flex-col">
                  <div class="min-h-0 flex-1">
                <Show
                  when={viewMode() === "graph"}
                  fallback={
                    <Show
                      when={viewMode() === "list"}
                      fallback={
                        <DragDropProvider
                          onDragStart={handleDragStart}
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
                        >
                          <DragDropSensors />
                          <div class="flex h-full flex-col">
                            <div class="min-h-0 flex-1 overflow-x-auto p-4">
                              <div class="grid h-full min-w-[1200px] grid-cols-5 gap-3">
                                <For each={filteredColumns()}>
                                  {(column) => (
                                    <>
                                      <Show
                                        when={
                                          activeColumnDrag() &&
                                          activeColumnDropPlacement()?.beforeColumnID === column.id
                                        }
                                      >
                                        <ColumnDropPlaceholder height={dragPlaceholderHeight()} />
                                      </Show>
                                      <BoardColumn
                                        column={column}
                                        selectedID={selectedID()}
                                        busy={busy()}
                                        activeDrag={activeDrag()}
                                        activeDragCard={activeDragCard()}
                                        activeColumnDrag={activeColumnDrag()}
                                        activeTarget={activeDropTarget()}
                                        dropPlacement={activeDropPlacement()}
                                        placeholderHeight={dragPlaceholderHeight()}
                                        onSelect={selectCard}
                                        onChat={openIssueChat}
                                        onAdvance={handleAdvance}
                                        onCardDragStart={startCardDrag}
                                      />
                                    </>
                                  )}
                                </For>
                                <Show when={activeColumnDrag() && !activeColumnDropPlacement()?.beforeColumnID}>
                                  <ColumnDropPlaceholder height={dragPlaceholderHeight()} />
                                </Show>
                              </div>
                            </div>
                            <div class="shrink-0 border-t border-border-weaker-base bg-background-base px-4 py-3">
                              <IssueComposer
                                variant="inline"
                                knownLabels={knownLabels()}
                                busy={!!busy()}
                                onSubmit={createIssue}
                                onPlan={planInChat}
                                onSuggest={suggestInChat}
                              />
                            </div>
                          </div>
                          <Portal>
                            <Show when={activeCardDragLayer()}>
                              {(drag) => (
                                <CardDragLayer
                                  card={drag().card}
                                  point={drag().point}
                                  offset={drag().offset}
                                  width={drag().width}
                                  height={drag().height}
                                />
                              )}
                            </Show>
                            <DragOverlay
                              class="pointer-events-none z-[10000]"
                              style={{
                                "z-index": 10000,
                                "pointer-events": "none",
                                "min-width": dragPreviewWidth() ? `${dragPreviewWidth()}px` : undefined,
                                "min-height": dragPlaceholderHeight() ? `${dragPlaceholderHeight()}px` : undefined,
                              }}
                            >
                              {(draggable) => {
                                const dragID = draggable?.id?.toString()
                                const columnID = parseColumnDragID(dragID)
                                const column = columnID
                                  ? (dragSnapshot() ?? board())?.columns.find((item) => item.id === columnID)
                                  : undefined
                                return (
                                  <Show when={column}>
                                    {(value) => (
                                      <ColumnPreview
                                        column={value()}
                                        width={dragPreviewWidth()}
                                        height={dragPlaceholderHeight()}
                                      />
                                    )}
                                  </Show>
                                )
                              }}
                            </DragOverlay>
                          </Portal>
                        </DragDropProvider>
                      }
                    >
                      <BoardListView
                        columns={filteredColumns()}
                        dependencies={current().graph.dependencies}
                        selectedID={selectedID()}
                        busy={busy()}
                        knownLabels={knownLabels()}
                        onSelect={selectCard}
                        onChat={openIssueChat}
                        onSubmit={createIssue}
                        onPlan={planInChat}
                        onSuggest={suggestInChat}
                      />
                    </Show>
                  }
                >
                  <GraphMode
                    board={current()}
                    query={query()}
                    selectedID={selectedID()}
                    busy={busy()}
                    onSelect={selectCard}
                    onChat={openIssueChat}
                    onSavePositions={(positions) => {
                      void client()
                        .saveGraphPositions(positions)
                        .catch((err) => {
                          showToast({
                            variant: "error",
                            title: "Could not save graph layout",
                            description: err instanceof Error ? err.message : String(err),
                          })
                        })
                    }}
                  />
                </Show>
                  </div>
                </div>
              </Show>
            )}
          </Show>
        </div>
      </main>

      <Show when={drawerCard()}>
        {(card) => (
          <div
            class="h-full shrink-0 overflow-hidden transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none"
            style={{ width: drawerOpen() ? "420px" : "0px" }}
            aria-hidden={!drawerOpen()}
          >
            <DetailDrawer
              card={card()}
              busy={!!busy()}
              open={drawerOpen()}
              tab={drawerTab()}
              onTabChange={setDrawerTab}
              onClose={() => selectCard(undefined)}
              onChat={() => openIssueChat(card().issue.id)}
              onMove={(column) => {
                const move = canMoveCardTo(card(), column)
                if (!move.ok) {
                  showToast({ variant: "error", title: "Cannot move card", description: move.reason })
                  return
                }
                const current = board()
                if (current) commitPresentationOrder(moveCardOnBoard(current, card().issue.id, column))
                void act(card().issue.id, () => client().moveCard(card().issue.id, column))
              }}
              onCancel={() => {
                const run = card().latestRun
                if (run) void act(run.id, () => client().cancelRun(run.id))
              }}
              onMarkDone={() => {
                const run = card().latestRun
                if (run) void act(run.id, () => client().markDone(run.id))
              }}
              onRequestChanges={(message) => {
                const run = card().latestRun
                if (run) void act(run.id, () => client().requestChanges(run.id, message))
              }}
              onRefreshArtifacts={() => {
                const run = card().latestRun
                if (run) void act(run.id, () => client().refreshArtifacts(run.id))
              }}
              onOpenSession={() => {
                const sessionID = card().latestRun?.opencodeSessionID
                if (sessionID) navigate(`/${base64Encode(sdk.directory)}/session/${sessionID}`)
              }}
            />
          </div>
        )}
      </Show>
      </div>
    </>
  )
}
