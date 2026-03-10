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
  /**
   * Other crypto wallets the agent has access to.
   * Used for auto-funding: when HBAR runs low, the SDK will
   * cascade through these wallets to find one that can be
   * swapped to HBAR via ChangeNOW.
   */
  wallets?: import("./autofund").WalletBalance[];
  /** Agent's W3C DID (did:hedera or other). New in v1.1. */
  did?: string;
  /** URL of agent registration file (ERC-8004 format). New in v1.1. */
  registrationUri?: string;
  /** URL of A2A Agent Card endpoint. New in v1.1. */
  a2aEndpoint?: string;
}

/** VAL protocol version */
export type VALVersion = "1.0" | "1.1";

/** Base attestation envelope per VAL v1.1 spec */
export interface Attestation {
  val: VALVersion;
  type: "agent.create" | "action" | "soul.verify" | "heartbeat";
  ts: string;
  agent: string;
  data: Record<string, unknown>;
  prev?: string;
  sig: string;
}

/** Legacy v1.0 attestation (sig optional) */
export interface AttestationV1 {
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

/** Data payload for agent.create (v1.1) */
export interface AgentCreateData {
  name: string;
  soul_hash: string;
  capabilities?: string[];
  creator?: string;
  framework?: string;
  /** Agent's W3C DID. New in v1.1. */
  did?: string;
  /** URL of agent registration file (ERC-8004 format). New in v1.1. */
  registration_uri?: string;
  /** URL of A2A Agent Card endpoint. New in v1.1. */
  a2a_endpoint?: string;
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

// ─── ATP v2.1 Types ──────────────────────────────────────────

/** Enforcement level for rental constraints */
export type EnforcementLevel = "cooperative" | "audited" | "sdk" | "tee";

/** ATP rental constraints (v2.1) */
export interface RentalConstraints {
  tools_blocked?: string[];
  memory_access_level?: "sandboxed" | "read_only" | "full";
  topics_blocked?: string[];
  max_per_instruction_cost?: number;
  max_daily_cost?: number;
  /** How constraints are enforced. Default: "cooperative". New in v2.1. */
  enforcement?: EnforcementLevel;
}

/** TEE attestation proof (v2.1) */
export interface TEEAttestation {
  /** TEE platform (e.g., "intel_sgx", "intel_tdx", "amd_sev", "nvidia_blackwell") */
  platform: string;
  /** Hash of the code running in the enclave */
  enclave_hash: string;
  /** Base64-encoded hardware attestation proof */
  attestation_proof: string;
  /** Entity that can verify the proof (e.g., "eqty_lab", "intel", "nvidia") */
  verified_by: string;
  /** URL to verify the attestation proof */
  verification_endpoint?: string;
}

/** Runtime attestation payload (v2.1) */
export interface RuntimeAttestationPayload {
  runtime_name: string;
  runtime_version: string;
  atp_sdk_version?: string;
  runtime_hash: string;
  attestation_statement?: string;
  memory_isolation: boolean;
  operator?: string;
  operator_stake?: number;
  /** Hardware attestation proof. Null/absent when not available. New in v2.1. */
  tee_attestation?: TEEAttestation | null;
}

/** Agent bridged payload (v2.1) — cross-chain identity linking */
export interface AgentBridgedPayload {
  /** Origin chain (e.g., "ethereum", "base", "polygon") */
  source_chain: string;
  /** Agent's identity on origin chain (e.g., EVM address) */
  source_identity: string;
  /** Identity standard on origin chain (e.g., "ERC-8004") */
  source_standard: string;
  /** NFT contract address on origin chain */
  source_nft_contract?: string;
  /** NFT token ID on origin chain */
  source_nft_token_id?: string;
  /** New did:hedera DID created for the agent */
  hedera_did: string;
  /** New HCS topic for VAL attestation log */
  hedera_hcs_topic: string;
  /** New HTS NFT token ID (if minted) */
  hedera_nft_token_id?: string;
  /** Hedera account that initiated the bridge */
  bridged_by: string;
  /** Updated registration file URL */
  registration_uri?: string;
}

/** ATP message envelope (v2.1) */
export interface ATPMessage {
  atp_version: "2.1";
  message_type: string;
  agent_id: string;
  timestamp: string;
  payload: Record<string, unknown>;
  sig: string;
}
