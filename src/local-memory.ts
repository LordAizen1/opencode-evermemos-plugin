import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { MemoryKind, RecalledMemory } from "./types.js"

type LocalRole = "user" | "assistant"

interface LocalMemoryEntry {
  content: string
  role: LocalRole
  memoryType?: MemoryKind
  createdAt: string
}

interface LocalMemoryStore {
  version: 2
  spaces: Record<string, LocalMemoryEntry[]>
}

const DEFAULT_STORE_PATH = join(homedir(), ".config", "opencode", "evermemos-local.json")
const MAX_PER_GROUP = 300

export function rememberLocal(
  spaceKey: string,
  content: string,
  role: LocalRole,
  memoryType?: MemoryKind,
): void {
  if (!spaceKey || !content) return
  const store = loadStore()
  const list = store.spaces[spaceKey] ?? []

  list.push({
    content,
    role,
    memoryType,
    createdAt: new Date().toISOString(),
  })

  if (list.length > MAX_PER_GROUP) {
    store.spaces[spaceKey] = list.slice(-MAX_PER_GROUP)
  } else {
    store.spaces[spaceKey] = list
  }

  saveStore(store)
}

export function recallLocalExact(
  spaceKey: string,
  query: string,
  limit: number,
): RecalledMemory[] {
  if (!spaceKey) return []
  const q = query.trim()
  if (!q || !isExactTokenQuery(q)) return []

  const store = loadStore()
  const list = store.spaces[spaceKey] ?? []
  if (list.length === 0) return []

  const needle = q.toLowerCase()
  const hits = list
    .filter((m) => m.content.toLowerCase().includes(needle))
    .slice(-Math.max(1, limit))
    .reverse()

  return hits.map((m) => ({
    memory_type: m.memoryType ?? "local_memory",
    content: m.content,
    timestamp: m.createdAt,
    group_id: spaceKey,
  }))
}

export function recallLocalSemantic(
  spaceKey: string,
  query: string,
  limit: number,
): RecalledMemory[] {
  if (!spaceKey) return []
  const q = query.trim()
  if (!q) return []

  const terms = tokenize(q)
  if (terms.length === 0) return []

  const store = loadStore()
  const list = store.spaces[spaceKey] ?? []
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
    memory_type: x.m.memoryType ?? "local_memory",
    content: x.m.content,
    timestamp: x.m.createdAt,
    group_id: spaceKey,
  }))
}

export function hasLocalMemory(
  spaceKey: string,
  content: string,
  memoryType?: MemoryKind,
): boolean {
  if (!spaceKey || !content) return false
  const store = loadStore()
  const list = store.spaces[spaceKey] ?? []
  const needle = normalizeMemoryKey(content)
  if (!needle) return false

  return list.some((entry) => {
    if (memoryType && entry.memoryType && entry.memoryType !== memoryType) return false
    return normalizeMemoryKey(entry.content) === needle
  })
}

export function countProjectSpacesWithMemory(
  content: string,
  memoryType?: MemoryKind,
): number {
  const needle = normalizeMemoryKey(content)
  if (!needle) return 0

  const store = loadStore()
  let matches = 0
  for (const [spaceKey, entries] of Object.entries(store.spaces)) {
    if (!spaceKey.startsWith("project:")) continue
    const found = entries.some((entry) => {
      if (memoryType && entry.memoryType && entry.memoryType !== memoryType) return false
      return normalizeMemoryKey(entry.content) === needle
    })
    if (found) matches++
  }
  return matches
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

function normalizeMemoryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function getStorePath(): string {
  return process.env.EVERMEMOS_LOCAL_STORE_PATH || DEFAULT_STORE_PATH
}

function loadStore(): LocalMemoryStore {
  const path = getStorePath()
  try {
    if (!existsSync(path)) return { version: 2, spaces: {} }
    const raw = readFileSync(path, "utf8")
    const parsed = JSON.parse(raw) as Partial<LocalMemoryStore> & { groups?: Record<string, LocalMemoryEntry[]> }
    if (!parsed || typeof parsed !== "object") {
      return { version: 2, spaces: {} }
    }

    if (parsed.version === 2 && typeof parsed.spaces === "object" && parsed.spaces) {
      return { version: 2, spaces: parsed.spaces }
    }

    if (typeof parsed.groups === "object" && parsed.groups) {
      const migratedSpaces: Record<string, LocalMemoryEntry[]> = {}
      for (const [groupId, entries] of Object.entries(parsed.groups)) {
        migratedSpaces[`project:${groupId}`] = Array.isArray(entries) ? entries : []
      }
      console.debug("[evermemos] Migrated local store v1 -> v2")
      return { version: 2, spaces: migratedSpaces }
    }

    return { version: 2, spaces: {} }
  } catch {
    return { version: 2, spaces: {} }
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
