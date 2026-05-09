import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"

export function SearchField(props: {
  value: string
  visible: number
  total: number
  onInput: (value: string) => void
  onClear: () => void
}) {
  let inputRef: HTMLInputElement | undefined
  return (
    <label class="relative hidden lg:block">
      <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-weak">
        <Icon name="magnifying-glass" class="size-3.5" />
      </span>
      <input
        ref={inputRef}
        type="text"
        autocomplete="off"
        spellcheck={false}
        class="h-7 w-72 rounded-md bg-surface-raised-base pl-8 pr-20 text-13-regular text-text-strong outline-none placeholder:text-text-weak focus:ring-1 focus:ring-border-strong-base"
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        placeholder="Search cards"
      />
      <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
        <Show
          when={props.value}
          fallback={
            <span class="rounded bg-background-base px-1.5 py-0.5 font-mono text-10-regular text-text-weak">/</span>
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
        <span class="rounded bg-background-base px-1.5 py-0.5 text-10-semibold tabular-nums text-text-weak">
          {props.visible}/{props.total}
        </span>
      </div>
    </label>
  )
}
