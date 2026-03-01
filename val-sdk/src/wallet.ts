import {
  Client,
  AccountCreateTransaction,
  Hbar,
  PrivateKey,
  AccountId,
  TransferTransaction,
  AccountBalanceQuery,
} from "@hashgraph/sdk";

export interface WalletInfo {
  accountId: string;
  privateKey: string;
  publicKey: string;
  network: "mainnet" | "testnet";
}

/**
 * Generate a new Hedera keypair (local, no network call).
 * The account doesn't exist on-chain until funded.
 */
export function generateKeypair(): { privateKey: string; publicKey: string } {
  const key = PrivateKey.generateECDSA();
  return {
    privateKey: key.toStringRaw(),
    publicKey: key.publicKey.toStringRaw(),
  };
}

/**
 * Create a Hedera account for an agent.
 * Requires a funded operator to pay for account creation (~$0.05).
 */
export async function createAccount(
  client: Client,
  initialBalance: Hbar = new Hbar(0.5)
): Promise<WalletInfo> {
  const newKey = PrivateKey.generateECDSA();

  const tx = await new AccountCreateTransaction()
    .setKey(newKey.publicKey)
    .setInitialBalance(initialBalance)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  const accountId = receipt.accountId!.toString();

  const network = client.mirrorNetwork?.[0]?.includes("testnet")
    ? "testnet"
    : "mainnet";

  return {
    accountId,
    privateKey: newKey.toStringRaw(),
    publicKey: newKey.publicKey.toStringRaw(),
    network: network as "mainnet" | "testnet",
  };
}

/**
 * Fund an existing Hedera account with HBAR.
 */
export async function fundAccount(
  client: Client,
  targetAccountId: string,
  amount: Hbar
): Promise<string> {
  const operatorId = client.operatorAccountId!.toString();

  const tx = await new TransferTransaction()
    .addHbarTransfer(operatorId, amount.negated())
    .addHbarTransfer(targetAccountId, amount)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  return receipt.status.toString();
}

/**
 * Check HBAR balance of an account.
 */
export async function getBalance(
  client: Client,
  accountId: string
): Promise<number> {
  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(accountId))
    .execute(client);
  return balance.hbars.toBigNumber().toNumber();
}

/**
 * Estimate how many attestations an HBAR balance can support.
 * HCS submit ≈ 0.0001 USD ≈ ~0.001 HBAR at current prices.
 * Topic creation ≈ 0.01 USD ≈ ~0.1 HBAR.
 */
export function estimateAttestations(hbarBalance: number): {
  topicCreation: number;
  attestations: number;
} {
  const TOPIC_COST_HBAR = 0.1;
  const ATTEST_COST_HBAR = 0.001;

  if (hbarBalance < TOPIC_COST_HBAR) {
    return { topicCreation: 0, attestations: 0 };
  }

  const remaining = hbarBalance - TOPIC_COST_HBAR;
  return {
    topicCreation: 1,
    attestations: Math.floor(remaining / ATTEST_COST_HBAR),
  };
}
