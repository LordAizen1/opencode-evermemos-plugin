#!/usr/bin/env node
import { writeFileSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Assume the plugin is side-by-side with EverMemOS-main in development, 
// or let the user override via EVERMEMOS_DIR
const EVERMEMOS_DIR = process.env.EVERMEMOS_DIR || resolve(__dirname, "../../EverMemOS-main")
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || process.argv[3] || "http://127.0.0.1:3000"
const OPENCODE_USERNAME = process.env.OPENCODE_USERNAME || "opencode"
const OPENCODE_PASSWORD = process.env.OPENCODE_PASSWORD

async function fetchIfOk(url: string) {
  try {
    const headers: Record<string, string> = {}
    if (OPENCODE_PASSWORD) {
      headers["Authorization"] = "Basic " + Buffer.from(`${OPENCODE_USERNAME}:${OPENCODE_PASSWORD}`).toString('base64')
    }

    const res = await fetch(url, { headers })
    if (!res.ok) {
      console.log(`Fetch returned status ${res.status}`)
      return null
    }
    return await res.json()
  } catch (error: any) {
    console.log(`Fetch threw error: ${error.message}`)
    return null
  }
}

async function runDoctor() {
  console.log("🩺 Running OpenCode-EverMemOS Diagnostics...")
  
  // 1. Check OpenCode Inference
  process.stdout.write(`  Checking OpenCode Inference at ${OPENCODE_BASE_URL}/health... `)
  const health = await fetchIfOk(`${OPENCODE_BASE_URL}/internal/inference/health`)
  if (!health) {
    console.log("❌ FAILED")
    console.error(`\n    Make sure OpenCode is running and exposes the internal API at ${OPENCODE_BASE_URL}`)
    console.error(`    Hint: If OpenCode assigned a random port (like 52059), run: bun run doctor http://127.0.0.1:52059`)
    process.exit(1)
  }
  console.log("✅ OK")

  // 2. Check EverMemOS
  // Default EverMemOS API port is often 8000
  const EVERMEMOS_API_URL = "http://127.0.0.1:8000"
  process.stdout.write("  Checking EverMemOS Backend... ")
  const memHealth = await fetchIfOk(`${EVERMEMOS_API_URL}/api/v1/health`) || await fetchIfOk(`${EVERMEMOS_API_URL}/v1/health`)
  if (!memHealth && !existsSync(EVERMEMOS_DIR)) {
    console.log("❌ FAILED")
    console.error(`\n    EverMemOS is not running, and directory ${EVERMEMOS_DIR} not found.`)
    console.error("    Please start EverMemOS with 'up' before using the plugin.")
  } else if (!memHealth) {
    console.log("⚠️ WARNING - Not currently running (can be started via setup/up)")
  } else {
    console.log("✅ OK")
  }
  
  console.log("\nDiagnostics look good.")
}

async function runSetup() {
  console.log("⚙️  Setting up OpenCode ↔ EverMemOS integration...")
  
  if (!existsSync(EVERMEMOS_DIR)) {
    console.error(`❌ Cannot find EverMemOS directory at: ${EVERMEMOS_DIR}`)
    console.error("   Please set EVERMEMOS_DIR to your EverMemOS installation.")
    process.exit(1)
  }

  // 1. Fetch Models
  process.stdout.write(`  Checking OpenCode Inference at ${OPENCODE_BASE_URL}/models...\n`)
  const modelsData = await fetchIfOk(`${OPENCODE_BASE_URL}/internal/inference/models`) as any
  if (!modelsData) {
    console.error(`❌ Cannot reach OpenCode at ${OPENCODE_BASE_URL}.`)
    console.error(`   If OpenCode assigned a random port (like 52059), run: \`bun run setup http://127.0.0.1:52059\``)
    process.exit(1)
  }

  const defaultModel = modelsData.defaultModel
  let chatModel = defaultModel
  let embeddingModel = ""

  // Automatically find an embedding model among providers
  const providers = modelsData.providers || []
  for (const provider of providers) {
    for (const [id, model] of Object.entries(provider.models || {})) {
      const lower = id.toLowerCase()
      if (lower.includes("embed") || lower.includes("text-embedding")) {
        embeddingModel = `${provider.name}/${id}`
        break
      }
    }
    if (embeddingModel) break
  }

  if (!embeddingModel) {
    console.warn("⚠️  Could not automatically detect an embedding model connected to OpenCode.")
    console.warn("   You may need to configure one manually (e.g. OpenAI text-embedding-3-small).")
  } else {
    console.log(`✅ Selected Embedding Model: ${embeddingModel}`)
  }

  console.log(`✅ Selected Chat Model: ${chatModel}`)

  // 2. Generate .env path
  const envPath = join(EVERMEMOS_DIR, ".env")
  let envLines: string[] = []
  
  // Read existing .env to preserve other settings if we wanted, 
  // but for a clean "plugin-managed" seam, we should set the necessary integration values.
  
  // Base configuration:
  const configMap: Record<string, string> = {
    "LLM_PROVIDER": "opencode",
    "VECTORIZE_PROVIDER": "opencode",
    "OPENCODE_BASE_URL": OPENCODE_BASE_URL,
    "OPENCODE_CHAT_MODEL": chatModel,
  }
  
  if (OPENCODE_PASSWORD) {
    configMap["OPENCODE_USERNAME"] = OPENCODE_USERNAME
    configMap["OPENCODE_PASSWORD"] = OPENCODE_PASSWORD
  }

  if (embeddingModel) {
    configMap["OPENCODE_EMBEDDING_MODEL"] = embeddingModel
  }

  for (const [k, v] of Object.entries(configMap)) {
    envLines.push(`${k}=${v}`)
  }

  console.log(`\nWriting config to ${envPath}...`)
  writeFileSync(envPath, envLines.join("\n") + "\n", { encoding: "utf-8" })
  
  console.log("✅ Setup Complete!")
  console.log("\nNext Steps:")
  console.log("  1. Run `bun evermemos up` to start EverMemOS with local inference")
  console.log("  2. Restart the OpenCode plugin to ensure it connects correctly.")
}

async function runUp() {
  console.log("🚀 Starting EverMemOS... (Placeholder for launching backend)")
  // Usually this runs 'docker compose up' or 'python run.py'
  console.log(`Please run cd ${EVERMEMOS_DIR} && make run (or your usual start command)`)
}

async function main() {
  const cmd = process.argv[2]
  switch (cmd) {
    case "setup":
      await runSetup()
      break
    case "doctor":
      await runDoctor()
      break
    case "up":
      await runUp()
      break
    default:
      console.log(`Usage: evermemos <command>
Commands:
  setup   - Discover OpenCode models and generate EverMemOS config
  doctor  - Check system health of OpenCode inference and EverMemOS
  up      - Start the EverMemOS background service
`)
  }
}

main().catch(console.error)
