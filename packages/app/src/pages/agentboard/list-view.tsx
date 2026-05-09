import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, For, Show } from "solid-js"
import { eventLabel } from "./activity"
import { type AgentBoardBoard, type AgentBoardCard } from "./api"
import { IssueComposer, type ComposerDraft, type ComposerSubmit } from "./issue-composer"
import { extractLabels } from "./issue-utils"
import { formatRelative } from "./time-utils"
import {
  cardSummary,
  COLUMN_ACCENT,
  COLUMN_ICON,
  issueIDTone,
  priorityTone,
  type ColumnAccent,
} from "./ui-tokens"

const RUNNING = new Set(["queued", "running"])

const COLUMN_HINT: Record<AgentBoardBoard["columns"][number]["id"], string> = {
  ready: "Unblocked and ready to start",
  running: "Currently assigned to sessions",
  needs_review: "Waiting on a human decision",
  blocked: "Waiting on dependencies",
  closed: "Done and archived",
}

export function BoardListView(props: {
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
                        <span class="inline-flex size-5 items-center justify-center rounded-md bg-surface-raised-base ring-1 ring-inset ring-border-weaker-base">
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
                      <ul class="overflow-hidden rounded-lg border border-border-weaker-base bg-surface-panel">
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
        aria-label={`${props.card.issue.id} - ${props.card.issue.title}`}
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
          <Show when={isLive()} fallback={<span class={`size-2 rounded-full ${props.accent.dot}`} />}>
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

function latestEvent(card: AgentBoardCard) {
  return card.events.at(-1)
}
