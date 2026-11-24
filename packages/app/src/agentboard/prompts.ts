import { type AgentBoardBoard, type AgentBoardColumnID, type BeadsIssue } from "./api"
import { type ComposerDraft } from "./issue-composer"
import { closedSortTimestamp, issueLabels } from "./issue-utils"
import { visibleStatus } from "./ui-tokens"

export const BEADS_DOCS_URL = "https://github.com/steveyegge/beads"

export function agentBoardPlanningPrompt(input: ComposerDraft) {
  const lines = ["You are planning work with Beads.", "", "User request:", input.title]
  if (input.description) {
    lines.push("", "Additional detail:", input.description)
  }
  lines.push(
    "",
    "Turn this into useful Beads issues.",
    "",
    "Workflow:",
    "1. Inspect the existing Beads state before creating duplicates. Start with `bd list --json --tree=false` and `bd ready --json`.",
    "2. If this is one concrete task, create one issue. If it is broad, split it into a small dependency-aware set of issues.",
    "3. Use `bd create --title ... --description ... --priority ... --labels ...` for new work. Prefer actionable titles and descriptions with acceptance criteria.",
    "4. If dependencies or labels need exact syntax, check `bd help` first instead of guessing.",
    "5. Do not implement the work yet unless I explicitly ask. End by listing the issue IDs you created and tell me to return to the board and press Refresh.",
  )
  if (input.priority !== undefined || input.labels?.length) {
    lines.push("", "Defaults to apply when they make sense:")
    if (input.priority !== undefined) lines.push(`- priority: P${input.priority}`)
    if (input.labels?.length) lines.push(`- labels: ${input.labels.join(", ")}`)
  }
  return lines.join("\n")
}

function promptSnapshotCards(column: AgentBoardBoard["columns"][number]) {
  if (column.id !== "closed") return column.cards
  return [...column.cards].sort(
    (a, b) => closedSortTimestamp(b) - closedSortTimestamp(a) || a.issue.id.localeCompare(b.issue.id),
  )
}

export function agentBoardSuggestionPrompt(current: AgentBoardBoard | undefined) {
  const lines = [
    "You are helping improve this project.",
    "",
    "Goal:",
    "Inspect the current Beads tracker and the codebase, then suggest the next useful tickets.",
    "",
    "Start by gathering context:",
    "1. Run `bd list --json --tree=false` and `bd ready --json` to understand current work and avoid duplicates.",
    "2. Inspect the repository structure and recent changes enough to identify real gaps, not generic chores.",
    "3. Look for small, demoable improvements, obvious bugs, missing tests, UX polish, or integration gaps.",
    "",
    "Important:",
    "- Do not create issues yet.",
    "- First propose 5-8 candidate tickets.",
    "- For each ticket include title, why it matters, acceptance criteria, suggested priority, and dependencies if any.",
    "- Prefer work that can make the project more useful, more delightful, or more shippable within one focused agent run.",
    "- End by asking which tickets I want you to create in Beads.",
  ]

  if (current?.columns.length) {
    lines.push("", "Current Beads board snapshot:")
    for (const column of current.columns) {
      const cards = promptSnapshotCards(column)
      const detail = column.id === "closed" ? " (most recently closed first)" : ""
      lines.push(`- ${column.title}: ${cards.length}${detail}`)
      for (const card of cards.slice(0, 5)) {
        const status = visibleStatus(card)
        const priority = card.issue.priority !== undefined ? `P${card.issue.priority}` : "no priority"
        lines.push(`  - ${card.issue.id} [${status}, ${priority}]: ${card.issue.title}`)
      }
      if (cards.length > 5) lines.push(`  - ...${cards.length - 5} more`)
    }
  }

  return lines.join("\n")
}

export function agentBoardIssueChatPrompt(input: { issue: BeadsIssue; column?: AgentBoardColumnID }) {
  const labels = issueLabels(input.issue)
  const priority = input.issue.priority !== undefined ? `P${input.issue.priority}` : "unset"
  const status = input.issue.status || input.column || "open"
  const lines = [
    "Please implement this Beads issue.",
    "",
    `Issue: ${input.issue.id}`,
    `Title: ${input.issue.title}`,
    `Status: ${status}`,
    `Priority: ${priority}`,
  ]
  if (labels.length) lines.push(`Labels: ${labels.join(", ")}`)
  if (input.issue.description?.trim()) {
    lines.push("", "Description:", input.issue.description.trim())
  }
  lines.push(
    "",
    "Workflow:",
    `1. Inspect the issue first with \`bd show ${input.issue.id}\` or the closest supported Beads command.`,
    "2. Use the codebase context to implement the issue with the smallest coherent patch.",
    "3. Run the most relevant tests or checks you can.",
    "4. Update Beads status/comments when appropriate. If the exact bd syntax differs, check `bd help` instead of guessing.",
    "5. End with a concise summary of files changed, tests run, and any follow-up needed.",
  )
  return lines.join("\n")
}

export function agentBoardSetupPrompt() {
  return [
    `Help me install Beads (${BEADS_DOCS_URL}) and set it up for this project so AgentBoard can work.`,
    "",
    "Please:",
    "1. Check whether the `bd` CLI is installed and available on PATH.",
    `2. If it is not installed, install it from ${BEADS_DOCS_URL} using the README's recommended method for this OS. Ask before making system changes.`,
    "3. Once `bd` is available, run `bd init` in this project.",
    "4. Verify with `bd list --json --tree=false` or `bd doctor`.",
    "5. End with what changed and what I should do next in AgentBoard.",
    "",
    "Tip: `npx skills beads` teaches any model to use Beads - install it only if I ask.",
  ].join("\n")
}
