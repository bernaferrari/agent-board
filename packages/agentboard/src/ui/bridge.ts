import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps"
import { OpenAIExtensions } from "@openai/mcp-extensions/app"
import type { Snapshot } from "../types"
import { readSnapshot, readToolData } from "./tool-result"

export const app = new App({ name: "AgentBoard", version: "0.1.5" }, { availableDisplayModes: ["fullscreen"] })
export const extensions = new OpenAIExtensions(app)

export async function connect(onSnapshot: (snapshot: Snapshot) => void, onError: (message: string) => void) {
  app.ontoolresult = (result) => {
    try {
      const data = readToolData(result)
      if ("projects" in data && "board" in data) onSnapshot(readSnapshot(data))
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  await app.connect(undefined, { timeout: 10000 }).catch((cause: unknown) => {
    throw requestError(cause, "ChatGPT didn’t finish connecting. Retry loading to reconnect.")
  })
  theme()
  if (
    app.getHostContext()?.displayMode === "inline" &&
    app.getHostContext()?.availableDisplayModes?.includes("fullscreen")
  )
    void app.requestDisplayMode({ mode: "fullscreen" }).catch(() => undefined)
}

export async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const data = readToolData(
    await app
      .callServerTool(
        { name, arguments: args },
        { timeout: name === "board_read" || name === "project_list" ? 15000 : 65000 },
      )
      .catch((cause: unknown) => {
        throw requestError(cause, "ChatGPT didn’t return the result in time. Refresh before trying the action again.")
      }),
  )
  return (
    ["board_open", "board_read", "project_connect", "issue_create", "issue_update", "dependency_update"].includes(name)
      ? readSnapshot(data)
      : data
  ) as T
}

function requestError(cause: unknown, timeout: string) {
  if (cause instanceof Error && "code" in cause && cause.code === -32001) return new Error(timeout)
  return cause instanceof Error ? cause : new Error(String(cause))
}

function theme() {
  const context = app.getHostContext()
  if (context?.theme) applyDocumentTheme(context.theme)
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables)
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts)
}
app.addEventListener("hostcontextchanged", theme)

export async function send(prompt: string, target: "active" | "new") {
  if (extensions.message) {
    const result = await extensions.message.send({
      role: "user",
      content: [{ type: "text", text: prompt }],
      _meta: { "openai/message": { target } },
    })
    if (result.isError) throw new Error("ChatGPT could not open the chat. Try attaching the issue to the current chat.")
    return
  }
  if (target === "new") throw new Error("This host does not support new-chat handoff. Use Attach to chat instead.")
  await app.sendMessage({
    role: "user",
    content: [{ type: "text", text: prompt }],
  })
}
