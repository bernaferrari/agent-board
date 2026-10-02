import { createMemo, createSignal, For, Show } from "solid-js"
import type { Snapshot, TrackerStatus } from "../types"
import { folderFromDrop } from "./drop"

export function ProjectPicker(props: {
  snapshot: Snapshot
  busy: boolean
  error: string
  onClose: () => void
  onConnect: (directory: string) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  onError: (message: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const [directory, setDirectory] = createSignal("")
  const [opening, setOpening] = createSignal("")
  const projects = createMemo(() =>
    Array.from(
      new Map<string, { name: string; directory: string; id?: string; tracker?: TrackerStatus }>([
        ...props.snapshot.suggestions.map((item) => [item.directory, { ...item, id: undefined }] as const),
        ...props.snapshot.projects.map((item) => [item.directory, item] as const),
      ]).values(),
    ).sort(
      (a, b) =>
        Number(!!b.id) - Number(!!a.id) || a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory),
    ),
  )
  const filtered = createMemo(() =>
    projects().filter((item) => `${item.name} ${item.directory}`.toLowerCase().includes(query().trim().toLowerCase())),
  )
  const open = (project: { directory: string; id?: string; tracker?: TrackerStatus }) => {
    setOpening(project.directory)
    if (project.tracker === "missing")
      return props.onError(
        "This folder has no Beads tracker. Use the AgentBoard setup skill in ChatGPT to initialize one, then refresh this list.",
      )
    if (project.tracker === "unavailable")
      return props.onError("This folder is unavailable. Check its path or reconnect its drive, then refresh this list.")
    if (project.id) return props.onSelect(project.id)
    props.onConnect(project.directory)
  }
  return (
    <section class="project-picker" aria-labelledby="projects-heading">
      <Show when={props.snapshot.board}>
        <button class="text-button project-back" disabled={props.busy} onClick={props.onClose}>
          ← Back to board
        </button>
      </Show>
      <div class="project-heading">
        <div>
          <h2 id="projects-heading">Open a project</h2>
          <p>Your local projects from ChatGPT desktop.</p>
        </div>
        <button
          class="project-refresh"
          disabled={props.busy}
          onClick={() => {
            setOpening("")
            props.onRefresh()
          }}
        >
          {props.busy && !opening() ? "Refreshing…" : "Refresh list"}
        </button>
      </div>
      <Show when={props.snapshot.projectProblem}>
        <p class="project-message" role="status">
          {props.snapshot.projectProblem}
        </p>
      </Show>
      <Show when={projects().length}>
        <label class="sr-only" for="project-search">
          Search projects
        </label>
        <input
          id="project-search"
          class="project-search"
          type="search"
          placeholder="Search projects by name or path"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          autocomplete="off"
        />
        <div class="project-list-label">
          <span>{query().trim() ? `${filtered().length} of ${projects().length}` : projects().length} projects</span>
          <Show when={query()}>
            <button class="text-button" onClick={() => setQuery("")}>
              Clear search
            </button>
          </Show>
        </div>
      </Show>
      <div class="project-choices" role="list" aria-label="Local projects">
        <For
          each={filtered()}
          fallback={
            <div class="project-list-empty">
              <strong>{query() ? "No matching projects" : "No saved local projects"}</strong>
              <p>{query() ? "Try another name or path." : "Add a project folder below to get started."}</p>
            </div>
          }
        >
          {(project) => (
            <div role="listitem">
              <button
                class="project-choice"
                classList={{ "project-opening": opening() === project.directory }}
                disabled={props.busy}
                aria-label={`Open ${project.directory}`}
                onClick={() => open(project)}
              >
                <svg
                  class="project-folder"
                  classList={{ "has-tracker": project.tracker === "present" }}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <Show
                    when={project.tracker === "present"}
                    fallback={<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />}
                  >
                    <rect x="3" y="4" width="18" height="16" rx="3" />
                    <path d="M9 4v16M15 4v16M5.5 8h1M11.5 8h1M17.5 8h1M5.5 11h1M11.5 11h1" />
                  </Show>
                  <Show when={project.tracker === "unavailable"}>
                    <path d="m3 21 18-18" />
                  </Show>
                </svg>
                <span class="project-path">
                  <strong>{project.name}</strong>
                  <small>{project.directory}</small>
                </span>
                <span
                  class="project-state"
                  title={project.tracker === "present" ? "A .beads tracker folder exists here." : undefined}
                >
                  <span>
                    {props.busy && opening() === project.directory
                      ? "Opening…"
                      : project.tracker === "missing"
                        ? "No Beads"
                        : project.tracker === "unavailable"
                          ? "Unavailable"
                          : props.snapshot.board?.project.id === project.id && project.id
                            ? "Current"
                            : "Open →"}
                  </span>
                  <Show when={project.tracker === "present"}>
                    <small>Beads</small>
                  </Show>
                  <Show when={project.tracker === "unknown"}>
                    <small>Tracker unchecked</small>
                  </Show>
                </span>
              </button>
            </div>
          )}
        </For>
      </div>
      <Show when={props.error}>
        <div class="project-message error" role="alert">
          <strong>Couldn’t open this project</strong>
          <Show when={opening()}>
            <span class="project-error-path">{opening()}</span>
          </Show>
          <p>{props.error}</p>
        </div>
      </Show>
      <details class="project-manual" open={!projects().length}>
        <summary>Open another folder</summary>
        <form
          class="connect-form"
          onSubmit={(event) => {
            event.preventDefault()
            open({ directory: directory().trim() })
          }}
        >
          <label for="folder">Project folder path</label>
          <div class="project-path-form">
            <input
              id="folder"
              placeholder="/path/to/project"
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
            <button class="primary" disabled={props.busy || !directory().trim()}>
              Open folder
            </button>
          </div>
          <p class="hint">Paste or drop an absolute path. A board requires a Beads tracker in that folder.</p>
        </form>
      </details>
    </section>
  )
}
