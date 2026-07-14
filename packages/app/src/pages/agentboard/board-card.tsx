import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import { eventLabel } from "./activity"
import { type AgentBoardBoard, type AgentBoardCard } from "./api"
import { issueTypeMeta } from "./issue-utils"
import {
  cardSummary,
  closedBadgeClass,
  COLUMN_ACCENT,
  COLUMN_ICON,
  issueIDTone,
  priorityClass,
  statusLabel,
  statusTone,
  visibleStatus,
} from "./ui-tokens"

const RUNNING = new Set(["queued", "running"])

function latestEvent(card: AgentBoardCard) {
  return card.events.at(-1)
}

export function BoardCardContent(props: {
  card: AgentBoardCard
  busy: boolean
  blockerCount?: number
  preview?: boolean
  onChat?: () => void
  onAdvance?: () => void
}) {
  const run = () => props.card.latestRun
  const last = () => latestEvent(props.card)
  const accent = () => COLUMN_ACCENT[props.card.column]
  const status = () => visibleStatus(props.card)
  const typeMeta = () => issueTypeMeta(props.card.issue)
  const showDependencyFooter = () => (props.blockerCount ?? 0) > 0 && !props.preview
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
            <Show
              when={typeMeta()}
              fallback={
                <span
                  class={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset [&_[data-component=icon]]:text-inherit ${statusTone(status())}`}
                >
                  <Show when={status() === "blocked"}>
                    <Icon name="lock" class="mr-1 size-3 text-inherit" />
                  </Show>
                  {statusLabel(status())}
                </span>
              }
            >
              {(meta) => (
                <span
                  class={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset [&_[data-component=icon]]:text-inherit ${meta().tone} ${closedBadgeClass(props.card.column === "closed")}`}
                >
                  <Icon name={meta().icon} class="mr-1 size-3 text-inherit" />
                  {meta().label}
                </span>
              )}
            </Show>
          }
        >
          <span class="flex shrink-0 items-center rounded-full bg-[#9e6a03]/14 px-1.5 py-0.5 text-10-semibold text-text-strong ring-1 ring-inset ring-[#d29922]/45">
            In Progress
          </span>
        </Show>
        <Show when={props.card.issue.priority !== undefined}>
          <span
            class={`shrink-0 rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityClass(props.card.issue.priority, props.card.column === "closed")}`}
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
        <div class="flex min-w-0 items-center gap-1.5">
          <span class={`max-w-[10rem] truncate ${issueIDTone()}`}>{props.card.issue.id}</span>
          <Show when={showDependencyFooter()}>
            <span
              class="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[#da3633]/12 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-1 ring-inset ring-[#f85149]/40 [&_[data-component=icon]]:text-inherit"
              title={`Blocked by ${props.blockerCount} issue${props.blockerCount === 1 ? "" : "s"}`}
              aria-label={`Blocked by ${props.blockerCount} issue${props.blockerCount === 1 ? "" : "s"}`}
            >
              <Icon name="lock" class="size-3 shrink-0 text-inherit" />
            </span>
          </Show>
        </div>
        <Show when={!props.preview}>
          <div class="flex h-6 min-w-[3.75rem] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <Show when={props.card.column !== "closed" && props.onChat}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-10-semibold uppercase tracking-wide text-primary-foreground transition-[box-shadow,opacity,transform] duration-150 hover:opacity-90 hover:shadow-xs-border-base active:translate-y-px disabled:opacity-50"
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

export function BoardCard(props: {
  card: AgentBoardCard
  selected: boolean
  busy: boolean
  dragging: boolean
  boardDragging: boolean
  onSelect: () => void
  onChat: () => void
  onAdvance: () => void
  onDragStart: (event: PointerEvent, card: AgentBoardCard) => void
  blockerCount?: number
}) {
  const run = () => props.card.latestRun
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
    "cursor-grab active:cursor-grabbing": true,
  })
  return (
    <article
      data-agentboard-card={props.card.issue.id}
      role="button"
      tabindex="0"
      aria-grabbed={props.dragging}
      aria-label={`${props.card.issue.id} - ${props.card.issue.title}`}
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
      <div class="relative">
        <BoardCardContent
          card={props.card}
          busy={props.busy}
          blockerCount={props.blockerCount}
          onChat={props.onChat}
          onAdvance={props.onAdvance}
        />
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

export function ColumnPreview(props: {
  column: AgentBoardBoard["columns"][number]
  width?: number
  height?: number
  ghost?: boolean
}) {
  if (!props.width) return null
  const accent = () => COLUMN_ACCENT[props.column.id]
  return (
    <div
      class="pointer-events-none box-border flex min-h-0 flex-none flex-col overflow-hidden rounded-lg border border-border-strong-base bg-surface-raised-base text-left shadow-2xl"
      classList={{
        "opacity-40": props.ghost,
        "opacity-90": !props.ghost,
      }}
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
      <div class="min-h-0 flex-1 space-y-3 overflow-hidden px-3 pb-4">
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

export function CardDragLayer(props: {
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

export function DropPlaceholder(props: { card?: AgentBoardCard; height?: number }) {
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

export function ColumnDropPlaceholder(props: {
  column?: AgentBoardBoard["columns"][number]
  width?: number
  height?: number
}) {
  if (props.column && props.width) {
    return <ColumnPreview column={props.column} width={props.width} height={props.height} ghost />
  }

  return (
    <div
      class="box-border h-full min-h-0 w-full rounded-lg border border-border-weaker-base bg-surface-raised-base opacity-45 shadow-xs-border-base"
      style={{ height: props.height ? `${props.height}px` : undefined }}
    />
  )
}
