import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { createMemo, For, Show } from "solid-js"
import type { AgentBoardArtifact, AgentBoardRunEvent } from "./api"
import { formatRelative, formatTime } from "./time-utils"

const EVENT_LABEL: Record<string, string> = {
  queued: "Queued from Open",
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

export function eventLabel(type: string) {
  return EVENT_LABEL[type] ?? type.replaceAll("_", " ")
}

function eventTone(type: string) {
  return EVENT_TONE[type] ?? DEFAULT_EVENT_TONE
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

export function ArtifactView(props: { artifact: AgentBoardArtifact }) {
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

export function Timeline(props: { events: AgentBoardRunEvent[] }) {
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
