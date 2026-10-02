import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"

const frame = document.querySelector<HTMLIFrameElement>("iframe")!
const bridge = new AppBridge(
  null,
  { name: "AgentBoard test host", version: "1.0.0" },
  {
    serverTools: {},
    updateModelContext: { text: {}, structuredContent: {} },
    message: { text: {} },
    experimental: { "openai/message": {}, "openai/modelContext": {} },
  },
  {
    hostContext: {
      theme: new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light",
      displayMode: "fullscreen",
      availableDisplayModes: ["fullscreen"],
    },
  },
)

async function tool(params: Record<string, unknown>) {
  return CallToolResultSchema.parse(
    await (
      await fetch("/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
    ).json(),
  )
}
bridge.oncalltool = tool
bridge.onmessage = async (params) => {
  await fetch("/capture", { method: "POST", body: JSON.stringify({ kind: "message", params }) })
  return {}
}
bridge.onupdatemodelcontext = async (params) => {
  await fetch("/capture", { method: "POST", body: JSON.stringify({ kind: "context", params }) })
  return {}
}
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: {} })
  await bridge.sendToolResult(await tool({ name: "board_open", arguments: {} }))
}
const transport = new PostMessageTransport(frame.contentWindow!, frame.contentWindow!)
await bridge.connect(transport)
const forward = transport.onmessage
transport.onmessage = (message, extra) => {
  if ("method" in message && message.method === "ui/message")
    void fetch("/capture", { method: "POST", body: JSON.stringify({ kind: "wire-message", params: message.params }) })
  forward?.(message, extra)
}
frame.src = "/board"
