import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { AgentBoardGraphNode } from "./graph-state"
import { GRAPH_EASE, GRAPH_NODE_HEIGHT, GRAPH_NODE_WIDTH, dependencyLabel } from "./graph-geometry"
import { COLUMN_ACCENT, issueIDTone, priorityClass, statusLabel, visibleStatus } from "./ui-tokens"

export function GraphNodeCard(props: {
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
          class={`inline-flex min-w-0 max-w-[8.5rem] items-center rounded-full px-1.5 py-0.5 text-10-semibold ring-1 ring-inset [&_[data-component=icon]]:text-inherit ${accent().tint} ${accent().ring}`}
        >
          <span class="truncate">{statusLabel(status(), { capitalize: true })}</span>
        </span>
        <Show when={card().issue.priority !== undefined}>
          <span
            class={`rounded px-1.5 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityClass(card().issue.priority, card().column === "closed")}`}
          >
            P{card().issue.priority}
          </span>
        </Show>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden pt-2">
        <h3 class="line-clamp-2 text-13-semibold leading-snug text-text-strong">{card().issue.title}</h3>
      </div>
      <div class="mt-2 flex h-5 shrink-0 items-center justify-between gap-2 text-11-regular">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class={`max-w-[8.5rem] truncate ${issueIDTone()}`}>{card().issue.id}</span>
          <Show when={props.node.blockedBy > 0}>
            <span
              class="inline-flex size-6 shrink-0 items-center justify-center rounded bg-[#da3633]/12 text-[color-mix(in_oklch,#cf222e_62%,var(--text-strong))] ring-1 ring-inset ring-[#f85149]/40 [&_[data-component=icon]]:text-inherit"
              title={`${dependencyLabel(props.node)} visible in this graph view`}
              aria-label={`${dependencyLabel(props.node)} visible in this graph view`}
            >
              <Icon name="lock" class="size-3 shrink-0 text-inherit" />
            </span>
          </Show>
        </div>
        <div class="flex h-6 min-w-[3.75rem] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <Show when={card().column !== "closed"}>
            <button
              type="button"
              class="inline-flex h-6 items-center gap-1 rounded bg-primary px-2 text-10-semibold uppercase tracking-wide text-primary-foreground transition-[box-shadow,opacity,transform] duration-150 hover:opacity-90 hover:shadow-xs-border-base active:translate-y-px disabled:opacity-50"
              disabled={props.busy}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                props.onChat()
              }}
              aria-label={`Open chat for ${card().issue.id}`}
            >
              <Icon name="bubble-5" class="size-3" />
              Chat
            </button>
          </Show>
        </div>
      </div>
    </article>
  )
}
