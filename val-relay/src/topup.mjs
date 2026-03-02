/**
 * Top-Up Service for VAL Relay
 *
 * Agents deposit any supported crypto to a relay-managed address.
 * Relay detects the deposit, converts to HBAR via ChangeNOW,
 * and funds the agent's Hedera account.
 *
 * Flow:
 *   1. Agent calls POST /v1/topup/address → gets a unique deposit address per chain
 *   2. Agent sends crypto to that address (any amount, any supported token)
 *   3. Relay detects deposit → swaps to HBAR → sends to agent's Hedera account
 *   4. Agent's balance increases, continues attesting
 *
 * The agent never needs to know about ChangeNOW, HBAR, or Hedera.
 * It just sends crypto to an address and attestation credits appear.
 */

import { createSwap, getSwapStatus } from "./swap.mjs";

/**
 * In-memory ledger of agent top-up requests.
 * Production: replace with persistent store.
 */
const topups = new Map();

/**
 * Create a top-up deposit address for an agent.
 *
 * The agent says "I want to top up with USDC" and gets back
 * a deposit address. Send crypto there, HBAR arrives in their account.
 *
 * @param {string} agentAccountId - Agent's Hedera account (e.g. "0.0.12345")
 * @param {string} fromToken - Token to deposit (e.g. "usdc", "eth", "sol")
 * @param {number} amount - Amount to deposit
 */
export async function createTopup(agentAccountId, fromToken, amount) {
  const swap = await createSwap(fromToken, amount, agentAccountId);

  if (swap.error) {
    return { error: swap.error };
  }

  const record = {
    agentAccountId,
    swapId: swap.swapId,
    fromToken,
    amount,
    depositAddress: swap.depositAddress,
    depositMemo: swap.depositMemo,
    estimatedHbar: swap.estimatedHbar,
    status: "awaiting_deposit",
    createdAt: new Date().toISOString(),
  };

  topups.set(swap.swapId, record);

  return {
    swapId: swap.swapId,
    depositAddress: swap.depositAddress,
    depositMemo: swap.depositMemo,
    fromToken,
    amount,
    estimatedHbar: swap.estimatedHbar,
    estimatedAttestations: Math.floor(
      Math.max(0, (swap.estimatedHbar || 0) - 0.1) / 0.001
    ),
    message: `Send ${amount} ${fromToken.toUpperCase()} to ${swap.depositAddress}${swap.depositMemo ? ` (memo: ${swap.depositMemo})` : ""}. Your account ${agentAccountId} will be credited with ~${swap.estimatedHbar} HBAR (~${Math.floor(Math.max(0, (swap.estimatedHbar || 0) - 0.1) / 0.001)} attestations).`,
  };
}

/**
 * Check top-up status
 */
export async function getTopupStatus(swapId) {
  const record = topups.get(swapId);
  const swapStatus = await getSwapStatus(swapId);

  if (swapStatus.error) {
    return { error: swapStatus.error };
  }

  return {
    swapId,
    agentAccountId: record?.agentAccountId || swapStatus.hederaAccount,
    status: swapStatus.status,
    finished: swapStatus.finished,
    failed: swapStatus.failed,
    amountDeposited: swapStatus.amountSent,
    hbarCredited: swapStatus.amountReceived,
    attestationsAdded: swapStatus.amountReceived
      ? Math.floor(Math.max(0, parseFloat(swapStatus.amountReceived) - 0.1) / 0.001)
      : null,
  };
}

/**
 * List active top-ups for an agent
 */
export function listTopups(agentAccountId) {
  const results = [];
  for (const [, record] of topups) {
    if (record.agentAccountId === agentAccountId) {
      results.push(record);
    }
  }
  return results;
}
