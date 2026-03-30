import type { SanitizeOptions } from "./types.js"

/**
 * Central privacy and redaction layer.
 * All content headed for EverMemOS passes through here.
 */
export function sanitize(raw: string, opts: SanitizeOptions = {}): string {
  const {
    maxLength = 4096,
    stripPrivateBlocks = true,
    redactSecrets = true,
  } = opts

  let text = raw

  // 1. Strip <private>…</private> blocks (case-insensitive, multiline)
  if (stripPrivateBlocks) {
    text = text.replace(/<private>[\s\S]*?<\/private>/gi, "[REDACTED_PRIVATE]")
  }

  // 2. Redact common secret patterns
  if (redactSecrets) {
    text = redactCommonSecrets(text)
  }

  // 3. Truncate to max length
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + "\n…[truncated]"
  }

  return text.trim()
}

// ---------------------------------------------------------------------------
// Secret patterns — each replaces the matched value with a tag
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Generic API keys / tokens (long hex or base64 strings after common prefixes)
  [/(?:api[_-]?key|api[_-]?secret|token|secret[_-]?key|access[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_\-/.+]{20,}["']?/gi, "[REDACTED_KEY]"],
  // AWS access keys
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_KEY]"],
  // GitHub tokens
  [/gh[pousr]_[A-Za-z0-9_]{36,}/g, "[REDACTED_GH_TOKEN]"],
  // Bearer tokens
  [/Bearer\s+[A-Za-z0-9_\-/.+]{20,}/g, "Bearer [REDACTED]"],
  // Private keys (PEM blocks)
  [/-----BEGIN\s[\w\s]+PRIVATE KEY-----[\s\S]*?-----END\s[\w\s]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  // Passwords in URLs
  [/:\/\/[^:@\s]+:[^@\s]+@/g, "://[REDACTED_CREDS]@"],
]

function redactCommonSecrets(text: string): string {
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement)
  }
  return text
}
