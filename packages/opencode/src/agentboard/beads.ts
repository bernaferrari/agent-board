import { spawn } from "node:child_process"

type RunOptions = {
  cwd: string
  env?: Record<string, string | undefined>
}

export class BeadsCommandError extends Error {
  constructor(
    public readonly args: string[],
    public readonly cwd: string,
    public readonly code: number | null,
    public readonly stderr: string,
  ) {
    super(`bd ${args.join(" ")} failed${code === null ? "" : ` with exit code ${code}`}: ${stderr.trim()}`)
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
          env: {
            ...process.env,
            ...options.env,
          },
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
        child.on("error", reject)
        child.on("close", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr })
            return
          }
          reject(new BeadsCommandError(args, options.cwd, code, stderr))
        })
      }),
  )
}

export async function runBdJson<T>(args: string[], options: RunOptions): Promise<T> {
  const result = await runBd(args, options)
  const text = result.stdout.trim()
  if (!text) return [] as T
  return JSON.parse(text) as T
}

export type BeadsRawIssue = Record<string, unknown>
export type BeadsCreateInput = {
  title: string
  description?: string
  priority?: number
  labels?: string[]
}

export function normalizeIssue(input: BeadsRawIssue): import("./types").BeadsIssue {
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
    return runBd(["init"], { cwd })
  },
  async listBlocked(cwd: string) {
    return (await runBdJson<BeadsRawIssue[]>(["blocked", "--json"], { cwd })).map(normalizeIssue).filter((x) => x.id)
  },
  async listReady(cwd: string) {
    return (await runBdJson<BeadsRawIssue[]>(["ready", "--limit", "1000", "--json"], { cwd }))
      .map(normalizeIssue)
      .filter((x) => x.id)
  },
  async listInProgress(cwd: string) {
    return (await runBdJson<BeadsRawIssue[]>(["list", "--json", "--tree=false", "--status", "in_progress"], { cwd }))
      .map(normalizeIssue)
      .filter((x) => x.id)
  },
  async listClosed(cwd: string) {
    return (await runBdJson<BeadsRawIssue[]>(["list", "--json", "--tree=false", "--status", "closed", "--limit", "1000"], {
      cwd,
    }))
      .map(normalizeIssue)
      .filter((x) => x.id)
  },
  async show(cwd: string, issueID: string) {
    const issue = await runBdJson<BeadsRawIssue>(["show", issueID, "--json"], { cwd })
    return normalizeIssue(issue)
  },
  async create(cwd: string, input: BeadsCreateInput) {
    const result = await runBd(createIssueArgs(input), { cwd })
    const id = result.stdout.trim().split(/\s+/).at(-1)
    if (!id) throw new Error("bd create did not return an issue ID")
    return this.show(cwd, id)
  },
  async updateStatus(cwd: string, issueID: string, status: string) {
    await runBd(["update", issueID, "--status", status], { cwd })
  },
}
