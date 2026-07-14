import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Markdown } from "@opencode-ai/session-ui/markdown"
import { showToast } from "@opencode-ai/ui/toast"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { ArtifactView, Timeline } from "./activity"
import { type AgentBoardCard, type AgentBoardColumnID, type AgentBoardDependency } from "./api"
import { canMoveCardTo } from "./board-state"
import { issueCloseReason, issueCreatedTimestamp, issueTypeMeta, issueUpdatedTimestamp } from "./issue-utils"
import { formatAbsolute, formatRelative } from "./time-utils"
import {
  cardSummary,
  COLUMN_ACCENT,
  COLUMN_ICON,
  issueIDTone,
  priorityTone,
  statusLabel,
  statusTone,
  visibleStatus,
} from "./ui-tokens"

const RUNNING = new Set(["queued", "running"])

const REVIEW_PRESETS = [
  "Please run the relevant tests and report the exact command output.",
  "Please tighten the implementation, remove unnecessary changes, and keep the patch scoped to this issue.",
  "Please inspect the diff for edge cases, regressions, and missing error states before handing back.",
]

export type DrawerTab = "details" | "timeline" | "artifacts" | "raw"

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function JsonPrimitive(props: { value: JsonValue }) {
  if (props.value === null) return <span class="text-text-muted">null</span>
  if (typeof props.value === "string") return <span class="text-text-base">"{props.value}"</span>
  if (typeof props.value === "number") return <span class="text-text-base">{props.value}</span>
  if (typeof props.value === "boolean") return <span class="text-text-base">{String(props.value)}</span>
  return null
}

function JsonTree(props: { value: JsonValue; depth?: number }) {
  const depth = () => props.depth ?? 0
  const indent = () => `${depth() * 14}px`
  const nextDepth = () => depth() + 1
  const entries = () =>
    props.value && typeof props.value === "object" && !Array.isArray(props.value)
      ? Object.entries(props.value)
      : []
  return (
    <Show
      when={props.value && typeof props.value === "object"}
      fallback={<JsonPrimitive value={props.value} />}
    >
      <Show
        when={Array.isArray(props.value)}
        fallback={
          <>
            <span class="text-text-muted">{"{"}</span>
            <div>
              <For each={entries()}>
                {([key, value], index) => (
                  <div style={{ "padding-left": indent() }}>
                    <span class="text-syntax-property">"{key}"</span>
                    <span class="text-syntax-punctuation">: </span>
                    <JsonTree value={value} depth={nextDepth()} />
                    <Show when={index() < entries().length - 1}>
                      <span class="text-syntax-punctuation">,</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <span style={{ "padding-left": `${Math.max(depth() - 1, 0) * 14}px` }} class="text-text-muted">
              {"}"}
            </span>
          </>
        }
      >
        <span class="text-text-muted">[</span>
        <div>
          <For each={props.value as JsonValue[]}>
            {(value, index) => (
              <div style={{ "padding-left": indent() }}>
                <JsonTree value={value} depth={nextDepth()} />
                <Show when={index() < (props.value as JsonValue[]).length - 1}>
                  <span class="text-text-muted">,</span>
                </Show>
              </div>
            )}
          </For>
        </div>
        <span style={{ "padding-left": `${Math.max(depth() - 1, 0) * 14}px` }} class="text-text-muted">
          ]
        </span>
      </Show>
    </Show>
  )
}

function DependencyMiniCard(props: {
  issueID: string
  card?: AgentBoardCard
  onSelect: () => void
}) {
  const status = () => (props.card ? visibleStatus(props.card) : undefined)
  return (
    <button
      type="button"
      class="group flex w-full items-start rounded-md border border-border-weaker-base bg-background-base px-2.5 py-2 text-left transition-[border-color,background,box-shadow] hover:border-border-base hover:bg-surface-raised-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base disabled:cursor-default disabled:opacity-70 disabled:hover:border-border-weaker-base disabled:hover:bg-background-base"
      disabled={!props.card}
      onClick={props.onSelect}
    >
      <span class="min-w-0 flex-1">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class={issueIDTone()}>{props.issueID}</span>
          <Show when={props.card?.issue.priority !== undefined}>
            <span
              class={`rounded px-1 py-0.5 font-mono text-10-semibold ring-1 ring-inset ${priorityTone(props.card!.issue.priority)}`}
            >
              P{props.card!.issue.priority}
            </span>
          </Show>
          <Show when={status()}>
            {(value) => (
              <span
                class={`rounded px-1.5 py-0.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset ${statusTone(value())}`}
              >
                {statusLabel(value())}
              </span>
            )}
          </Show>
        </span>
        <span class="mt-1 block truncate text-12-semibold text-text-strong">
          {props.card?.issue.title ?? "Issue not loaded in this board view"}
        </span>
        <Show when={props.card && cardSummary(props.card)}>
          {(summary) => <span class="mt-0.5 block truncate text-11-regular text-text-weak">{summary()}</span>}
        </Show>
      </span>
      <Show when={props.card}>
        <Icon name="chevron-right" class="mt-1 size-3.5 text-text-muted transition-colors group-hover:text-text-base" />
      </Show>
    </button>
  )
}

function DependencySection(props: {
  title: string
  items: Array<{ id: string; type: string; card?: AgentBoardCard }>
  onSelectCard: (issueID: string) => void
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="rounded-md bg-surface-raised-base p-3">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-10-semibold uppercase tracking-wider text-text-weak">{props.title}</h3>
          <span class="rounded bg-background-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-base ring-1 ring-inset ring-border-weaker-base">
            {props.items.length}
          </span>
        </div>
        <div class="mt-2 space-y-1.5">
          <For each={props.items}>
            {(item) => (
              <DependencyMiniCard
                issueID={item.id}
                card={item.card}
                onSelect={() => {
                  if (item.card) props.onSelectCard(item.id)
                }}
              />
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}

export function DetailDrawer(props: {
  card: AgentBoardCard
  cards: AgentBoardCard[]
  dependencies: AgentBoardDependency[]
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
  onSelectCard: (issueID: string) => void
}) {
  const [message, setMessage] = createSignal("")
  const run = () => props.card.latestRun
  const cardByID = createMemo(() => new Map(props.cards.map((card) => [card.issue.id, card] as const)))
  const blockingPrerequisites = createMemo(() =>
    props.dependencies
      .filter((dependency) => dependency.type === "blocks" && dependency.fromIssueID === props.card.issue.id)
      .map((dependency) => ({
        id: dependency.toIssueID,
        type: dependency.type,
        card: cardByID().get(dependency.toIssueID),
      })),
  )
  const dependencies = createMemo(() =>
    props.dependencies
      .filter((dependency) => dependency.type !== "blocks" && dependency.fromIssueID === props.card.issue.id)
      .map((dependency) => ({
        id: dependency.toIssueID,
        type: dependency.type,
        card: cardByID().get(dependency.toIssueID),
      })),
  )
  const blockedDependents = createMemo(() =>
    props.dependencies
      .filter((dependency) => dependency.type === "blocks" && dependency.toIssueID === props.card.issue.id)
      .map((dependency) => ({
        id: dependency.fromIssueID,
        type: dependency.type,
        card: cardByID().get(dependency.fromIssueID),
      })),
  )
  const createdAt = () => issueCreatedTimestamp(props.card.issue)
  const updatedAt = () => issueUpdatedTimestamp(props.card)
  const closeReason = () => issueCloseReason(props.card.issue)
  const canOpen = () => !!run()?.opencodeSessionID
  const canChat = () => props.card.column !== "closed"
  const canCancel = () => !!run() && RUNNING.has(run()!.status)
  const canReview = () => run()?.status === "needs_review" || run()?.status === "failed"
  const accent = () => COLUMN_ACCENT[props.card.column]
  const moveLabel = (column: AgentBoardColumnID) =>
    column === "needs_review" ? "Review" : column === "open" ? "Open" : column === "in_progress" ? "In Progress" : "Closed"
  const moveDisabled = (column: AgentBoardColumnID) => props.busy || !canMoveCardTo(props.card, column).ok
  const applyPreset = (preset: string) => {
    const current = message().trim()
    setMessage(current ? `${current}\n\n${preset}` : preset)
  }
  const requestChanges = () => {
    props.onRequestChanges(message())
    setMessage("")
  }
  const rawText = () => JSON.stringify(props.card.issue.raw, null, 2)
  const copyRaw = () => {
    void navigator.clipboard
      ?.writeText(rawText())
      .then(() =>
        showToast({
          variant: "success",
          icon: "circle-check",
          title: "Copied raw issue data",
          description: props.card.issue.id,
        }),
      )
      .catch((error: unknown) =>
        showToast({
          variant: "error",
          title: "Could not copy raw issue data",
          description: error instanceof Error ? error.message : "Clipboard write failed.",
        }),
      )
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
                class={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset [&_[data-component=icon]]:text-inherit ${meta().tone}`}
              >
                <Icon name={meta().icon} class="size-3 text-inherit" />
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
              <Show
                when={props.card.issue.description?.trim()}
                fallback={<p class="mt-2 text-13-regular leading-relaxed text-text-weak">No description provided.</p>}
              >
                {(description) => (
                  <Markdown
                    text={description()}
                    class="mt-2 text-13-regular leading-relaxed text-text-base"
                    cacheKey={`agentboard-description:${props.card.issue.id}:${props.card.issue.raw.updated_at ?? ""}`}
                  />
                )}
              </Show>
              <Show when={createdAt() || updatedAt()}>
                <div class="mt-3 flex flex-wrap items-center gap-2 text-11-regular text-text-weak">
                  <Show when={createdAt()}>
                    {(value) => (
                      <span
                        class="inline-flex items-center gap-1 rounded bg-surface-raised-base px-1.5 py-0.5 ring-1 ring-inset ring-border-weaker-base"
                        title={`Created ${formatAbsolute(value())}`}
                      >
                        <span class="text-text-muted">Created</span>
                        <span class="text-text-base">{formatRelative(value()) || formatAbsolute(value())}</span>
                      </span>
                    )}
                  </Show>
                  <Show when={updatedAt()}>
                    {(value) => (
                      <span
                        class="inline-flex items-center gap-1 rounded bg-surface-raised-base px-1.5 py-0.5 ring-1 ring-inset ring-border-weaker-base"
                        title={`Updated ${formatAbsolute(value())}`}
                      >
                        <span class="text-text-muted">Updated</span>
                        <span class="text-text-base">{formatRelative(value()) || formatAbsolute(value())}</span>
                      </span>
                    )}
                  </Show>
                </div>
              </Show>
            </section>
            <Show when={closeReason()}>
              {(reason) => (
                <section class="rounded-md bg-surface-raised-base p-3">
                  <h3 class="text-10-semibold uppercase tracking-wider text-text-weak">Close reason</h3>
                  <Markdown
                    text={reason()}
                    class="mt-2 text-13-regular leading-relaxed text-text-base"
                    cacheKey={`agentboard-close-reason:${props.card.issue.id}:${props.card.issue.raw.closed_at ?? props.card.issue.raw.updated_at ?? ""}`}
                  />
                </section>
              )}
            </Show>
            <DependencySection
              title="Blocked by"
              items={blockingPrerequisites()}
              onSelectCard={props.onSelectCard}
            />
            <DependencySection title="Depends on" items={dependencies()} onSelectCard={props.onSelectCard} />
            <DependencySection title="Blocks" items={blockedDependents()} onSelectCard={props.onSelectCard} />
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
          <div class="relative overflow-auto rounded-md bg-surface-raised-base p-3 pr-12 font-mono text-11-regular leading-relaxed text-text-base">
            <button
              type="button"
              class="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded bg-background-base text-text-weak shadow-xs-border-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong-base"
              onClick={copyRaw}
              aria-label="Copy raw data"
              title="Copy raw data"
            >
              <Icon name="copy" class="size-3.5" />
            </button>
            <JsonTree value={props.card.issue.raw as JsonValue} />
          </div>
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
              placeholder="Request specific changes..."
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
            <For each={["open", "in_progress", "needs_review", "closed"] as const}>
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
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-11-semibold text-primary-foreground transition-[box-shadow,opacity,transform] duration-150 hover:opacity-90 hover:shadow-xs-border-base active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.busy}
              onClick={props.onChat}
            >
              <Icon name="bubble-5" size="small" />
              Chat
            </button>
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
