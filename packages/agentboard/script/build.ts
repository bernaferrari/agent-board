import { build } from "vite"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

await build()
const directory = path.resolve("../../plugins/agent-board/dist")
await mkdir(directory, { recursive: true })
const html = await readFile("build/ui/index.html", "utf8")
const bundled = await Promise.all(
  [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>|<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(
    async (match) => ({
      original: match[0],
      content: match[1]
        ? `<script type="module">${(await readFile(path.join("build/ui", match[1]), "utf8")).replaceAll("</script", "<\\/script")}</script>`
        : `<style>${await readFile(path.join("build/ui", match[2]), "utf8")}</style>`,
    }),
  ),
)
await writeFile(
  path.join(directory, "board.html"),
  bundled.reduce((result, item) => result.replace(item.original, () => item.content), html),
)
const server = await Bun.build({
  entrypoints: ["src/server.ts"],
  outdir: directory,
  target: "bun",
  minify: false,
})
if (!server.success) throw new Error(server.logs.join("\n"))
console.log(`Built local MCP server and self-contained board in ${directory}`)
