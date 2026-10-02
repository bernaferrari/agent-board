import { expect, test } from "bun:test"
import { readSnapshot, readToolData } from "../src/ui/tool-result"

const snapshot = { projects: [], suggestions: [], board: null }

test("loads snapshots from structured and text-only MCP replies", () => {
  expect(readSnapshot(readToolData({ content: [], structuredContent: snapshot }))).toEqual(snapshot)
  expect(readSnapshot(readToolData({ content: [{ type: "text", text: JSON.stringify(snapshot) }] }))).toEqual(snapshot)
  expect(readSnapshot(readToolData({ content: [{ type: "text", text: '{"projects":[],"board":null}' }] }))).toEqual(
    snapshot,
  )
})

test("rejects missing, invalid and failed replies before they reach UI state", () => {
  expect(() => readToolData({ content: [] })).toThrow("did not include")
  expect(() => readToolData({ content: [{ type: "text", text: "not JSON" }] })).toThrow("unreadable")
  expect(() => readToolData({ content: [], structuredContent: null })).toThrow("did not include")
  expect(() => readToolData({ content: [], structuredContent: [] })).toThrow("unreadable")
  expect(() => readToolData({ content: [{ type: "text", text: "Beads is unavailable" }], isError: true })).toThrow(
    "Beads is unavailable",
  )
  expect(() => readSnapshot({ projects: [], board: {} })).toThrow("incomplete")
  expect(() => readSnapshot({ projects: "wrong", board: null })).toThrow("incomplete")
})
