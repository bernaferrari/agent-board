import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { render } from "solid-js/web"
import { app, call, connect, extensions, send } from "./bridge"
import { Graph } from "./graph"
import { IssueComposer, PRIORITIES } from "./issue-composer"
import { ProjectPicker } from "./project-picker"
import { draftFromDrop } from "./drop"
import type { IssueDraft } from "./drop"
import { planningPrompt } from "../prompts"
import { COLUMN_TITLES, IssueType, Status } from "../types"
import type { AgentBoardCard, Snapshot } from "../types"
import "@openai/mcp-extensions/app/styles.css"
import "./style.css"

function Workspace() {
  const [snapshot, setSnapshot] = createSignal<Snapshot>({
    projects: [],
    suggestions: [],
    board: null,
  })
  const [ready, setReady] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [view, setView] = createSignal<"board" | "list" | "graph">("board")
  const [query, setQuery] = createSignal("")
  const [type, setType] = createSignal("all")
  const [selected, setSelected] = createSignal<string>()
  const [draft, setDraft] = createSignal<IssueDraft>()
  const [choosingProject, setChoosingProject] = createSignal(false)
  const [hideClosed, setHideClosed] = createSignal(false)
  const [sort, setSort] = createSignal("priority")
  const [dropColumn, setDropColumn] = createSignal<string>()
  const [externalDrop, setExternalDrop] = createSignal(false)
  const [notes, setNotes] = createSignal("")
  const [dependsOn, setDependsOn] = createSignal("")
  const [dragID, setDragID] = createSignal<string>()
  const board = () => snapshot().board
  const allCards = createMemo(() => board()?.columns.flatMap((column) => column.cards) ?? [])
  const cards = createMemo(() =>
    allCards()
      .filter(
        (card) =>
          [card.issue.id, card.issue.title, card.issue.description, ...(card.issue.labels ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query().trim().toLowerCase()) &&
          (type() === "all" || card.issue.raw.issue_type === type()) &&
          (!hideClosed() || card.column !== "closed"),
      )
      .sort((a, b) =>
        sort() === "title"
          ? a.issue.title.localeCompare(b.issue.title)
          : sort() === "updated"
            ? String(b.issue.raw.updated_at ?? "").localeCompare(String(a.issue.raw.updated_at ?? ""))
            : Number(a.issue.priority ?? 2) - Number(b.issue.priority ?? 2) ||
              a.issue.title.localeCompare(b.issue.title),
      ),
  )
  const byID = createMemo(() => new Map(allCards().map((item) => [item.issue.id, item])))
  const filtered = () => !!query().trim() || type() !== "all" || hideClosed()
  const clearFilters = () => {
    setQuery("")
    setType("all")
    setHideClosed(false)
  }
  const card = createMemo(() => allCards().find((item) => item.issue.id === selected()))
  const [drawer, setDrawer] = createSignal<HTMLDialogElement>()
  const openDraft = (value: IssueDraft = { title: "", description: "", priority: 2, type: "task" }) => {
    setError("")
    setNotice("")
    setDraft(value)
  }
  const openProjects = () => {
    setError("")
    setNotice("")
    setChoosingProject(true)
  }
  const select = (id: string) => {
    if (!allCards().some((item) => item.issue.id === id)) {
      setError("This prerequisite is outside the current board. Refresh or inspect it in Beads.")
      return
    }
    setSelected(id)
    setNotes("")
    setDependsOn("")
    setError("")
    setNotice("")
    if (!drawer()?.open) drawer()?.showModal()
  }
  const background = { pending: undefined as Promise<void> | undefined }
  const perform = async (action: () => Promise<unknown>) => {
    if (busy()) return
    setBusy(true)
    await background.pending
    setError("")
    setNotice("")
    const success = await action()
      .then(() => true)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      })
    setBusy(false)
    return success
  }
  const refresh = async () => {
    setSnapshot(await call<Snapshot>("board_read", board() ? { projectID: board()!.project.id } : {}))
    setLoaded(true)
  }
  const update = async (issueID: string, status: string) => {
    if (!board() || allCards().find((item) => item.issue.id === issueID)?.column === status) return
    setSnapshot(
      await call<Snapshot>("issue_update", {
        projectID: board()!.project.id,
        issueID,
        status,
      }),
    )
    setNotice(`Moved issue to ${COLUMN_TITLES[Status.parse(status)]}.`)
  }
  const changeStatus = (issueID: string, element: HTMLSelectElement) => {
    const previous = allCards().find((item) => item.issue.id === issueID)?.column ?? "open"
    const next = element.value
    void perform(() => update(issueID, next)).then((success) => {
      if (!success) element.value = previous
    })
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
  connect(
    (value) => {
      setSnapshot(value)
      setLoaded(true)
      if (value.problem) setError(value.problem)
    },
    (message) => {
      setError(message)
      setLoaded(true)
    },
  )
    .then(() => setReady(true))
    .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  const interval = setInterval(() => {
    if (
      !ready() ||
      !board() ||
      busy() ||
      background.pending ||
      dragID() ||
      draft() ||
      selected() ||
      document.visibilityState !== "visible"
    )
      return
    background.pending = refresh()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        background.pending = undefined
      })
  }, 15000)
  onCleanup(() => clearInterval(interval))

  const searchInput = { current: undefined as HTMLInputElement | undefined }
  const shortcut = (event: KeyboardEvent) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable], dialog"))
    )
      return
    if (document.querySelector("dialog[open]")) return
    if (event.key === "/") {
      event.preventDefault()
      searchInput.current?.focus()
    }
    if (event.key.toLowerCase() === "n" && board() && !busy()) {
      event.preventDefault()
      openDraft()
    }
  }
  document.addEventListener("keydown", shortcut)
  onCleanup(() => document.removeEventListener("keydown", shortcut))

  const Card = (props: { card: AgentBoardCard }) => (
    <article
      class="issue-card"
      classList={{ "is-dragging": dragID() === props.card.issue.id }}
      draggable={!busy()}
      onDragStart={(event) => {
        setDragID(props.card.issue.id)
        event.dataTransfer?.setData("text/plain", props.card.issue.id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
      }}
      onDragEnd={() => {
        setDragID(undefined)
        setDropColumn(undefined)
      }}
    >
      <button class="card-open" onClick={() => select(props.card.issue.id)}>
        <span class="card-meta">
          <span class="issue-id">{props.card.issue.id}</span>
          <span class="priority" title={PRIORITIES[Number(props.card.issue.priority ?? 2)]}>
            P{props.card.issue.priority ?? 2}
          </span>
        </span>
        <strong>{props.card.issue.title}</strong>
        <Show when={props.card.issue.description}>
          <span class="card-description">{props.card.issue.description}</span>
        </Show>
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
    <main
      class="workspace"
      classList={{ "external-drop": externalDrop() }}
      onDragOver={(event) => {
        if (!board() || dragID() || busy() || document.querySelector("dialog[open]")) return
        if (event.target instanceof HTMLElement && event.target.closest("input,textarea")) return
        event.preventDefault()
        setExternalDrop(true)
      }}
      onDragLeave={(event) => {
        if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setExternalDrop(false)
      }}
      onDrop={(event) => {
        setExternalDrop(false)
        if (!board() || dragID() || busy() || document.querySelector("dialog[open]")) return
        if (event.target instanceof HTMLElement && event.target.closest("input,textarea")) return
        event.preventDefault()
        if (event.dataTransfer)
          void draftFromDrop(event.dataTransfer)
            .then(openDraft)
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      }}
    >
      <Show when={externalDrop()}>
        <div class="drop-overlay" aria-hidden="true">
          <strong>Drop to draft an issue</strong>
          <span>Text or a .md / .txt file · review before creating</span>
        </div>
      </Show>
      <header class="toolbar">
        <div class="brand">
          <span class="brand-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16M15 4v16M3 9h6M9 14h6M15 11h6" />
            </svg>
          </span>
          <div>
            <h1>AgentBoard</h1>
            <span class="subtitle">Your work, connected.</span>
          </div>
        </div>
        <Show when={snapshot().projects.length}>
          <button class="project-switch" disabled={busy()} title={board()?.project.directory} onClick={openProjects}>
            <span class="hint">Project</span>
            <strong>{board()?.project.name ?? "Choose a project"}</strong>
            <span aria-hidden="true">⌄</span>
          </button>
        </Show>
        <div class="toolbar-spacer" />
        <button disabled={!ready() || busy()} onClick={() => void perform(refresh)}>
          {busy() ? "Updating…" : "Refresh"}
        </button>
        <Show when={board()}>
          <button class="primary" disabled={busy()} title="New issue (N)" onClick={() => openDraft()}>
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
        when={ready() && loaded()}
        fallback={
          <div class="empty">
            <h2>{error() ? "AgentBoard couldn’t load" : "Loading your workspace…"}</h2>
            <p>
              {error()
                ? "Reopen AgentBoard from its workspace entrypoint, or refresh if the connection is ready."
                : "Connecting to your local projects and Beads tracker."}
            </p>
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
              <button class="primary empty-action" disabled={busy()} onClick={openProjects}>
                Choose a project
              </button>
              <p class="hint">Use a connected folder, import desktop paths, or paste a new path.</p>
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
                ref={(element) => (searchInput.current = element)}
                autocomplete="off"
                spellcheck={false}
                type="search"
                placeholder="Search issues…  /"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </label>
            <select aria-label="Issue type" value={type()} onChange={(event) => setType(event.currentTarget.value)}>
              <option value="all">All types</option>
              <For
                each={Array.from(
                  new Set([
                    ...IssueType.options,
                    ...allCards().map((item) => String(item.issue.raw.issue_type ?? "task")),
                  ]),
                )}
              >
                {(value) => <option>{value}</option>}
              </For>
            </select>
            <select aria-label="Sort issues" value={sort()} onChange={(event) => setSort(event.currentTarget.value)}>
              <option value="priority">Priority first</option>
              <option value="updated">Recently updated</option>
              <option value="title">Title A–Z</option>
            </select>
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={hideClosed()}
                onChange={(event) => setHideClosed(event.currentTarget.checked)}
              />
              Hide closed
            </label>
            <span class="count">
              {cards().length}
              {filtered() ? ` of ${allCards().length}` : ""} {cards().length === 1 ? "issue" : "issues"}
            </span>
          </nav>
          <Show when={filtered() && !cards().length}>
            <div class="filter-empty">
              <h2>No issues match your filters</h2>
              <p>Try a different search, type, or status.</p>
              <button onClick={clearFilters}>Clear filters</button>
            </div>
          </Show>
          <Show when={view() === "board" && (!filtered() || cards().length)}>
            <section class="kanban" aria-label="Kanban board">
              <For each={Status.options}>
                {(status) => (
                  <section
                    class={`column ${status}`}
                    classList={{ "drop-target": dropColumn() === status }}
                    onDragOver={(event) => {
                      if (!dragID() || busy()) return
                      event.preventDefault()
                      setDropColumn(status)
                      if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropColumn(undefined)
                    }}
                    onDrop={(event) => {
                      if (!dragID()) return
                      event.preventDefault()
                      event.stopPropagation()
                      setDropColumn(undefined)
                      const id = dragID()
                      setDragID(undefined)
                      if (id) void perform(() => update(id, status))
                    }}
                  >
                    <h2>
                      <span class={`status-dot ${status}`} />
                      {COLUMN_TITLES[status]}
                      <span class="column-count">{cards().filter((card) => card.column === status).length}</span>
                    </h2>
                    <div class="column-cards">
                      <For
                        each={cards()
                          .filter((card) => card.column === status)
                          .map((item) => item.issue.id)}
                      >
                        {(id) => <Card card={byID().get(id)!} />}
                      </For>
                      <Show when={!cards().some((card) => card.column === status)}>
                        <p class="column-empty">
                          {filtered()
                            ? "No matching issues"
                            : status === "open"
                              ? "Add an issue to get started"
                              : `Drop an issue to move it here`}
                        </p>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
            </section>
          </Show>
          <Show when={view() === "list" && (!filtered() || cards().length)}>
            <div class="list-view">
              <table>
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Status</th>
                    <th class="numeric">Priority</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={cards().map((item) => item.issue.id)}>
                    {(id) => {
                      const item = () => byID().get(id)!
                      return (
                        <tr>
                          <td>
                            <button class="list-title" onClick={() => select(item().issue.id)}>
                              <span>{item().issue.id}</span>
                              <strong>{item().issue.title}</strong>
                            </button>
                          </td>
                          <td>
                            <select
                              class="list-status"
                              aria-label={`Status for ${item().issue.title}`}
                              value={item().column}
                              disabled={busy()}
                              onChange={(event) => changeStatus(item().issue.id, event.currentTarget)}
                            >
                              <For each={Status.options}>
                                {(status) => <option value={status}>{COLUMN_TITLES[status]}</option>}
                              </For>
                            </select>
                            <Show when={item().issue.blocked}>
                              <span class="blocked-badge">Blocked</span>
                            </Show>
                          </td>
                          <td class="numeric">P{item().issue.priority ?? 2}</td>
                          <td>{String(item().issue.raw.issue_type ?? "task")}</td>
                        </tr>
                      )
                    }}
                  </For>
                </tbody>
              </table>
              <Show when={!cards().length}>
                <div class="filter-empty">
                  <h2>Your first issue starts here</h2>
                  <p>Create an issue to organize work for this project.</p>
                  <button onClick={() => openDraft()}>New issue</button>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={view() === "graph" && (!filtered() || cards().length)}>
            <Show when={board()!.project.id} keyed>
              {(projectID) => (
                <Graph
                  board={{ ...board()!, project: { ...board()!.project, id: projectID } }}
                  cards={cards()}
                  busy={busy()}
                  onSelect={select}
                  onSave={(positions) =>
                    perform(async () => {
                      await call("graph_save_positions", {
                        projectID: board()!.project.id,
                        positions,
                      })
                      setSnapshot((current) => ({
                        ...current,
                        board: current.board
                          ? {
                              ...current.board,
                              graph: {
                                ...current.board.graph,
                                positions: [
                                  ...current.board.graph.positions.filter(
                                    (item) => !positions.some((position) => position.issueID === item.issueID),
                                  ),
                                  ...positions,
                                ],
                              },
                            }
                          : null,
                      }))
                    })
                  }
                />
              )}
            </Show>
          </Show>
          <footer class="workspace-footer">
            <span title={board()!.project.directory}>Local Beads · {board()!.project.directory}</span>
            <span class="sync-time" title={new Date(board()!.generatedAt).toLocaleString()}>
              Synced {new Date(board()!.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button disabled={busy()} onClick={openProjects}>
              Manage projects
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
              <button
                class="edit-issue"
                disabled={busy()}
                onClick={() =>
                  openDraft({
                    issueID: current().issue.id,
                    title: current().issue.title,
                    description: current().issue.description ?? "",
                    priority: Number(current().issue.priority ?? 2),
                    type: String(current().issue.raw.issue_type ?? "task"),
                  })
                }
              >
                Edit issue
              </button>
              <div class="detail-properties">
                <label for="issue-status">Status</label>
                <select
                  id="issue-status"
                  disabled={busy()}
                  value={current().column}
                  onChange={(event) => changeStatus(current().issue.id, event.currentTarget)}
                >
                  <For each={Status.options}>{(status) => <option value={status}>{COLUMN_TITLES[status]}</option>}</For>
                </select>
                <span>Priority</span>
                <span>{PRIORITIES[Number(current().issue.priority ?? 2)]}</span>
                <span>Type</span>
                <span>{String(current().issue.raw.issue_type ?? "task")}</span>
              </div>
              <Show when={current().issue.blocked}>
                <p class="blocked-message">This issue has unresolved blockers.</p>
              </Show>
              <div class="handoff-actions">
                <button
                  class="primary"
                  disabled={busy() || current().issue.blocked || !ready() || !extensions.message}
                  title={
                    !extensions.message
                      ? "New-chat handoff is unavailable in this host"
                      : current().issue.blocked
                        ? "Resolve prerequisites before starting work"
                        : "Open this issue in a new ChatGPT conversation"
                  }
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
                <h3>Prerequisites</h3>
                <Show when={!board()?.graph.dependencies.some((edge) => edge.fromIssueID === current().issue.id)}>
                  <p class="hint">No prerequisites. This issue can stand on its own.</p>
                </Show>
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
                    disabled={busy()}
                    value={dependsOn()}
                    onChange={(event) => setDependsOn(event.currentTarget.value)}
                    required
                  >
                    <option value="">Choose a prerequisite…</option>
                    <For
                      each={allCards().filter(
                        (item) =>
                          item.issue.id !== current().issue.id &&
                          !board()?.graph.dependencies.some(
                            (edge) => edge.fromIssueID === current().issue.id && edge.toIssueID === item.issue.id,
                          ),
                      )}
                    >
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
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault()
                      event.currentTarget.requestSubmit()
                    }
                  }}
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
                      setNotice("Note added.")
                    })
                  }}
                >
                  <label class="sr-only" for="note">
                    Add a note
                  </label>
                  <textarea
                    id="note"
                    disabled={busy()}
                    maxlength="50000"
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
                <p class="hint">
                  Updated{" "}
                  {current().issue.raw.updated_at
                    ? new Date(String(current().issue.raw.updated_at)).toLocaleString()
                    : "recently"}
                </p>
                <p class="hint">
                  Created{" "}
                  {current().issue.raw.created_at
                    ? new Date(String(current().issue.raw.created_at)).toLocaleString()
                    : "earlier"}
                </p>
              </section>
            </>
          )}
        </Show>
      </dialog>
      <Show when={!!draft()}>
        <IssueComposer
          draft={draft()!}
          busy={busy()}
          error={error()}
          canPlan={ready() && !!extensions.message}
          project={board()?.project.name ?? ""}
          onChange={setDraft}
          onClose={() => setDraft(undefined)}
          onError={setError}
          onSave={() =>
            void perform(async () => {
              const current = draft()!
              setSnapshot(
                await call<Snapshot>(current.issueID ? "issue_update" : "issue_create", {
                  projectID: board()!.project.id,
                  ...(current.issueID ? { issueID: current.issueID } : {}),
                  ...(IssueType.safeParse(current.type).success ? { type: current.type } : {}),
                  title: current.title.trim(),
                  description: current.description,
                  priority: current.priority,
                }),
              )
              setDraft(undefined)
              setNotice(current.issueID ? "Issue updated." : "Issue created.")
            })
          }
          onPlan={() =>
            void perform(async () => {
              await send(planningPrompt(board()!.project, `${draft()!.title}\n${draft()!.description}`), "new")
              setDraft(undefined)
            })
          }
        />
      </Show>
      <Show when={choosingProject()}>
        <ProjectPicker
          snapshot={snapshot()}
          busy={busy()}
          error={error()}
          canImport={ready()}
          onClose={() => setChoosingProject(false)}
          onError={setError}
          onConnect={(directory) =>
            void perform(async () => {
              setSnapshot(await call<Snapshot>("project_connect", { directory }))
              clearFilters()
              setChoosingProject(false)
              setSelected(undefined)
            })
          }
          onSelect={(projectID) =>
            void perform(async () => {
              setSnapshot(await call<Snapshot>("board_read", { projectID }))
              clearFilters()
              setChoosingProject(false)
              setSelected(undefined)
            })
          }
          onImport={() =>
            void perform(async () => {
              await send(
                "Import my desktop project folder paths into AgentBoard. Use the host list_projects tool if available. Keep only absolute local paths on this host; exclude remote and cloud ChatGPT projects. Call AgentBoard project_import with the deduplicated paths array. Do not connect or initialize any folder. Tell me to refresh AgentBoard when done.",
                "active",
              )
              setChoosingProject(false)
              setNotice("Asked ChatGPT to import your local paths. Refresh after it finishes.")
            })
          }
        />
      </Show>
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
