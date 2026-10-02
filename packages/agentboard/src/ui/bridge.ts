import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps"
import { OpenAIExtensions } from "@openai/mcp-extensions/app"
import type { Snapshot } from "../types"

export const app = new App({ name: "AgentBoard", version: "0.1.3" }, { availableDisplayModes: ["fullscreen"] })
export const extensions = new OpenAIExtensions(app)

export async function connect(onSnapshot: (snapshot: Snapshot) => void, onError: (message: string) => void) {
  app.ontoolresult = (result) => {
    if (result.isError) {
      onError(
        result.content
          ?.filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n") || "Could not load the board.",
      )
      return
    }
    if (result.structuredContent && "projects" in result.structuredContent && "board" in result.structuredContent)
      onSnapshot(result.structuredContent as Snapshot)
  }
  const theme = () => {
    const context = app.getHostContext()
    if (context?.theme) applyDocumentTheme(context.theme)
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables)
    if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts)
  }
  app.addEventListener("hostcontextchanged", theme)
  await app.connect()
  theme()
  if (
    app.getHostContext()?.displayMode === "inline" &&
    app.getHostContext()?.availableDisplayModes?.includes("fullscreen")
  )
    void app.requestDisplayMode({ mode: "fullscreen" }).catch(() => undefined)
}

export async function call<T>(name: string, args: Record<string, unknown> = {}) {
  const result = await app.callServerTool({ name, arguments: args })
  if (result.isError)
    throw new Error(
      result.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n") || "The action failed. Refresh and try again.",
    )
  return result.structuredContent as T
}

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
