/**
 * Auto-funding cascade for VAL agents.
 *
 * When HBAR runs low, automatically find and convert available crypto
 * before prompting the user.
 *
 * Cascade:
 *   1. HBAR balance sufficient → proceed
 *   2. Other wallets with balances → auto-swap via ChangeNOW → HBAR
 *   3. No auto-swappable balance → prompt agent for approval
 *   4. No funds anywhere → InsufficientBalanceError
 */

import { checkBalanceViaRelay } from "./provision";

export interface WalletBalance {
  /** Token symbol (e.g. "ETH", "SOL", "USDC") */
  token: string;
  /** Chain/network (e.g. "ethereum", "solana", "base") */
  chain: string;
  /** Balance amount */
  balance: number;
  /** Estimated USD value */
  usdValue?: number;
  /** Wallet address on that chain */
  address: string;
  /** Can the SDK send from this wallet without human approval? */
  canAutoSend: boolean;
}

export interface FundingResult {
  action: "sufficient" | "auto_swapped" | "approval_needed" | "no_funds";
  /** Current HBAR balance after any action */
  hbarBalance?: number;
  /** If auto_swapped: details of the swap */
  swap?: {
    swapId: string;
    from: string;
    amount: number;
    depositAddress: string;
    estimatedHbar: number;
    message: string;
  };
  /** If approval_needed: which wallet could be used */
  candidateWallet?: WalletBalance;
  /** Human-readable message */
  message: string;
}

/** Minimum HBAR to trigger auto-funding (enough for ~50 attestations) */
const LOW_BALANCE_THRESHOLD = 0.05;

/** Minimum HBAR to fund to (enough for ~250 attestations + headroom) */
const TARGET_FUND_AMOUNT_USD = 0.10; // $0.10 worth of source token

/**
 * Check balance and auto-fund if needed.
 *
 * @param relayUrl - VAL relay URL
 * @param hederaAccountId - Agent's Hedera account
 * @param wallets - All wallets the agent has access to
 */
export async function ensureFunded(
  relayUrl: string,
  hederaAccountId: string,
  wallets: WalletBalance[]
): Promise<FundingResult> {
  // Step 1: Check HBAR balance
  let hbarBalance: number;
  try {
    const bal = await checkBalanceViaRelay(relayUrl, hederaAccountId);
    hbarBalance = bal.hbar;
  } catch {
    // If we can't check, assume we're fine and let the submit fail naturally
    return { action: "sufficient", message: "Balance check unavailable, proceeding." };
  }

  if (hbarBalance >= LOW_BALANCE_THRESHOLD) {
    return {
      action: "sufficient",
      hbarBalance,
      message: `HBAR balance: ${hbarBalance} (sufficient)`,
    };
  }

  // Step 2: Find wallets that can auto-send (no human approval needed)
  const autoWallets = wallets
    .filter((w) => w.canAutoSend && w.balance > 0 && w.token.toUpperCase() !== "HBAR")
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

  if (autoWallets.length > 0) {
    // Pick the best wallet (highest USD value, prefer stablecoins)
    const stablecoin = autoWallets.find((w) =>
      ["USDC", "USDT", "DAI", "BUSD"].includes(w.token.toUpperCase())
    );
    const wallet = stablecoin || autoWallets[0];

    // Calculate amount to swap (target ~$0.10 worth, or min swap amount)
    const swapAmount = calculateSwapAmount(wallet);

    try {
      const swap = await createSwapViaRelay(
        relayUrl,
        wallet.token,
        swapAmount,
        hederaAccountId
      );

      if (swap.error) {
        // Swap failed, fall through to approval
      } else {
        return {
          action: "auto_swapped",
          hbarBalance,
          swap: {
            swapId: swap.swapId,
            from: wallet.token,
            amount: swapAmount,
            depositAddress: swap.depositAddress,
            estimatedHbar: swap.estimatedHbar,
            message: swap.message,
          },
          message: `Auto-funding: swapping ${swapAmount} ${wallet.token} → HBAR via ${swap.depositAddress}`,
        };
      }
    } catch {
      // Swap creation failed, fall through
    }
  }

  // Step 3: Find wallets that need approval
  const manualWallets = wallets
    .filter((w) => !w.canAutoSend && w.balance > 0 && w.token.toUpperCase() !== "HBAR")
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

  if (manualWallets.length > 0) {
    const best = manualWallets[0];
    return {
      action: "approval_needed",
      hbarBalance,
      candidateWallet: best,
      message:
        `HBAR balance low (${hbarBalance}). ` +
        `Found ${best.balance} ${best.token} on ${best.chain} (${best.address}) ` +
        `that can be swapped to HBAR. Approve to proceed.`,
    };
  }

  // Step 4: No funds anywhere
  return {
    action: "no_funds",
    hbarBalance,
    message:
      `HBAR balance depleted (${hbarBalance}) and no other wallets with funds found. ` +
      `Fund your Hedera account ${hederaAccountId} to continue attesting.`,
  };
}

function calculateSwapAmount(wallet: WalletBalance): number {
  // For stablecoins, swap $1 worth (or balance if less)
  if (["USDC", "USDT", "DAI", "BUSD"].includes(wallet.token.toUpperCase())) {
    return Math.min(wallet.balance, 1.0);
  }
  // For other tokens, swap a small fraction (or use USD estimate)
  if (wallet.usdValue && wallet.usdValue > 0) {
    // Target $0.50 worth
    const fraction = 0.5 / wallet.usdValue;
    return Math.min(wallet.balance, wallet.balance * fraction);
  }
  // Fallback: swap 10% of balance
  return wallet.balance * 0.1;
}

async function createSwapViaRelay(
  relayUrl: string,
  fromToken: string,
  amount: number,
  accountId: string
): Promise<{
  swapId: string;
  depositAddress: string;
  estimatedHbar: number;
  message: string;
  error?: string;
}> {
  const res = await fetch(`${relayUrl}/v1/swap/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromToken, amount, accountId }),
  });
  return res.json() as any;
}
