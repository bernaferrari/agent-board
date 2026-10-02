import { expect, test } from "bun:test"
import { draftFromDrop, draftFromText, folderFromDrop } from "../src/ui/drop"

test("dropped Markdown creates a reviewable draft with a clean title", async () => {
  const draft = await draftFromDrop({
    files: [new File(["# Keyboard navigation\n\nAcceptance: tab order follows the screen."], "brief.md")],
    getData: () => "",
  })
  expect(draft).toEqual({
    title: "Keyboard navigation",
    description: "Acceptance: tab order follows the screen.",
    priority: 2,
    type: "task",
  })
  expect(draftFromText("A title\r\n\r\nContext").description).toBe("Context")
  expect(draftFromText("x".repeat(600)).title.length).toBe(500)
})

test("drop admission rejects empty, binary, oversized and multiple files", async () => {
  expect(() => draftFromText(" ")).toThrow("empty")
  expect(() => draftFromText("title\0binary")).toThrow("plain text")
  expect(() => draftFromText("x".repeat(50001))).toThrow("50,000")
  await expect(draftFromDrop({ files: [new File(["image"], "image.png")], getData: () => "" })).rejects.toThrow(
    ".md or .txt",
  )
  await expect(
    draftFromDrop({ files: [new File(["a"], "one.md"), new File(["b"], "two.md")], getData: () => "" }),
  ).rejects.toThrow("one text")
  await expect(
    draftFromDrop({ files: [new File(["x".repeat(200001)], "large.md")], getData: () => "" }),
  ).rejects.toThrow("too large")
})

test("folder drops decode local paths without treating remote URIs as local access", () => {
  expect(folderFromDrop("# comment\nfile:///Users/test/My%20Project")).toBe("/Users/test/My Project")
  expect(folderFromDrop('"/Users/test/My Project"')).toBe("/Users/test/My Project")
  expect(folderFromDrop("file:///C:/Projects/Board")).toBe("C:/Projects/Board")
  expect(() => folderFromDrop("file://remote/share/project")).toThrow("this computer")
})
