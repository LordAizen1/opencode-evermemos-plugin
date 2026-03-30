import type { Plugin } from "@opencode-ai/plugin"
import { EverMemOSClient } from "./client.js"
import { loadConfig } from "./config.js"
import { computeGroupId } from "./git.js"
import { formatRecalledMemories, buildToolSummary } from "./memory.js"
import { sanitize } from "./sanitize.js"
import {
  cacheUserMessage,
  getCachedUserMessage,
  pruneExpired,
} from "./session-cache.js"

/**
 * OpenCode EverMemOS Plugin
 *
 * Gives the OpenCode model durable, per-project memory powered by EverMemOS.
 *
 * Hook wiring:
 *  - chat.message          → cache sanitized user message; fire-and-forget store
 *  - experimental.chat.system.transform → recall memories, inject into system prompt
 *  - tool.execute.after    → fire-and-forget store of tool summaries
 *  - event (session.idle)  → prune expired session cache entries
 */
const plugin: Plugin = async (input) => {
  const config = loadConfig()
  const client = new EverMemOSClient(config)
  const groupId = await computeGroupId(
    input.$ as any,       // BunShell tagged-template callable
    input.directory,
  )

  return {
    // ------------------------------------------------------------------
    // chat.message — cache the user message for recall; store it async
    // ------------------------------------------------------------------
    "chat.message": async (_hookInput, output) => {
      const text = extractUserText(output)
      if (!text) return

      const sessionId = _hookInput.sessionID
      const sanitized = sanitize(text)
      cacheUserMessage(sessionId, sanitized)

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
          /* fail open — never crash the chat */
        })
    },

    // ------------------------------------------------------------------
    // experimental.chat.system.transform — recall & inject memories
    // ------------------------------------------------------------------
    "experimental.chat.system.transform": async (hookInput, output) => {
      const sessionId = hookInput.sessionID
      if (!sessionId) return

      const query = getCachedUserMessage(sessionId)
      if (!query) return

      const response = await client.search({
        query,
        group_id: groupId,
        retrieve_method: config.retrieveMethod,
        top_k: config.recallTopK,
      })

      if (!response || response.result.total_count === 0) return

      const block = formatRecalledMemories(response)
      if (block) {
        output.system.push(block)
      }
    },

    // ------------------------------------------------------------------
    // tool.execute.after — store a summary of tool results as memory
    // ------------------------------------------------------------------
    "tool.execute.after": async (hookInput, output) => {
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
    // event — listen for session.idle to prune cache
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
