import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const directory = await mkdtemp(path.join(os.tmpdir(), "agentboard-smoke-"))
const client = new Client({ name: "agentboard-smoke", version: "1.0.0" })
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("../../plugins/agent-board/dist/server.js")],
  cwd: directory,
  env: {
    ...Object.fromEntries(
      Object.entries(Bun.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    PLUGIN_DATA: directory,
  },
  stderr: "pipe",
})
await client.connect(transport)
const tools = await client.listTools()
assert.equal(tools.tools.length, 10)
assert.ok(tools.tools.some((tool) => tool.name === "board_open"))
const snapshot = await client.callTool({ name: "board_open", arguments: {} })
assert.ok(!snapshot.isError)
assert.deepEqual(snapshot.structuredContent, { projects: [], suggestions: [], board: null })
const resource = await client.readResource({ uri: "ui://agent-board/workspace" })
assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app")
assert.ok("text" in resource.contents[0] && resource.contents[0].text.includes("AgentBoard"))
await client.close()
await rm(directory, { recursive: true, force: true })
console.log("Bundled stdio server starts, discovers tools, opens a workspace and serves the UI without node_modules")
