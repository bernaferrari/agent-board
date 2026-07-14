import { randomUUID } from "node:crypto"
import { sql } from "drizzle-orm"
import { Effect, ManagedRuntime } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { Database } from "@opencode-ai/core/database/database"
import type {
  AgentBoardArtifact,
  AgentBoardArtifactKind,
  AgentBoardGraphPosition,
  AgentBoardProject,
  AgentBoardRun,
  AgentBoardRunEvent,
  AgentBoardRunStatus,
} from "./types"

type ProjectRow = {
  id: string
  worktree: string
  bd_db_path: string | null
  enabled: number
  time_created: number
  time_updated: number
}

type RunRow = {
  id: string
  project_id: string
  issue_id: string
  opencode_session_id: string | null
  status: AgentBoardRunStatus
  prompt: string | null
  agent: string | null
  model: string | null
  error: string | null
  time_started: number | null
  time_ended: number | null
  time_created: number
  time_updated: number
}

type ArtifactRow = {
  id: string
  run_id: string
  kind: AgentBoardArtifactKind
  title: string
  url: string | null
  path: string | null
  data_json: string | null
  time_created: number
}

type EventRow = {
  id: string
  run_id: string
  type: AgentBoardRunEvent["type"]
  message: string
  data_json: string | null
  time_created: number
}

type LeaseRow = {
  resource: string
  owner: string
  expires_at: number
  time_created: number
  time_updated: number
}

type GraphPositionRow = {
  project_id: string
  issue_id: string
  x: number
  y: number
  pinned: number
  time_updated: number
}

type Db = Database.Interface["db"]

// Same Database.node + process-wide memoMap as AppRuntime / the rest of the server.
// Agentboard Hono handlers leave Effect request context, so re-enter Database.Service here.
const dbRuntime = (() => {
  let runtime: ManagedRuntime.ManagedRuntime<Database.Service, never> | undefined
  return () => (runtime ??= ManagedRuntime.make(AppNodeBuilder.build(Database.node), { memoMap }))
})()

let initialized = false

function use<T>(fn: (db: Db) => Effect.Effect<T, unknown>) {
  return dbRuntime().runSync(Database.Service.use(({ db }) => fn(db).pipe(Effect.orDie)))
}

function ensure() {
  if (initialized) return
  use((db) =>
    Effect.gen(function* () {
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_project (
          id TEXT PRIMARY KEY,
          worktree TEXT NOT NULL UNIQUE,
          bd_db_path TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_run (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          issue_id TEXT NOT NULL,
          opencode_session_id TEXT,
          status TEXT NOT NULL,
          prompt TEXT,
          agent TEXT,
          model TEXT,
          error TEXT,
          time_started INTEGER,
          time_ended INTEGER,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`CREATE INDEX IF NOT EXISTS agentboard_run_project_issue_idx ON agentboard_run(project_id, issue_id)`)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_artifact (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT,
          path TEXT,
          data_json TEXT,
          time_created INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`CREATE INDEX IF NOT EXISTS agentboard_artifact_run_idx ON agentboard_artifact(run_id)`)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_run_event (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          data_json TEXT,
          time_created INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`CREATE INDEX IF NOT EXISTS agentboard_run_event_run_idx ON agentboard_run_event(run_id, time_created)`)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_lease (
          resource TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          time_created INTEGER NOT NULL,
          time_updated INTEGER NOT NULL
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_issue_state (
          project_id TEXT NOT NULL,
          issue_id TEXT NOT NULL,
          last_seen_at INTEGER NOT NULL,
          last_run_id TEXT,
          local_column_override TEXT,
          PRIMARY KEY(project_id, issue_id)
        )
      `)
      yield* db.run(sql`
        CREATE TABLE IF NOT EXISTS agentboard_graph_position (
          project_id TEXT NOT NULL,
          issue_id TEXT NOT NULL,
          x REAL NOT NULL,
          y REAL NOT NULL,
          pinned INTEGER NOT NULL DEFAULT 1,
          time_updated INTEGER NOT NULL,
          PRIMARY KEY(project_id, issue_id)
        )
      `)
    }),
  )
  initialized = true
}

function projectFromRow(row: ProjectRow): AgentBoardProject {
  return {
    id: row.id,
    worktree: row.worktree,
    bdDbPath: row.bd_db_path ?? undefined,
    enabled: row.enabled === 1,
    time: {
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function runFromRow(row: RunRow): AgentBoardRun {
  return {
    id: row.id,
    projectID: row.project_id,
    issueID: row.issue_id,
    opencodeSessionID: row.opencode_session_id ?? undefined,
    status: row.status,
    prompt: row.prompt ?? undefined,
    agent: row.agent ?? undefined,
    model: row.model ?? undefined,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      started: row.time_started ?? undefined,
      ended: row.time_ended ?? undefined,
    },
  }
}

function artifactFromRow(row: ArtifactRow): AgentBoardArtifact {
  return {
    id: row.id,
    runID: row.run_id,
    kind: row.kind,
    title: row.title,
    url: row.url ?? undefined,
    path: row.path ?? undefined,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    time: {
      created: row.time_created,
    },
  }
}

function eventFromRow(row: EventRow): AgentBoardRunEvent {
  return {
    id: row.id,
    runID: row.run_id,
    type: row.type,
    message: row.message,
    data: row.data_json ? JSON.parse(row.data_json) : undefined,
    time: {
      created: row.time_created,
    },
  }
}

function graphPositionFromRow(row: GraphPositionRow): AgentBoardGraphPosition {
  return {
    issueID: row.issue_id,
    x: row.x,
    y: row.y,
    pinned: row.pinned === 1,
  }
}

function hasOwn<T extends object, K extends PropertyKey>(input: T, key: K): input is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(input, key)
}

export const AgentBoardStore = {
  ensure,
  upsertProject(input: { worktree: string; bdDbPath?: string }) {
    ensure()
    const now = Date.now()
    return use((db) =>
      Effect.gen(function* () {
        const existing = yield* db.get<ProjectRow>(
          sql`SELECT * FROM agentboard_project WHERE worktree = ${input.worktree}`,
        )
        if (existing) {
          yield* db.run(sql`
            UPDATE agentboard_project
            SET bd_db_path = ${input.bdDbPath ?? null}, enabled = 1, time_updated = ${now}
            WHERE id = ${existing.id}
          `)
          return projectFromRow({
            ...existing,
            bd_db_path: input.bdDbPath ?? existing.bd_db_path,
            enabled: 1,
            time_updated: now,
          })
        }
        const id = `abp_${randomUUID()}`
        yield* db.run(sql`
          INSERT INTO agentboard_project (id, worktree, bd_db_path, enabled, time_created, time_updated)
          VALUES (${id}, ${input.worktree}, ${input.bdDbPath ?? null}, 1, ${now}, ${now})
        `)
        return projectFromRow({
          id,
          worktree: input.worktree,
          bd_db_path: input.bdDbPath ?? null,
          enabled: 1,
          time_created: now,
          time_updated: now,
        })
      }),
    )
  },
  listProjects() {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = yield* db.all<ProjectRow>(sql`SELECT * FROM agentboard_project ORDER BY time_updated DESC`)
        return rows.map(projectFromRow)
      }),
    )
  },
  getProject(projectID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const row = yield* db.get<ProjectRow>(sql`SELECT * FROM agentboard_project WHERE id = ${projectID}`)
        return row ? projectFromRow(row) : undefined
      }),
    )
  },
  createRun(input: { projectID: string; issueID: string; prompt: string; agent?: string; model?: string }) {
    ensure()
    const now = Date.now()
    const id = `abr_${randomUUID()}`
    use((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO agentboard_run
            (id, project_id, issue_id, opencode_session_id, status, prompt, agent, model, error, time_started, time_ended, time_created, time_updated)
          VALUES
            (${id}, ${input.projectID}, ${input.issueID}, NULL, 'queued', ${input.prompt}, ${input.agent ?? null}, ${input.model ?? null}, NULL, NULL, NULL, ${now}, ${now})
        `)
        yield* db.run(sql`
          INSERT INTO agentboard_issue_state (project_id, issue_id, last_seen_at, last_run_id, local_column_override)
          VALUES (${input.projectID}, ${input.issueID}, ${now}, ${id}, NULL)
          ON CONFLICT(project_id, issue_id) DO UPDATE SET last_seen_at = ${now}, last_run_id = ${id}
        `)
      }),
    )
    return this.getRun(id)!
  },
  updateRun(
    runID: string,
    patch: Partial<Omit<AgentBoardRun, "id" | "projectID" | "issueID" | "time">> & {
      status?: AgentBoardRunStatus
      started?: number
      ended?: number
    },
  ) {
    ensure()
    const current = this.getRun(runID)
    if (!current) return
    const now = Date.now()
    const next = {
      status: patch.status ?? current.status,
      opencodeSessionID: hasOwn(patch, "opencodeSessionID") ? patch.opencodeSessionID : current.opencodeSessionID,
      prompt: hasOwn(patch, "prompt") ? patch.prompt : current.prompt,
      agent: hasOwn(patch, "agent") ? patch.agent : current.agent,
      model: hasOwn(patch, "model") ? patch.model : current.model,
      error: hasOwn(patch, "error") ? patch.error : current.error,
      started: hasOwn(patch, "started") ? patch.started : current.time.started,
      ended: hasOwn(patch, "ended") ? patch.ended : current.time.ended,
    }
    use((db) =>
      db.run(sql`
        UPDATE agentboard_run
        SET status = ${next.status},
            opencode_session_id = ${next.opencodeSessionID ?? null},
            prompt = ${next.prompt ?? null},
            agent = ${next.agent ?? null},
            model = ${next.model ?? null},
            error = ${next.error ?? null},
            time_started = ${next.started ?? null},
            time_ended = ${next.ended ?? null},
            time_updated = ${now}
        WHERE id = ${runID}
      `),
    )
    return this.getRun(runID)
  },
  getRun(runID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const row = yield* db.get<RunRow>(sql`SELECT * FROM agentboard_run WHERE id = ${runID}`)
        return row ? runFromRow(row) : undefined
      }),
    )
  },
  listRuns(projectID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = yield* db.all<RunRow>(
          sql`SELECT * FROM agentboard_run WHERE project_id = ${projectID} ORDER BY time_created DESC`,
        )
        return rows.map(runFromRow)
      }),
    )
  },
  listActiveRuns(projectID?: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = projectID
          ? yield* db.all<RunRow>(
              sql`SELECT * FROM agentboard_run WHERE project_id = ${projectID} AND status IN ('queued', 'running') ORDER BY time_created ASC`,
            )
          : yield* db.all<RunRow>(
              sql`SELECT * FROM agentboard_run WHERE status IN ('queued', 'running') ORDER BY time_created ASC`,
            )
        return rows.map(runFromRow)
      }),
    )
  },
  latestRunByIssue(projectID: string) {
    const map = new Map<string, AgentBoardRun>()
    for (const run of this.listRuns(projectID)) {
      if (!map.has(run.issueID)) map.set(run.issueID, run)
    }
    return map
  },
  listArtifacts(runID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = yield* db.all<ArtifactRow>(
          sql`SELECT * FROM agentboard_artifact WHERE run_id = ${runID} ORDER BY time_created DESC`,
        )
        return rows.map(artifactFromRow)
      }),
    )
  },
  deleteArtifacts(runID: string, kinds?: AgentBoardArtifactKind[]) {
    ensure()
    use((db) =>
      Effect.gen(function* () {
        if (!kinds?.length) {
          yield* db.run(sql`DELETE FROM agentboard_artifact WHERE run_id = ${runID}`)
          return
        }
        for (const kind of kinds) {
          yield* db.run(sql`DELETE FROM agentboard_artifact WHERE run_id = ${runID} AND kind = ${kind}`)
        }
      }),
    )
  },
  addArtifact(input: {
    runID: string
    kind: AgentBoardArtifactKind
    title: string
    url?: string
    path?: string
    data?: unknown
  }) {
    ensure()
    const id = `aba_${randomUUID()}`
    const now = Date.now()
    use((db) =>
      db.run(sql`
        INSERT INTO agentboard_artifact (id, run_id, kind, title, url, path, data_json, time_created)
        VALUES (${id}, ${input.runID}, ${input.kind}, ${input.title}, ${input.url ?? null}, ${input.path ?? null}, ${
          input.data === undefined ? null : JSON.stringify(input.data)
        }, ${now})
      `),
    )
    return this.listArtifacts(input.runID).find((artifact: AgentBoardArtifact) => artifact.id === id)!
  },
  addRunEvent(input: { runID: string; type: AgentBoardRunEvent["type"]; message: string; data?: unknown }) {
    ensure()
    const id = `abe_${randomUUID()}`
    const now = Date.now()
    use((db) =>
      db.run(sql`
        INSERT INTO agentboard_run_event (id, run_id, type, message, data_json, time_created)
        VALUES (${id}, ${input.runID}, ${input.type}, ${input.message}, ${
          input.data === undefined ? null : JSON.stringify(input.data)
        }, ${now})
      `),
    )
    return this.listRunEvents(input.runID).find((event: AgentBoardRunEvent) => event.id === id)!
  },
  listRunEvents(runID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = yield* db.all<EventRow>(
          sql`SELECT * FROM agentboard_run_event WHERE run_id = ${runID} ORDER BY time_created ASC`,
        )
        return rows.map(eventFromRow)
      }),
    )
  },
  acquireLease(input: { resource: string; owner: string; ttlMs?: number }) {
    ensure()
    const now = Date.now()
    const expires = now + (input.ttlMs ?? 1000 * 60 * 60 * 8)
    return use((db) =>
      Effect.gen(function* () {
        const existing = yield* db.get<LeaseRow>(sql`SELECT * FROM agentboard_lease WHERE resource = ${input.resource}`)
        if (existing && existing.expires_at > now && existing.owner !== input.owner) {
          return false
        }
        yield* db.run(sql`
          INSERT INTO agentboard_lease (resource, owner, expires_at, time_created, time_updated)
          VALUES (${input.resource}, ${input.owner}, ${expires}, ${now}, ${now})
          ON CONFLICT(resource) DO UPDATE SET owner = ${input.owner}, expires_at = ${expires}, time_updated = ${now}
        `)
        return true
      }),
    )
  },
  releaseLease(input: { resource: string; owner: string }) {
    ensure()
    use((db) => db.run(sql`DELETE FROM agentboard_lease WHERE resource = ${input.resource} AND owner = ${input.owner}`))
  },
  listGraphPositions(projectID: string) {
    ensure()
    return use((db) =>
      Effect.gen(function* () {
        const rows = yield* db.all<GraphPositionRow>(
          sql`SELECT * FROM agentboard_graph_position WHERE project_id = ${projectID}`,
        )
        return rows.map(graphPositionFromRow)
      }),
    )
  },
  setGraphPositions(projectID: string, positions: AgentBoardGraphPosition[]) {
    ensure()
    const now = Date.now()
    use((db) =>
      Effect.gen(function* () {
        for (const position of positions) {
          if (!position.issueID || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue
          yield* db.run(sql`
            INSERT INTO agentboard_graph_position (project_id, issue_id, x, y, pinned, time_updated)
            VALUES (${projectID}, ${position.issueID}, ${position.x}, ${position.y}, ${position.pinned ? 1 : 0}, ${now})
            ON CONFLICT(project_id, issue_id) DO UPDATE SET
              x = ${position.x},
              y = ${position.y},
              pinned = ${position.pinned ? 1 : 0},
              time_updated = ${now}
          `)
        }
      }),
    )
  },
}
