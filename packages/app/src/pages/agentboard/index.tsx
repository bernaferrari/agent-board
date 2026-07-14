import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { useTitlebarRightMount } from "@/components/titlebar"
import { DragDropProvider, DragDropSensors, DragOverlay, type DragEvent } from "@thisbeyond/solid-dnd"
import { LoadingState, SetupState } from "./agentboard-controls"
import { AgentBoardChrome } from "./agentboard-chrome"
import { createAgentBoardDrawerState } from "./agentboard-drawer-state"
import { createAgentBoardHandoff } from "./agentboard-handoff"
import { createAgentBoardNotifications } from "./agentboard-notifications"
import { CardDragLayer, ColumnDropPlaceholder, ColumnPreview } from "./board-card"
import { BoardColumn, parseColumnDragID, type BoardDropPlacement } from "./board-column"
import { boardCards, boardContentKey, boardEpics, boardIssueTypes, boardLabels, filterBoard } from "./board-projection"
import {
  beforeColumnIDAtPoint as resolveBeforeColumnIDAtPoint,
  beforeIssueIDAtPoint,
  columnIDAtPoint,
  currentBoardDragGeometry,
  currentBoardDragPointer,
  setBoardDragGeometry,
  setBoardDragPointer,
  stopBoardPointerTracking,
  type BoardDragTarget,
  type ColumnDropPlacement,
  type PendingCardDrag,
} from "./board-dnd"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { getDraggableId } from "@/utils/solid-dnd"
import {
  applyBoardOrder,
  insertArrayItemBefore,
  loadBoardOrder,
  normalizeColumnOrder,
  orderFromBoard,
  saveBoardOrder,
} from "./board-order"
import { type AgentBoardBoard, type AgentBoardCard, type AgentBoardColumnID, createAgentBoardClient } from "./api"
import { canMoveCardTo, findCard, moveCardOnBoard, normalizeBoard } from "./board-state"
import { DetailDrawer, type DrawerTab } from "./detail-drawer"
import { GraphMode, type AgentBoardViewMode } from "./graph-view"
import { IssueComposer, type ComposerSubmit } from "./issue-composer"
import { issueType } from "./issue-utils"
import { BoardListView } from "./list-view"
import { BEADS_DOCS_URL } from "./prompts"

const CARD_DRAG_THRESHOLD = 5
const CARD_POINTER_OPTIONS: AddEventListenerOptions = { capture: true }

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
  const [boardOrder, setBoardOrder] = createSignal(loadBoardOrder(sdk().directory))
  const [query, setQuery] = createSignal("")
  const [viewMode, setViewMode] = createSignal<AgentBoardViewMode>("board")
  const [activeEpicID, setActiveEpicID] = createSignal<string>()
  const [activeIssueType, setActiveIssueType] = createSignal<string>()
  const [drawerTab, setDrawerTab] = createSignal<DrawerTab>("details")
  const [titlebarLeftMount, setTitlebarLeftMount] = createSignal<HTMLElement | null>(null)
  const [titlebarCenterMount, setTitlebarCenterMount] = createSignal<HTMLElement | null>(null)
  const titlebarRightMount = useTitlebarRightMount()
  // Prefer titlebar chrome whenever any mount exists so controls are not doubled.
  const titlebarChrome = createMemo(() => !!titlebarLeftMount() || !!titlebarCenterMount() || !!titlebarRightMount())
  let searchRef: HTMLInputElement | undefined
  let loadVersion = 0

  const client = createMemo(() => {
    if (!server.current) throw new Error("No active OpenCode server")
    return createAgentBoardClient({ server: server.current.http, directory: sdk().directory })
  })

  const notifications = createAgentBoardNotifications((issueID, tab) => {
    selectCard(issueID)
    setDrawerTab(tab)
  })
  const drawer = createAgentBoardDrawerState(board, selectedID)
  const handoff = createAgentBoardHandoff({
    directory: () => sdk().directory,
    board,
    navigate,
  })
  const activeDragCard = createMemo(() => findCard(dragSnapshot() ?? board(), activeDrag()))
  const cardDragPoint = createMemo(() => {
    const point = cardDragPointer()
    const { offset, size } = currentBoardDragGeometry()
    if (!point || !offset || !size) return undefined
    return { point, offset, width: size.width, height: size.height }
  })
  const activeCardDragLayer = createMemo(() => {
    const card = activeDragCard()
    const drag = cardDragPoint()
    if (!card || !drag) return undefined
    return { card, ...drag }
  })
  const activeColumnPreview = createMemo(() => {
    const column = activeColumnDrag()
    if (!column) return undefined
    return (dragSnapshot() ?? board())?.columns.find((item) => item.id === column)
  })
  const allCards = createMemo(() => boardCards(board()))
  const searchableCards = createMemo(() => allCards().filter((card) => issueType(card.issue) !== "epic"))
  const isBoardEmpty = createMemo(() => allCards().length === 0)
  const knownLabels = createMemo(() => boardLabels(allCards()))
  const typeMeta = createMemo(() => boardIssueTypes(allCards()))
  const epicMeta = createMemo(() => boardEpics(board(), allCards()))
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
  createEffect(() => {
    const type = activeIssueType()
    if (!type) return
    if (typeMeta().some((meta) => meta.id === type)) return
    setActiveIssueType(undefined)
  })
  const filteredBoard = createMemo(() =>
    filterBoard(board(), {
      query: query(),
      childIDs: activeEpic()?.childIDs,
      issueType: activeIssueType(),
    }),
  )
  const filteredColumns = createMemo(() => filteredBoard()?.columns ?? [])
  const visibleCardCount = createMemo(() => filteredColumns().reduce((total, column) => total + column.cards.length, 0))
  const searchableCardCount = createMemo(() => searchableCards().length)
  let lastValidDragTarget: BoardDragTarget | undefined
  let lastDragKey: string | undefined

  function setOrderedBoard(next: AgentBoardBoard) {
    const ordered = applyBoardOrder(normalizeBoard(next), boardOrder())
    const current = board()
    if (current && boardContentKey(current) === boardContentKey(ordered)) return current
    notifications.process(ordered)
    setBoard(ordered)
    return ordered
  }

  function commitPresentationOrder(next: AgentBoardBoard) {
    const order = orderFromBoard(next)
    setBoardOrder(order)
    saveBoardOrder(sdk().directory, order)
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
      // Missing Beads is a normal setup state — the page already shows SetupState.
      if (!silent && !/no beads database found/i.test(message)) {
        showToast({ variant: "error", title: "AgentBoard failed", description: message })
      }
    } finally {
      if (version === loadVersion) setLoading(false)
    }
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

  function revealCard(issueID: string) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-agentboard-card="${CSS.escape(issueID)}"]`)
          ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
      })
    })
  }

  function selectCard(issueID: string | undefined, options?: { reveal?: boolean }) {
    setSelectedID(issueID)
    setDrawerTab("details")
    if (issueID && options?.reveal) revealCard(issueID)
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
        handoff.openIssue(issueID, result.issue)
        return
      }
      showToast({
        variant: "success",
        title: `Filed ${issueID || "issue"}`,
        description: "Stays in Open until you open a chat or move it.",
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
      setDragSnapshot(filteredBoard())
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
    const current = filteredBoard()
    if (current) setBoard(applyBoardOrder(current, nextOrder))
    return nextOrder
  }

  function dragPoint() {
    return currentBoardDragPointer()
  }

  function beforeColumnIDAtPoint(moving: AgentBoardColumnID) {
    const point = dragPoint()
    return resolveBeforeColumnIDAtPoint({
      moving,
      point,
      fallback: activeColumnDropPlacement()?.beforeColumnID,
    })
  }

  function resolveCardDragTarget(
    issueID: string | undefined,
    source = dragSnapshot() ?? board(),
  ): BoardDragTarget | undefined {
    if (!issueID || !source) return undefined
    const card = findCard(source, issueID)
    if (!card) return undefined
    const point = dragPoint()
    if (!point) return undefined
    const target = columnIDAtPoint(point)
    if (!target) return undefined
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

  function handleDragMove(_event: DragEvent) {
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
      saveBoardOrder(sdk().directory, nextOrder)
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
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
    event.preventDefault()
    searchRef?.focus()
    searchRef?.select()
  }

  onMount(() => {
    setTitlebarLeftMount(document.getElementById("opencode-titlebar-left"))
    setTitlebarCenterMount(document.getElementById("opencode-titlebar-center"))
    notifications.initialize()
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
      window.removeEventListener("keydown", onKeyDown)
      cleanupCardPointerDrag()
      stopBoardPointerTracking()
      setBoardDragPointer(undefined)
      setBoardDragGeometry({})
      notifications.dispose()
    })
  })

  return (
    <>
      <div
        classList={{
          "isolate relative flex size-full min-h-0 min-w-0 w-full flex-1 self-stretch overflow-hidden": true,
          // Match session pages under NewLayout: padded raised panel.
          "p-2": titlebarChrome(),
          "bg-v2-background-bg-deep": titlebarChrome(),
          "bg-background-base text-text-base": !titlebarChrome(),
        }}
      >
        <div
          classList={{
            "flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden": true,
            "rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]": titlebarChrome(),
            "bg-background-base text-text-base": !titlebarChrome(),
          }}
        >
          <main class="flex min-h-0 min-w-0 w-full flex-1 flex-col">
            <AgentBoardChrome
              titlebarLeftMount={titlebarLeftMount()}
              titlebarCenterMount={titlebarCenterMount()}
              titlebarRightMount={titlebarRightMount()}
              titlebarChrome={titlebarChrome()}
              loading={loading()}
              query={query()}
              visibleCount={visibleCardCount()}
              totalCount={searchableCardCount()}
              epics={epicMeta()}
              issueTypes={typeMeta()}
              activeEpicID={activeEpicID()}
              activeIssueType={activeIssueType()}
              viewMode={viewMode()}
              onRefresh={() => void load()}
              onQueryChange={setQuery}
              onSelectEpic={setActiveEpicID}
              onSelectIssueType={setActiveIssueType}
              onViewModeChange={setViewMode}
            />

            <div class="min-h-0 w-full flex-1 overflow-hidden">
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
                      onChat={handoff.setup}
                      onDocs={() => platform.openExternal(BEADS_DOCS_URL)}
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
                            onPlan={handoff.plan}
                            onSuggest={handoff.suggest}
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
                                    <div class="min-h-0 flex-1 overflow-x-auto p-[18px]">
                                      <div
                                        class="grid h-full gap-2"
                                        style={{
                                          "grid-template-columns": `repeat(${Math.max(filteredColumns().length, 1)}, minmax(280px, 1fr))`,
                                          "min-width": `${Math.max(1120, filteredColumns().length * 296)}px`,
                                        }}
                                      >
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
                                                dependencies={current().graph.dependencies}
                                                selectedID={selectedID()}
                                                busy={busy()}
                                                activeDrag={activeDrag()}
                                                activeDragCard={activeDragCard()}
                                                activeColumnDrag={activeColumnDrag()}
                                                activeTarget={activeDropTarget()}
                                                dropPlacement={activeDropPlacement()}
                                                placeholderHeight={dragPlaceholderHeight()}
                                                onSelect={selectCard}
                                                onChat={handoff.openIssue}
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
                                        onPlan={handoff.plan}
                                        onSuggest={handoff.suggest}
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
                                        "min-height": dragPlaceholderHeight()
                                          ? `${dragPlaceholderHeight()}px`
                                          : undefined,
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
                                onChat={handoff.openIssue}
                                onSubmit={createIssue}
                                onPlan={handoff.plan}
                                onSuggest={handoff.suggest}
                              />
                            </Show>
                          }
                        >
                          <GraphMode
                            board={filteredBoard() ?? current()}
                            unfilteredBoard={current()}
                            query={query()}
                            selectedID={selectedID()}
                            busy={busy()}
                            onSelect={selectCard}
                            onChat={handoff.openIssue}
                            onClearWorkFilters={() => {
                              setActiveEpicID(undefined)
                              setActiveIssueType(undefined)
                            }}
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
        </div>

        <Show when={drawer.card()}>
          {(card) => (
            <div
              class="h-full shrink-0 overflow-hidden transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none"
              style={{ width: drawer.open() ? "420px" : "0px" }}
              aria-hidden={!drawer.open()}
            >
              <DetailDrawer
                card={card()}
                cards={allCards()}
                dependencies={board()?.graph.dependencies ?? []}
                busy={!!busy()}
                open={drawer.open()}
                tab={drawerTab()}
                onTabChange={setDrawerTab}
                onClose={() => selectCard(undefined)}
                onChat={() => handoff.openIssue(card().issue.id)}
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
                  if (sessionID) handoff.openSession(sessionID)
                }}
                onSelectCard={(issueID) => selectCard(issueID, { reveal: true })}
              />
            </div>
          )}
        </Show>
      </div>
    </>
  )
}
