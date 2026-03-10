/**
 * VAL Auto-Attestation Plugin for OpenClaw
 *
 * Registers an `after_tool_call` hook that automatically attests
 * tool executions to Hedera Consensus Service via the VAL SDK.
 *
 * This is a reference integration demonstrating SDK-level enforcement:
 * the agent doesn't decide whether to attest — the framework handles it.
 */

import { execSync } from "child_process";
import { createHash } from "crypto";

// ─── Types ───────────────────────────────────────────────────

interface PluginConfig {
  topicId?: string;
  operatorId?: string;
  operatorKey?: string;
  operatorKeyRef?: string;
  policy?: "minimal" | "standard" | "strict";
  network?: "mainnet" | "testnet";
  agentName?: string;
  did?: string;
  async?: boolean;
}

interface AfterToolCallEvent {
  toolName: string;
  params: unknown;
  runId: string;
  toolCallId: string;
  result: unknown;
  error?: string;
  durationMs?: number;
}

interface AfterToolCallContext {
  toolName: string;
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId: string;
  toolCallId: string;
}

// ─── Policy Engine (inline, minimal) ─────────────────────────

// Tool categories for policy decisions
type ActionCategory =
  | "financial"
  | "identity"
  | "external_comms"
  | "data_access"
  | "system"
  | "internal";

// Default tool → category mappings for OpenClaw tools
const TOOL_CATEGORIES: Record<string, ActionCategory> = {
  // Financial
  exec: "system", // could be financial depending on content

  // External communications
  message: "external_comms",
  tts: "external_comms",

  // Data access
  read: "data_access",
  write: "data_access",
  edit: "data_access",
  web_search: "data_access",
  web_fetch: "data_access",
  pdf: "data_access",
  image: "data_access",

  // System
  process: "system",
  browser: "system",
  canvas: "system",
  nodes: "system",

  // Internal (low-signal)
  memory_search: "internal",
  memory_get: "internal",
  session_status: "internal",
  sessions_list: "internal",
  sessions_history: "internal",
  sessions_send: "internal",
  sessions_spawn: "internal",
  subagents: "internal",
  agents_list: "internal",
};

// Policy: which categories to attest at each level
const POLICY_MATRIX: Record<string, Set<ActionCategory>> = {
  minimal: new Set(["financial", "identity", "external_comms"]),
  standard: new Set(["financial", "identity", "external_comms", "data_access", "system"]),
  strict: new Set(["financial", "identity", "external_comms", "data_access", "system", "internal"]),
};

function shouldAttest(toolName: string, policy: string): boolean {
  const category = TOOL_CATEGORIES[toolName] ?? "system";
  const allowed = POLICY_MATRIX[policy] ?? POLICY_MATRIX.standard;
  return allowed.has(category);
}

// ─── Hashing (privacy-preserving) ────────────────────────────

function sha256(data: unknown): string {
  const json = typeof data === "string" ? data : JSON.stringify(data);
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

// ─── Key Resolution ──────────────────────────────────────────

function resolveOperatorKey(config: PluginConfig): string | null {
  // Direct key
  if (config.operatorKey) return config.operatorKey;

  // Keychain reference: "keychain:<service>" or "keychain:<service>:<account>"
  if (config.operatorKeyRef?.startsWith("keychain:")) {
    const parts = config.operatorKeyRef.slice("keychain:".length).split(":");
    const service = parts[0];
    const account = parts[1];

    try {
      const cmd = account
        ? `security find-generic-password -s "${service}" -a "${account}" -w`
        : `security find-generic-password -s "${service}" -w`;
      return execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
    } catch {
      return null;
    }
  }

  return null;
}

// ─── VAL Client (lightweight inline) ─────────────────────────
// We use a lightweight HCS submitter instead of importing the full
// val-sdk to keep the plugin dependency-free. The attestation format
// matches VAL v1.1 exactly.

let hederaSdk: typeof import("@hashgraph/sdk") | null = null;

async function loadHederaSDK() {
  if (!hederaSdk) {
    // Dynamic import — @hashgraph/sdk should be available in the
    // OpenClaw environment (it's a val-sdk dependency)
    hederaSdk = await import("@hashgraph/sdk");
  }
  return hederaSdk;
}

interface AttestationState {
  client: any;
  topicId: any;
  privateKey: any;
  prevHash: string | null;
  agentId: string;
  ready: boolean;
}

let state: AttestationState | null = null;

async function initAttestation(config: PluginConfig, logger: any): Promise<boolean> {
  try {
    const sdk = await loadHederaSDK();
    const { Client, AccountId, PrivateKey, TopicId } = sdk;

    const operatorKey = resolveOperatorKey(config);
    if (!operatorKey || !config.operatorId) {
      logger.warn("VAL attestation: missing operatorId or operatorKey — attestation disabled");
      return false;
    }

    // Try Ed25519 first (recommended), then ECDSA
    let privateKey;
    try {
      privateKey = PrivateKey.fromStringED25519(operatorKey);
    } catch {
      try {
        privateKey = PrivateKey.fromStringECDSA(operatorKey);
      } catch {
        privateKey = PrivateKey.fromString(operatorKey);
      }
    }

    const network = config.network ?? "mainnet";
    const client = network === "testnet" ? Client.forTestnet() : Client.forMainnet();
    client.setOperator(AccountId.fromString(config.operatorId), privateKey);

    const topicId = config.topicId ? TopicId.fromString(config.topicId) : null;
    const agentId = config.did ?? config.topicId ?? config.operatorId!;

    state = {
      client,
      topicId,
      privateKey,
      prevHash: null,
      agentId,
      ready: !!topicId,
    };

    if (!topicId) {
      logger.warn("VAL attestation: no topicId configured — will create on first attestation");
    }

    logger.info(`VAL attestation initialized: agent=${agentId} topic=${config.topicId ?? "pending"} policy=${config.policy ?? "standard"}`);
    return true;
  } catch (err) {
    logger.error(`VAL attestation init failed: ${err}`);
    return false;
  }
}

function deepSortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(deepSortKeys);
  if (obj !== null && typeof obj === "object" && (obj as object).constructor === Object) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = deepSortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(deepSortKeys(obj));
}

function signAttestation(attestation: Record<string, unknown>, privateKey: any): string {
  const { sig: _, ...rest } = attestation;
  const canonical = canonicalJson(rest);
  const bytes = Buffer.from(canonical, "utf8");
  const signature = privateKey.sign(bytes);

  // Detect key type
  const der = privateKey.toStringDer();
  const algo = der.startsWith("302e") ? "ed25519" : "ecdsa-secp256k1";

  return `${algo}:${Buffer.from(signature).toString("base64")}`;
}

async function submitAttestation(
  toolName: string,
  status: "success" | "failure" | "error",
  desc: string,
  inputHash: string | undefined,
  outputHash: string | undefined,
  logger: any
): Promise<void> {
  if (!state?.ready) return;

  const sdk = await loadHederaSDK();
  const { TopicMessageSubmitTransaction } = sdk;

  const attestation: Record<string, unknown> = {
    val: "1.1",
    type: "action",
    ts: new Date().toISOString(),
    agent: state.agentId,
    data: {
      tool: toolName,
      status,
      desc,
      ...(inputHash ? { input_hash: inputHash } : {}),
      ...(outputHash ? { output_hash: outputHash } : {}),
    },
  };

  // Chain hash
  if (state.prevHash) {
    attestation.prev = state.prevHash;
  }

  // Sign
  attestation.sig = signAttestation(attestation, state.privateKey);

  const message = canonicalJson(attestation);

  // HCS 1024-byte limit
  const bytes = Buffer.byteLength(message, "utf8");
  if (bytes > 1024) {
    // Truncate desc and retry
    const shortDesc = (desc || "").slice(0, 50) + "…";
    (attestation.data as any).desc = shortDesc;
    attestation.sig = signAttestation(attestation, state.privateKey);
  }

  const finalMessage = canonicalJson(attestation);

  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(state.topicId!)
      .setMessage(finalMessage)
      .execute(state.client);

    await tx.getReceipt(state.client);

    // Update chain hash
    state.prevHash = sha256(finalMessage);
  } catch (err) {
    logger.warn(`VAL attestation failed: tool=${toolName} error=${err}`);
  }
}

// ─── Plugin Entry ────────────────────────────────────────────

export default function register(api: any) {
  const logger = api.logger ?? console;
  let config: PluginConfig = {};
  let initialized = false;
  let initPromise: Promise<boolean> | null = null;

  // Lazy init on first tool call
  async function ensureInit(): Promise<boolean> {
    if (initialized) return state?.ready ?? false;
    if (initPromise) return initPromise;

    // Read config from plugin entries
    try {
      const pluginConfig = api.config?.plugins?.entries?.["val-attestation"]?.config;
      if (pluginConfig) config = pluginConfig;
    } catch {}

    initPromise = initAttestation(config, logger);
    initialized = true;
    return initPromise;
  }

  // Register the after_tool_call hook
  api.on(
    "after_tool_call",
    async (event: AfterToolCallEvent, ctx: AfterToolCallContext) => {
      const policy = config.policy ?? "standard";

      // Policy check: should this tool be attested?
      if (!shouldAttest(event.toolName, policy)) return;

      // Lazy init
      const ready = await ensureInit();
      if (!ready) return;

      // Build attestation
      const status = event.error ? "error" : "success";
      const desc = event.error
        ? `${event.toolName}: ${event.error.slice(0, 80)}`
        : `${event.toolName}${event.durationMs ? ` (${event.durationMs}ms)` : ""}`;

      // Hash params and result for privacy (never attest raw content)
      const inputHash = event.params ? sha256(event.params) : undefined;
      const outputHash = event.result ? sha256(event.result) : undefined;

      if (config.async !== false) {
        // Fire and forget — don't block the agent
        submitAttestation(event.toolName, status, desc, inputHash, outputHash, logger).catch(
          (err) => logger.warn(`VAL attestation async error: ${err}`)
        );
      } else {
        // Blocking — wait for HCS confirmation
        await submitAttestation(event.toolName, status, desc, inputHash, outputHash, logger);
      }
    },
    { priority: -10 } // Low priority — run after other hooks
  );

  logger.info("VAL Auto-Attestation plugin registered (hook: after_tool_call)");
}
