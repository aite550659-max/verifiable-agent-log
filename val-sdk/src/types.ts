import type { PolicyLevel, AttestPolicy, ActionCategory } from "./policy";

/** Configuration for VAL SDK */
export interface VALConfig {
  /** Hedera operator account ID (e.g. "0.0.12345"). Omit to auto-provision via relay. */
  operatorId?: string;
  /** Hedera operator private key (DER-encoded hex or raw). Omit to auto-provision via relay. */
  operatorKey?: string;
  /** HCS topic ID for this agent's log. If omitted, one will be created. */
  topicId?: string;
  /** Network: "mainnet" | "testnet" (default: "mainnet") */
  network?: "mainnet" | "testnet";
  /** Agent name for agent.create message */
  agentName?: string;
  /** Attestation policy: which actions to log (default: "standard") */
  policy?: PolicyLevel | AttestPolicy;
  /** VAL relay URL for auto-provisioning (free tier funding) */
  relay?: string;
  /** VAL relay API key */
  apiKey?: string;
  /** Path to persist wallet credentials (default: ~/.val/wallet.json) */
  walletPath?: string;
}

/** Base attestation envelope per VAL v1 spec */
export interface Attestation {
  val: "1.0";
  type: "agent.create" | "action" | "soul.verify" | "heartbeat";
  ts: string;
  agent: string;
  data: Record<string, unknown>;
  prev?: string;
  sig?: string;
}

/** Data payload for action attestations */
export interface ActionData {
  tool: string;
  status: "success" | "failure" | "error";
  desc?: string;
  input_hash?: string;
  output_hash?: string;
  context_hash?: string;
}

/** Data payload for agent.create */
export interface AgentCreateData {
  name: string;
  soul_hash: string;
  capabilities?: string[];
  creator?: string;
  framework?: string;
}

/** Data payload for soul.verify */
export interface SoulVerifyData {
  soul_hash: string;
  files?: Record<string, string>;
  changed: boolean;
  prev_hash?: string;
}

/** Data payload for heartbeat */
export interface HeartbeatData {
  seq: number;
  uptime_h?: number;
  actions_since_last?: number;
  soul_hash?: string;
}

/** Options for val.attest() convenience method */
export interface AttestOptions {
  /** Tool or action name */
  tool: string;
  /** Brief description (< 100 chars recommended) */
  desc?: string;
  /** Status */
  status?: "success" | "failure" | "error";
  /** Raw input to hash (will be SHA-256'd, not stored) */
  input?: unknown;
  /** Raw output to hash (will be SHA-256'd, not stored) */
  output?: unknown;
  /** Override the action category for policy evaluation */
  category?: ActionCategory;
  /** Force attestation regardless of policy (use sparingly) */
  force?: boolean;
}
