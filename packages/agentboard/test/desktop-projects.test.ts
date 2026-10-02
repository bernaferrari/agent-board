import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createServer } from "../src/server"
import { createStore } from "../src/store"
import { readDesktopProjects } from "../src/desktop-projects"
import type { Snapshot } from "../src/types"

test("project choices distinguish trackers and open without reading a slow or unavailable last board", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentboard-tracker-"))
  const ready = path.join(directory, "ready")
  const plain = path.join(directory, "plain")
  const offline = path.join(directory, "offline")
  await mkdir(path.join(ready, ".beads"), { recursive: true })
  await mkdir(plain)
  await mkdir(path.join(offline, ".beads"), { recursive: true })
  const store = await createStore(path.join(directory, "data"))
  const selected = await store.connect(offline)
  store.select(selected.id)
  await rename(offline, `${offline}-removed`)
  store.importProjects([ready, plain, offline])
  const server = createServer(store, "<!doctype html>", { desktopState: path.join(directory, "missing.json") })
  const client = new Client({ name: "tracker-check-test", version: "1.0.0" })
  const transport = InMemoryTransport.createLinkedPair()
  await server.connect(transport[0])
  await client.connect(transport[1])
  const opened = await client.callTool({ name: "board_open", arguments: {} })
  const listed = await client.callTool({ name: "project_list", arguments: {} })
  await rm(path.join(ready, ".beads"), { recursive: true })
  const refreshed = await client.callTool({ name: "project_list", arguments: {} })
  await client.close()
  await server.close()
  store.close()
  await rm(directory, { recursive: true, force: true })
  expect(opened.isError).not.toBe(true)
  expect((opened.structuredContent as Snapshot).problem).toBeUndefined()
  expect((opened.structuredContent as Snapshot).board).toBeNull()
  const choices = listed.structuredContent as Pick<Snapshot, "projects" | "suggestions">
  expect(choices.projects[0]).toMatchObject({ directory: selected.directory, tracker: "unavailable" })
  expect(choices.suggestions).toContainEqual({ name: "ready", directory: ready, tracker: "present" })
  expect(choices.suggestions).toContainEqual({ name: "plain", directory: plain, tracker: "missing" })
  expect((refreshed.structuredContent as Pick<Snapshot, "suggestions">).suggestions).toContainEqual({
    name: "ready",
    directory: ready,
    tracker: "missing",
  })
})

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
  expect(choices.suggestions).toHaveLength(3)
  expect(choices.suggestions).toMatchObject([
    { name: "first", directory: "/projects/first" },
    { name: "shared", directory: "/projects/shared" },
    { name: "second", directory: "/projects/second" },
  ])
  expect(choices.projects).toEqual([])
  expect(stored).toEqual([])
  expect((refreshed.structuredContent as Pick<Snapshot, "suggestions">).suggestions).toMatchObject([
    { name: "fresh", directory: "/projects/fresh" },
    { name: "imported", directory: "/projects/imported" },
  ])
})

test("desktop project order and renamed labels survive merging imported paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentboard-sidebar-"))
  const state = path.join(directory, "desktop.json")
  const entries = {
    alpha: { name: "Zebra board", rootPaths: ["/projects/alpha", "/projects/shared"] },
    beta: { name: "Desktop beta", rootPaths: ["/projects/beta", "/projects/shared"] },
    remainder: { name: 42, rootPaths: ["/projects/remainder"] },
  }
  await Bun.write(
    state,
    JSON.stringify({ "local-projects": entries, "project-order": ["unknown", "beta", "beta", 4, "alpha"] }),
  )
  const store = await createStore(path.join(directory, "data"))
  store.importProjects(["/projects/extra", "/projects/alpha"])
  const server = createServer(store, "<!doctype html>", { desktopState: state })
  const client = new Client({ name: "sidebar-order-test", version: "1.0.0" })
  const transport = InMemoryTransport.createLinkedPair()
  await server.connect(transport[0])
  await client.connect(transport[1])
  const first = await client.callTool({ name: "project_list", arguments: {} })
  await Bun.write(state, JSON.stringify({ "local-projects": entries, "project-order": ["alpha", "beta"] }))
  const refreshed = await client.callTool({ name: "project_list", arguments: {} })
  await client.close()
  await server.close()
  store.close()
  await rm(directory, { recursive: true, force: true })
  expect((first.structuredContent as Snapshot).suggestions).toMatchObject([
    { name: "Desktop beta", directory: "/projects/beta" },
    { name: "Desktop beta", directory: "/projects/shared" },
    { name: "Zebra board", directory: "/projects/alpha" },
    { name: "remainder", directory: "/projects/remainder" },
    { name: "extra", directory: "/projects/extra" },
  ])
  expect((refreshed.structuredContent as Snapshot).suggestions).toMatchObject([
    { name: "Zebra board", directory: "/projects/alpha" },
    { name: "Zebra board", directory: "/projects/shared" },
    { name: "Desktop beta", directory: "/projects/beta" },
    { name: "remainder", directory: "/projects/remainder" },
    { name: "extra", directory: "/projects/extra" },
  ])
})

test("desktop preferences support legacy roots, empty modern projects and malformed-file recovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentboard-desktop-"))
  const state = path.join(directory, "desktop.json")
  await Bun.write(
    state,
    JSON.stringify({
      "electron-saved-workspace-roots": ["/projects/legacy", "/projects/legacy", "relative", null],
      "electron-workspace-root-labels": { "/projects/legacy": "Renamed legacy" },
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
  expect(legacy.suggestions).toEqual([{ name: "Renamed legacy", directory: "/projects/legacy" }])
  expect(empty.suggestions).toEqual([])
  expect(invalid.suggestions).toEqual([])
  expect(invalid.projectProblem).toContain("Couldn’t read")
  expect(missing.suggestions).toEqual([])
})
