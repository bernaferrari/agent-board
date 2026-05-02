const DEFAULT_START_READY_LIMIT = 3
const MAX_START_READY_LIMIT = 5

export function normalizeStartReadyLimit(input: unknown, fallback = DEFAULT_START_READY_LIMIT) {
  const numeric = Number(input ?? fallback)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(MAX_START_READY_LIMIT, Math.floor(numeric)))
}
