import { EverMemOSClient } from "./client.js"
import { recallLocalExact, recallLocalSemantic } from "./local-memory.js"
import {
  dedupeMemories,
  excludeMemories,
  flattenSearchMemories,
  formatCompactionMemories,
  formatMemorySection,
  formatProfileMemories,
  mergeRecallBlocks,
  rankMemoriesForRecall,
} from "./memory.js"
import { localScopeKey } from "./scope.js"
import type { PluginConfig, RecalledMemory, ScopeContext } from "./types.js"

export interface ProjectRecallContext {
  blocks: string[]
  allHits: RecalledMemory[]
}

export async function recallProjectContext(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
  query: string,
  topK: number,
): Promise<ProjectRecallContext> {
  const projectSpace = localScopeKey(scopeContext, "project")
  const localExact = recallLocalExact(projectSpace, query, topK)
  const localSemantic = localExact.length > 0 ? [] : recallLocalSemantic(projectSpace, query, topK)
  const localHits = [...localExact, ...localSemantic]

  const [searchResponse, projectProfileMemories] = await Promise.all([
    client.search({
      query,
      user_id: scopeContext.userId,
      group_id: scopeContext.projectGroupId,
      retrieve_method: config.retrieveMethod,
      top_k: topK,
    }),
    config.injectProfileRecall
      ? client.listProfileMemories(scopeContext.userId, scopeContext.projectGroupId, config.profileRecallLimit)
      : Promise.resolve([]),
  ])

  const remoteHits = searchResponse ? flattenSearchMemories(searchResponse) : []
  const historyHits = rankMemoriesForRecall(
    [
      ...filterByTypes(localHits, ["episodic_memory", "event_log", "local_memory"]),
      ...filterByTypes(remoteHits, ["episodic_memory", "event_log"]),
    ],
    query,
  )
  const foresightHits = rankMemoriesForRecall(
    [
      ...filterByTypes(localHits, ["foresight"]),
      ...filterByTypes(remoteHits, ["foresight"]),
    ],
    query,
  )
  const profileHits = dedupeMemories([
    ...filterByTypes(localHits, ["profile"]),
    ...projectProfileMemories,
  ])

  const projectProfileBlock = config.injectProfileRecall && profileHits.length > 0
    ? formatProfileMemories(
        profileHits,
        config.profileRecallLimit,
        1000,
        "## Project profile memories",
      )
    : ""

  const projectHistoryBlock = formatMemorySection(
    historyHits,
    "## Project history",
    query,
    topK,
    1400,
  )
  const projectForesightBlock = formatMemorySection(
    foresightHits,
    "## Project foresight",
    query,
    Math.min(3, topK),
    800,
  )

  return {
    blocks: [projectProfileBlock, projectHistoryBlock, projectForesightBlock].filter(Boolean),
    allHits: dedupeMemories([...profileHits, ...historyHits, ...foresightHits]),
  }
}

export async function recallProjectBlocks(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
  query: string,
  topK: number,
): Promise<string[]> {
  return (await recallProjectContext(client, config, scopeContext, query, topK)).blocks
}

export async function recallGlobalBlocks(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
  query: string,
  topK: number,
  excludedMemories: RecalledMemory[] = [],
): Promise<string> {
  if (!config.enableGlobalScope) return ""

  const globalSpace = localScopeKey(scopeContext, "global")
  const localExact = recallLocalExact(globalSpace, query, topK)
  const localSemantic = localExact.length > 0 ? [] : recallLocalSemantic(globalSpace, query, topK)
  const localHits = [...localExact, ...localSemantic]

  const globalProfileMemories = await recallGlobalProfileMemories(client, config, scopeContext)
  const novelRemoteProfileHits = excludeMemories(globalProfileMemories, excludedMemories)
  const novelLocalProfileHits = excludeMemories(localHits, excludedMemories)

  const remoteProfileBlock =
    novelRemoteProfileHits.length > 0
      ? formatProfileMemories(
          novelRemoteProfileHits,
          config.globalProfileRecallLimit,
          1000,
          "## Global profile memories",
        )
      : ""
  const localProfileBlock =
    novelLocalProfileHits.length > 0
      ? formatProfileMemories(
          novelLocalProfileHits,
          Math.min(topK, config.globalProfileRecallLimit),
          1000,
          "## Global profile memories (local fallback)",
        )
      : ""

  return mergeRecallBlocks(remoteProfileBlock, localProfileBlock)
}

export async function recallCompactionBlock(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
  query: string,
): Promise<string> {
  const response = await client.search({
    query,
    user_id: scopeContext.userId,
    group_id: scopeContext.projectGroupId,
    retrieve_method: config.retrieveMethod,
    top_k: Math.min(config.recallTopK, 4),
  })

  if (!response || response.result.total_count === 0) return ""
  const compactCandidates = rankMemoriesForRecall(
    filterByTypes(flattenSearchMemories(response), ["episodic_memory", "event_log", "foresight"]),
    query,
  )
  if (compactCandidates.length === 0) return ""

  return formatCompactionMemories(
    {
      status: "ok",
      message: "filtered-compaction",
      result: {
        memories: [{ compact: compactCandidates }],
        total_count: compactCandidates.length,
        has_more: false,
      },
    },
    4,
    1200,
    query,
  )
}

async function recallGlobalProfileBlock(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
): Promise<string> {
  const globalProfileMemories = await recallGlobalProfileMemories(client, config, scopeContext)
  return formatProfileMemories(
    globalProfileMemories,
    config.globalProfileRecallLimit,
    1000,
    "## Global profile memories",
  )
}

async function recallGlobalProfileMemories(
  client: EverMemOSClient,
  config: PluginConfig,
  scopeContext: ScopeContext,
): Promise<RecalledMemory[]> {
  if (!config.enableGlobalScope || !config.injectProfileRecall) return []
  return client.listProfileMemories(
    scopeContext.userId,
    scopeContext.globalGroupId,
    config.globalProfileRecallLimit,
  )
}

function filterByTypes(memories: RecalledMemory[], types: string[]): RecalledMemory[] {
  const allowed = new Set(types)
  return memories.filter((memory) => allowed.has(memory.memory_type))
}
