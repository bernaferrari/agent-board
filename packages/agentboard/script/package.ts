import "./validate"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

const root = path.resolve("../../")
const plugin = path.join(root, "plugins/agent-board")
const manifest = await Bun.file(path.join(plugin, "plugin.json")).json()
z.object({
  name: z.literal("agent-board"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  extensions: z.object({
    "com.openai": z.object({
      interface: z.object({ shortDescription: z.string().max(30) }),
    }),
  }),
}).parse(manifest)
if (!(await Bun.file(path.join(plugin, "dist/server.js")).exists()))
  throw new Error("Run bun run build before packaging.")
await mkdir(path.join(root, "releases"), { recursive: true })
const archive = path.join(root, "releases", `agent-board-${manifest.version}.zip`)
await rm(archive, { force: true })
const result = Bun.spawn(["zip", "-qr", archive, "agent-board"], {
  cwd: path.dirname(plugin),
  stdout: "inherit",
  stderr: "inherit",
})
if ((await result.exited) !== 0) throw new Error("Plugin packaging failed")
console.log(archive)
