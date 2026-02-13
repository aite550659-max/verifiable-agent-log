#!/usr/bin/env node
// val-init.js — Create a new HCS topic for the agent and submit agent.create attestation
// Usage: node val-init.js --name "AgentName" --network testnet

import { Client, TopicCreateTransaction, TopicMessageSubmitTransaction, PrivateKey } from "@hashgraph/sdk";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// --- Argument parsing ---
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const agentName = getArg("name", null);
const network = getArg("network", process.env.HEDERA_NETWORK || "testnet");
const capabilities = getArg("capabilities", "web_search,file_ops,message").split(",").map(s => s.trim());
const framework = getArg("framework", "openclaw/1.0");

if (!agentName) {
  console.error("Usage: node val-init.js --name \"AgentName\" [--network testnet|mainnet] [--capabilities tool1,tool2] [--framework name/ver]");
  process.exit(1);
}

const accountId = process.env.HEDERA_ACCOUNT_ID;
const privateKey = process.env.HEDERA_PRIVATE_KEY;

if (!accountId || !privateKey) {
  console.error("Error: HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY environment variables are required.");
  process.exit(1);
}

// --- Config directory ---
const configDir = path.join(process.env.HOME, ".val");
const configPath = path.join(configDir, "config.json");

// --- Hash SOUL.md if it exists ---
function hashFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

// Try common workspace locations for SOUL.md
const workspaceDir = process.env.OPENCLAW_WORKSPACE || path.resolve(process.cwd());
const soulHash = hashFile(path.join(workspaceDir, "SOUL.md")) || "sha256:none";

// --- Main ---
async function main() {
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const key = PrivateKey.fromStringDer(privateKey);
  client.setOperator(accountId, key);

  console.log(`Creating VAL topic on ${network}...`);

  // Create topic with agent's public key as submit key
  const txResponse = await new TopicCreateTransaction()
    .setSubmitKey(key.publicKey)
    .setTopicMemo(`VAL:${agentName}`)
    .execute(client);

  const receipt = await txResponse.getReceipt(client);
  const topicId = receipt.topicId.toString();

  console.log(`Topic created: ${topicId}`);

  // Build agent.create attestation
  const attestation = JSON.stringify({
    val: "1.0",
    type: "agent.create",
    ts: new Date().toISOString(),
    agent: topicId,
    data: {
      name: agentName,
      soul_hash: soulHash,
      capabilities,
      creator: accountId,
      framework
    }
  });

  // Check size
  if (Buffer.byteLength(attestation, "utf-8") > 1024) {
    console.error("Warning: attestation exceeds 1024 bytes. Trimming capabilities.");
  }

  console.log("Submitting agent.create attestation...");
  await new TopicMessageSubmitTransaction({ topicId, message: attestation }).execute(client);

  // Save config
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

  const config = {
    topicId,
    network,
    agentName,
    accountId,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`Config saved to ${configPath}`);
  console.log(`\n✅ VAL initialized for "${agentName}" on ${network}`);
  console.log(`   Topic ID: ${topicId}`);
  console.log(`   Soul hash: ${soulHash}`);

  client.close();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
