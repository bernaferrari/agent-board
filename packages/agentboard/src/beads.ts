import { z } from "zod"
import { Issue } from "./types"
import type { BeadsIssue, AgentBoardDependency } from "./types"

export async function runBd(directory: string, args: string[]) {
  const process = Bun.spawn(["bd", ...args, "--json"], {
    cwd: directory,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
    env: Object.fromEntries(
      Object.entries(Bun.env).filter(
        ([key]) => !["BEADS_DIR", "BEADS_DB", "BEADS_DOLT_DATABASE", "BD_ROOT"].includes(key),
      ),
    ),
  })
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (code !== 0) throw new Error(error.trim() || `Beads command failed (${code}). Check that bd and Dolt are running.`)
  if (!output.trim()) return null
  return JSON.parse(output) as unknown
}

export function normalizeIssue(input: unknown): BeadsIssue {
  const parsed = Issue.parse(input)
  return { ...parsed, raw: parsed }
}

export function normalizeIssues(input: unknown) {
  return z
    .array(z.unknown())
    .parse(input ?? [])
    .map(normalizeIssue)
}

export async function showIssue(directory: string, id: string) {
  const result = await runBd(directory, ["show", id])
  return normalizeIssue(Array.isArray(result) ? result[0] : result)
}

// Beads edges point from the dependent issue to its prerequisite.
export function dependenciesFromRawIssues(issues: BeadsIssue[]): AgentBoardDependency[] {
  const seen = new Set<string>()
  return issues
    .flatMap((issue) => {
      const dependencies = z.array(z.unknown()).safeParse(issue.raw.dependencies)
      const blocked = z.array(z.string()).safeParse(issue.raw.blocked_by)
      const parents =
        typeof issue.raw.parent === "string"
          ? [
              {
                fromIssueID: issue.id,
                toIssueID: issue.raw.parent,
                type: "parent-child",
              },
            ]
          : []
      return [
        ...(dependencies.success
          ? dependencies.data.flatMap((item) => {
              if (typeof item === "string") return [{ fromIssueID: issue.id, toIssueID: item, type: "blocks" }]
              const edge = z
                .object({
                  id: z.string().optional(),
                  depends_on_id: z.string().optional(),
                  dependency_id: z.string().optional(),
                  type: z.string().optional(),
                  dependency_type: z.string().optional(),
                })
                .safeParse(item)
              if (!edge.success) return []
              const target = edge.data.depends_on_id ?? edge.data.dependency_id ?? edge.data.id
              return target
                ? [
                    {
                      fromIssueID: issue.id,
                      toIssueID: target,
                      type: edge.data.type ?? edge.data.dependency_type ?? "blocks",
                    },
                  ]
                : []
            })
          : []),
        ...(blocked.success
          ? blocked.data.map((id) => ({
              fromIssueID: issue.id,
              toIssueID: id,
              type: "blocks",
            }))
          : []),
        ...parents,
      ]
    })
    .filter((edge) => {
      const key = `${edge.fromIssueID}:${edge.toIssueID}:${edge.type}`
      if (edge.fromIssueID === edge.toIssueID || seen.has(key)) return false
      seen.add(key)
      return true
    })
}
