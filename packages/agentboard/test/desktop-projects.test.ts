import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createServer } from "../src/server"
import { createStore } from "../src/store"
import { readDesktopProjects } from "../src/desktop-projects"
import type { Snapshot } from "../src/types"

test("project list reads existing desktop paths without importing or connecting folders", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentboard-desktop-"))
  const state = path.join(directory, "desktop.json")
  await Bun.write(
    state,
    JSON.stringify({
      "local-projects": {
        first: { rootPaths: ["/projects/first", "/projects/shared"] },
        second: { rootPaths: ["/projects/shared", "/projects/second"] },
      },
      "remote-projects": { secret: { rootPaths: ["/remote/secret"] } },
      "thread-workspace-root-hints": { irrelevant: "/private/thread" },
    }),
  )
  const store = await createStore(path.join(directory, "data"))
  const server = createServer(store, "<!doctype html>", { desktopState: state })
  const client = new Client({ name: "project-list-test", version: "1.0.0" })
  const transport = InMemoryTransport.createLinkedPair()
  await server.connect(transport[0])
  await client.connect(transport[1])
  const result = await client.callTool({ name: "project_list", arguments: {} })
  const stored = store.suggestions()
  await Bun.write(
    state,
    JSON.stringify({
      "local-projects": { fresh: { rootPaths: ["relative", "/projects/fresh/", 4] } },
    }),
  )
  store.importProjects(["/projects/imported"])
  const refreshed = await client.callTool({ name: "project_list", arguments: {} })
  await client.close()
  await server.close()
  store.close()
  await rm(directory, { recursive: true, force: true })
  const choices = result.structuredContent as Pick<Snapshot, "suggestions" | "projects">
  expect(choices.suggestions).toEqual([
    { name: "first", directory: "/projects/first" },
    { name: "second", directory: "/projects/second" },
    { name: "shared", directory: "/projects/shared" },
  ])
  expect(choices.projects).toEqual([])
  expect(stored).toEqual([])
  expect((refreshed.structuredContent as Pick<Snapshot, "suggestions">).suggestions).toEqual([
    { name: "fresh", directory: "/projects/fresh" },
    { name: "imported", directory: "/projects/imported" },
  ])
})

test("desktop preferences support legacy roots, empty modern projects and malformed-file recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentboard-desktop-"))
  const state = path.join(directory, "desktop.json")
  await Bun.write(
    state,
    JSON.stringify({
      "electron-saved-workspace-roots": ["/projects/legacy", "/projects/legacy", "relative", null],
    }),
  )
  const legacy = await readDesktopProjects(state)
  await Bun.write(
    state,
    JSON.stringify({
      "local-projects": {},
      "electron-saved-workspace-roots": ["/projects/removed"],
    }),
  )
  const empty = await readDesktopProjects(state)
  await Bun.write(state, "invalid JSON")
  const invalid = await readDesktopProjects(state)
  const missing = await readDesktopProjects(path.join(directory, "missing.json"))
  await rm(directory, { recursive: true, force: true })
  expect(legacy.suggestions).toEqual([{ name: "legacy", directory: "/projects/legacy" }])
  expect(empty.suggestions).toEqual([])
  expect(invalid.suggestions).toEqual([])
  expect(invalid.projectProblem).toContain("Couldn’t read")
  expect(missing.suggestions).toEqual([])
})
