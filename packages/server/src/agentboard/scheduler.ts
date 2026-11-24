const DEFAULT_START_OPEN_LIMIT = 3
const MAX_START_OPEN_LIMIT = 5

export function normalizeStartOpenLimit(input: unknown, fallback = DEFAULT_START_OPEN_LIMIT) {
  const numeric = Number(input ?? fallback)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(1, Math.min(MAX_START_OPEN_LIMIT, Math.floor(numeric)))
}
