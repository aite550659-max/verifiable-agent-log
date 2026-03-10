import type { AgentCreateData, AgentBridgedPayload, TEEAttestation } from "./types";

// ─── Base58btc Encoder ───────────────────────────────────────

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encode a Uint8Array to base58btc string. */
export function base58btcEncode(bytes: Uint8Array): string {
  // Count leading zeros
  let zeros = 0;
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) zeros++;

  // Convert to bigint
  let num = BigInt(0);
  for (const byte of bytes) num = num * 256n + BigInt(byte);

  // Convert to base58
  const chars: string[] = [];
  while (num > 0n) {
    chars.unshift(BASE58_ALPHABET[Number(num % 58n)]);
    num = num / 58n;
  }

  // Prepend '1' for each leading zero byte
  for (let i = 0; i < zeros; i++) chars.unshift("1");

  return chars.join("");
}

// ─── DID Utilities ───────────────────────────────────────────

/**
 * Check if a string is a did:hedera DID.
 */
export function isHederaDID(identifier: string): boolean {
  return identifier.startsWith("did:hedera:");
}

/**
 * Extract the HCS topic ID from a did:hedera DID.
 * Format: did:hedera:mainnet:z7ASgb..._0.0.XXXXX
 * Returns the topic ID portion (e.g., "0.0.XXXXX").
 */
export function extractTopicFromDID(did: string): string | null {
  if (!isHederaDID(did)) return null;
  // DID format: did:hedera:<network>:<publicKeyMultibase>_<topicId>
  const parts = did.split("_");
  if (parts.length < 2) return null;
  return parts[parts.length - 1];
}

/**
 * Extract the network from a did:hedera DID.
 */
export function extractNetworkFromDID(did: string): string | null {
  if (!isHederaDID(did)) return null;
  const parts = did.split(":");
  if (parts.length < 3) return null;
  return parts[2]; // "mainnet" or "testnet"
}

/**
 * Encode a public key as multibase base58btc with multicodec prefix.
 * Ed25519 multicodec: 0xed, 0x01
 */
export function encodePublicKeyMultibase(publicKeyBytes: Uint8Array): string {
  const prefixed = new Uint8Array(2 + publicKeyBytes.length);
  prefixed[0] = 0xed; // ed25519-pub multicodec
  prefixed[1] = 0x01;
  prefixed.set(publicKeyBytes, 2);
  return `z${base58btcEncode(prefixed)}`;
}

/**
 * Construct a did:hedera DID from components.
 */
export function constructDID(
  network: "mainnet" | "testnet",
  publicKeyMultibase: string,
  topicId: string
): string {
  return `did:hedera:${network}:${publicKeyMultibase}_${topicId}`;
}

/**
 * Resolve agent identifier to a topic ID.
 * Accepts both raw topic IDs (0.0.XXXXX) and did:hedera DIDs.
 */
export function resolveToTopicId(agentIdentifier: string): string {
  if (isHederaDID(agentIdentifier)) {
    const topicId = extractTopicFromDID(agentIdentifier);
    if (!topicId) throw new Error(`Cannot extract topic ID from DID: ${agentIdentifier}`);
    return topicId;
  }
  // Assume raw topic ID
  return agentIdentifier;
}

// ─── DID Document ────────────────────────────────────────────

export interface DIDDocument {
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  service: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
  hederaAccountId?: string;
  hcsTopicId?: string;
  nftTokenId?: string;
}

/**
 * Generate a DID Document for a VAL agent.
 */
export function generateDIDDocument(opts: {
  did: string;
  publicKeyMultibase: string;
  hederaAccountId: string;
  hcsTopicId: string;
  nftTokenId?: string;
  network: "mainnet" | "testnet";
  registrationUri?: string;
  a2aEndpoint?: string;
}): DIDDocument {
  const services: DIDDocument["service"] = [
    {
      id: "#val-log",
      type: "VerifiableAgentLog",
      serviceEndpoint: `hedera:${opts.network}:${opts.hcsTopicId}`,
    },
  ];

  if (opts.registrationUri) {
    services.push({
      id: "#registration",
      type: "AgentRegistration",
      serviceEndpoint: opts.registrationUri,
    });
  }

  if (opts.a2aEndpoint) {
    services.push({
      id: "#a2a",
      type: "AgentToAgent",
      serviceEndpoint: opts.a2aEndpoint,
    });
  }

  return {
    id: opts.did,
    verificationMethod: [
      {
        id: `${opts.did}#key-1`,
        type: "Ed25519VerificationKey2020",
        controller: opts.did,
        publicKeyMultibase: opts.publicKeyMultibase,
      },
    ],
    service: services,
    hederaAccountId: opts.hederaAccountId,
    hcsTopicId: opts.hcsTopicId,
    nftTokenId: opts.nftTokenId,
  };
}

// ─── ERC-8004 Registration File ──────────────────────────────

export interface ERC8004RegistrationFile {
  schemaVersion: string;
  agentId: string;
  name: string;
  description?: string;
  did?: string;
  capabilities?: string[];
  protocols?: Array<{
    type: string;
    endpoint?: string;
  }>;
  extensions?: {
    val?: {
      hcs_topic: string;
      soul_hash: string;
      framework?: string;
    };
    atp?: {
      pricing?: Record<string, unknown>;
      enforcement?: string;
    };
    [key: string]: unknown;
  };
}

/**
 * Generate an ERC-8004 compatible agent registration file.
 */
export function generateERC8004Registration(opts: {
  agentId: string;
  name: string;
  description?: string;
  did?: string;
  capabilities?: string[];
  hcsTopicId: string;
  soulHash: string;
  framework?: string;
  a2aEndpoint?: string;
  pricing?: Record<string, unknown>;
  enforcement?: string;
}): ERC8004RegistrationFile {
  const protocols: ERC8004RegistrationFile["protocols"] = [];

  if (opts.a2aEndpoint) {
    protocols.push({ type: "a2a", endpoint: opts.a2aEndpoint });
  }
  protocols.push({ type: "val", endpoint: `hedera:hcs:${opts.hcsTopicId}` });

  const reg: ERC8004RegistrationFile = {
    schemaVersion: "1.0",
    agentId: opts.agentId,
    name: opts.name,
    description: opts.description,
    did: opts.did,
    capabilities: opts.capabilities,
    protocols,
    extensions: {
      val: {
        hcs_topic: opts.hcsTopicId,
        soul_hash: opts.soulHash,
        framework: opts.framework,
      },
    },
  };

  if (opts.pricing || opts.enforcement) {
    reg.extensions!.atp = {
      pricing: opts.pricing,
      enforcement: opts.enforcement,
    };
  }

  return reg;
}

// ─── A2A Agent Card ──────────────────────────────────────────

export interface A2AAgentCard {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  capabilities?: {
    skills?: Array<{
      id: string;
      name: string;
      description?: string;
    }>;
  };
  authentication?: {
    type: string;
    did?: string;
    publicKey?: string;
  };
  protocols?: Array<{
    name: string;
    version: string;
    endpoint?: string;
  }>;
}

/**
 * Generate an A2A Agent Card.
 */
export function generateA2ACard(opts: {
  name: string;
  description?: string;
  url?: string;
  version?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  did?: string;
  publicKeyMultibase?: string;
  hcsTopicId: string;
  registrationUri?: string;
}): A2AAgentCard {
  const card: A2AAgentCard = {
    name: opts.name,
    description: opts.description,
    url: opts.url,
    version: opts.version ?? "1.0",
  };

  if (opts.skills?.length) {
    card.capabilities = { skills: opts.skills };
  }

  if (opts.did || opts.publicKeyMultibase) {
    card.authentication = {
      type: opts.did ? "did" : "publicKey",
      did: opts.did,
      publicKey: opts.publicKeyMultibase,
    };
  }

  card.protocols = [
    { name: "val", version: "1.1", endpoint: `hedera:hcs:${opts.hcsTopicId}` },
  ];

  if (opts.registrationUri) {
    card.protocols.push({
      name: "erc8004",
      version: "1.0",
      endpoint: opts.registrationUri,
    });
  }

  return card;
}

// ─── Bridge ──────────────────────────────────────────────────

/**
 * Create an agent_bridged payload for cross-chain identity linking.
 */
export function createBridgedPayload(opts: {
  sourceChain: string;
  sourceIdentity: string;
  sourceStandard: string;
  sourceNftContract?: string;
  sourceNftTokenId?: string;
  hederaDid: string;
  hederaHcsTopic: string;
  hederaNftTokenId?: string;
  bridgedBy: string;
  registrationUri?: string;
}): AgentBridgedPayload {
  return {
    source_chain: opts.sourceChain,
    source_identity: opts.sourceIdentity,
    source_standard: opts.sourceStandard,
    source_nft_contract: opts.sourceNftContract,
    source_nft_token_id: opts.sourceNftTokenId,
    hedera_did: opts.hederaDid,
    hedera_hcs_topic: opts.hederaHcsTopic,
    hedera_nft_token_id: opts.hederaNftTokenId,
    bridged_by: opts.bridgedBy,
    registration_uri: opts.registrationUri,
  };
}
