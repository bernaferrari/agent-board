import { Database } from "bun:sqlite"
import { mkdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { Position, Project } from "./types"

export async function createStore(directory: string) {
  await mkdir(directory, { recursive: true })
  const db = new Database(path.join(directory, "agentboard.sqlite"), {
    create: true,
  })
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS position (project_id TEXT NOT NULL, issue_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, PRIMARY KEY (project_id, issue_id));`)
  return {
    list: () =>
      z
        .array(z.object({ id: z.string(), name: z.string(), directory: z.string() }))
        .parse(db.query("SELECT * FROM project ORDER BY name").all()),
    get(id: string): Project {
      const project = z
        .object({ id: z.string(), name: z.string(), directory: z.string() })
        .safeParse(db.query("SELECT * FROM project WHERE id = ?").get(id))
      if (!project.success) throw new Error("Project is not connected. Connect its folder first.")
      return project.data
    },
    async connect(directory: string) {
      if (!path.isAbsolute(directory)) throw new Error("Choose an absolute project folder path.")
      const resolved = await realpath(directory)
      if (!(await stat(path.join(resolved, ".beads"))).isDirectory())
        throw new Error("This folder needs a Beads tracker. Run bd init there first.")
      const existing = db.query("SELECT id FROM project WHERE directory = ?").get(resolved)
      const id = z.object({ id: z.string() }).safeParse(existing)
      const project = {
        id: id.success ? id.data.id : crypto.randomUUID(),
        name: path.basename(resolved),
        directory: resolved,
      }
      db.query(
        "INSERT INTO project (id, name, directory) VALUES (?, ?, ?) ON CONFLICT(directory) DO UPDATE SET name = excluded.name",
      ).run(project.id, project.name, project.directory)
      return project
    },
    positions(projectID: string) {
      return z
        .array(z.object({ issueID: z.string(), x: z.number(), y: z.number() }))
        .parse(db.query("SELECT issue_id AS issueID, x, y FROM position WHERE project_id = ?").all(projectID))
    },
    savePositions(projectID: string, positions: Position[]) {
      db.transaction(() =>
        positions.forEach((item) =>
          db
            .query("INSERT OR REPLACE INTO position (project_id, issue_id, x, y) VALUES (?, ?, ?, ?)")
            .run(projectID, item.issueID, item.x, item.y),
        ),
      )()
    },
    close: () => db.close(),
  }
}
export type Store = Awaited<ReturnType<typeof createStore>>
