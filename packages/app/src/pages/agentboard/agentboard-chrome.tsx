import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { HelpMenu, WorkFilterMenu, type EpicSummary, type TypeSummary } from "./agentboard-controls"
import type { AgentBoardViewMode } from "./graph-view"
import { SearchField } from "./search-field"

export function AgentBoardChrome(props: {
  titlebarLeftMount: HTMLElement | null
  titlebarCenterMount: HTMLElement | null
  titlebarRightMount: HTMLElement | null
  titlebarChrome: boolean
  loading: boolean
  query: string
  visibleCount: number
  totalCount: number
  epics: EpicSummary[]
  issueTypes: TypeSummary[]
  activeEpicID?: string
  activeIssueType?: string
  viewMode: AgentBoardViewMode
  onRefresh: () => void
  onQueryChange: (query: string) => void
  onSelectEpic: (id?: string) => void
  onSelectIssueType: (type?: string) => void
  onViewModeChange: (mode: AgentBoardViewMode) => void
}) {
  const modeSwitch = () => (
    <div class="hidden h-6 items-center overflow-hidden rounded-md border border-border-weak-base bg-surface-panel md:flex">
      <For
        each={[
          { id: "board" as const, label: "Board", icon: "checklist" as const },
          { id: "list" as const, label: "List", icon: "bullet-list" as const },
          { id: "graph" as const, label: "Graph", icon: "branch" as const },
        ]}
      >
        {(value) => (
          <button
            type="button"
            class="inline-flex h-full items-center gap-1.5 border-r border-border-weak-base px-2 text-10-semibold transition-colors last:border-r-0 [&_[data-component=icon]]:text-inherit"
            classList={{
              "bg-surface-raised-base-active text-text-strong": props.viewMode === value.id,
              "text-text-weak hover:bg-surface-raised-base hover:text-text-base": props.viewMode !== value.id,
            }}
            onClick={() => props.onViewModeChange(value.id)}
          >
            <Icon name={value.icon} size="small" class="size-3" />
            <span>{value.label}</span>
          </button>
        )}
      </For>
    </div>
  )

  const toolbar = () => (
    <div class="flex items-center gap-2">
      <Show when={props.epics.length > 0 || props.issueTypes.length > 0}>
        <WorkFilterMenu
          epics={props.epics}
          types={props.issueTypes}
          activeEpicID={props.activeEpicID}
          activeType={props.activeIssueType}
          onSelectEpic={props.onSelectEpic}
          onSelectType={props.onSelectIssueType}
          onClear={() => {
            props.onSelectEpic(undefined)
            props.onSelectIssueType(undefined)
          }}
        />
      </Show>
      <HelpMenu />
      {modeSwitch()}
    </div>
  )

  const search = (always = false) => (
    <SearchField
      value={props.query}
      visible={props.visibleCount}
      total={props.totalCount}
      always={always}
      onInput={props.onQueryChange}
      onClear={() => props.onQueryChange("")}
    />
  )

  const refresh = (titlebar = false) => (
    <Tooltip placement="top" value="Refresh AgentBoard">
      <Button
        variant={titlebar ? "ghost" : "secondary"}
        icon="reset"
        size={titlebar ? undefined : "small"}
        class={titlebar ? "titlebar-icon h-6 w-8 p-0" : undefined}
        onClick={props.onRefresh}
        disabled={props.loading}
        aria-label="Refresh AgentBoard"
      />
    </Tooltip>
  )

  return (
    <>
      <Show when={props.titlebarLeftMount}>{(mount) => <Portal mount={mount()}>{refresh(true)}</Portal>}</Show>
      <Show when={props.titlebarCenterMount}>{(mount) => <Portal mount={mount()}>{search(true)}</Portal>}</Show>
      <Show when={props.titlebarRightMount}>
        {(mount) => (
          <Portal mount={mount()}>
            <div class="flex items-center gap-2">
              <Show when={!props.titlebarCenterMount}>{search(true)}</Show>
              {toolbar()}
            </div>
          </Portal>
        )}
      </Show>
      <Show when={!props.titlebarChrome}>
        <header class="shrink-0 border-b border-border-weaker-base bg-background-base px-5 py-3">
          <div class="flex w-full items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-2.5">
              <div class="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-text-strong shadow-xs-border-base">
                <Icon name="checklist" class="size-3.5" />
              </div>
              <h1 class="text-14-semibold text-text-strong">AgentBoard</h1>
              {refresh()}
            </div>
            <div class="flex shrink-0 items-center gap-2">
              {search()}
              {toolbar()}
            </div>
          </div>
        </header>
      </Show>
    </>
  )
}
