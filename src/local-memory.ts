import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { RecalledMemory } from "./types.js"

type LocalRole = "user" | "assistant"

interface LocalMemoryEntry {
  content: string
  role: LocalRole
  createdAt: string
}

interface LocalMemoryStore {
  version: 1
  groups: Record<string, LocalMemoryEntry[]>
}

const DEFAULT_STORE_PATH = join(homedir(), ".config", "opencode", "evermemos-local.json")
const MAX_PER_GROUP = 300

export function rememberLocal(
  groupId: string,
  content: string,
  role: LocalRole,
): void {
  if (!groupId || !content) return
  const store = loadStore()
  const list = store.groups[groupId] ?? []

  list.push({
    content,
    role,
    createdAt: new Date().toISOString(),
  })

  if (list.length > MAX_PER_GROUP) {
    store.groups[groupId] = list.slice(-MAX_PER_GROUP)
  } else {
    store.groups[groupId] = list
  }

  saveStore(store)
}

export function recallLocalExact(
  groupId: string,
  query: string,
  limit: number,
): RecalledMemory[] {
  if (!groupId) return []
  const q = query.trim()
  if (!q || !isExactTokenQuery(q)) return []

  const store = loadStore()
  const list = store.groups[groupId] ?? []
  if (list.length === 0) return []

  const needle = q.toLowerCase()
  const hits = list
    .filter((m) => m.content.toLowerCase().includes(needle))
    .slice(-Math.max(1, limit))
    .reverse()

  return hits.map((m) => ({
    memory_type: "local_memory",
    content: m.content,
    timestamp: m.createdAt,
    group_id: groupId,
  }))
}

export function recallLocalSemantic(
  groupId: string,
  query: string,
  limit: number,
): RecalledMemory[] {
  if (!groupId) return []
  const q = query.trim()
  if (!q) return []

  const terms = tokenize(q)
  if (terms.length === 0) return []

  const store = loadStore()
  const list = store.groups[groupId] ?? []
  if (list.length === 0) return []

  const scored = list
    .map((m) => {
      const body = m.content.toLowerCase()
      let overlap = 0
      for (const t of terms) {
        if (t.length >= 3 && body.includes(t)) overlap++
      }
      let score = overlap
      if (containsPreferenceCue(body)) score += 2
      if (/\b(stack|typescript|tailwind|react|nextjs|patch|refactor)\b/.test(body)) score += 1
      return { m, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))

  return scored.map((x) => ({
    memory_type: "local_memory",
    content: x.m.content,
    timestamp: x.m.createdAt,
    group_id: groupId,
  }))
}

function isExactTokenQuery(query: string): boolean {
  if (/^memtest[_-]/i.test(query)) return true
  if (/^[A-Z0-9][A-Z0-9_-]{7,}$/.test(query)) return true
  return false
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function containsPreferenceCue(text: string): boolean {
  return /\b(prefer|preference|style|stack|uses|tech|convention|refactor|commit)\b/.test(text)
}

function getStorePath(): string {
  return process.env.EVERMEMOS_LOCAL_STORE_PATH || DEFAULT_STORE_PATH
}

function loadStore(): LocalMemoryStore {
  const path = getStorePath()
  try {
    if (!existsSync(path)) return { version: 1, groups: {} }
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw) as Partial<LocalMemoryStore>
    if (!parsed || parsed.version !== 1 || typeof parsed.groups !== "object" || !parsed.groups) {
      return { version: 1, groups: {} }
    }
    return { version: 1, groups: parsed.groups }
  } catch {
    return { version: 1, groups: {} }
  }
}

function saveStore(store: LocalMemoryStore): void {
  const path = getStorePath()
  const dir = dirname(path)
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(store, null, 2), "utf8")
  } catch {
    // fail open
  }
}
