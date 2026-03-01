/**
 * Integration test — runs against Hedera testnet.
 * Requires HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY env vars.
 *
 * Run: node test/integration.test.mjs
 */

import { VAL, VALReader } from "../dist/index.mjs";

const OPERATOR_ID = process.env.HEDERA_OPERATOR_ID;
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY;

if (!OPERATOR_ID || !OPERATOR_KEY) {
  console.log("⏭  Skipping integration test — set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY");
  process.exit(0);
}

async function run() {
  console.log("🧪 VAL SDK Integration Test (testnet)\n");

  // 1. Create VAL instance
  const val = new VAL({
    operatorId: OPERATOR_ID,
    operatorKey: OPERATOR_KEY,
    network: "testnet",
    agentName: "val-test-agent",
  });

  // 2. Initialize (creates topic + agent.create message)
  console.log("  → Initializing (creating HCS topic)...");
  const topicId = await val.init({
    name: "val-test-agent",
    soul_hash: "sha256:test1234567890abcdef",
    capabilities: ["test", "attest"],
    framework: "val-sdk/0.1.0-test",
  });
  console.log(`  ✅ Topic created: ${topicId}`);
  console.log(`     View: https://hashscan.io/testnet/topic/${topicId}\n`);

  // 3. Attest some actions
  console.log("  → Attesting actions...");

  const r1 = await val.attest({ tool: "web_search", desc: "Searched for HBAR price" });
  console.log(`  ✅ Action 1: seq ${r1.sequenceNumber}`);

  const r2 = await val.attest({
    tool: "swap",
    desc: "Swapped 50 HBAR for USDC",
    status: "success",
    input: { from: "HBAR", to: "USDC", amount: 50 },
    output: { txId: "0.0.12345@1234567890.000" },
  });
  console.log(`  ✅ Action 2: seq ${r2.sequenceNumber}`);

  const r3 = await val.attest({
    tool: "send_email",
    desc: "Sent quarterly report",
    status: "success",
  });
  console.log(`  ✅ Action 3: seq ${r3.sequenceNumber}\n`);

  // 4. Heartbeat
  console.log("  → Posting heartbeat...");
  const hb = await val.heartbeat({ uptime_h: 1, actions_since_last: 3 });
  console.log(`  ✅ Heartbeat: seq ${hb.sequenceNumber}\n`);

  // 5. Soul verify
  console.log("  → Posting soul verify...");
  const sv = await val.verifySoul({
    soul_hash: "sha256:test1234567890abcdef",
    changed: false,
  });
  console.log(`  ✅ Soul verify: seq ${sv.sequenceNumber}\n`);

  val.close();

  // 6. Read back and verify (wait for mirror node propagation)
  console.log("  → Waiting 8s for mirror node propagation...");
  await new Promise((r) => setTimeout(r, 8000));

  console.log("  → Reading log from mirror node...");
  const reader = new VALReader(topicId, "testnet");
  const log = await reader.fetch();
  console.log(`  ✅ Fetched ${log.length} messages`);

  // Verify chain
  const chain = reader.verifyChain(log);
  console.log(`  ✅ Chain valid: ${chain.valid}`);
  if (!chain.valid) {
    console.log(`  ❌ Chain broken at ${chain.brokenAt}: ${chain.reason}`);
  }

  // Summary
  const summary = await reader.summary();
  console.log(`\n  📊 Summary:`);
  console.log(`     Agent: ${summary.agentName}`);
  console.log(`     Messages: ${summary.totalMessages}`);
  console.log(`     Actions: ${summary.actionCount}`);
  console.log(`     Chain valid: ${summary.chainValid}`);
  console.log(`     Created: ${summary.created}`);
  console.log(`     Last activity: ${summary.lastActivity}`);

  // Assertions
  const pass = (label, cond) => console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  console.log("\n  📋 Assertions:");
  pass("Topic created", topicId.startsWith("0.0."));
  pass("6 messages total (create + 3 actions + heartbeat + soul)", log.length === 6);
  pass("First message is agent.create", log[0]?.type === "agent.create");
  pass("Actions are type=action", log[1]?.type === "action" && log[2]?.type === "action");
  pass("Chain integrity", chain.valid);
  pass("Agent name matches", summary.agentName === "val-test-agent");

  console.log("\n🏁 Done.\n");
}

run().catch((e) => {
  console.error("❌ Test failed:", e);
  process.exit(1);
});
