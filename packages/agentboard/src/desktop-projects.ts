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
  const roots =
    modern !== undefined && entries.success
      ? Object.values(entries.data).flatMap(
          (entry) => z.object({ rootPaths: z.array(z.unknown()) }).safeParse(entry).data?.rootPaths ?? [],
        )
      : (z.array(z.unknown()).safeParse(state.data["electron-saved-workspace-roots"]).data ?? [])
  const directories = roots
    .map((root) => z.string().trim().min(1).safeParse(root).data)
    .filter((root): root is string => !!root && path.isAbsolute(root))
    .map((root) => path.resolve(root))
  return {
    suggestions: Array.from(new Set(directories))
      .map((directory) => ({ name: path.basename(directory) || directory, directory }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.directory.localeCompare(b.directory)),
  }
}
