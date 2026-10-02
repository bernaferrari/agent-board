import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { createServer } from "../src/server"
import { createStore } from "../src/store"
import path from "node:path"

const root = path.resolve("../../")
const store = await createStore(
  Bun.env.AGENTBOARD_DATA_DIR ?? path.join(root, "packages/agentboard/build/preview-data"),
)
if (Bun.env.AGENTBOARD_PROJECT_DIRECTORY) await store.connect(Bun.env.AGENTBOARD_PROJECT_DIRECTORY)
const html = await Bun.file(path.join(root, "plugins/agent-board/dist/board.html")).text()
const server = createServer(store, html)
const client = new Client({ name: "agentboard-preview", version: "1.0.0" })
const transport = InMemoryTransport.createLinkedPair()
await server.connect(transport[0])
await client.connect(transport[1])
const host = await Bun.build({ entrypoints: ["test/host.ts"], target: "browser", minify: true })
if (!host.success) throw new Error(host.logs.join("\n"))
const captures: unknown[] = []
const listener = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(Bun.env.AGENTBOARD_PREVIEW_PORT ?? 4319),
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/board") return new Response(html, { headers: { "Content-Type": "text/html" } })
    if (url.pathname === "/host.js")
      return new Response(host.outputs[0], { headers: { "Content-Type": "application/javascript" } })
    if (url.pathname === "/tool" && request.method === "POST") {
      const params = CallToolRequestSchema.shape.params.parse(await request.json())
      return Response.json(await client.callTool(params))
    }
    if (url.pathname === "/capture" && request.method === "POST") {
      captures.push(await request.json())
      return Response.json({ ok: true })
    }
    if (url.pathname === "/captures") return Response.json(captures)
    return new Response(
      '<!doctype html><html lang="en"><title>AgentBoard test host</title><body style="margin:0"><iframe title="AgentBoard" style="width:100vw;height:100vh;border:0"></iframe><script type="module" src="/host.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } },
    )
  },
})
console.log(`AgentBoard MCP test host: ${listener.url}`)
