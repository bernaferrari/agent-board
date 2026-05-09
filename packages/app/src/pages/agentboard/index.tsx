import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
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
import {
  EpicFilterMenu,
  HelpMenu,
  LoadingState,
  SetupState,
  type EpicSummary,
} from "./agentboard-controls"
import {
  BlockedStripeOverlay,
  BoardCard,
  CardDragLayer,
  ColumnDropPlaceholder,
  ColumnPreview,
  DropPlaceholder,
} from "./board-card"
import {
  currentBoardDragGeometry,
  currentBoardDragPointer,
  setBoardDragGeometry,
  setBoardDragPointer,
  startBoardPointerTracking,
  stopBoardPointerTracking,
} from "./board-dnd"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { setSessionHandoff } from "@/pages/session/handoff"
import { getDraggableId } from "@/utils/solid-dnd"
import {
  applyBoardOrder,
  insertArrayItemBefore,
  loadBoardOrder,
  normalizeColumnOrder,
  orderFromBoard,
  saveBoardOrder,
  type BoardLocalOrder,
} from "./board-order"
import {
  type AgentBoardBoard,
  type AgentBoardCard,
  type AgentBoardColumnID,
  type BeadsIssue,
  createAgentBoardClient,
} from "./api"
import { BOARD_COLUMN_IDS, canMoveCardTo, findCard, isBoardColumnID, moveCardOnBoard } from "./board-state"
import { DetailDrawer, type DrawerTab } from "./detail-drawer"
import { GraphMode, type AgentBoardViewMode } from "./graph-view"
import { IssueComposer, type ComposerDraft, type ComposerSubmit } from "./issue-composer"
import {
  buildEpicChildren,
  extractLabels,
  issueType,
} from "./issue-utils"
import { BoardListView } from "./list-view"
import {
  agentBoardIssueChatPrompt,
  agentBoardPlanningPrompt,
  agentBoardSetupPrompt,
  agentBoardSuggestionPrompt,
  BEADS_DOCS_URL,
} from "./prompts"
import { SearchField } from "./search-field"
import {
  COLUMN_ACCENT,
  COLUMN_ICON,
} from "./ui-tokens"

const NOTIFY_STORAGE_KEY = "agentboard.notify"
const COLUMN_DRAG_PREFIX = "agentboard-column:"
const NOTIFY_STATUSES = new Set(["needs_review", "failed", "done"])
const CARD_INSERT_RATIO = 0.5
const CARD_DRAG_THRESHOLD = 5
const CARD_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }
const NOTIFY_TITLES: Record<string, string> = {
  needs_review: "Ready for review",
  failed: "Run failed",
  done: "Run finished",
}
const ADVANCEMENT: Partial<Record<AgentBoardColumnID, AgentBoardColumnID>> = {
  ready: "running",
  running: "needs_review",
  needs_review: "closed",
}
type PendingCardDrag = {
  card: AgentBoardCard
  current: AgentBoardBoard
  rect: DOMRect
  startX: number
  startY: number
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

function latestEvent(card: AgentBoardCard) {
  return card.events.at(-1)
}

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

function columnDragID(column: AgentBoardColumnID) {
  return `${COLUMN_DRAG_PREFIX}${column}`
}

function parseColumnDragID(value: string | undefined) {
  if (!value?.startsWith(COLUMN_DRAG_PREFIX)) return
  const column = value.slice(COLUMN_DRAG_PREFIX.length)
  return isBoardColumnID(column) ? column : undefined
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
        "ring-1 ring-inset ring-border-weaker-base": dragging() && !targeted(),
        [`${accent().drop} ring-1 ring-inset shadow-lg ${accent().glow}`]: dragging() && targeted() && !disabled(),
        "opacity-55 ring-1 ring-inset ring-border-critical-base": dragging() && targeted() && disabled(),
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
          [accent().drop]: dragging() && targeted() && !disabled(),
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
    const { offset, size } = currentBoardDragGeometry()
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
  const searchableCards = createMemo(() => allCards().filter((card) => issueType(card.issue) !== "epic"))
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
  const searchableCardCount = createMemo(() => searchableCards().length)
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
      const { size } = currentBoardDragGeometry()
      setDragPreviewWidth(rect?.width ?? size?.width)
      setDragPlaceholderHeight(rect?.height ?? size?.height)
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
    setBoardDragPointer(undefined)
    setBoardDragGeometry({})
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
    return currentBoardDragPointer()
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
    const { offset, size } = currentBoardDragGeometry()
    if (!offset || !size) return point
    return {
      x: point.x,
      y: point.y - offset.y + size.height / 2,
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
    window.addEventListener("pointermove", handleCardPointerMove, CARD_POINTER_OPTIONS)
    window.addEventListener("pointerup", handleCardPointerUp, CARD_POINTER_OPTIONS)
  }

  function activatePendingCardDrag(event: PointerEvent, pending: PendingCardDrag) {
    event.preventDefault()
    event.stopPropagation()
    const point = { x: event.clientX, y: event.clientY }
    setBoardDragPointer(point)
    setCardDragPointer(point)
    setBoardDragGeometry({
      offset: { x: pending.startX - pending.rect.left, y: pending.startY - pending.rect.top },
      size: { width: pending.rect.width, height: pending.rect.height },
    })
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
    window.removeEventListener("pointermove", handleCardPointerMove, CARD_POINTER_OPTIONS)
    window.removeEventListener("pointerup", handleCardPointerUp, CARD_POINTER_OPTIONS)
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
    const point = { x: event.clientX, y: event.clientY }
    setBoardDragPointer(point)
    setCardDragPointer(point)
    updateCardDropTarget()
  }

  function finishCardDrag(event?: PointerEvent) {
    if (event) {
      const point = { x: event.clientX, y: event.clientY }
      setBoardDragPointer(point)
      setCardDragPointer(point)
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
      setActiveDropTarget(undefined)
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
      setBoardDragPointer(undefined)
      setBoardDragGeometry({})
      for (const notification of openNotifications) notification.close()
      openNotifications.clear()
    })
  })

  const modeSwitch = () => (
    <div class="hidden h-6 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel md:flex">
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
              total={searchableCardCount()}
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
              <HelpMenu />
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
                  total={searchableCardCount()}
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
                <HelpMenu />
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
                                        <ColumnDropPlaceholder
                                          column={activeColumnPreview()}
                                          width={dragPreviewWidth()}
                                          height={dragPlaceholderHeight()}
                                        />
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
                                  <ColumnDropPlaceholder
                                    column={activeColumnPreview()}
                                    width={dragPreviewWidth()}
                                    height={dragPlaceholderHeight()}
                                  />
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
              cards={allCards()}
              dependencies={board()?.graph.dependencies ?? []}
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
              onSelectCard={selectCard}
            />
          </div>
        )}
      </Show>
      </div>
    </>
  )
}
