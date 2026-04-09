import { tool, type Plugin } from "@opencode-ai/plugin"
import { EverMemOSClient } from "./client.js"
import { loadConfig } from "./config.js"
import { computeGroupId } from "./git.js"
import { recallLocalExact, recallLocalSemantic, rememberLocal } from "./local-memory.js"
import {
  formatCompactionMemories,
  formatProfileMemories,
  formatRecalledMemories,
  mergeRecallBlocks,
  buildToolSummary,
  shapeRecallQuery,
} from "./memory.js"
import { sanitize } from "./sanitize.js"
import {
  cacheUserMessage,
  getCachedUserMessage,
  pruneExpired,
} from "./session-cache.js"

const z = tool.schema

// Tools that must never be stored as memories — they'd pollute recall with meta-noise.
const SKIP_TOOLS = new Set(["evermemos_recall", "evermemos_remember", "evermemos_forget"])

// Messages that look like plugin tool invocations shouldn't be stored either.
const PLUGIN_INVOCATION_RE = /\bevermemos_(recall|remember|forget)\b/i

/**
 * OpenCode EverMemOS Plugin
 *
 * Gives the OpenCode model durable, per-project memory powered by EverMemOS.
 *
 * Hook wiring:
 *  - chat.message -> cache sanitized user message; fire-and-forget store
 *  - experimental.chat.system.transform -> recall memories, inject into system prompt
 *  - experimental.session.compacting -> add compact recall context for compaction
 *  - tool.execute.after -> fire-and-forget store of tool summaries
 *  - event (session.idle) -> prune expired session cache entries
 */
const plugin: Plugin = async (input) => {
  const config = loadConfig()
  const client = new EverMemOSClient(config)
  const groupId = await computeGroupId(
    input.$ as any, // BunShell tagged-template callable
    input.directory,
  )

  return {
    tool: {
      evermemos_recall: tool({
        description:
          "Recall relevant project memories from EverMemOS for the current repository scope.",
        args: {
          query: z.string().min(1).describe("What to recall"),
          top_k: z.number().int().positive().max(20).optional(),
        },
        execute: async (args) => {
          const query = shapeRecallQuery(
            sanitize(args.query, { maxLength: 1024 }),
          )
          if (!query) return "No query provided after sanitization."
          const topK = args.top_k ?? config.recallTopK
          const localExact = recallLocalExact(groupId, query, topK)
          const localSemantic = localExact.length > 0
            ? []
            : recallLocalSemantic(groupId, query, topK)

          const [response, profileMemories] = await Promise.all([
            client.search({
              query,
              group_id: groupId,
              retrieve_method: config.retrieveMethod,
              top_k: topK,
            }),
            config.injectProfileRecall
              ? client.listProfileMemories(groupId, config.profileRecallLimit)
              : Promise.resolve([]),
          ])

          if (!response && localExact.length === 0) return "EverMemOS unavailable or timed out."
          if (
            (!response || response.result.total_count === 0)
            && profileMemories.length === 0
            && localExact.length === 0
            && localSemantic.length === 0
          ) {
            return "No matching memories found."
          }

          const effective = response ?? {
            status: "ok",
            message: "local-only",
            result: {
              memories: [],
              total_count: 0,
              has_more: false,
            },
          }
          const block = formatRecalledMemories(
            effective,
            query,
            [...localExact, ...localSemantic, ...profileMemories],
          )
          if (!block) return "No matching memories found."

          return block.length > 4000 ? `${block.slice(0, 4000)}\n...[truncated]` : block
        },
      }),

      evermemos_remember: tool({
        description:
          "Store a durable memory entry in EverMemOS for the current repository scope.",
        args: {
          content: z.string().min(1).describe("Memory content to store"),
          role: z.enum(["user", "assistant"]).optional(),
        },
        execute: async (args) => {
          const content = sanitize(args.content, { maxLength: config.toolOutputMaxChars })
          if (!content) return "Nothing to store after sanitization."
          const role = args.role ?? "user"
          rememberLocal(groupId, content, role)

          const result = await client.memorize({
            message_id: `manual-${Date.now()}`,
            create_time: new Date().toISOString(),
            sender: config.senderId,
            content,
            group_id: groupId,
            role,
          })

          if (!result) return "Failed to store memory (EverMemOS unavailable or timed out)."
          return "Memory stored successfully."
        },
      }),

      evermemos_forget: tool({
        description:
          "Delete memories in EverMemOS by event_id, user_id, or current project scope.",
        args: {
          event_id: z.string().optional(),
          user_id: z.string().optional(),
          current_project_only: z.boolean().optional(),
        },
        execute: async (args) => {
          const payload = {
            event_id: args.event_id,
            user_id: args.user_id,
            group_id: args.current_project_only ? groupId : undefined,
          }

          if (!payload.event_id && !payload.user_id && !payload.group_id) {
            return "Refusing broad delete: provide event_id, user_id, or current_project_only=true."
          }

          const result = await client.deleteMemories(payload)
          if (!result) return "Failed to delete memories (EverMemOS unavailable or timed out)."
          if (result.ok && result.notFound) return "No memories matched the delete criteria (already clean)."
          if (!result.ok) return "Failed to delete memories."
          return "Delete request sent successfully."
        },
      }),
    },

    // ------------------------------------------------------------------
    // chat.message - cache the user message for recall; store it async
    // ------------------------------------------------------------------
    "chat.message": async (_hookInput, output) => {
      const text = extractUserText(output)
      if (!text) return

      const sessionId = _hookInput.sessionID
      const sanitized = sanitize(text)
      cacheUserMessage(sessionId, shapeRecallQuery(sanitized) || sanitized)

      // Skip storing plugin tool invocations — they create meta-noise in recall
      if (PLUGIN_INVOCATION_RE.test(sanitized)) return

      // Fire-and-forget: store user message in EverMemOS
      client
        .memorize({
          message_id: `${sessionId}-${Date.now()}`,
          create_time: new Date().toISOString(),
          sender: config.senderId,
          content: sanitized,
          group_id: groupId,
          role: "user",
        })
        .catch(() => {
          /* fail open - never crash the chat */
        })
    },

    // ------------------------------------------------------------------
    // experimental.chat.system.transform - recall and inject memories
    // ------------------------------------------------------------------
    "experimental.chat.system.transform": async (hookInput, output) => {
      const sessionId = hookInput.sessionID
      if (!sessionId) return

      // Use cached query from current message if available; fall back to a
      // broad default so recall still fires on the very first message of a
      // fresh session (cache is empty until chat.message populates it).
      const query =
        shapeRecallQuery(getCachedUserMessage(sessionId)) ??
        "project context preferences stack technology"

      const localExact = recallLocalExact(groupId, query, config.recallTopK)
      const localSemantic =
        localExact.length > 0
          ? []
          : recallLocalSemantic(groupId, query, config.recallTopK)
      const localHits = [...localExact, ...localSemantic]

      const [searchResponse, profileMemories] = await Promise.all([
        client.search({
          query,
          group_id: groupId,
          retrieve_method: config.retrieveMethod,
          top_k: config.recallTopK,
        }),
        config.injectProfileRecall
          ? client.listProfileMemories(groupId, config.profileRecallLimit)
          : Promise.resolve([]),
      ])

      const episodicBlock =
        searchResponse && searchResponse.result.total_count > 0
          ? formatRecalledMemories(searchResponse, query, localHits)
          : localHits.length > 0
            ? formatRecalledMemories(
                { status: "ok", message: "local-only", result: { memories: [], total_count: 0, has_more: false } },
                query,
                localHits,
              )
            : ""
      const profileBlock = config.injectProfileRecall
        ? formatProfileMemories(profileMemories, config.profileRecallLimit)
        : ""
      const merged = mergeRecallBlocks(episodicBlock, profileBlock)

      if (merged) output.system.push(merged)
    },

    // ------------------------------------------------------------------
    // experimental.session.compacting - add concise recall context
    // ------------------------------------------------------------------
    "experimental.session.compacting": async (hookInput, output) => {
      const query = shapeRecallQuery(getCachedUserMessage(hookInput.sessionID))
      if (!query) return

      const response = await client.search({
        query,
        group_id: groupId,
        retrieve_method: config.retrieveMethod,
        top_k: Math.min(config.recallTopK, 4),
      })

      if (!response || response.result.total_count === 0) return

      const compactBlock = formatCompactionMemories(response, 4, 1200, query)
      if (compactBlock) {
        output.context.push(compactBlock)
      }
    },

    // ------------------------------------------------------------------
    // tool.execute.after - store a summary of tool results as memory
    // ------------------------------------------------------------------
    "tool.execute.after": async (hookInput, output) => {
      // Never store the plugin's own tool calls — primary source of meta-noise
      if (SKIP_TOOLS.has(hookInput.tool)) return

      const summary = buildToolSummary(
        hookInput.tool,
        hookInput.args,
        output.title,
        output.output,
        config.toolOutputMaxChars,
      )
      const sanitized = sanitize(summary, { maxLength: config.toolOutputMaxChars })

      client
        .memorize({
          message_id: `tool-${hookInput.callID}`,
          create_time: new Date().toISOString(),
          sender: config.senderId,
          content: sanitized,
          group_id: groupId,
          role: "assistant",
        })
        .catch(() => {
          /* fail open */
        })
    },

    // ------------------------------------------------------------------
    // event - listen for session.idle to prune cache
    // ------------------------------------------------------------------
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        pruneExpired()
      }
    },
  }
}

export default plugin

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractUserText(
  output: { message: { content: string } | unknown; parts: unknown[] },
): string {
  // UserMessage has a `content` field with the raw user text
  const msg = output.message as Record<string, unknown> | undefined
  if (msg && typeof msg.content === "string") {
    return msg.content
  }
  // Fallback: concatenate text parts
  if (Array.isArray(output.parts)) {
    return output.parts
      .filter((p: any) => p?.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
  }
  return ""
}
