import { Validator } from "@cfworker/json-schema"
import path from "node:path"
import { z } from "zod"

const plugin = path.resolve("../../plugins/agent-board")
for (const name of ["plugin", "mcp"]) {
  const schema = await Bun.file(`script/schemas/${name}.json`).json()
  const value = await Bun.file(path.join(plugin, `${name}.json`)).json()
  const result = new Validator(schema).validate(value)
  if (!result.valid) throw new Error(`${name}.json: ${JSON.stringify(result.errors)}`)
}
const manifest = await Bun.file(path.join(plugin, "plugin.json")).json()
const legacy = await Bun.file(path.join(plugin, ".codex-plugin/plugin.json")).json()
for (const field of ["name", "version", "author"]) {
  if (JSON.stringify(manifest[field]) !== JSON.stringify(legacy[field]))
    throw new Error(`Compatibility manifest differs at ${field}`)
}
if (JSON.stringify(manifest.extensions["com.openai"].interface) !== JSON.stringify(legacy.interface))
  throw new Error("Compatibility presentation differs")
z.object({
  name: z.literal("agent-board"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  extensions: z.object({ "com.openai": z.object({ interface: z.object({ shortDescription: z.string().max(30) }) }) }),
}).parse(manifest)
for (const asset of ["logo", "composerIcon"]) {
  if (!(await Bun.file(path.join(plugin, manifest.extensions["com.openai"].interface[asset])).exists()))
    throw new Error(`Missing ${asset}`)
}
const html = await Bun.file(path.join(plugin, "dist/board.html")).text()
if (/<script[^>]+src=|<link[^>]+href=/.test(html)) throw new Error("The board must be self-contained")
if (html.match(/<script\b/gi)?.length !== 1 || html.match(/<\/script>/gi)?.length !== 1)
  throw new Error("Invalid inline script boundaries")
console.log("Portable manifests, compatibility overlay, assets and self-contained UI validated")
