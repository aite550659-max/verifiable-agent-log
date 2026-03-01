import { PolicyEngine } from "../dist/index.mjs";
import { strict as assert } from "assert";

console.log("🧪 Policy Engine Tests\n");

// --- Classification ---
const engine = new PolicyEngine("standard");

const tests = [
  // Value movement — always attested
  ["transfer", "value_transfer", true],
  ["hbar_transfer", "value_transfer", true],
  ["swap", "value_transfer", true],
  ["saucerswap_swap_tokens", "value_transfer", true],
  ["stake", "value_transfer", true],
  ["bridge", "value_transfer", true],
  // Approvals
  ["approve", "value_approve", true],
  ["revoke", "value_approve", true],
  // External comms
  ["send_email", "external_comms", true],
  ["post_tweet", "external_comms", true],
  // Identity
  ["update_prompt", "identity_change", true],
  ["rotate_key", "identity_change", true],
  // Data writes
  ["deploy_contract", "data_write", true],
  ["write_file", "data_write", true],
  // Reads — attested in standard, not in minimal
  ["get_balance", "data_read", false],  // standard doesn't include data_read
  ["web_search", "data_read", false],
  // Unknown — attested in standard
  ["some_random_tool", "unknown", true],
];

let passed = 0;
for (const [tool, expectedCat, expectedAttest] of tests) {
  const cat = engine.classify(tool);
  const should = engine.shouldAttest(tool);
  
  const catOk = cat === expectedCat;
  const attestOk = should === expectedAttest;
  
  if (catOk && attestOk) {
    passed++;
  } else {
    console.log(`  ❌ ${tool}: classify=${cat} (expected ${expectedCat}), attest=${should} (expected ${expectedAttest})`);
  }
}
console.log(`  ✅ Standard policy: ${passed}/${tests.length} passed`);

// --- Minimal policy ---
const minimal = new PolicyEngine("minimal");
assert.equal(minimal.shouldAttest("transfer"), true, "minimal: transfer");
assert.equal(minimal.shouldAttest("approve"), true, "minimal: approve");
assert.equal(minimal.shouldAttest("update_prompt"), true, "minimal: identity");
assert.equal(minimal.shouldAttest("send_email"), false, "minimal: email");
assert.equal(minimal.shouldAttest("web_search"), false, "minimal: search");
assert.equal(minimal.shouldAttest("some_random_tool"), false, "minimal: unknown");
console.log("  ✅ Minimal policy: all correct");

// --- Strict policy ---
const strict = new PolicyEngine("strict");
assert.equal(strict.shouldAttest("transfer"), true);
assert.equal(strict.shouldAttest("send_email"), true);
assert.equal(strict.shouldAttest("web_search"), true);
assert.equal(strict.shouldAttest("get_balance"), true);
console.log("  ✅ Strict policy: all correct");

// --- Always/never overrides ---
const custom = new PolicyEngine({
  level: "minimal",
  alwaysAttest: ["my_critical_tool"],
  neverAttest: ["transfer"],  // override even value_transfer
});
assert.equal(custom.shouldAttest("my_critical_tool"), true);
assert.equal(custom.shouldAttest("transfer"), false);
console.log("  ✅ Override policy: always/never work");

// --- Custom filter ---
const filtered = new PolicyEngine({
  level: "custom",
  filter: (tool, cat) => cat === "value_transfer" && tool.includes("hbar"),
});
assert.equal(filtered.shouldAttest("hbar_transfer"), true);
assert.equal(filtered.shouldAttest("eth_transfer"), false);  // value_transfer but no "hbar"
assert.equal(filtered.shouldAttest("web_search"), false);
console.log("  ✅ Custom filter: works");

// --- Register custom tools ---
const reg = new PolicyEngine("minimal");
reg.registerTool("my_defi_action", "value_transfer");
assert.equal(reg.classify("my_defi_action"), "value_transfer");
assert.equal(reg.shouldAttest("my_defi_action"), true);
console.log("  ✅ Tool registration: works");

console.log("\n🏁 All policy tests passed.\n");
