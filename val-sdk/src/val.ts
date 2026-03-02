import {
  Client,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  AccountId,
  PrivateKey,
} from "@hashgraph/sdk";
import { sha256 } from "./hash";
import { PolicyEngine } from "./policy";
import { loadWallet, saveWallet, provisionViaRelay } from "./provision";
import type { ActionCategory } from "./policy";
import type {
  VALConfig,
  Attestation,
  AttestOptions,
  ActionData,
  AgentCreateData,
  SoulVerifyData,
  HeartbeatData,
} from "./types";

/** Parse a private key from various formats (tries ECDSA first — most common for Hedera) */
function parsePrivateKey(key: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(key);
  } catch {
    try {
      return PrivateKey.fromStringED25519(key);
    } catch {
      try {
        return PrivateKey.fromStringDer(key);
      } catch {
        return PrivateKey.fromString(key);
      }
    }
  }
}

/**
 * VAL — Verifiable Agent Log
 *
 * Immutable audit trails for AI agents via Hedera Consensus Service.
 *
 * Usage:
 *   const val = new VAL({ operatorId: "0.0.12345", operatorKey: "302e..." });
 *   await val.init();
 *   await val.attest({ tool: "web_search", desc: "Searched for HBAR price" });
 */
export class VAL {
  private client: Client;
  private topicId: TopicId | null = null;
  private prevHash: string | null = null;
  private config: VALConfig;
  private _ready = false;
  private heartbeatSeq = 0;
  private policy: PolicyEngine;
  private _skipped = 0;

  constructor(config: VALConfig) {
    this.config = config;
    this.policy = new PolicyEngine(config.policy ?? "standard");

    // Client setup deferred if no credentials (will provision in init)
    const network = config.network ?? "mainnet";
    this.client =
      network === "testnet" ? Client.forTestnet() : Client.forMainnet();

    if (config.operatorId && config.operatorKey) {
      this.client.setOperator(
        AccountId.fromString(config.operatorId),
        parsePrivateKey(config.operatorKey)
      );
    }

    if (config.topicId) {
      this.topicId = TopicId.fromString(config.topicId);
    }
  }

  /**
   * Initialize the agent's VAL log.
   *
   * If operatorId/operatorKey are set: creates topic + posts agent.create.
   * If not set but relay is configured: provisions a wallet via relay first.
   * If a wallet file exists at walletPath: loads it and resumes.
   */
  async init(createData?: Partial<AgentCreateData>): Promise<string> {
    // Step 1: Resolve credentials
    if (!this.config.operatorId || !this.config.operatorKey) {
      await this.resolveCredentials();
    }

    // Step 2: Create topic if needed
    if (!this.topicId) {
      const operatorKey = parsePrivateKey(this.config.operatorKey!);
      const tx = await new TopicCreateTransaction()
        .setAdminKey(operatorKey)
        .setSubmitKey(operatorKey)
        .setTopicMemo(`VAL:${this.config.agentName ?? "agent"}`)
        .execute(this.client);
      const receipt = await tx.getReceipt(this.client);
      this.topicId = receipt.topicId!;

      // Post agent.create as first message
      await this.submit({
        val: "1.0",
        type: "agent.create",
        ts: new Date().toISOString(),
        agent: this.topicId.toString(),
        data: {
          name: createData?.name ?? this.config.agentName ?? "agent",
          soul_hash: createData?.soul_hash ?? "",
          capabilities: createData?.capabilities ?? [],
          creator: createData?.creator ?? this.config.operatorId ?? "",
          framework: createData?.framework ?? "val-sdk/0.1.0",
        },
      });

      // Persist wallet + topic for resumption
      this.persistWallet();
    }

    this._ready = true;
    return this.topicId.toString();
  }

  /** Resolve credentials: check stored wallet, or provision via relay */
  private async resolveCredentials(): Promise<void> {
    // Try loading stored wallet
    const stored = loadWallet(this.config.walletPath);
    if (stored) {
      this.config.operatorId = stored.accountId;
      this.config.operatorKey = stored.privateKey;
      if (stored.topicId) {
        this.topicId = TopicId.fromString(stored.topicId);
      }
      this.client.setOperator(
        AccountId.fromString(stored.accountId),
        parsePrivateKey(stored.privateKey)
      );
      return;
    }

    // Provision via relay
    if (!this.config.relay) {
      throw new Error(
        "No credentials and no relay configured. Provide operatorId/operatorKey, " +
          "or set relay URL for auto-provisioning."
      );
    }

    const wallet = await provisionViaRelay(
      this.config.relay,
      this.config.apiKey ?? "",
      this.config.agentName ?? "val-agent"
    );

    this.config.operatorId = wallet.accountId;
    this.config.operatorKey = wallet.privateKey;
    this.client.setOperator(
      AccountId.fromString(wallet.accountId),
      parsePrivateKey(wallet.privateKey)
    );

    // Save for future sessions
    saveWallet(wallet, this.config.walletPath);
  }

  /** Persist wallet + topic to disk for session resumption */
  private persistWallet(): void {
    if (this.config.operatorId && this.config.operatorKey) {
      const stored = loadWallet(this.config.walletPath) || {
        accountId: this.config.operatorId,
        privateKey: this.config.operatorKey,
        publicKey: "",
        network: this.config.network ?? "mainnet",
        agentName: this.config.agentName,
      };
      stored.topicId = this.topicId?.toString();
      saveWallet(stored, this.config.walletPath);
    }
  }

  /** The agent's topic ID (log identifier) */
  get agentId(): string {
    if (!this.topicId) throw new Error("VAL not initialized — call init() first");
    return this.topicId.toString();
  }

  /** Whether init() has been called */
  get ready(): boolean {
    return this._ready;
  }

  /** Number of actions skipped by policy */
  get skipped(): number {
    return this._skipped;
  }

  /** Register a tool with its action category for policy classification */
  registerTool(tool: string, category: ActionCategory): void {
    this.policy.registerTool(tool, category);
  }

  /** Register multiple tools at once */
  registerTools(mappings: Record<string, ActionCategory>): void {
    this.policy.registerTools(mappings);
  }

  /** Check if a tool would be attested under current policy (dry run) */
  wouldAttest(tool: string, category?: ActionCategory): boolean {
    return this.policy.shouldAttest(tool, category);
  }

  // ─── Public API ────────────────────────────────────────────

  /**
   * Attest an action. This is the primary method most integrations will use.
   *
   *   await val.attest({ tool: "send_email", desc: "Sent quarterly report" });
   *   await val.attest({ tool: "swap", desc: "Swapped 100 HBAR for USDC", input: txParams });
   */
  async attest(opts: AttestOptions): Promise<{ sequenceNumber: number; topicId: string } | null> {
    this.ensureReady();

    // Policy check: should this action be attested?
    if (!opts.force && !this.policy.shouldAttest(opts.tool, opts.category)) {
      this._skipped++;
      return null;
    }

    const data: ActionData = {
      tool: opts.tool,
      status: opts.status ?? "success",
      desc: opts.desc,
      input_hash: opts.input !== undefined ? sha256(opts.input) : undefined,
      output_hash: opts.output !== undefined ? sha256(opts.output) : undefined,
    };

    return this.submit({
      val: "1.0",
      type: "action",
      ts: new Date().toISOString(),
      agent: this.topicId!.toString(),
      data: stripUndefined(data as unknown as Record<string, unknown>),
    });
  }

  /** Post a soul.verify attestation (identity integrity check) */
  async verifySoul(data: SoulVerifyData): Promise<{ sequenceNumber: number; topicId: string }> {
    this.ensureReady();
    return this.submit({
      val: "1.0",
      type: "soul.verify",
      ts: new Date().toISOString(),
      agent: this.topicId!.toString(),
      data: data as unknown as Record<string, unknown>,
    });
  }

  /** Post a heartbeat attestation */
  async heartbeat(
    data?: Partial<HeartbeatData>
  ): Promise<{ sequenceNumber: number; topicId: string }> {
    this.ensureReady();
    this.heartbeatSeq++;
    return this.submit({
      val: "1.0",
      type: "heartbeat",
      ts: new Date().toISOString(),
      agent: this.topicId!.toString(),
      data: { seq: this.heartbeatSeq, ...data },
    });
  }

  /** Submit a raw attestation envelope (advanced usage) */
  async submitRaw(attestation: Attestation): Promise<{ sequenceNumber: number; topicId: string }> {
    this.ensureReady();
    return this.submit(attestation);
  }

  // ─── Internal ──────────────────────────────────────────────

  private ensureReady() {
    if (!this._ready || !this.topicId) {
      throw new Error("VAL not initialized — call init() first");
    }
  }

  private async submit(
    attestation: Attestation
  ): Promise<{ sequenceNumber: number; topicId: string }> {
    // Chain: include hash of previous message
    if (this.prevHash) {
      attestation.prev = this.prevHash;
    }

    const message = JSON.stringify(attestation);

    // HCS 1024-byte limit check
    const bytes = Buffer.byteLength(message, "utf8");
    if (bytes > 1024) {
      throw new Error(
        `Attestation exceeds HCS 1024-byte limit (${bytes} bytes). Shorten desc or reduce data.`
      );
    }

    let tx;
    try {
      tx = await new TopicMessageSubmitTransaction()
        .setTopicId(this.topicId!)
        .setMessage(message)
        .execute(this.client);
    } catch (e: unknown) {
      if (isInsufficientBalance(e)) {
        throw new InsufficientBalanceError(this.config.operatorId!, this.config.network ?? "mainnet");
      }
      throw e;
    }

    let receipt;
    try {
      receipt = await tx.getReceipt(this.client);
    } catch (e: unknown) {
      if (isInsufficientBalance(e)) {
        throw new InsufficientBalanceError(this.config.operatorId!, this.config.network ?? "mainnet");
      }
      throw e;
    }
    const seqNum = Number(receipt.topicSequenceNumber);

    // Update chain hash
    this.prevHash = sha256(message);

    return { sequenceNumber: seqNum, topicId: this.topicId!.toString() };
  }

  /** Close the Hedera client connection */
  close() {
    this.client.close();
  }
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function isInsufficientBalance(e: unknown): boolean {
  const msg = String(e);
  return (
    msg.includes("INSUFFICIENT_PAYER_BALANCE") ||
    msg.includes("INSUFFICIENT_TX_FEE") ||
    msg.includes("INSUFFICIENT_ACCOUNT_BALANCE")
  );
}

/**
 * Thrown when the agent's Hedera account doesn't have enough HBAR.
 * Contains clear instructions for the agent to fund itself.
 */
export class InsufficientBalanceError extends Error {
  readonly accountId: string;
  readonly network: string;
  readonly fundingInstructions: string;

  constructor(accountId: string, network: string) {
    const explorer =
      network === "testnet"
        ? `https://hashscan.io/testnet/account/${accountId}`
        : `https://hashscan.io/mainnet/account/${accountId}`;

    const instructions = [
      `Your VAL agent account ${accountId} is out of HBAR.`,
      ``,
      `Fund your account by swapping any crypto to HBAR via the VAL relay:`,
      ``,
      `  POST /v1/swap/create`,
      `  { "from": "usdc", "amount": 1, "accountId": "${accountId}" }`,
      ``,
      `  → You'll receive a deposit address. Send your crypto there.`,
      `  → HBAR arrives in ${accountId} within 10-60 minutes.`,
      ``,
      `Supported: ETH, SOL, BTC, USDC, USDT, BNB, MATIC, AVAX, XRP, and 200+ more.`,
      ``,
      `Check rate:  GET /v1/swap/estimate?from=usdc&amount=1`,
      `Check balance: ${explorer}`,
      ``,
      `Estimated costs:`,
      `  • $0.01 of any crypto ≈ 100 attestations`,
      `  • $0.05 of any crypto ≈ 500 attestations`,
      `  • $0.10 of any crypto ≈ 1000 attestations`,
    ].join("\n");

    super(instructions);
    this.name = "InsufficientBalanceError";
    this.accountId = accountId;
    this.network = network;
    this.fundingInstructions = instructions;
  }
}
