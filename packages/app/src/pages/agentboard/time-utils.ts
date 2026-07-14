export function formatTime(value?: number) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(value)
}

export function formatAbsolute(value?: number) {
  if (!value) return ""
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value)
}

export function formatRelative(value?: number) {
  if (!value) return ""
  const diff = Date.now() - value
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  const days = Math.floor(diff / 86_400_000)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value)
}
