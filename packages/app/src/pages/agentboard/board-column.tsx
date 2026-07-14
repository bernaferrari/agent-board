import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { createDraggable, createDroppable } from "@thisbeyond/solid-dnd"
import { For, Show } from "solid-js"
import {
  BoardCard,
  DropPlaceholder,
} from "./board-card"
import {
  startBoardPointerTracking,
} from "./board-dnd"
import {
  type AgentBoardBoard,
  type AgentBoardCard,
  type AgentBoardColumnID,
  type AgentBoardDependency,
} from "./api"
import { normalizeBoardColumnID } from "./board-state"
import {
  COLUMN_ACCENT,
  COLUMN_ICON,
} from "./ui-tokens"

const COLUMN_DRAG_PREFIX = "agentboard-column:"

const COLUMN_EMPTY: Record<AgentBoardColumnID, { idle: string; managed?: string }> = {
  blocked: { idle: "Nothing blocked" },
  open: { idle: "No open cards" },
  in_progress: { idle: "No active runs" },
  needs_review: { idle: "Nothing to review" },
  closed: { idle: "No closed work yet" },
}

const ADVANCEMENT: Partial<Record<AgentBoardColumnID, AgentBoardColumnID>> = {
  open: "in_progress",
  in_progress: "needs_review",
  needs_review: "closed",
}

export type BoardDropPlacement = {
  column: AgentBoardColumnID
  beforeIssueID?: string
}

export function columnDragID(column: AgentBoardColumnID) {
  return `${COLUMN_DRAG_PREFIX}${column}`
}

export function parseColumnDragID(value: string | undefined) {
  if (!value?.startsWith(COLUMN_DRAG_PREFIX)) return
  const column = value.slice(COLUMN_DRAG_PREFIX.length)
  return normalizeBoardColumnID(column)
}

export function BoardColumn(props: {
  column: AgentBoardBoard["columns"][number]
  dependencies: AgentBoardDependency[]
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
  const accent = () => COLUMN_ACCENT[props.column.id]
  const dragging = () => !!props.activeDrag
  const targeted = () => props.activeTarget === props.column.id
  const columnDragging = () => props.activeColumnDrag === props.column.id
  const empty = () => COLUMN_EMPTY[props.column.id]
  const placeholderBefore = (issueID: string) =>
    props.dropPlacement?.column === props.column.id && props.dropPlacement.beforeIssueID === issueID
  const placeholderAtEnd = () => props.dropPlacement?.column === props.column.id && !props.dropPlacement.beforeIssueID
  const blockerCount = (issueID: string) =>
    props.dependencies.filter((dependency) => dependency.type === "blocks" && dependency.fromIssueID === issueID).length
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
        [`${accent().drop} ring-1 ring-inset shadow-lg ${accent().glow}`]: dragging() && targeted(),
        "!fixed !left-0 !top-0 !h-0 !min-h-0 !w-0 !border-0 opacity-0 pointer-events-none shadow-none overflow-hidden":
          columnDragging(),
      }}
    >
      <header
        class="sticky top-0 z-10 flex shrink-0 items-center gap-2 px-3 pb-1 pt-3 transition-colors duration-150"
        classList={{
          [accent().drop]: dragging() && targeted(),
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
      <ScrollView class="relative z-10 min-h-0 flex-1" data-slot="agentboard-column-scroll" data-scrollable>
        <div class="space-y-3 px-4 pb-2.5 pt-2">
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
                    blockerCount={blockerCount(card.issue.id)}
                  />
                </>
              )}
            </For>
            <Show when={placeholderAtEnd()}>
              <DropPlaceholder card={props.activeDragCard} height={props.placeholderHeight} />
            </Show>
          </Show>
        </div>
      </ScrollView>
    </section>
  )
}
