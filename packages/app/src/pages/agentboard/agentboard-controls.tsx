import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show } from "solid-js"
import { BEADS_DOCS_URL } from "./prompts"
import { ISSUE_TYPE_META } from "./issue-utils"

export type EpicSummary = {
  id: string
  title: string
  childCount: number
  closedCount: number
  childIDs: Set<string>
}

export type TypeSummary = {
  id: string
  label: string
  count: number
}

function isMissingBeads(message?: string) {
  return message?.toLowerCase().includes("no beads database found") ?? false
}

function shortError(message?: string) {
  if (!message) return "AgentBoard could not load this project."
  if (isMissingBeads(message)) return "This project does not have a Beads database yet."
  return message.replace(/\s+/g, " ").trim()
}

function isInitErrorMissingCli(message?: string) {
  if (!message) return false
  return /not found|enoent|no such file|command not found|\bspawn\b|not recognized|is not in your PATH/i.test(message)
}

export function LoadingState() {
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

export function HelpMenu() {
  return (
    <DropdownMenu gutter={6} placement="bottom-end">
      <Tooltip placement="top" value="About AgentBoard">
        <DropdownMenu.Trigger
          class="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-weak ring-1 ring-inset ring-transparent transition-colors hover:bg-surface-raised-base hover:text-text-base data-[expanded]:bg-surface-raised-base-active data-[expanded]:text-text-strong data-[expanded]:ring-border-base"
          aria-label="About AgentBoard"
        >
          <span class="text-12-semibold">?</span>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="w-80 p-3">
          <h3 class="text-13-semibold text-text-strong">About AgentBoard</h3>
          <ul class="mt-2 flex flex-col gap-2 text-12-regular leading-relaxed text-text-base">
            <li class="flex gap-2">
              <span class="select-none text-text-weak">·</span>
              <span>Agents do the work; their activity shows up here as cards.</span>
            </li>
            <li class="flex gap-2">
              <span class="select-none text-text-weak">·</span>
              <span>Beads runs locally and works with any agent or model - you're not locked into one.</span>
            </li>
            <li class="flex gap-2">
              <span class="select-none text-text-weak">·</span>
              <span>Spectate, drag to reorder, or open chat on a card to redirect an agent.</span>
            </li>
            <li class="flex gap-2">
              <span class="select-none text-text-weak">·</span>
              <span>
                Tip:{" "}
                <button
                  type="button"
                  title="Click to copy"
                  class="cursor-pointer rounded bg-surface-raised-base px-1 font-mono transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText("npx skills beads")
                      .then(() =>
                        showToast({
                          variant: "success",
                          icon: "circle-check",
                          title: "Copied",
                          description: "npx skills beads",
                        }),
                      )
                      .catch(() => {})
                  }}
                >
                  npx skills beads
                </button>{" "}
                helps agents use Beads better.
              </span>
            </li>
          </ul>
          <a
            class="mt-3 inline-flex items-center gap-1 text-11-regular text-text-weak underline underline-offset-2 decoration-text-weak hover:text-text-base hover:decoration-text-base"
            href={BEADS_DOCS_URL}
            target="_blank"
            rel="noreferrer"
          >
            Beads on GitHub
            <Icon name="square-arrow-top-right" class="size-3" />
          </a>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export function WorkFilterMenu(props: {
  epics: EpicSummary[]
  types: TypeSummary[]
  activeEpicID?: string
  activeType?: string
  onSelectEpic: (id: string | undefined) => void
  onSelectType: (type: string | undefined) => void
  onClear: () => void
}) {
  const activeEpic = () => props.epics.find((epic) => epic.id === props.activeEpicID)
  const activeType = () => props.types.find((type) => type.id === props.activeType)
  const activeCount = () => (props.activeEpicID ? 1 : 0) + (props.activeType ? 1 : 0)
  const buttonLabel = () => {
    const type = activeType()
    const epic = activeEpic()
    if (type && epic) return `${type.label} in ${epic.title}`
    return type?.label ?? epic?.title ?? "Filter"
  }
  const typeIcon = (type: string) => ISSUE_TYPE_META[type]?.icon ?? "bullet-list"
  const typeIconClass = (type: string) => ISSUE_TYPE_META[type]?.iconClass ?? "text-text-muted"
  return (
    <DropdownMenu gutter={6} placement="bottom-end">
      <Tooltip placement="top" value="Filter by type or epic">
        <DropdownMenu.Trigger
          class="inline-flex h-6 max-w-[260px] items-center gap-1 rounded-md px-2 text-10-semibold ring-1 ring-inset transition-colors data-[expanded]:bg-surface-raised-base-active data-[expanded]:text-text-strong data-[expanded]:ring-border-base"
          classList={{
            "bg-surface-raised-base-active text-text-strong ring-border-base": activeCount() > 0,
            "text-text-weak ring-transparent hover:bg-surface-raised-base hover:text-text-base": activeCount() === 0,
          }}
        >
          <Icon name="sliders" class="size-3" />
          <span class="min-w-0 truncate">{buttonLabel()}</span>
          <Icon name="chevron-down" class="size-3 shrink-0 text-text-muted" />
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="w-80">
          <div class="flex items-center justify-between px-2 py-1">
            <div class="text-11-semibold uppercase tracking-wider text-text-muted">Filters</div>
            <DropdownMenu.Item disabled={activeCount() === 0} onSelect={props.onClear}>
              <DropdownMenu.ItemLabel>Clear</DropdownMenu.ItemLabel>
            </DropdownMenu.Item>
          </div>
          <Show when={props.types.length > 0}>
            <DropdownMenu.Separator />
            <div class="px-2 py-1 text-10-semibold uppercase tracking-wider text-text-muted">Type</div>
            <For each={props.types}>
              {(type) => {
                const active = () => props.activeType === type.id
                return (
                  <DropdownMenu.Item onSelect={() => props.onSelectType(active() ? undefined : type.id)}>
                    <Icon name={typeIcon(type.id)} class={`size-3.5 ${typeIconClass(type.id)}`} />
                    <DropdownMenu.ItemLabel>{type.label}</DropdownMenu.ItemLabel>
                    <span class="ml-auto shrink-0 rounded bg-surface-raised-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak ring-1 ring-inset ring-border-weaker-base">
                      {type.count}
                    </span>
                  </DropdownMenu.Item>
                )
              }}
            </For>
          </Show>
          <Show when={props.epics.length > 0}>
            <DropdownMenu.Separator />
            <div class="px-2 py-1 text-10-semibold uppercase tracking-wider text-text-muted">Epic</div>
            <div class="max-h-64 overflow-y-auto">
              <For each={props.epics}>
                {(epic) => {
                  const active = () => props.activeEpicID === epic.id
                  const progress = () => `${epic.closedCount}/${epic.childCount}`
                  return (
                    <DropdownMenu.Item
                      class="min-w-0"
                      title={`${epic.id} · ${epic.title}`}
                      onSelect={() => props.onSelectEpic(active() ? undefined : epic.id)}
                    >
                      <Icon name={ISSUE_TYPE_META.epic.icon} class={`size-3.5 ${ISSUE_TYPE_META.epic.iconClass}`} />
                      <DropdownMenu.ItemLabel class="min-w-0 truncate">{epic.title}</DropdownMenu.ItemLabel>
                      <span class="ml-2 shrink-0 rounded bg-surface-raised-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak ring-1 ring-inset ring-border-weaker-base">
                        {progress()}
                      </span>
                    </DropdownMenu.Item>
                  )
                }}
              </For>
            </div>
          </Show>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}

export function SetupState(props: {
  error?: string
  initError?: string
  initializing: boolean
  onInit: () => void
  onChat: () => void
  onDocs: () => void
}) {
  const missing = () => isMissingBeads(props.error)
  const cliMissing = () => isInitErrorMissingCli(props.initError)

  return (
    <div class="flex h-full items-center justify-center px-6 pb-24">
      <Show
        when={missing()}
        fallback={
          <div class="w-full max-w-md text-center">
            <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-surface-raised-base text-text-strong shadow-md">
              <Icon name="warning" class="size-5" />
            </div>
            <h2 class="text-20-medium text-text-strong [text-wrap:balance]">AgentBoard couldn't load</h2>
            <p class="mx-auto mt-2 max-w-sm text-13-regular leading-relaxed text-text-weak">
              {shortError(props.error)}
            </p>
            <div class="mt-5 flex justify-center">
              <Button size="large" icon="bubble-5" onClick={props.onChat}>
                Ask chat to help
              </Button>
            </div>
          </div>
        }
      >
        <div class="w-full max-w-md text-center">
          <div class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-surface-raised-base text-text-strong shadow-md">
            <Icon name="checklist" class="size-5" />
          </div>
          <h2 class="text-20-medium text-text-strong [text-wrap:balance]">Beads isn't set up here yet</h2>
          <p class="mx-auto mt-2 text-13-regular leading-relaxed text-text-weak">
            AgentBoard runs on{" "}
            <a
              class="text-text-base underline underline-offset-2 decoration-text-weak hover:text-text-strong hover:decoration-text-strong"
              href={BEADS_DOCS_URL}
              target="_blank"
              rel="noreferrer"
            >
              Beads
            </a>
            , a tiny local issue tracker for coding agents.
          </p>

          <Show when={props.initError}>
            {(error) => (
              <div class="mt-5 rounded-lg bg-[#da3633]/14 p-3 text-left text-12-regular leading-relaxed text-text-strong ring-1 ring-inset ring-[#f85149]/45">
                <Show when={cliMissing()} fallback={error()}>
                  Couldn't run <code class="rounded bg-surface-raised-base px-1 font-mono">bd</code>. Install Beads
                  first, then try again.
                </Show>
              </div>
            )}
          </Show>

          <div class="mt-6 flex justify-center">
            <Button size="large" icon="plus-small" disabled={props.initializing} onClick={props.onInit}>
              <Show when={props.initializing} fallback={<>Initialize Beads</>}>
                Initializing...
              </Show>
            </Button>
          </div>

          <p class="mt-6 text-12-regular leading-relaxed text-text-weak">
            No <code class="rounded bg-surface-raised-base px-1 font-mono">bd</code> yet?{" "}
            <button
              type="button"
              class="cursor-pointer text-text-base underline underline-offset-2 decoration-text-weak hover:text-text-strong hover:decoration-text-strong"
              onClick={props.onDocs}
            >
              Install from GitHub
            </button>{" "}
            or{" "}
            <button
              type="button"
              class="cursor-pointer text-text-base underline underline-offset-2 decoration-text-weak hover:text-text-strong hover:decoration-text-strong"
              onClick={props.onChat}
            >
              ask chat to do it
            </button>
            .
          </p>

          <p class="mt-3 text-11-regular text-text-weak">
            Tip:{" "}
            <button
              type="button"
              title="Click to copy"
              class="cursor-pointer rounded bg-surface-raised-base px-1 font-mono transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText("npx skills beads")
                  .then(() =>
                    showToast({
                      variant: "success",
                      icon: "circle-check",
                      title: "Copied",
                      description: "npx skills beads",
                    }),
                  )
                  .catch(() => {})
              }}
            >
              npx skills beads
            </button>{" "}
            teaches any model to use Beads.
          </p>
        </div>
      </Show>
    </div>
  )
}
