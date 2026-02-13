#!/usr/bin/env node
// val-verify.js — Read and verify an agent's VAL attestation log
// Usage: node val-verify.js --topic 0.0.12345 --network testnet

import https from "https";
import http from "http";

// --- Argument parsing ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const topicId = getArg("topic", null);
const network = getArg("network", process.env.HEDERA_NETWORK || "testnet");

if (!topicId) {
  console.error("Usage: node val-verify.js --topic 0.0.12345 [--network testnet|mainnet]");
  process.exit(1);
}

const mirrorBase = network === "mainnet"
  ? "https://mainnet.mirrornode.hedera.com"
  : "https://testnet.mirrornode.hedera.com";

// --- Fetch helper ---
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse response from ${url}`)); }
      });
    }).on("error", reject);
  });
}

// --- Fetch all messages with pagination ---
async function fetchAllMessages(topicId) {
  const messages = [];
  let url = `${mirrorBase}/api/v1/topics/${topicId}/messages?limit=100&order=asc`;

  while (url) {
    const resp = await fetchJson(url);
    if (!resp.messages || resp.messages.length === 0) break;

    for (const msg of resp.messages) {
      try {
        const content = JSON.parse(Buffer.from(msg.message, "base64").toString("utf-8"));
        messages.push({
          seq: msg.sequence_number,
          consensusTs: msg.consensus_timestamp,
          ...content
        });
      } catch {
        messages.push({
          seq: msg.sequence_number,
          consensusTs: msg.consensus_timestamp,
          _parseError: true
        });
      }
    }

    // Pagination
    if (resp.links && resp.links.next) {
      url = `${mirrorBase}${resp.links.next}`;
    } else {
      url = null;
    }
  }

  return messages;
}

// --- Verification ---
function verify(messages) {
  const issues = [];

  if (messages.length === 0) {
    issues.push("FAIL: No messages found on topic");
    return issues;
  }

  // Check first message is agent.create
  if (messages[0].type !== "agent.create") {
    issues.push(`FAIL: First message is "${messages[0].type}", expected "agent.create"`);
  }

  // Check sequence continuity
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].seq !== messages[i - 1].seq + 1) {
      issues.push(`FAIL: Sequence gap between ${messages[i - 1].seq} and ${messages[i].seq}`);
    }
  }

  // Check timestamp ordering
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].consensusTs < messages[i - 1].consensusTs) {
      issues.push(`FAIL: Timestamp ordering violated at seq ${messages[i].seq}`);
    }
  }

  // Check for parse errors
  const parseErrors = messages.filter(m => m._parseError);
  if (parseErrors.length > 0) {
    issues.push(`WARN: ${parseErrors.length} message(s) could not be parsed as JSON`);
  }

  // Check soul hash consistency
  const soulVerifies = messages.filter(m => m.type === "soul.verify");
  for (let i = 1; i < soulVerifies.length; i++) {
    if (soulVerifies[i].data?.match === false) {
      issues.push(`INFO: Soul hash changed at seq ${soulVerifies[i].seq} (identity modified)`);
    }
  }

  return issues;
}

// --- Display ---
function displaySummary(messages, issues) {
  const agentCreate = messages.find(m => m.type === "agent.create");

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║         VAL — Verifiable Agent Log Audit        ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (agentCreate) {
    console.log(`  Agent: ${agentCreate.data?.name || "Unknown"}`);
    console.log(`  Topic: ${topicId}`);
    console.log(`  Network: ${network}`);
    console.log(`  Created: ${agentCreate.ts}`);
    console.log(`  Framework: ${agentCreate.data?.framework || "Unknown"}`);
    console.log(`  Soul Hash: ${agentCreate.data?.soul_hash || "None"}`);
    console.log();
  }

  // Type summary
  const typeCounts = {};
  for (const m of messages) {
    const t = m.type || "unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  console.log("  Attestation Summary:");
  console.log("  ─────────────────────────────────");
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${type.padEnd(20)} ${String(count).padStart(6)}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)} ${String(messages.length).padStart(6)}`);
  console.log();

  // Recent attestations (last 10)
  const recent = messages.slice(-10);
  console.log("  Recent Attestations (last 10):");
  console.log("  ─────────────────────────────────────────────────────────────────");
  console.log("  Seq   Type            Tool/Info                Status    Timestamp");
  console.log("  ─────────────────────────────────────────────────────────────────");
  for (const m of recent) {
    const seq = String(m.seq).padEnd(6);
    const type = (m.type || "?").padEnd(16);
    const info = (m.data?.tool || m.data?.name || m.data?.status || "").padEnd(25).slice(0, 25);
    const status = (m.data?.status || "").padEnd(10);
    const ts = (m.ts || "").slice(0, 19);
    console.log(`  ${seq}${type}${info}${status}${ts}`);
  }
  console.log();

  // Verification results
  if (issues.length === 0) {
    console.log("  ✅ Verification: PASSED — Log integrity intact");
  } else {
    console.log("  ⚠️  Verification Issues:");
    for (const issue of issues) {
      console.log(`     ${issue}`);
    }
  }
  console.log();
}

// --- Main ---
async function main() {
  console.log(`Fetching attestations for topic ${topicId} on ${network}...`);

  const messages = await fetchAllMessages(topicId);
  const issues = verify(messages);
  displaySummary(messages, issues);
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
