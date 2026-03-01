import type { Attestation } from "./types";
import { sha256 } from "./hash";

/**
 * VALReader — Read and verify an agent's attestation log from the Hedera mirror node.
 * No private keys needed. Anyone can verify.
 *
 *   const reader = new VALReader("0.0.12345");
 *   const log = await reader.fetch();
 *   const valid = reader.verifyChain(log);
 */
export class VALReader {
  private topicId: string;
  private mirrorUrl: string;

  constructor(topicId: string, network: "mainnet" | "testnet" = "mainnet") {
    this.topicId = topicId;
    this.mirrorUrl =
      network === "testnet"
        ? "https://testnet.mirrornode.hedera.com"
        : "https://mainnet-public.mirrornode.hedera.com";
  }

  /** Fetch all attestations from the mirror node */
  async fetch(limit = 100): Promise<Attestation[]> {
    const attestations: Attestation[] = [];
    let next: string | null =
      `/api/v1/topics/${this.topicId}/messages?limit=${Math.min(limit, 100)}&order=asc`;

    while (next && attestations.length < limit) {
      const res = await fetch(`${this.mirrorUrl}${next}`);
      if (!res.ok) throw new Error(`Mirror node error: ${res.status}`);
      const data = (await res.json()) as {
        messages: { message: string; consensus_timestamp: string; sequence_number: number }[];
        links?: { next?: string };
      };

      for (const msg of data.messages) {
        try {
          const decoded = Buffer.from(msg.message, "base64").toString("utf8");
          const attestation = JSON.parse(decoded) as Attestation;
          attestations.push(attestation);
        } catch {
          // Skip non-VAL messages
        }
      }

      next = data.links?.next ?? null;
    }

    return attestations;
  }

  /** Verify the hash chain integrity of a log */
  verifyChain(attestations: Attestation[]): {
    valid: boolean;
    brokenAt?: number;
    reason?: string;
  } {
    for (let i = 1; i < attestations.length; i++) {
      const prev = attestations[i - 1];
      const current = attestations[i];

      if (current.prev) {
        const expectedHash = sha256(JSON.stringify(prev));
        if (current.prev !== expectedHash) {
          return {
            valid: false,
            brokenAt: i,
            reason: `Hash chain broken at message ${i}: expected ${expectedHash}, got ${current.prev}`,
          };
        }
      }
    }

    return { valid: true };
  }

  /** Get a summary of an agent's log */
  async summary(): Promise<{
    topicId: string;
    totalMessages: number;
    agentName?: string;
    created?: string;
    lastActivity?: string;
    actionCount: number;
    chainValid: boolean;
  }> {
    const log = await this.fetch(1000);
    const chain = this.verifyChain(log);
    const createMsg = log.find((a) => a.type === "agent.create");
    const actions = log.filter((a) => a.type === "action");

    return {
      topicId: this.topicId,
      totalMessages: log.length,
      agentName: (createMsg?.data as Record<string, unknown>)?.name as string | undefined,
      created: createMsg?.ts,
      lastActivity: log[log.length - 1]?.ts,
      actionCount: actions.length,
      chainValid: chain.valid,
    };
  }
}
