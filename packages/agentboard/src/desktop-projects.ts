import { homedir } from "node:os"
import path from "node:path"
import { z } from "zod"

export async function readDesktopProjects(
  file = Bun.env.AGENTBOARD_DESKTOP_STATE ??
    path.join(Bun.env.CODEX_HOME ?? path.join(homedir(), ".codex"), ".codex-global-state.json"),
) {
  const source = Bun.file(file)
  if (!(await source.exists())) return { suggestions: [] }
  const problem = "Couldn’t read saved desktop projects. Refresh or add a folder path below."
  const content = await source.json().catch(() => undefined)
  const state = z.record(z.string(), z.unknown()).safeParse(content)
  if (!state.success) return { suggestions: [], projectProblem: problem }
  // This desktop preferences file is a compatibility adapter, not a public SDK API.
  // Modern local-projects is authoritative; legacy roots can contain removed projects.
  const modern = state.data["local-projects"]
  const entries = z.record(z.string(), z.unknown()).safeParse(modern)
  if (modern !== undefined && !entries.success) return { suggestions: [], projectProblem: problem }
  const labels = z.record(z.string(), z.string()).safeParse(state.data["electron-workspace-root-labels"]).data ?? {}
  const ordered = z.array(z.unknown()).safeParse(state.data["project-order"]).data ?? []
  const projects = entries.success ? new Map(Object.entries(entries.data)) : new Map<string, unknown>()
  // Keep the first sidebar name when several desktop projects share one root.
  // Unordered or newly added projects follow the saved order in insertion order.
  const roots =
    modern !== undefined && entries.success
      ? [...new Set([...ordered.filter((id): id is string => typeof id === "string"), ...projects.keys()])].flatMap(
          (id) => {
            const entry = z
              .object({ name: z.string().trim().min(1).optional().catch(undefined), rootPaths: z.array(z.unknown()) })
              .safeParse(projects.get(id))
            return entry.success ? entry.data.rootPaths.map((root) => ({ root, name: entry.data.name })) : []
          },
        )
      : (z.array(z.unknown()).safeParse(state.data["electron-saved-workspace-roots"]).data ?? []).map((root) => ({
          root,
          name: undefined,
        }))
  const seen = new Set<string>()
  const directories = roots
    .flatMap((entry) => {
      const root = z.string().trim().min(1).safeParse(entry.root).data
      if (!root || !path.isAbsolute(root)) return []
      const directory = path.resolve(root)
      return [{ name: (entry.name ?? labels[directory]?.trim()) || path.basename(directory) || directory, directory }]
    })
    .filter((entry) => {
      if (seen.has(entry.directory)) return false
      seen.add(entry.directory)
      return true
    })
  return {
    suggestions: directories,
  }
}
