import { spawn } from "node:child_process"
import z from "zod"
import type { BeadsIssue } from "./types"

export const REVIEW_LABEL = "agentboard:review"
const rawIssue = z.record(z.string(), z.unknown())
const missingTracker = /no beads database found|no \.beads directory found/i

type RunOptions = {
  cwd: string
}

export class BeadsCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly cwd: string,
    public readonly code: number | null,
    public readonly stderr: string,
  ) {
    // Keep the setup-detection phrase the UI matches on for missing Beads.
    const detail = stderr.trim()
    if (missingTracker.test(detail)) {
      super("no beads database found")
      return
    }
    super(`bd ${args.join(" ")} failed${code === null ? "" : ` with exit code ${code}`}: ${detail}`)
  }
}

let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn)
  queue = next.catch(() => undefined)
  return next
}

export function runBd(args: string[], options: RunOptions): Promise<{ stdout: string; stderr: string }> {
  return enqueue(
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.env.BD_BIN || "bd", args, {
          cwd: options.cwd,
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !["BEADS_DIR", "BEADS_DB", "BEADS_DOLT_DATABASE", "BD_ROOT"].includes(key),
            ),
          ),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        })

        let stdout = ""
        let stderr = ""
        child.stdout.setEncoding("utf8")
        child.stderr.setEncoding("utf8")
        child.stdout.on("data", (chunk) => {
          stdout += chunk
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk
        })
        const timeout = setTimeout(() => {
          reject(new Error(`bd ${args[0]} timed out`))
          child.kill("SIGTERM")
        }, 30_000)
        child.on("error", (error) => {
          clearTimeout(timeout)
          reject(error)
        })
        child.on("close", (code) => {
          clearTimeout(timeout)
          if (code === 0) {
            resolve({ stdout, stderr })
            return
          }
          reject(new BeadsCommandError(args, options.cwd, code, stderr))
        })
      }),
  )
}

async function runBdJson(args: string[], options: RunOptions): Promise<unknown> {
  const result = await runBd(args, options)
  const text = result.stdout.trim()
  if (!text) throw new Error(`bd ${args[0]} returned no JSON`)
  return JSON.parse(text)
}

export type BeadsRawIssue = Record<string, unknown>
export type BeadsRawDependency = Record<string, unknown>
export type BeadsCreateInput = {
  title: string
  description?: string
  priority?: number
  labels?: string[]
}

export function normalizeIssue(input: BeadsRawIssue): BeadsIssue {
  const id = stringValue(input.id) ?? stringValue(input.issue_id) ?? stringValue(input.key) ?? ""
  const title = stringValue(input.title) ?? stringValue(input.summary) ?? stringValue(input.name) ?? id
  return {
    id,
    title,
    status: stringValue(input.status),
    priority: numberValue(input.priority) ?? stringValue(input.priority),
    description: stringValue(input.description) ?? stringValue(input.notes),
    blocked: Boolean(input.blocked),
    raw: input,
  }
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.length > 0 ? input : undefined
}

function numberValue(input: unknown) {
  if (typeof input === "number") return input
  if (typeof input !== "string") return
  const parsed = Number(input)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringArrayValue(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter((value): value is string => typeof value === "string" && value.length > 0)
}

function objectArrayValue(input: unknown) {
  if (!Array.isArray(input)) return []
  return input.filter(
    (value): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value),
  )
}

function dependencyID(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(input[key])
    if (value) return value
  }
}

function normalizeDependencyType(input: BeadsRawDependency, fallback = "blocks") {
  const raw =
    stringValue(input.type) ??
    stringValue(input.dependency_type) ??
    stringValue(input.kind) ??
    stringValue(input.relation)
  const normalized = raw?.toLowerCase().replaceAll("_", "-")
  if (normalized === "parent-child") return "parent-child"
  if (normalized === "child" || normalized === "parent") return "parent-child"
  if (normalized === "blocks" || normalized === "blocked-by" || normalized === "blocker") return "blocks"
  return fallback
}

export function normalizeDependency(
  input: BeadsRawDependency,
  fallbackType = "blocks",
): import("./types").AgentBoardDependency | undefined {
  const fromIssueID = dependencyID(input, [
    "from_id",
    "from",
    "issue_id",
    "issue",
    "dependent_id",
    "dependent",
    "blocked_id",
    "child_id",
  ])
  const toIssueID = dependencyID(input, [
    "to_id",
    "to",
    "depends_on_id",
    "dependency_id",
    "dependency",
    "blocker_id",
    "parent_id",
  ])
  if (!fromIssueID || !toIssueID || fromIssueID === toIssueID) return
  return {
    fromIssueID,
    toIssueID,
    type: normalizeDependencyType(input, fallbackType),
  }
}

function relationFromIssue(issue: import("./types").BeadsIssue, toIssueID: string, type: string) {
  if (!toIssueID || toIssueID === issue.id) return
  return {
    fromIssueID: issue.id,
    toIssueID,
    type,
  }
}

function relationToIssue(issue: import("./types").BeadsIssue, fromIssueID: string, type: string) {
  if (!fromIssueID || fromIssueID === issue.id) return
  return {
    fromIssueID,
    toIssueID: issue.id,
    type,
  }
}

export function dependenciesFromRawIssues(issues: import("./types").BeadsIssue[]) {
  const output: import("./types").AgentBoardDependency[] = []
  const add = (dependency: import("./types").AgentBoardDependency | undefined) => {
    if (dependency) output.push(dependency)
  }
  for (const issue of issues) {
    const raw = issue.raw
    for (const id of stringArrayValue(raw.depends_on)) add(relationFromIssue(issue, id, "blocks"))
    for (const id of stringArrayValue(raw.dependencies)) add(relationFromIssue(issue, id, "dependency"))
    for (const id of stringArrayValue(raw.blocked_by)) add(relationFromIssue(issue, id, "blocks"))
    for (const id of stringArrayValue(raw.blocks)) add(relationToIssue(issue, id, "blocks"))
    for (const id of stringArrayValue(raw.children)) add(relationToIssue(issue, id, "parent-child"))
    const parent = stringValue(raw.parent) ?? stringValue(raw.parent_id)
    if (parent) add(relationFromIssue(issue, parent, "parent-child"))
    const discoveredFrom = stringValue(raw.discovered_from) ?? stringValue(raw.discovered_from_id)
    if (discoveredFrom) add(relationFromIssue(issue, discoveredFrom, "dependency"))
    for (const value of objectArrayValue(raw.dependencies)) {
      const toIssueID = dependencyID(value, [
        "to_id",
        "to",
        "depends_on_id",
        "dependency_id",
        "dependency",
        "blocker_id",
        "parent_id",
        "id",
      ])
      const normalized = normalizeDependency(
        {
          issue_id: issue.id,
          ...value,
          to_id: stringValue(value.to_id) ?? toIssueID,
        } as BeadsRawDependency,
        "dependency",
      )
      if (normalized) output.push(normalized)
    }
  }
  const seen = new Set<string>()
  return output.filter((dependency) => {
    if (!dependency) return false
    const key = `${dependency.fromIssueID}:${dependency.toIssueID}:${dependency.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function createIssueArgs(input: BeadsCreateInput) {
  const args = ["create", "--title", input.title.trim(), "--silent"]
  const description = input.description?.trim()
  if (description) args.push("--description", description)
  if (input.priority !== undefined) args.push("--priority", String(input.priority))
  const labels = input.labels?.map((label) => label.trim().replace(/^#+/, "")).filter(Boolean)
  if (labels?.length) args.push("--labels", labels.join(","))
  return args
}

export const Beads = {
  async init(cwd: string) {
    const tracker = await runBd(["where", "--json"], { cwd }).catch((error) => {
      if (error instanceof BeadsCommandError && missingTracker.test(error.message)) return undefined
      throw error
    })
    if (tracker) return tracker
    return runBd(["init"], { cwd })
  },
  async listBlocked(cwd: string) {
    return z
      .array(rawIssue)
      .parse(await runBdJson(["blocked", "--json"], { cwd }))
      .map(normalizeIssue)
      .filter((issue) => issue.id)
  },
  async listOpen(cwd: string) {
    return z
      .array(rawIssue)
      .parse(await runBdJson(["ready", "--limit", "0", "--json"], { cwd }))
      .map(normalizeIssue)
      .filter((issue) => issue.id && issue.status === "open")
  },
  async list(cwd: string) {
    return z
      .array(rawIssue)
      .parse(await runBdJson(["list", "--json", "--flat", "--all", "--limit", "0"], { cwd }))
      .map(normalizeIssue)
      .filter((issue) => issue.id)
  },
  async show(cwd: string, issueID: string) {
    const result = await runBdJson(["show", "--json", "--", issueID], { cwd })
    const issue = normalizeIssue(rawIssue.parse(Array.isArray(result) ? result[0] : result))
    if (!issue.id) throw new Error(`Issue not found: ${issueID}`)
    return issue
  },
  async create(cwd: string, input: BeadsCreateInput) {
    const result = await runBd(createIssueArgs(input), { cwd })
    const id = result.stdout.trim().split(/\s+/).at(-1)
    if (!id) throw new Error("bd create did not return an issue ID")
    return this.show(cwd, id)
  },
  async updateStatus(cwd: string, issueID: string, status: string, review = false) {
    await runBd(
      ["update", "--status", status, review ? "--add-label" : "--remove-label", REVIEW_LABEL, "--", issueID],
      { cwd },
    )
  },
}
