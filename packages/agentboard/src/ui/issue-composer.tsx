import { For, onCleanup, onMount, Show } from "solid-js"
import { IssueType } from "../types"
import type { IssueDraft } from "./drop"
import { draftFromDrop } from "./drop"

export const PRIORITIES = ["P0 · Urgent", "P1 · High", "P2 · Normal", "P3 · Low", "P4 · Backlog"]

export function IssueComposer(props: {
  draft: IssueDraft
  busy: boolean
  error: string
  canPlan: boolean
  project: string
  onChange: (draft: IssueDraft) => void
  onClose: () => void
  onSave: () => void
  onPlan: () => void
  onError: (message: string) => void
}) {
  const dialog = { current: undefined as HTMLDialogElement | undefined }
  const title = { current: undefined as HTMLInputElement | undefined }
  const previous = document.activeElement
  onCleanup(() => {
    dialog.current?.close()
    // The parent finishes its pending action before controls become focusable again.
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }, 0)
  })
  onMount(() => {
    dialog.current?.showModal()
    if (matchMedia("(pointer: fine)").matches) title.current?.focus()
  })
  const fileInput = { current: undefined as HTMLInputElement | undefined }
  const importBrief = (transfer: { files: ArrayLike<File>; getData: (type: string) => string }) => {
    return draftFromDrop(transfer)
      .then((incoming) => {
        const description =
          props.draft.title.trim() || props.draft.description.trim()
            ? [props.draft.description, incoming.title, incoming.description].filter(Boolean).join("\n\n")
            : incoming.description
        if (description.length > 50000) throw new Error("Keep the combined description under 50,000 characters.")
        props.onChange({ ...props.draft, title: props.draft.title || incoming.title, description })
      })
      .catch((cause: unknown) => props.onError(cause instanceof Error ? cause.message : String(cause)))
  }
  return (
    <dialog
      class="composer"
      ref={(element) => (dialog.current = element)}
      aria-labelledby="create-heading"
      onClose={props.onClose}
      onCancel={(event) => {
        if (props.busy) event.preventDefault()
      }}
    >
      <div class="drawer-top">
        <div>
          <h2 id="create-heading">{props.draft.issueID ? "Edit issue" : "New issue"}</h2>
          <p class="hint">{props.project}</p>
        </div>
        <button
          class="icon-button"
          disabled={props.busy}
          aria-label="Close issue editor"
          onClick={() => dialog.current?.close()}
        >
          ×
        </button>
      </div>
      <Show when={props.error}>
        <p class="dialog-message error" role="alert">
          {props.error}
        </p>
      </Show>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          props.onSave()
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            event.currentTarget.requestSubmit()
          }
        }}
      >
        <label for="new-title">Title</label>
        <input
          ref={(element) => (title.current = element)}
          id="new-title"
          value={props.draft.title}
          onInput={(event) => props.onChange({ ...props.draft, title: event.currentTarget.value })}
          placeholder="What needs to be done?"
          required
          maxlength="500"
          disabled={props.busy}
          autocomplete="off"
        />
        <label for="new-description">
          Description <span class="hint">Optional</span>
        </label>
        <textarea
          id="new-description"
          value={props.draft.description}
          maxlength="50000"
          disabled={props.busy}
          onInput={(event) => props.onChange({ ...props.draft, description: event.currentTarget.value })}
          placeholder="Why it matters, useful context, and what done looks like"
        />
        <Show when={!props.draft.issueID}>
          <div
            class="draft-drop"
            onDragOver={(event) => {
              if (!props.busy) event.preventDefault()
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (props.busy || !event.dataTransfer) return
              void importBrief(event.dataTransfer)
            }}
          >
            <span>Drop text or a Markdown file.</span>
            <button type="button" disabled={props.busy} onClick={() => fileInput.current?.click()}>
              Choose file
            </button>
            <input
              hidden
              ref={(element) => (fileInput.current = element)}
              type="file"
              accept=".md,.markdown,.txt"
              aria-label="Issue brief"
              onChange={(event) => {
                const element = event.currentTarget
                if (element.files?.length) void importBrief({ files: element.files, getData: () => "" })
                element.value = ""
              }}
            />
          </div>
        </Show>
        <div class="composer-properties">
          <label>
            Priority
            <select
              disabled={props.busy}
              value={props.draft.priority}
              onChange={(event) => props.onChange({ ...props.draft, priority: Number(event.currentTarget.value) })}
            >
              <For each={PRIORITIES}>{(label, index) => <option value={index()}>{label}</option>}</For>
            </select>
          </label>
          <label>
            Type
            <select
              disabled={props.busy}
              value={props.draft.type}
              onChange={(event) => props.onChange({ ...props.draft, type: event.currentTarget.value })}
            >
              <Show when={!IssueType.options.some((value) => value === props.draft.type)}>
                <option value={props.draft.type}>{props.draft.type}</option>
              </Show>
              <For each={IssueType.options}>
                {(value) => <option value={value}>{value[0].toUpperCase() + value.slice(1)}</option>}
              </For>
            </select>
          </label>
        </div>
        <div class="composer-actions">
          <Show when={!props.draft.issueID}>
            <button
              type="button"
              disabled={props.busy || !props.draft.title.trim() || !props.canPlan}
              title={
                props.canPlan
                  ? "Discuss this draft in a new ChatGPT conversation"
                  : "New-chat handoff is unavailable in this host"
              }
              onClick={props.onPlan}
            >
              Plan in ChatGPT ↗
            </button>
          </Show>
          <button class="primary" disabled={props.busy || !props.draft.title.trim()}>
            {props.busy ? "Saving…" : props.draft.issueID ? "Save changes" : "Create issue"}
          </button>
        </div>
        <p class="hint form-shortcut">{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"} + Enter to save</p>
      </form>
    </dialog>
  )
}
