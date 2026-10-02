import { z } from "zod"
import { Issue, Status } from "../types"

const project = z.object({ id: z.string(), name: z.string(), directory: z.string() })
const snapshot = z.object({
  projects: z.array(project),
  suggestions: z.array(z.object({ name: z.string(), directory: z.string() })).default([]),
  board: z
    .object({
      project,
      generatedAt: z.number(),
      columns: z.array(
        z.object({
          id: Status,
          title: z.string(),
          cards: z.array(z.object({ issue: Issue.extend({ raw: z.record(z.string(), z.unknown()) }), column: Status })),
        }),
      ),
      graph: z.object({
        dependencies: z.array(z.object({ fromIssueID: z.string(), toIssueID: z.string(), type: z.string() })),
        positions: z.array(z.object({ issueID: z.string(), x: z.number(), y: z.number() })),
      }),
    })
    .nullable(),
  problem: z.string().optional(),
  projectProblem: z.string().optional(),
})

export function readToolData(result: {
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
  isError?: boolean
}) {
  const text = result.content
    ?.filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
  if (result.isError) throw new Error(text || "The action failed. Try again.")
  if (result.structuredContent == null && !text)
    throw new Error("The desktop response did not include workspace data. Try loading again.")
  // Some host transports preserve JSON text but omit structuredContent.
  // Reject unreadable responses before Solid's reactive state can be replaced.
  const data = result.structuredContent ?? parseText(text!)
  const parsed = z.record(z.string(), z.unknown()).safeParse(data)
  if (!parsed.success) throw new Error("The desktop returned unreadable workspace data. Try loading again.")
  return parsed.data
}

export function readSnapshot(data: Record<string, unknown>) {
  const parsed = snapshot.safeParse(data)
  if (!parsed.success) throw new Error("The desktop returned incomplete workspace data. Try loading again.")
  return parsed.data
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("The desktop returned unreadable workspace data. Try loading again.")
  }
}
