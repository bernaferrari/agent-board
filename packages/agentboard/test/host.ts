import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { McpUiStyles } from "@modelcontextprotocol/ext-apps"

// Deliberately distinct sample tokens expose any hardcoded widget colors.
const palettes = {
  light: {
    "--color-background-primary": "#faf8f4",
    "--color-background-secondary": "#eeeae2",
    "--color-background-inverse": "#242124",
    "--color-background-disabled": "#e7e2dc",
    "--color-background-info": "#dbe8fa",
    "--color-text-primary": "#242124",
    "--color-text-secondary": "#66606a",
    "--color-text-tertiary": "#746c76",
    "--color-text-inverse": "#faf8f4",
    "--color-text-disabled": "#777078",
    "--color-text-info": "#265a9c",
    "--color-text-danger": "#ac2929",
    "--color-text-warning": "#875209",
    "--color-text-success": "#226b47",
    "--color-border-primary": "#a9a2ac",
    "--color-border-secondary": "#d4ccd5",
    "--color-ring-primary": "#514455",
    "--border-radius-sm": "9px",
    "--border-radius-md": "11px",
    "--border-radius-lg": "15px",
    "--font-sans": "Georgia, serif",
    "--font-weight-medium": "500",
    "--shadow-sm": "0 2px 3px #24212414",
  },
  dark: {
    "--color-background-primary": "#211e27",
    "--color-background-secondary": "#302b38",
    "--color-background-inverse": "#f4eff9",
    "--color-background-disabled": "#383240",
    "--color-background-info": "#293751",
    "--color-text-primary": "#f4eff9",
    "--color-text-secondary": "#c1b6cd",
    "--color-text-tertiary": "#a99cb9",
    "--color-text-inverse": "#211e27",
    "--color-text-disabled": "#a397ae",
    "--color-text-info": "#8bbafa",
    "--color-text-danger": "#ff9a9a",
    "--color-text-warning": "#ecc078",
    "--color-text-success": "#86d6ad",
    "--color-border-primary": "#887c96",
    "--color-border-secondary": "#55495f",
    "--color-ring-primary": "#d5c1e3",
    "--border-radius-sm": "9px",
    "--border-radius-md": "11px",
    "--border-radius-lg": "15px",
    "--font-sans": "Georgia, serif",
    "--font-weight-medium": "500",
    "--shadow-sm": "0 2px 3px #00000040",
  },
} satisfies Record<string, Partial<McpUiStyles>>

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

const calls = { read: 0, handshake: 0 }
async function tool(params: Record<string, unknown>) {
  if (params.name === "board_read" || params.name === "project_list") {
    calls.read += 1
    const failure = new URLSearchParams(location.search).get("toolFailure")
    if (failure === "always" || (failure === "once" && calls.read === 1))
      return { content: [{ type: "text" as const, text: "Test host cannot read the workspace." }], isError: true }
    if (new URLSearchParams(location.search).has("stallTool")) await new Promise(() => {})
  }
  const result = CallToolResultSchema.parse(
    await (
      await fetch("/tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      })
    ).json(),
  )
  if (new URLSearchParams(location.search).has("emptyResult")) return { content: [] }
  if (new URLSearchParams(location.search).has("textOnly")) return { ...result, structuredContent: undefined }
  return result
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
  if (new URLSearchParams(location.search).has("skipInitialResult")) return
  await bridge.sendToolInput({ arguments: {} })
  await bridge.sendToolResult(await tool({ name: "board_open", arguments: {} }))
}
const transport = new PostMessageTransport(frame.contentWindow!, frame.contentWindow!)
await bridge.connect(transport)
const forward = transport.onmessage
transport.onmessage = (message, extra) => {
  if ("method" in message && message.method === "ui/initialize") {
    calls.handshake += 1
    const stall = new URLSearchParams(location.search).get("stallHandshake")
    if (stall === "1" || (stall === "once" && calls.handshake === 1)) return
  }
  if ("method" in message && message.method === "ui/message")
    void fetch("/capture", { method: "POST", body: JSON.stringify({ kind: "wire-message", params: message.params }) })
  forward?.(message, extra)
}
frame.src = "/board"

document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((button) => {
  button.addEventListener("click", () => {
    const theme = button.dataset.theme === "dark" ? "dark" : "light"
    bridge.setHostContext({
      theme,
      styles: {
        // The SDK's mapped type requires every key; hosts may supply a subset.
        variables: (button.dataset.palette === "host"
          ? palettes[theme]
          : Object.fromEntries(Object.keys(palettes[theme]).map((key) => [key, ""]))) as McpUiStyles,
      },
    })
  })
})
