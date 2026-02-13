#!/usr/bin/env node
// val-soul.js — Hash identity files and submit a soul.verify attestation
// Usage: node val-soul.js [--network testnet|mainnet]

import { Client, TopicMessageSubmitTransaction, PrivateKey } from "@hashgraph/sdk";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

// --- Argument parsing ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const networkOverride = getArg("network", null);

// --- Load config ---
const configPath = path.join(process.env.HOME, ".val", "config.json");
if (!fs.existsSync(configPath)) {
  console.error("Error: No VAL config found. Run val-init.js first.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const topicId = config.topicId;
const network = networkOverride || config.network || process.env.HEDERA_NETWORK || "testnet";

const accountId = process.env.HEDERA_ACCOUNT_ID;
const privateKey = process.env.HEDERA_PRIVATE_KEY;

if (!accountId || !privateKey) {
  console.error("Error: HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY environment variables are required.");
  process.exit(1);
}

// --- Hash identity files ---
const workspaceDir = process.env.OPENCLAW_WORKSPACE || process.cwd();
const identityFiles = ["SOUL.md", "AGENTS.md", "IDENTITY.md", "USER.md"];

function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

// --- Fetch last soul_hash from mirror node ---
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("Failed to parse mirror response")); }
      });
    }).on("error", reject);
  });
}

async function getLastSoulHash() {
  const mirrorBase = network === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

  try {
    // Fetch latest messages (descending) and look for soul.verify or agent.create
    const resp = await fetchJson(`${mirrorBase}/api/v1/topics/${topicId}/messages?limit=25&order=desc`);
    if (!resp.messages) return null;

    for (const msg of resp.messages) {
      try {
        const content = JSON.parse(Buffer.from(msg.message, "base64").toString("utf-8"));
        if (content.type === "soul.verify" || content.type === "agent.create") {
          return content.data?.soul_hash || null;
        }
      } catch { /* skip */ }
    }
  } catch { /* mirror unreachable */ }
  return null;
}

// --- Main ---
async function main() {
  // Hash all existing identity files
  const files = {};
  const hashParts = [];

  for (const filename of identityFiles) {
    const fp = path.join(workspaceDir, filename);
    const hash = hashFile(fp);
    if (hash) {
      files[filename] = hash;
      hashParts.push(hash);
    }
  }

  if (Object.keys(files).length === 0) {
    console.error("Error: No identity files found (SOUL.md, AGENTS.md, IDENTITY.md, USER.md)");
    process.exit(1);
  }

  // Composite hash: hash of all individual hashes concatenated
  const compositeInput = Object.values(files).sort().join("|");
  const soulHash = "sha256:" + crypto.createHash("sha256").update(compositeInput).digest("hex");

  console.log("Identity file hashes:");
  for (const [file, hash] of Object.entries(files)) {
    console.log(`  ${file}: ${hash.slice(0, 20)}...`);
  }
  console.log(`  Composite: ${soulHash.slice(0, 20)}...`);

  // Compare to last attested hash
  console.log("\nFetching last attested soul hash...");
  const lastHash = await getLastSoulHash();
  const match = lastHash ? (lastHash === soulHash) : true; // first time = match

  if (lastHash) {
    console.log(`  Last attested: ${lastHash.slice(0, 20)}...`);
    console.log(`  Current:       ${soulHash.slice(0, 20)}...`);
    console.log(`  Match: ${match ? "✅ Yes" : "❌ No — identity files changed"}`);
  } else {
    console.log("  No previous soul hash found (first soul.verify)");
  }

  // Submit attestation
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(accountId, PrivateKey.fromStringDer(privateKey));

  const attestation = JSON.stringify({
    val: "1.0",
    type: "soul.verify",
    ts: new Date().toISOString(),
    agent: topicId,
    data: {
      soul_hash: soulHash,
      files,
      match
    }
  });

  if (Buffer.byteLength(attestation, "utf-8") > 1024) {
    // Trim file hashes if too large
    console.warn("Warning: attestation exceeds 1024 bytes, submitting without individual file hashes");
    const trimmed = JSON.stringify({
      val: "1.0",
      type: "soul.verify",
      ts: new Date().toISOString(),
      agent: topicId,
      data: { soul_hash: soulHash, match }
    });
    await new TopicMessageSubmitTransaction({ topicId, message: trimmed }).execute(client);
  } else {
    await new TopicMessageSubmitTransaction({ topicId, message: attestation }).execute(client);
  }

  console.log(`\n✅ Soul verification attested to ${topicId}`);
  client.close();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
