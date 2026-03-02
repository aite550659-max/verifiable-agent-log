/**
 * ChangeNOW integration for VAL Relay
 *
 * Converts any supported crypto → HBAR for agent funding.
 * Uses ChangeNOW v1 API (partially keyless for estimates, key needed for exchanges).
 *
 * Flow:
 *   1. Agent calls /v1/swap/estimate — get rate + deposit amount
 *   2. Agent calls /v1/swap/create  — get deposit address
 *   3. Agent sends crypto to deposit address
 *   4. ChangeNOW converts and sends HBAR to agent's Hedera account
 *   5. Agent polls /v1/swap/status  — check completion
 */

const CHANGENOW_API = "https://api.changenow.io/v1";
const CHANGENOW_KEY = process.env.CHANGENOW_API_KEY || "";

// Common token ticker mappings to ChangeNOW format
const TICKER_MAP = {
  // Native tokens
  eth: "eth",
  btc: "btc",
  sol: "sol",
  hbar: "hbar",
  bnb: "bnb",
  matic: "matic",
  avax: "avax",
  dot: "dot",
  xrp: "xrp",
  // Stablecoins (need network suffix)
  "usdt-eth": "usdterc20",
  "usdt-erc20": "usdterc20",
  "usdt-trc20": "usdttrc20",
  "usdt-bsc": "usdtbsc",
  "usdt-sol": "usdtsol",
  "usdt-polygon": "usdtmatic",
  "usdt-avax": "usdtarc20",
  "usdc-eth": "usdc",
  "usdc-erc20": "usdc",
  "usdc-sol": "usdcsol",
  "usdc-bsc": "usdcbsc",
  "usdc-polygon": "usdcmatic",
  "usdc-base": "usdcbase",
  // Shorthand defaults (assume cheapest network)
  usdt: "usdttrc20",
  usdc: "usdcsol",
};

function resolveTicker(input) {
  const key = input.toLowerCase().trim();
  return TICKER_MAP[key] || key;
}

/**
 * Get estimated swap amount and minimum
 */
export async function getEstimate(fromToken, amount) {
  const from = resolveTicker(fromToken);
  const pair = `${from}_hbar`;

  const [minRes, estRes] = await Promise.all([
    fetch(`${CHANGENOW_API}/min-amount/${pair}`).then((r) => r.json()),
    amount
      ? fetch(`${CHANGENOW_API}/exchange-amount/${amount}/${pair}`).then((r) =>
          r.json()
        )
      : Promise.resolve(null),
  ]);

  if (minRes.error) {
    return { error: `Pair not supported: ${from} → HBAR. ${minRes.message || minRes.error}` };
  }

  return {
    from: fromToken,
    fromTicker: from,
    to: "hbar",
    minAmount: minRes.minAmount,
    ...(estRes && !estRes.error
      ? {
          sendAmount: amount,
          estimatedHbar: estRes.estimatedAmount,
          estimatedAttestations: Math.floor(
            Math.max(0, estRes.estimatedAmount - 0.1) / 0.001
          ),
          speedForecast: estRes.transactionSpeedForecast
            ? `${estRes.transactionSpeedForecast} minutes`
            : null,
        }
      : {}),
  };
}

/**
 * Create a swap — returns deposit address for the agent to send funds to.
 * HBAR will be sent directly to the agent's Hedera account.
 */
export async function createSwap(fromToken, amount, hederaAccountId) {
  const from = resolveTicker(fromToken);

  if (!CHANGENOW_KEY) {
    return { error: "ChangeNOW API key not configured on relay" };
  }

  // HBAR requires "extraId" (memo) field — not needed for account-level transfers
  const body = {
    from,
    to: "hbar",
    amount: parseFloat(amount),
    address: hederaAccountId,
    extraId: "",
    flow: "standard",
  };

  const res = await fetch(
    `${CHANGENOW_API}/transactions/${CHANGENOW_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await res.json();

  if (data.error) {
    return { error: data.message || data.error };
  }

  return {
    swapId: data.id,
    depositAddress: data.payinAddress,
    depositMemo: data.payinExtraId || null,
    sendAmount: data.amount,
    sendCurrency: fromToken,
    estimatedHbar: data.estimatedAmount || null,
    hederaAccount: hederaAccountId,
    status: "waiting",
    message: `Send ${amount} ${fromToken.toUpperCase()} to ${data.payinAddress}${data.payinExtraId ? ` (memo: ${data.payinExtraId})` : ""}. HBAR will arrive in ${hederaAccountId} within 10-60 minutes.`,
  };
}

/**
 * Check swap status
 */
export async function getSwapStatus(swapId) {
  if (!CHANGENOW_KEY) {
    return { error: "ChangeNOW API key not configured" };
  }

  const res = await fetch(
    `${CHANGENOW_API}/transactions/${swapId}/${CHANGENOW_KEY}`
  );
  const data = await res.json();

  if (data.error) {
    return { error: data.message || data.error };
  }

  return {
    swapId: data.id,
    status: data.status, // waiting, confirming, exchanging, sending, finished, failed, refunded
    from: data.fromCurrency,
    to: data.toCurrency,
    amountSent: data.amountSend,
    amountReceived: data.amountReceive,
    depositAddress: data.payinAddress,
    hederaAccount: data.payoutAddress,
    updatedAt: data.updatedAt,
    finished: data.status === "finished",
    failed: ["failed", "refunded", "expired"].includes(data.status),
  };
}

/**
 * List supported tokens for HBAR swaps
 */
export async function listSupportedTokens() {
  const res = await fetch(`${CHANGENOW_API}/currencies?active=true`);
  const all = await res.json();

  // Filter to common ones agents would have
  const common = new Set([
    "btc", "eth", "sol", "bnb", "matic", "avax", "dot", "xrp", "trx", "ada",
    "usdc", "usdcsol", "usdcbsc", "usdcmatic", "usdcbase",
    "usdterc20", "usdttrc20", "usdtbsc", "usdtsol", "usdtmatic",
  ]);

  return all
    .filter((c) => common.has(c.ticker))
    .map((c) => ({ ticker: c.ticker, name: c.name }));
}
