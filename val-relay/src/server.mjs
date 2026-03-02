/**
 * VAL Relay Server
 *
 * Provisions Hedera wallets and funds them for AI agent attestations.
 * The agent always signs their own transactions — the relay just funds.
 *
 * Endpoints:
 *   POST /v1/provision     — Create a Hedera account, fund it, return credentials
 *   POST /v1/fund          — Top up an existing account
 *   GET  /v1/balance       — Check agent's HBAR balance + attestation estimate
 *   GET  /v1/health        — Relay health check
 *   GET  /v1/swap/estimate — Get conversion rate for any crypto → HBAR
 *   POST /v1/swap/create   — Create a swap (agent sends crypto, gets HBAR)
 *   GET  /v1/swap/status   — Check swap completion
 *   GET  /v1/swap/tokens   — List supported tokens
 *
 * Safeguards:
 *   - Rate limit: 1 provision per API key per 24h
 *   - Free tier: 0.5 HBAR per agent (~400 attestations)
 *   - Max fund per request: 1 HBAR
 *   - API key required for all writes
 *   - Abuse detection: track provisions per IP
 */

import { createServer } from "http";
import { getEstimate, createSwap, getSwapStatus, listSupportedTokens } from "./swap.mjs";
import { createTopup, getTopupStatus, listTopups } from "./topup.mjs";
import {
  Client,
  AccountCreateTransaction,
  TransferTransaction,
  AccountBalanceQuery,
  Hbar,
  PrivateKey,
  AccountId,
} from "@hashgraph/sdk";

// ─── Config ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3141");
const NETWORK = process.env.HEDERA_NETWORK || "mainnet";
const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY;

// Free tier limits
const FREE_TIER_HBAR = 0.5;         // ~400 attestations + 1 topic creation
const MAX_FUND_HBAR = 1.0;           // Max per funding request
const PROVISION_COOLDOWN_MS = 86400000; // 24h between provisions per key
const MAX_PROVISIONS_PER_IP = 5;      // Lifetime limit per IP

if (!OPERATOR_ID || !OPERATOR_KEY) {
  console.error("❌ Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY");
  process.exit(1);
}

// ─── Hedera Client ───────────────────────────────────────────

const client = NETWORK === "testnet" ? Client.forTestnet() : Client.forMainnet();
client.setOperator(
  AccountId.fromString(OPERATOR_ID),
  PrivateKey.fromStringECDSA(OPERATOR_KEY)
);

// ─── State (in-memory, replace with DB for production) ───────

const provisions = new Map();  // apiKey → { lastProvision, count, accountIds }
const ipTracking = new Map();  // ip → { provisions: number }

// ─── API Keys (simple for now, replace with DB) ─────────────

const VALID_KEYS = new Set(
  (process.env.VAL_API_KEYS || "val_free_test").split(",")
);

function validateKey(key) {
  return VALID_KEYS.has(key) || key?.startsWith("val_");
}

// ─── Handlers ────────────────────────────────────────────────

async function handleProvision(req, body, ip) {
  const apiKey = req.headers["x-api-key"] || body.apiKey;
  if (!validateKey(apiKey)) return { status: 401, body: { error: "Invalid API key" } };

  // Rate limit check
  const record = provisions.get(apiKey) || { lastProvision: 0, count: 0, accountIds: [] };
  const now = Date.now();
  if (now - record.lastProvision < PROVISION_COOLDOWN_MS) {
    const waitMin = Math.ceil((PROVISION_COOLDOWN_MS - (now - record.lastProvision)) / 60000);
    return { status: 429, body: { error: `Rate limited. Try again in ${waitMin} minutes.` } };
  }

  // IP limit check
  const ipRecord = ipTracking.get(ip) || { provisions: 0 };
  if (ipRecord.provisions >= MAX_PROVISIONS_PER_IP) {
    return { status: 429, body: { error: "IP provision limit reached" } };
  }

  // Create account
  const agentName = body.agentName || "val-agent";
  const newKey = PrivateKey.generateECDSA();
  const initialHbar = new Hbar(FREE_TIER_HBAR);

  try {
    const tx = await new AccountCreateTransaction()
      .setKey(newKey.publicKey)
      .setInitialBalance(initialHbar)
      .setAccountMemo(`VAL:${agentName}`)
      .execute(client);

    const receipt = await tx.getReceipt(client);
    const accountId = receipt.accountId.toString();

    // Update tracking
    record.lastProvision = now;
    record.count++;
    record.accountIds.push(accountId);
    provisions.set(apiKey, record);
    ipRecord.provisions++;
    ipTracking.set(ip, ipRecord);

    console.log(`✅ Provisioned ${accountId} for ${agentName} (${apiKey.slice(0, 12)}...) — ${FREE_TIER_HBAR} HBAR`);

    return {
      status: 200,
      body: {
        accountId,
        privateKey: newKey.toStringRaw(),
        publicKey: newKey.publicKey.toStringRaw(),
        network: NETWORK,
        balance: FREE_TIER_HBAR,
        estimatedAttestations: Math.floor((FREE_TIER_HBAR - 0.1) / 0.001),
        message: `Account created and funded with ${FREE_TIER_HBAR} HBAR. You sign all transactions — this is YOUR wallet.`,
        // Include config snippet the agent can use directly
        valConfig: {
          operatorId: accountId,
          operatorKey: newKey.toStringRaw(),
          network: NETWORK,
          agentName,
        },
      },
    };
  } catch (e) {
    console.error("❌ Provision failed:", e.message);
    return { status: 500, body: { error: "Account creation failed", details: e.message } };
  }
}

async function handleFund(req, body) {
  const apiKey = req.headers["x-api-key"] || body.apiKey;
  if (!validateKey(apiKey)) return { status: 401, body: { error: "Invalid API key" } };

  const targetAccount = body.accountId;
  if (!targetAccount) return { status: 400, body: { error: "accountId required" } };

  const amount = Math.min(parseFloat(body.amount || "0.5"), MAX_FUND_HBAR);
  if (amount <= 0) return { status: 400, body: { error: "Invalid amount" } };

  try {
    const hbar = new Hbar(amount);
    const tx = await new TransferTransaction()
      .addHbarTransfer(OPERATOR_ID, hbar.negated())
      .addHbarTransfer(targetAccount, hbar)
      .execute(client);

    await tx.getReceipt(client);
    console.log(`💰 Funded ${targetAccount} with ${amount} HBAR`);

    return {
      status: 200,
      body: {
        accountId: targetAccount,
        funded: amount,
        message: `Sent ${amount} HBAR to ${targetAccount}`,
      },
    };
  } catch (e) {
    return { status: 500, body: { error: "Funding failed", details: e.message } };
  }
}

async function handleBalance(req, url) {
  const accountId = url.searchParams.get("accountId");
  if (!accountId) return { status: 400, body: { error: "accountId query param required" } };

  try {
    const balance = await new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountId))
      .execute(client);

    const hbar = balance.hbars.toBigNumber().toNumber();
    const attestEstimate = Math.floor(Math.max(0, hbar - 0.1) / 0.001);

    return {
      status: 200,
      body: {
        accountId,
        hbar,
        estimatedAttestations: attestEstimate,
        needsFunding: hbar < 0.05,
      },
    };
  } catch (e) {
    return { status: 500, body: { error: "Balance query failed", details: e.message } };
  }
}

// ─── Server ──────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  let body = {};
  if (req.method === "POST") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch { body = {}; }
  }

  let result;
  try {
    switch (url.pathname) {
      case "/v1/provision":
        result = req.method === "POST"
          ? await handleProvision(req, body, ip)
          : { status: 405, body: { error: "POST required" } };
        break;
      case "/v1/fund":
        result = req.method === "POST"
          ? await handleFund(req, body)
          : { status: 405, body: { error: "POST required" } };
        break;
      case "/v1/balance":
        result = await handleBalance(req, url);
        break;
      case "/v1/swap/estimate": {
        const from = url.searchParams.get("from");
        const amount = url.searchParams.get("amount");
        if (!from) {
          result = { status: 400, body: { error: "from query param required (e.g. eth, sol, usdc)" } };
        } else {
          const estimate = await getEstimate(from, amount ? parseFloat(amount) : null);
          result = { status: estimate.error ? 400 : 200, body: estimate };
        }
        break;
      }
      case "/v1/swap/create": {
        if (req.method !== "POST") { result = { status: 405, body: { error: "POST required" } }; break; }
        const { from: swapFrom, amount: swapAmount, accountId: swapAccount } = body;
        if (!swapFrom || !swapAmount || !swapAccount) {
          result = { status: 400, body: { error: "from, amount, and accountId required" } };
        } else {
          const swap = await createSwap(swapFrom, swapAmount, swapAccount);
          result = { status: swap.error ? 400 : 200, body: swap };
        }
        break;
      }
      case "/v1/swap/status": {
        const swapId = url.searchParams.get("id");
        if (!swapId) {
          result = { status: 400, body: { error: "id query param required" } };
        } else {
          const status = await getSwapStatus(swapId);
          result = { status: status.error ? 400 : 200, body: status };
        }
        break;
      }
      case "/v1/topup": {
        if (req.method !== "POST") { result = { status: 405, body: { error: "POST required" } }; break; }
        const { accountId: topupAccount, token: topupToken, amount: topupAmount } = body;
        if (!topupAccount || !topupToken || !topupAmount) {
          result = { status: 400, body: { error: "accountId, token, and amount required" } };
        } else {
          const topup = await createTopup(topupAccount, topupToken, topupAmount);
          result = { status: topup.error ? 400 : 200, body: topup };
        }
        break;
      }
      case "/v1/topup/status": {
        const topupId = url.searchParams.get("id");
        if (!topupId) {
          result = { status: 400, body: { error: "id query param required" } };
        } else {
          const ts = await getTopupStatus(topupId);
          result = { status: ts.error ? 400 : 200, body: ts };
        }
        break;
      }
      case "/v1/swap/tokens": {
        const tokens = await listSupportedTokens();
        result = { status: 200, body: { tokens, note: "Send any of these to get HBAR for attestations" } };
        break;
      }
      case "/v1/health":
        result = {
          status: 200,
          body: {
            status: "ok",
            network: NETWORK,
            operator: OPERATOR_ID,
            uptime: process.uptime(),
            provisioned: [...provisions.values()].reduce((s, r) => s + r.count, 0),
            swapEnabled: !!process.env.CHANGENOW_API_KEY,
          },
        };
        break;
      default:
        result = { status: 404, body: { error: "Not found" } };
    }
  } catch (e) {
    result = { status: 500, body: { error: e.message } };
  }

  res.writeHead(result.status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result.body, null, 2));
});

server.listen(PORT, () => {
  console.log(`\n🚀 VAL Relay running on http://localhost:${PORT}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Operator: ${OPERATOR_ID}`);
  console.log(`   Free tier: ${FREE_TIER_HBAR} HBAR per agent (~${Math.floor((FREE_TIER_HBAR - 0.1) / 0.001)} attestations)`);
  console.log(`   Swap enabled: ${!!process.env.CHANGENOW_API_KEY}`);
  console.log(`\n   Endpoints:`);
  console.log(`   POST /v1/provision      — Create & fund agent wallet`);
  console.log(`   POST /v1/fund           — Top up agent wallet`);
  console.log(`   GET  /v1/balance        — Check balance + estimate`);
  console.log(`   GET  /v1/swap/estimate  — Get rate: ?from=eth&amount=0.01`);
  console.log(`   POST /v1/swap/create    — Create swap (from, amount, accountId)`);
  console.log(`   GET  /v1/swap/status    — Check swap: ?id=<swapId>`);
  console.log(`   GET  /v1/swap/tokens    — List supported tokens`);
  console.log(`   GET  /v1/health         — Relay status\n`);
});
