import { createHash } from "node:crypto"
import { basename } from "node:path"

/**
 * Compute a stable groupId for EverMemOS scoping.
 *
 * Strategy:
 *  1. Hash the git remote origin URL (strips credentials, normalises)
 *  2. Fall back to hashing the directory basename if no remote exists
 *
 * The Bun shell `$` from PluginInput is used instead of child_process.
 */
export async function computeGroupId(
  $: (strings: TemplateStringsArray, ...exprs: unknown[]) => Promise<{ text(): Promise<string> }>,
  directory: string,
): Promise<string> {
  try {
    const result = await $`git -C ${directory} remote get-url origin`
    const remoteUrl = (await result.text()).trim()
    if (remoteUrl) {
      return sha256Short(remoteUrl)
    }
  } catch {
    // No remote — fall through
  }
  return sha256Short(basename(directory))
}

function sha256Short(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
