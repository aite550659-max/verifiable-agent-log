import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PrivateKey } from "@hashgraph/sdk";

// We test via compiled output
import {
  signAttestation, verifyAttestation, canonicalJson, deepCanonicalize,
  isHederaDID, extractTopicFromDID, extractNetworkFromDID,
  constructDID, resolveToTopicId, generateDIDDocument,
  generateERC8004Registration, generateA2ACard, createBridgedPayload,
} from "../dist/index.mjs";

describe("Canonical JSON", () => {
  test("sorts keys alphabetically", () => {
    const result = canonicalJson({ z: 1, a: 2, m: 3 });
    assert.equal(result, '{"a":2,"m":3,"z":1}');
  });

  test("deep sorts nested objects", () => {
    const result = canonicalJson({ b: { z: 1, a: 2 }, a: 1 });
    assert.equal(result, '{"a":1,"b":{"a":2,"z":1}}');
  });

  test("preserves arrays in order", () => {
    const result = canonicalJson({ a: [3, 1, 2] });
    assert.equal(result, '{"a":[3,1,2]}');
  });

  test("handles null and primitives", () => {
    const result = canonicalJson({ b: null, a: true, c: "hello" });
    assert.equal(result, '{"a":true,"b":null,"c":"hello"}');
  });
});

describe("Signing and Verification", () => {
  const key = PrivateKey.generateED25519();
  const pubKey = key.publicKey;

  test("signs and verifies an attestation", () => {
    const attestation = {
      val: "1.1",
      type: "action",
      ts: "2026-03-10T14:00:00Z",
      agent: "0.0.12345",
      data: { tool: "web_search", status: "success" },
    };

    const sig = signAttestation(attestation, key);
    assert.ok(sig.startsWith("ed25519:"), `Expected ed25519 prefix, got: ${sig.slice(0, 20)}`);

    const signed = { ...attestation, sig };
    assert.ok(verifyAttestation(signed, pubKey));
  });

  test("rejects tampered attestation", () => {
    const attestation = {
      val: "1.1",
      type: "action",
      ts: "2026-03-10T14:00:00Z",
      agent: "0.0.12345",
      data: { tool: "web_search", status: "success" },
    };

    const sig = signAttestation(attestation, key);
    const tampered = { ...attestation, sig, data: { tool: "TAMPERED", status: "success" } };
    assert.ok(!verifyAttestation(tampered, pubKey));
  });

  test("rejects wrong key", () => {
    const otherKey = PrivateKey.generateED25519();
    const attestation = {
      val: "1.1",
      type: "action",
      ts: "2026-03-10T14:00:00Z",
      agent: "0.0.12345",
      data: { tool: "test", status: "success" },
    };

    const sig = signAttestation(attestation, key);
    const signed = { ...attestation, sig };
    assert.ok(!verifyAttestation(signed, otherKey.publicKey));
  });

  test("returns false for missing sig", () => {
    assert.ok(!verifyAttestation({ val: "1.1", type: "action" }, pubKey));
  });
});

describe("DID Utilities", () => {
  test("isHederaDID", () => {
    assert.ok(isHederaDID("did:hedera:mainnet:z7ASgb_0.0.12345"));
    assert.ok(!isHederaDID("0.0.12345"));
    assert.ok(!isHederaDID("did:web:example.com"));
  });

  test("extractTopicFromDID", () => {
    assert.equal(extractTopicFromDID("did:hedera:mainnet:z7ASgb_0.0.12345"), "0.0.12345");
    assert.equal(extractTopicFromDID("0.0.12345"), null);
  });

  test("extractNetworkFromDID", () => {
    assert.equal(extractNetworkFromDID("did:hedera:mainnet:z7ASgb_0.0.12345"), "mainnet");
    assert.equal(extractNetworkFromDID("did:hedera:testnet:z7ASgb_0.0.12345"), "testnet");
  });

  test("constructDID", () => {
    const did = constructDID("mainnet", "z7ASgb", "0.0.12345");
    assert.equal(did, "did:hedera:mainnet:z7ASgb_0.0.12345");
  });

  test("resolveToTopicId with topic ID", () => {
    assert.equal(resolveToTopicId("0.0.12345"), "0.0.12345");
  });

  test("resolveToTopicId with DID", () => {
    assert.equal(resolveToTopicId("did:hedera:mainnet:z7ASgb_0.0.12345"), "0.0.12345");
  });
});

describe("DID Document Generation", () => {
  test("generates valid DID Document", () => {
    const doc = generateDIDDocument({
      did: "did:hedera:mainnet:z7ASgb_0.0.12345",
      publicKeyMultibase: "z7ASgb",
      hederaAccountId: "0.0.11111",
      hcsTopicId: "0.0.12345",
      network: "mainnet",
      registrationUri: "https://example.com/.well-known/agent.json",
      a2aEndpoint: "https://example.com/a2a",
    });

    assert.equal(doc.id, "did:hedera:mainnet:z7ASgb_0.0.12345");
    assert.equal(doc.verificationMethod.length, 1);
    assert.equal(doc.service.length, 3); // val-log + registration + a2a
    assert.equal(doc.hederaAccountId, "0.0.11111");
    assert.equal(doc.hcsTopicId, "0.0.12345");
  });
});

describe("ERC-8004 Registration", () => {
  test("generates valid registration file", () => {
    const reg = generateERC8004Registration({
      agentId: "0.0.12345",
      name: "TestAgent",
      did: "did:hedera:mainnet:z7ASgb_0.0.12345",
      capabilities: ["web_search", "email"],
      hcsTopicId: "0.0.12345",
      soulHash: "sha256:abc123",
      framework: "val-sdk/1.1.0",
      a2aEndpoint: "https://example.com/a2a",
    });

    assert.equal(reg.schemaVersion, "1.0");
    assert.equal(reg.name, "TestAgent");
    assert.equal(reg.did, "did:hedera:mainnet:z7ASgb_0.0.12345");
    assert.ok(reg.extensions?.val);
    assert.equal(reg.extensions?.val?.hcs_topic, "0.0.12345");
    assert.equal(reg.protocols?.length, 2); // a2a + val
  });
});

describe("A2A Agent Card", () => {
  test("generates valid agent card", () => {
    const card = generateA2ACard({
      name: "TestAgent",
      description: "A test agent",
      did: "did:hedera:mainnet:z7ASgb_0.0.12345",
      hcsTopicId: "0.0.12345",
      skills: [{ id: "search", name: "Web Search" }],
    });

    assert.equal(card.name, "TestAgent");
    assert.equal(card.authentication?.type, "did");
    assert.equal(card.capabilities?.skills?.length, 1);
    assert.ok(card.protocols?.some(p => p.name === "val"));
  });
});

describe("Bridge Payload", () => {
  test("creates valid agent_bridged payload", () => {
    const payload = createBridgedPayload({
      sourceChain: "ethereum",
      sourceIdentity: "0x1234abcd",
      sourceStandard: "ERC-8004",
      hederaDid: "did:hedera:mainnet:z7ASgb_0.0.12345",
      hederaHcsTopic: "0.0.12345",
      bridgedBy: "0.0.11111",
    });

    assert.equal(payload.source_chain, "ethereum");
    assert.equal(payload.source_identity, "0x1234abcd");
    assert.equal(payload.source_standard, "ERC-8004");
    assert.equal(payload.hedera_did, "did:hedera:mainnet:z7ASgb_0.0.12345");
    assert.equal(payload.bridged_by, "0.0.11111");
  });
});
