import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"

export function SearchField(props: {
  value: string
  visible: number
  total: number
  onInput: (value: string) => void
  onClear: () => void
  always?: boolean
}) {
  let inputRef: HTMLInputElement | undefined
  return (
    <label
      classList={{
        "box-border flex h-7 w-72 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border-weak-base bg-surface-panel pl-2 pr-1.5":
          true,
        "hidden lg:flex": !props.always,
      }}
    >
      <span class="flex shrink-0 items-center text-text-weak" aria-hidden="true">
        <Icon name="magnifying-glass" class="size-3.5" />
      </span>
      <input
        ref={inputRef}
        type="text"
        autocomplete="off"
        spellcheck={false}
        class="min-w-0 flex-1 border-0 bg-transparent p-0 text-13-regular text-text-strong outline-none placeholder:text-text-weak"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder="Search issues"
      />
      <div class="flex shrink-0 items-center gap-1">
        <Show
          when={props.value}
          fallback={
            <span class="px-1 font-mono text-10-regular text-text-weak">/</span>
          }
        >
          <button
            type="button"
            class="flex size-5 items-center justify-center rounded text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
            aria-label="Clear search"
            onClick={props.onClear}
          >
            <Icon name="close-small" class="size-3" />
          </button>
        </Show>
        <span class="px-1 text-10-semibold tabular-nums text-text-weak">
          {props.visible}/{props.total}
        </span>
      </div>
    </label>
  )
}
