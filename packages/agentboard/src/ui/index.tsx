import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import { app, call, connect, extensions, send } from "./bridge"
import { Graph } from "./graph"
import { planningPrompt } from "../prompts"
import { COLUMN_TITLES, Status } from "../types"
import type { AgentBoardCard, Snapshot } from "../types"
import "@openai/mcp-extensions/app/styles.css"
import "./style.css"

function Workspace() {
  const [snapshot, setSnapshot] = createSignal<Snapshot>({
    projects: [],
    board: null,
  })
  const [ready, setReady] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [view, setView] = createSignal<"board" | "list" | "graph">("board")
  const [query, setQuery] = createSignal("")
  const [type, setType] = createSignal("all")
  const [selected, setSelected] = createSignal<string>()
  const [creating, setCreating] = createSignal(false)
  const [directory, setDirectory] = createSignal("")
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [priority, setPriority] = createSignal(2)
  const [issueType, setIssueType] = createSignal("task")
  const [notes, setNotes] = createSignal("")
  const [dependsOn, setDependsOn] = createSignal("")
  const [dragID, setDragID] = createSignal<string>()
  const board = () => snapshot().board
  const allCards = createMemo(() => board()?.columns.flatMap((column) => column.cards) ?? [])
  const cards = createMemo(() =>
    allCards().filter(
      (card) =>
        [card.issue.id, card.issue.title, card.issue.description, ...(card.issue.labels ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query().toLowerCase()) &&
        (type() === "all" || card.issue.raw.issue_type === type()),
    ),
  )
  const card = createMemo(() => allCards().find((item) => item.issue.id === selected()))
  const [drawer, setDrawer] = createSignal<HTMLDialogElement>()
  const [composer, setComposer] = createSignal<HTMLDialogElement>()
  const select = (id: string) => {
    if (!allCards().some((item) => item.issue.id === id)) {
      setError("This prerequisite is outside the current board. Refresh or inspect it in Beads.")
      return
    }
    setSelected(id)
    setNotes("")
    setError("")
    setNotice("")
    drawer()?.showModal()
  }
  const perform = async (action: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    setError("")
    setNotice("")
    await action().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    setBusy(false)
  }
  const refresh = async () =>
    setSnapshot(await call<Snapshot>("board_read", board() ? { projectID: board()!.project.id } : {}))
  const update = async (issueID: string, status: string) => {
    if (!board()) return
    setSnapshot(
      await call<Snapshot>("issue_update", {
        projectID: board()!.project.id,
        issueID,
        status,
      }),
    )
  }
  const context = async () => {
    if (!card() || !board()) throw new Error("Select an issue first.")
    return call<{ prompt: string }>("issue_context", {
      projectID: board()!.project.id,
      issueID: card()!.issue.id,
    })
  }
  const attach = async () => {
    const result = await context()
    const content = [
      {
        type: "text" as const,
        text: result.prompt,
        _meta: { "openai/title": card()!.issue.title },
      },
    ]
    if (extensions.modelContext) await extensions.modelContext.update({ content })
    if (!extensions.modelContext) await app.updateModelContext({ content })
    setNotice("Issue attached to the chat. Send your message when you’re ready.")
  }
  connect(setSnapshot, setError)
    .then(() => setReady(true))
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  const interval = setInterval(() => {
    if (ready() && board() && !busy() && document.visibilityState === "visible")
      void refresh().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, 15000)
  onCleanup(() => clearInterval(interval))

  const Card = (props: { card: AgentBoardCard }) => (
    <article
      class="issue-card"
      draggable={!busy()}
      onDragStart={(event) => {
        setDragID(props.card.issue.id)
        event.dataTransfer?.setData("text/plain", props.card.issue.id)
      }}
      onDragEnd={() => setDragID(undefined)}
    >
      <button class="card-open" onClick={() => select(props.card.issue.id)}>
        <span class="card-meta">
          <span class="issue-id">{props.card.issue.id}</span>
          <span class="priority">P{props.card.issue.priority ?? 2}</span>
        </span>
        <strong>{props.card.issue.title}</strong>
      </button>
      <div class="card-tags">
        <span>{String(props.card.issue.raw.issue_type ?? "task")}</span>
        <Show when={props.card.issue.blocked}>
          <span class="blocked-badge">Blocked</span>
        </Show>
        <For each={(props.card.issue.labels ?? []).filter((label) => label !== "agentboard:review").slice(0, 2)}>
          {(label) => <span>{label}</span>}
        </For>
      </div>
    </article>
  )

  return (
    <main class="workspace">
      <header class="toolbar">
        <div class="brand">
          <span class="brand-icon">▦</span>
          <div>
            <h1>AgentBoard</h1>
            <span class="subtitle">Your work, connected.</span>
          </div>
        </div>
        <Show when={snapshot().projects.length}>
          <select
            class="project-select"
            aria-label="Project"
            value={board()?.project.id ?? ""}
            disabled={busy()}
            onChange={(event) => {
              setSelected(undefined)
              void perform(async () =>
                setSnapshot(
                  await call<Snapshot>("board_read", {
                    projectID: event.currentTarget.value,
                  }),
                ),
              )
            }}
          >
            <For each={snapshot().projects}>{(project) => <option value={project.id}>{project.name}</option>}</For>
          </select>
        </Show>
        <div class="toolbar-spacer" />
        <button disabled={!ready() || busy()} onClick={() => void perform(refresh)}>
          Refresh
        </button>
        <Show when={board()}>
          <button
            class="primary"
            disabled={busy()}
            onClick={() => {
              setCreating(true)
              composer()?.showModal()
            }}
          >
            + New issue
          </button>
        </Show>
      </header>
      <Show when={error()}>
        <div class="banner error" role="alert">
          <span>{error()}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      </Show>
      <Show when={notice()}>
        <div class="banner" role="status">
          {notice()}
        </div>
      </Show>
      <Show
        when={ready()}
        fallback={
          <div class="empty">
            <h2>Connecting to ChatGPT…</h2>
            <p>Open AgentBoard from the plugin’s workspace entrypoint.</p>
          </div>
        }
      >
        <Show
          when={board()}
          fallback={
            <div class="empty">
              <span class="empty-icon">▦</span>
              <h2>Bring your project into focus</h2>
              <p>Connect a local folder with a Beads tracker to plan work and hand issues to ChatGPT.</p>
              <form
                class="connect-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void perform(async () =>
                    setSnapshot(
                      await call<Snapshot>("project_connect", {
                        directory: directory(),
                      }),
                    ),
                  )
                }}
              >
                <label for="folder">Project folder</label>
                <input
                  id="folder"
                  placeholder="/Users/you/projects/my-project"
                  value={directory()}
                  onInput={(event) => setDirectory(event.currentTarget.value)}
                  required
                />
                <button class="primary" disabled={busy()}>
                  Connect project
                </button>
              </form>
              <p class="hint">New project? Ask ChatGPT to set up Beads in this folder first.</p>
            </div>
          }
        >
          <nav class="view-toolbar" aria-label="Board views">
            <div class="view-tabs">
              <For each={["board", "list", "graph"] as const}>
                {(mode) => (
                  <button
                    classList={{ active: view() === mode }}
                    aria-pressed={view() === mode}
                    onClick={() => setView(mode)}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                )}
              </For>
            </div>
            <label class="search">
              <span class="sr-only">Search issues</span>
              <input
                type="search"
                placeholder="Search issues…"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <select aria-label="Issue type" value={type()} onChange={(event) => setType(event.currentTarget.value)}>
              <option value="all">All types</option>
              <For each={["task", "bug", "feature", "epic"]}>{(value) => <option>{value}</option>}</For>
            </select>
            <span class="count">{cards().length} issues</span>
          </nav>
          <Show when={view() === "board"}>
            <section class="kanban" aria-label="Kanban board">
              <For each={board()!.columns}>
                {(column) => (
                  <section
                    class={`column ${column.id}`}
                    onDragOver={(event) => {
                      if (dragID()) event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const id = dragID()
                      setDragID(undefined)
                      if (id) void perform(() => update(id, column.id))
                    }}
                  >
                    <h2>
                      <span class={`status-dot ${column.id}`} />
                      {column.title}
                      <span class="column-count">{cards().filter((card) => card.column === column.id).length}</span>
                    </h2>
                    <div class="column-cards">
                      <For each={cards().filter((card) => card.column === column.id)}>
                        {(item) => <Card card={item} />}
                      </For>
                      <Show when={!cards().some((card) => card.column === column.id)}>
                        <p class="column-empty">{query() ? "No matching issues" : "No issues here yet"}</p>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
            </section>
          </Show>
          <Show when={view() === "list"}>
            <div class="list-view">
              <table>
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={cards()}>
                    {(item) => (
                      <tr>
                        <td>
                          <button class="list-title" onClick={() => select(item.issue.id)}>
                            <span>{item.issue.id}</span>
                            <strong>{item.issue.title}</strong>
                          </button>
                        </td>
                        <td>
                          <span class={`status-dot ${item.column}`} />
                          {COLUMN_TITLES[item.column]}
                          {item.issue.blocked ? " · Blocked" : ""}
                        </td>
                        <td class="numeric">P{item.issue.priority ?? 2}</td>
                        <td>{String(item.issue.raw.issue_type ?? "task")}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <Show when={!cards().length}>
                <p class="column-empty">No matching issues</p>
              </Show>
            </div>
          </Show>
          <Show when={view() === "graph"}>
            <Graph
              board={board()!}
              cards={cards()}
              busy={busy()}
              onSelect={select}
              onSave={(positions) =>
                void perform(async () => {
                  await call("graph_save_positions", {
                    projectID: board()!.project.id,
                    positions,
                  })
                })
              }
            />
          </Show>
          <footer class="workspace-footer">
            <span>Local Beads · {board()!.project.directory}</span>
            <button
              onClick={() => {
                setSnapshot({ ...snapshot(), board: null })
                setDirectory("")
              }}
            >
              Connect another project
            </button>
          </footer>
        </Show>
      </Show>
      <dialog class="drawer" ref={setDrawer} onClose={() => setSelected(undefined)} aria-labelledby="issue-heading">
        <Show when={error()}>
          <p class="dialog-message error" role="alert">
            {error()}
          </p>
        </Show>
        <Show when={notice()}>
          <p class="dialog-message" role="status">
            {notice()}
          </p>
        </Show>
        <Show when={card()}>
          {(current) => (
            <>
              <div class="drawer-top">
                <span class="issue-id">{current().issue.id}</span>
                <button aria-label="Close issue" onClick={() => drawer()?.close()}>
                  ×
                </button>
              </div>
              <h2 id="issue-heading">{current().issue.title}</h2>
              <div class="detail-properties">
                <label for="issue-status">Status</label>
                <select
                  id="issue-status"
                  disabled={busy()}
                  value={current().column}
                  onChange={(event) => void perform(() => update(current().issue.id, event.currentTarget.value))}
                >
                  <For each={Status.options}>{(status) => <option value={status}>{COLUMN_TITLES[status]}</option>}</For>
                </select>
                <span>Priority</span>
                <span>P{current().issue.priority ?? 2}</span>
                <span>Type</span>
                <span>{String(current().issue.raw.issue_type ?? "task")}</span>
              </div>
              <Show when={current().issue.blocked}>
                <p class="blocked-message">This issue has unresolved blockers.</p>
              </Show>
              <div class="handoff-actions">
                <button
                  class="primary"
                  disabled={busy() || current().issue.blocked || !extensions.message}
                  onClick={() =>
                    void perform(async () => {
                      const result = await context()
                      await send(result.prompt, "new")
                      drawer()?.close()
                    })
                  }
                >
                  Work in new chat ↗
                </button>
                <button disabled={busy()} onClick={() => void perform(attach)}>
                  Attach to chat
                </button>
              </div>
              <section class="detail-section">
                <h3>Description</h3>
                <p class="description">{current().issue.description || "No description yet."}</p>
              </section>
              <section class="detail-section">
                <h3>Dependencies</h3>
                <For each={board()?.graph.dependencies.filter((edge) => edge.fromIssueID === current().issue.id)}>
                  {(edge) => (
                    <div class="dependency">
                      <button onClick={() => select(edge.toIssueID)}>
                        {allCards().find((item) => item.issue.id === edge.toIssueID)?.issue.title ?? edge.toIssueID}
                      </button>
                      <button
                        aria-label={`Remove dependency ${edge.toIssueID}`}
                        disabled={busy()}
                        onClick={() =>
                          void perform(async () =>
                            setSnapshot(
                              await call<Snapshot>("dependency_update", {
                                projectID: board()!.project.id,
                                issueID: current().issue.id,
                                dependsOnID: edge.toIssueID,
                                action: "remove",
                              }),
                            ),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  )}
                </For>
                <form
                  class="dependency-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void perform(async () => {
                      setSnapshot(
                        await call<Snapshot>("dependency_update", {
                          projectID: board()!.project.id,
                          issueID: current().issue.id,
                          dependsOnID: dependsOn(),
                          action: "add",
                        }),
                      )
                      setDependsOn("")
                    })
                  }}
                >
                  <label class="sr-only" for="depends-on">
                    Depends on issue
                  </label>
                  <select
                    id="depends-on"
                    value={dependsOn()}
                    onChange={(event) => setDependsOn(event.currentTarget.value)}
                    required
                  >
                    <option value="">Add a prerequisite…</option>
                    <For each={allCards().filter((item) => item.issue.id !== current().issue.id)}>
                      {(item) => <option value={item.issue.id}>{item.issue.title}</option>}
                    </For>
                  </select>
                  <button disabled={busy() || !dependsOn()}>Add</button>
                </form>
              </section>
              <section class="detail-section">
                <h3>Notes</h3>
                <p class="description">{String(current().issue.raw.notes ?? "No notes yet.")}</p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void perform(async () => {
                      setSnapshot(
                        await call<Snapshot>("issue_update", {
                          projectID: board()!.project.id,
                          issueID: current().issue.id,
                          notes: notes(),
                        }),
                      )
                      setNotes("")
                    })
                  }}
                >
                  <label class="sr-only" for="note">
                    Add a note
                  </label>
                  <textarea
                    id="note"
                    placeholder="Record progress or a review note…"
                    value={notes()}
                    onInput={(event) => setNotes(event.currentTarget.value)}
                    required
                  />
                  <button disabled={busy() || !notes().trim()}>Add note</button>
                </form>
              </section>
              <section class="detail-section">
                <h3>Activity</h3>
                <p class="hint">Updated {String(current().issue.raw.updated_at ?? "recently")}</p>
                <p class="hint">Created {String(current().issue.raw.created_at ?? "earlier")}</p>
              </section>
            </>
          )}
        </Show>
      </dialog>
      <dialog class="composer" ref={setComposer} onClose={() => setCreating(false)} aria-labelledby="create-heading">
        <div class="drawer-top">
          <h2 id="create-heading">New issue</h2>
          <button aria-label="Close new issue" onClick={() => composer()?.close()}>
            ×
          </button>
        </div>
        <Show when={error()}>
          <p class="dialog-message error" role="alert">
            {error()}
          </p>
        </Show>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void perform(async () => {
              setSnapshot(
                await call<Snapshot>("issue_create", {
                  projectID: board()!.project.id,
                  title: title(),
                  description: description(),
                  priority: priority(),
                  type: issueType(),
                }),
              )
              setTitle("")
              setDescription("")
              composer()?.close()
            })
          }}
        >
          <label for="new-title">Title</label>
          <input
            id="new-title"
            value={title()}
            onInput={(event) => setTitle(event.currentTarget.value)}
            placeholder="What needs to be done?"
            required
            maxlength="500"
          />
          <label for="new-description">Description</label>
          <textarea
            id="new-description"
            value={description()}
            onInput={(event) => setDescription(event.currentTarget.value)}
            placeholder="Context and acceptance criteria"
          />
          <div class="composer-properties">
            <label>
              Priority
              <select value={priority()} onChange={(event) => setPriority(Number(event.currentTarget.value))}>
                <For each={[0, 1, 2, 3, 4]}>{(value) => <option value={value}>P{value}</option>}</For>
              </select>
            </label>
            <label>
              Type
              <select value={issueType()} onChange={(event) => setIssueType(event.currentTarget.value)}>
                <For each={["task", "bug", "feature", "epic"]}>{(value) => <option>{value}</option>}</For>
              </select>
            </label>
          </div>
          <div class="composer-actions">
            <button
              type="button"
              disabled={busy() || !title().trim() || !extensions.message}
              onClick={() =>
                void perform(async () => {
                  await send(planningPrompt(board()!.project, `${title()}\n${description()}`), "new")
                  composer()?.close()
                })
              }
            >
              Plan in ChatGPT ↗
            </button>
            <button class="primary" disabled={busy() || !title().trim()}>
              {busy() && creating() ? "Creating…" : "Create issue"}
            </button>
          </div>
        </form>
      </dialog>
      <Show when={busy()}>
        <span class="saving" role="status">
          Updating…
        </span>
      </Show>
    </main>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("AgentBoard root element is missing.")
render(() => <Workspace />, root)
