import type { MemoryScope, RoutedWrite } from "./types.js"

type RequestedScope = "auto" | MemoryScope | undefined
type WriteSource = "chat" | "manual" | "tool"

interface ClassifyWriteOptions {
  requestedScope?: RequestedScope
  enableGlobalScope: boolean
  source?: WriteSource
}

const GLOBAL_PREFERENCE_RE = /\b(prefer|preference|always|never|usually|my style|i like|i prefer|commit style|explain before|explain first|avoid unrelated refactors|don't refactor unrelated|do not refactor unrelated|testing preference)\b/i
const PROJECT_PROFILE_RE = /\b(this repo|this project|this codebase|we use|architecture|convention|conventions|stack|folder structure|in this repo|in this project|middleware-first|naming convention)\b/i
const PROJECT_FORESIGHT_RE = /\b(later|next|todo|after this|want to add|next sprint|eventually|follow up|coming next|we should add|remember to)\b/i

export function classifyWrite(
  content: string,
  options: ClassifyWriteOptions,
): RoutedWrite {
  const normalized = content.trim()

  if (!normalized) {
    return {
      scope: "project",
      memoryType: "episodic_memory",
      confidence: 0.2,
      reason: "Empty or blank content falls back to project episodic memory.",
    }
  }

  if (options.source === "tool") {
    return {
      scope: "project",
      memoryType: "episodic_memory",
      confidence: 1,
      reason: "Tool activity is always project-scoped episodic memory.",
    }
  }

  const requestedScope = options.requestedScope
  const globalPreference = GLOBAL_PREFERENCE_RE.test(normalized)
  const projectProfile = PROJECT_PROFILE_RE.test(normalized)
  const projectForesight = PROJECT_FORESIGHT_RE.test(normalized)

  if (requestedScope === "project") {
    return {
      scope: "project",
      memoryType: inferProjectMemoryType({ projectProfile, projectForesight }),
      confidence: 0.98,
      reason: "Manual scope override forced project memory.",
    }
  }

  if (requestedScope === "global") {
    return {
      scope: "global",
      memoryType: globalPreference ? "profile" : "episodic_memory",
      confidence: 0.98,
      reason: globalPreference
        ? "Manual scope override forced global memory and the content looks like a user preference."
        : "Manual scope override forced global memory.",
    }
  }

  if (!options.enableGlobalScope) {
    return {
      scope: "project",
      memoryType: inferProjectMemoryType({ projectProfile, projectForesight }),
      confidence: 0.95,
      reason: "Global scope is disabled, so writes stay project-scoped.",
    }
  }

  // Precedence is intentional: project cues checked before global.
  // A message matching both (e.g. "I prefer TypeScript in this stack")
  // routes to project scope because projectProfile is checked first.
  if (projectForesight) {
    return {
      scope: "project",
      memoryType: "foresight",
      confidence: 0.86,
      reason: "The content looks like future work for this repository.",
    }
  }

  if (projectProfile) {
    return {
      scope: "project",
      memoryType: "profile",
      confidence: 0.84,
      reason: "The content looks like a project-specific convention or architecture fact.",
    }
  }

  if (globalPreference) {
    return {
      scope: "global",
      memoryType: "profile",
      confidence: 0.87,
      reason: "The content looks like a stable user preference that should follow across projects.",
    }
  }

  return {
    scope: "project",
    memoryType: "episodic_memory",
    confidence: 0.6,
    reason: "Defaulted to project episodic memory because no stronger scope signal was found.",
  }
}

function inferProjectMemoryType(signals: {
  projectProfile: boolean
  projectForesight: boolean
}): RoutedWrite["memoryType"] {
  if (signals.projectForesight) return "foresight"
  if (signals.projectProfile) return "profile"
  return "episodic_memory"
}
