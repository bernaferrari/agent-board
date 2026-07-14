import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, createSignal, For, Show } from "solid-js"
import { PRIORITY_OPTIONS } from "./ui-tokens"

export type ComposerSubmit = {
  title: string
  description?: string
  priority?: number
  labels?: string[]
  runImmediately: boolean
}

export type ComposerDraft = Omit<ComposerSubmit, "runImmediately">

export function IssueComposer(props: {
  variant?: "inline" | "hero"
  knownLabels: string[]
  busy: boolean
  onSubmit: (input: ComposerSubmit) => Promise<void>
  onPlan: (input: ComposerDraft) => void
  onSuggest: () => void
}) {
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [labels, setLabels] = createSignal<string[]>([])
  const [labelDraft, setLabelDraft] = createSignal("")
  const [priority, setPriority] = createSignal(2)
  const [expanded, setExpanded] = createSignal(props.variant === "hero")
  const [submitting, setSubmitting] = createSignal(false)
  const [showSuggestions, setShowSuggestions] = createSignal(false)
  let titleRef: HTMLTextAreaElement | undefined
  let descRef: HTMLTextAreaElement | undefined
  let labelInputRef: HTMLInputElement | undefined
  let composerRef: HTMLFormElement | undefined

  const isHero = () => props.variant === "hero"
  const filled = () => title().trim().length > 0
  const priorityMeta = () => PRIORITY_OPTIONS.find((option) => option.value === priority()) ?? PRIORITY_OPTIONS[2]
  const suggestions = createMemo(() => {
    const draft = labelDraft().trim().toLowerCase().replace(/^#+/, "")
    const taken = new Set(labels())
    return props.knownLabels
      .filter((label) => !taken.has(label))
      .filter((label) => !draft || label.toLowerCase().includes(draft))
      .slice(0, 6)
  })

  function reset() {
    setTitle("")
    setDescription("")
    setLabels([])
    setLabelDraft("")
    setPriority(2)
    if (!isHero()) setExpanded(false)
  }

  function addLabel(value: string) {
    const trimmed = value.trim().replace(/^#+/, "")
    if (!trimmed || labels().includes(trimmed)) return
    setLabels([...labels(), trimmed])
    setLabelDraft("")
    setShowSuggestions(false)
  }

  function collapse() {
    if (isHero()) return
    setShowSuggestions(false)
    setExpanded(false)
    titleRef?.blur()
    descRef?.blur()
    labelInputRef?.blur()
  }

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== "Escape" || isHero()) return
    if (showSuggestions()) {
      event.preventDefault()
      setShowSuggestions(false)
      return
    }
    if (!expanded()) return
    event.preventDefault()
    event.stopPropagation()
    collapse()
  }

  function removeLabel(value: string) {
    setLabels(labels().filter((existing) => existing !== value))
  }

  async function submit(runImmediately: boolean) {
    const trimmed = title().trim()
    if (!trimmed || submitting() || props.busy) return
    setSubmitting(true)
    try {
      await props.onSubmit({
        title: trimmed,
        description: description().trim() || undefined,
        priority: priority(),
        labels: labels().length > 0 ? labels() : undefined,
        runImmediately,
      })
      reset()
      titleRef?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  function planInChat() {
    const trimmed = title().trim()
    if (!trimmed || submitting() || props.busy) return
    props.onPlan({
      title: trimmed,
      description: description().trim() || undefined,
      priority: priority(),
      labels: labels().length > 0 ? labels() : undefined,
    })
  }

  function onTitleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submit(event.metaKey || event.ctrlKey)
    }
  }

  function onDescriptionKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit(true)
    } else if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      // Plain Enter inside description still inserts a newline; Cmd+Enter files and opens chat.
    }
  }

  function onLabelKeyDown(event: KeyboardEvent) {
    const draft = labelDraft()
    if (event.key === "Enter" || event.key === "Tab" || event.key === ",") {
      if (draft.trim()) {
        event.preventDefault()
        addLabel(draft)
      }
    } else if (event.key === "Backspace" && !draft && labels().length > 0) {
      event.preventDefault()
      removeLabel(labels()[labels().length - 1]!)
    }
  }

  function autosize(el: HTMLTextAreaElement) {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  function cyclePriority() {
    const next = (priority() + 1) % PRIORITY_OPTIONS.length
    setPriority(next)
  }

  return (
    <form
      ref={composerRef}
      class="w-full"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
      onKeyDown={handleEscape}
    >
      <div
        class="group relative overflow-hidden rounded-xl bg-background-base transition-[box-shadow,background] duration-150"
        classList={{
          "ring-1 ring-inset ring-border-weak-base": !filled() && !expanded(),
          "ring-1 ring-inset ring-border-strong-base": filled() || expanded(),
        }}
      >
        <div class="flex items-start gap-2 px-3 py-2.5">
          <Show when={!expanded()}>
            <button
              type="button"
              class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-raised-base text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
              onClick={() => {
                setExpanded(true)
                titleRef?.focus()
              }}
              aria-label="Add issue"
            >
              <Icon name="plus-small" class="size-3.5" />
            </button>
          </Show>
          <textarea
            ref={titleRef}
            rows="1"
            value={title()}
            disabled={submitting() || props.busy}
            placeholder={isHero() ? "What needs to get done?" : "Tell AgentBoard what to work on…"}
            class="min-h-6 flex-1 resize-none bg-transparent text-14-regular leading-6 text-text-strong outline-none placeholder:text-text-weak disabled:opacity-60"
            onFocus={() => setExpanded(true)}
            onInput={(event) => {
              setTitle(event.currentTarget.value)
              autosize(event.currentTarget)
            }}
            onKeyDown={onTitleKeyDown}
          />
          <div class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class={`flex h-6 items-center gap-1 rounded px-1.5 text-10-semibold uppercase tracking-wide ring-1 ring-inset transition-colors hover:bg-surface-raised-base-hover ${priorityMeta().tone}`}
              onClick={cyclePriority}
              title="Priority - click to cycle"
            >
              {priorityMeta().label}
            </button>
            <Show when={!filled()}>
              <button
                type="button"
                class="inline-flex h-6 items-center gap-1 rounded-md bg-surface-raised-base px-2 text-11-semibold text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong disabled:opacity-50"
                disabled={submitting() || props.busy}
                onClick={props.onSuggest}
                title="Ask Chat to inspect Beads and the codebase, then suggest useful tickets"
                aria-label="Suggest AgentBoard work"
              >
                <Icon name="brain" class="size-3" />
                Suggest
              </button>
            </Show>
          </div>
        </div>

        <Show when={expanded()}>
          <div class="border-t border-border-weaker-base px-3 py-2.5">
            <textarea
              ref={descRef}
              rows="2"
              value={description()}
              disabled={submitting() || props.busy}
              placeholder="Add detail (optional) - what done looks like, constraints, links..."
              class="min-h-12 w-full resize-none bg-transparent text-13-regular leading-relaxed text-text-base outline-none placeholder:text-text-weak disabled:opacity-60"
              onInput={(event) => {
                setDescription(event.currentTarget.value)
                autosize(event.currentTarget)
              }}
              onKeyDown={onDescriptionKeyDown}
            />
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <For each={labels()}>
                {(label) => (
                  <span class="inline-flex items-center gap-1 rounded-full bg-surface-raised-base px-2 py-0.5 text-11-regular text-text-base">
                    <span class="font-mono text-text-weak">#</span>
                    {label}
                    <button
                      type="button"
                      class="flex size-3 items-center justify-center rounded-full text-text-weak transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong"
                      onClick={() => removeLabel(label)}
                      aria-label={`Remove ${label}`}
                    >
                      <Icon name="close-small" class="size-2.5" />
                    </button>
                  </span>
                )}
              </For>
              <div class="relative">
                <input
                  ref={labelInputRef}
                  type="text"
                  value={labelDraft()}
                  disabled={submitting() || props.busy}
                  placeholder={labels().length === 0 ? "Add tag..." : "+"}
                  class="h-6 w-24 bg-transparent text-12-regular text-text-base outline-none placeholder:text-text-weak disabled:opacity-60"
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onInput={(event) => {
                    setLabelDraft(event.currentTarget.value)
                    setShowSuggestions(true)
                  }}
                  onKeyDown={onLabelKeyDown}
                />
                <Show when={showSuggestions() && suggestions().length > 0}>
                  <div class="absolute bottom-7 left-0 z-20 flex flex-wrap gap-1 rounded-md bg-surface-raised-base p-1.5 shadow-lg ring-1 ring-inset ring-border-weak-base">
                    <For each={suggestions()}>
                      {(label) => (
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-full bg-background-base px-2 py-0.5 text-11-regular text-text-base transition-colors hover:text-text-strong"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            addLabel(label)
                            labelInputRef?.focus()
                          }}
                        >
                          <span class="font-mono text-text-weak">#</span>
                          {label}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
              <span class="ml-auto hidden items-center gap-1.5 text-10-regular text-text-weak md:flex">
                <Show when={!isHero()}>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 rounded px-1 py-0.5 text-text-weak underline-offset-2 hover:bg-surface-raised-base hover:text-text-strong hover:underline"
                    onClick={collapse}
                  >
                    <kbd class="rounded bg-surface-raised-base px-1 py-0.5 font-mono">esc</kbd>
                    collapse
                  </button>
                </Show>
                <span class="inline-flex items-center gap-1">
                  <button
                    type="button"
                    class="inline-flex items-center gap-1.5 rounded-md bg-surface-raised-base px-2 py-0.5 text-10-semibold text-text-base transition-colors hover:bg-surface-raised-base-hover hover:text-text-strong disabled:opacity-50"
                    disabled={!filled() || submitting() || props.busy}
                    onClick={() => void submit(true)}
                    title="Create one Beads issue, then open chat with that issue context"
                    aria-label="Create and open chat"
                  >
                    <Icon name="bubble-5" class="size-3" />
                    Chat
                    <kbd class="rounded bg-background-base px-1 py-0.5 font-mono text-10-semibold text-text-weak ring-1 ring-inset ring-border-weaker-base">
                      ⌘↵
                    </kbd>
                  </button>
                  <button
                    type="submit"
                    class="inline-flex items-center gap-1.5 rounded-md border border-border-weak-base bg-[var(--button-primary-base)] px-2.5 py-0.5 text-10-semibold text-[var(--icon-invert-base)] transition-colors hover:bg-[var(--icon-strong-hover)] disabled:bg-[var(--icon-strong-disabled)] disabled:opacity-100"
                    disabled={!filled() || submitting() || props.busy}
                    title="Create one Beads issue"
                  >
                    Create
                    <kbd class="rounded bg-[color-mix(in_srgb,var(--icon-invert-base)_15%,transparent)] px-1 py-0.5 font-mono text-10-semibold text-[color-mix(in_srgb,var(--icon-invert-base)_85%,transparent)]">
                      ↵
                    </kbd>
                  </button>
                </span>
              </span>
            </div>
          </div>
        </Show>
      </div>
    </form>
  )
}
