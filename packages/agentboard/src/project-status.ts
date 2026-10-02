import { stat } from "node:fs/promises"
import path from "node:path"
import type { TrackerStatus } from "./types"

export async function inspectTracker(directory: string): Promise<TrackerStatus> {
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  return Promise.race([
    stat(path.join(directory, ".beads"))
      .then((info): TrackerStatus => (info.isDirectory() ? "present" : "missing"))
      .catch(async (cause: unknown): Promise<TrackerStatus> => {
        if (!missingPath(cause)) return "unknown"
        return stat(directory)
          .then((info): TrackerStatus => (info.isDirectory() ? "missing" : "unavailable"))
          .catch((cause: unknown): TrackerStatus => (missingPath(cause) ? "unavailable" : "unknown"))
      }),
    new Promise<TrackerStatus>((resolve) => {
      timer.id = setTimeout(() => resolve("unknown"), 300)
    }),
  ]).finally(() => clearTimeout(timer.id))
}

function missingPath(cause: unknown) {
  return cause instanceof Error && "code" in cause && (cause.code === "ENOENT" || cause.code === "ENOTDIR")
}
