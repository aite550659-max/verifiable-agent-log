#!/usr/bin/env node
// val-attest.js — Submit an action attestation to the agent's VAL topic
// Usage: node val-attest.js --tool "web_search" --desc "Searched for HBAR price" --status success

import { Client, TopicMessageSubmitTransaction, PrivateKey } from "@hashgraph/sdk";
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

const tool = getArg("tool", null);
const desc = getArg("desc", null);
const status = getArg("status", "success");
const inputJson = getArg("input", null);
const outputJson = getArg("output", null);
const networkOverride = getArg("network", null);

if (!tool || !desc) {
  console.error('Usage: node val-attest.js --tool "tool_name" --desc "description" [--status success|failure|error] [--input \'{"key":"val"}\'] [--output \'{"key":"val"}\']');
  process.exit(1);
}

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

// --- Hash helper ---
function sha256Hash(data) {
  return "sha256:" + crypto.createHash("sha256").update(data).digest("hex");
}

// --- Main ---
async function main() {
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(accountId, PrivateKey.fromStringDer(privateKey));

  const data = { tool, status, desc };

  if (inputJson) {
    try {
      JSON.parse(inputJson); // validate
      data.input_hash = sha256Hash(inputJson);
    } catch {
      console.error("Warning: --input is not valid JSON, hashing raw string");
      data.input_hash = sha256Hash(inputJson);
    }
  }

  if (outputJson) {
    try {
      JSON.parse(outputJson); // validate
      data.output_hash = sha256Hash(outputJson);
    } catch {
      console.error("Warning: --output is not valid JSON, hashing raw string");
      data.output_hash = sha256Hash(outputJson);
    }
  }

  const attestation = JSON.stringify({
    val: "1.0",
    type: "action",
    ts: new Date().toISOString(),
    agent: topicId,
    data
  });

  if (Buffer.byteLength(attestation, "utf-8") > 1024) {
    console.error("Warning: attestation exceeds HCS 1024-byte limit. Consider shorter desc.");
  }

  console.log(`Attesting: ${tool} → ${status}`);
  await new TopicMessageSubmitTransaction({ topicId, message: attestation }).execute(client);

  console.log(`✅ Action attested to ${topicId}`);
  console.log(`   Tool: ${tool}`);
  console.log(`   Status: ${status}`);
  console.log(`   Desc: ${desc}`);

  client.close();
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
