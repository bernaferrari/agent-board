export type IssueDraft = { issueID?: string; title: string; description: string; priority: number; type: string }

export function draftFromText(text: string): IssueDraft {
  if (text.includes("\0")) throw new Error("Use a plain text or Markdown file.")
  if (text.length > 50000) throw new Error("Keep the issue draft under 50,000 characters.")
  const lines = text.trim().split(/\r?\n/)
  if (!lines[0]) throw new Error("The dropped text is empty.")
  return {
    title: lines[0].replace(/^#{1,6}\s+/, "").slice(0, 500),
    description: lines.slice(1).join("\n").trim(),
    priority: 2,
    type: "task",
  }
}

export async function draftFromDrop(transfer: { files: ArrayLike<File>; getData: (type: string) => string }) {
  if (transfer.files.length > 1) throw new Error("Drop one text or Markdown file at a time.")
  const file = transfer.files[0]
  if (!file) return draftFromText(transfer.getData("text/plain"))
  if (!/\.(md|markdown|txt)$/i.test(file.name))
    throw new Error("Drop a .md or .txt file, or paste its text into the description.")
  if (file.size > 200000) throw new Error("This file is too large. Drop a short issue brief instead.")
  return draftFromText(await file.text())
}

export function folderFromDrop(text: string) {
  const value =
    text
      .trim()
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#")) ?? ""
  if (!value.startsWith("file:")) return value.replace(/^['"]|['"]$/g, "")
  const url = new URL(value)
  if (url.hostname && url.hostname !== "localhost") throw new Error("Choose a folder on this computer.")
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/, "$1")
}
