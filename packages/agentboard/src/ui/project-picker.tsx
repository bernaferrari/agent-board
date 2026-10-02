import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import type { Snapshot } from "../types"
import { folderFromDrop } from "./drop"

export function ProjectPicker(props: {
  snapshot: Snapshot
  busy: boolean
  error: string
  onClose: () => void
  onConnect: (directory: string) => void
  onSelect: (id: string) => void
  onImport: () => void
  canImport: boolean
  onError: (message: string) => void
}) {
  const [directory, setDirectory] = createSignal("")
  const dialog = { current: undefined as HTMLDialogElement | undefined }
  const previous = document.activeElement
  onCleanup(() => {
    dialog.current?.close()
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }, 0)
  })
  const suggestions = () =>
    props.snapshot.suggestions.filter(
      (item) => !props.snapshot.projects.some((project) => project.directory === item.directory),
    )
  onMount(() => dialog.current?.showModal())
  return (
    <dialog
      class="project-picker"
      ref={(element) => (dialog.current = element)}
      aria-labelledby="projects-heading"
      onClose={props.onClose}
      onCancel={(event) => {
        if (props.busy) event.preventDefault()
      }}
    >
      <div class="drawer-top">
        <div>
          <h2 id="projects-heading">Your projects</h2>
          <p class="hint">Choose a local Beads workspace.</p>
        </div>
        <button
          class="icon-button"
          disabled={props.busy}
          aria-label="Close projects"
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
      <Show when={props.snapshot.projects.length}>
        <h3 class="section-label">Connected</h3>
        <div class="project-choices">
          <For each={props.snapshot.projects}>
            {(project) => (
              <button class="project-choice" disabled={props.busy} onClick={() => props.onSelect(project.id)}>
                <span>
                  <strong>{project.name}</strong>
                  <small title={project.directory}>{project.directory}</small>
                </span>
                <span class="project-state">
                  {props.snapshot.board?.project.id === project.id ? "Current" : "Open →"}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="section-heading">
        <h3 class="section-label">From ChatGPT desktop</h3>
        <button class="text-button" disabled={props.busy || !props.canImport} onClick={props.onImport}>
          Import project list ↗
        </button>
      </div>
      <Show
        when={suggestions().length}
        fallback={
          <p class="hint project-hint">
            Ask ChatGPT to import your local projects, then refresh AgentBoard. Cloud projects need a local Beads folder
            to use this board.
          </p>
        }
      >
        <div class="project-choices">
          <For each={suggestions()}>
            {(project) => (
              <button class="project-choice" disabled={props.busy} onClick={() => props.onConnect(project.directory)}>
                <span>
                  <strong>{project.name}</strong>
                  <small title={project.directory}>{project.directory}</small>
                </span>
                <span class="project-state">Connect →</span>
              </button>
            )}
          </For>
        </div>
      </Show>
      <form
        class="connect-form"
        onSubmit={(event) => {
          event.preventDefault()
          props.onConnect(directory().trim())
        }}
      >
        <label for="folder">Connect a folder</label>
        <input
          id="folder"
          placeholder="Absolute path to your project"
          value={directory()}
          disabled={props.busy}
          autocomplete="off"
          spellcheck={false}
          required
          onInput={(event) => setDirectory(event.currentTarget.value)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const transfer = event.dataTransfer
            if (!transfer || props.busy) return
            if (transfer.files.length && !transfer.getData("text/uri-list")) {
              props.onError("The host did not share this folder’s path. Paste its absolute path here.")
              return
            }
            void Promise.resolve()
              .then(() =>
                setDirectory(folderFromDrop(transfer.getData("text/uri-list") || transfer.getData("text/plain"))),
              )
              .catch((cause: unknown) => props.onError(cause instanceof Error ? cause.message : String(cause)))
          }}
        />
        <p class="hint">Paste or drop a folder path. It must already contain a Beads tracker.</p>
        <button class="primary" disabled={props.busy || !directory().trim()}>
          {props.busy ? "Connecting…" : "Connect project"}
        </button>
      </form>
    </dialog>
  )
}
