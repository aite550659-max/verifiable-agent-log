import { PrivateKey, PublicKey } from "@hashgraph/sdk";

/**
 * Deep-sort all object keys recursively for canonical JSON.
 */
export function deepCanonicalize(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(deepCanonicalize);
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = deepCanonicalize((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/**
 * Produce canonical JSON: deep-sorted keys, no whitespace.
 */
export function canonicalJson(obj: unknown): string {
  return JSON.stringify(deepCanonicalize(obj));
}

/**
 * Detect key type from a PrivateKey instance.
 * Throws on unrecognized key format rather than silently mislabeling.
 */
function keyAlgorithm(key: PrivateKey): "ed25519" | "ecdsa-secp256k1" {
  const der = key.toStringDer();
  // ED25519 DER prefix: 302e020100300506032b657004220420
  if (der.startsWith("302e")) return "ed25519";
  // ECDSA secp256k1 DER prefixes
  if (der.startsWith("3030") || der.startsWith("3074")) return "ecdsa-secp256k1";
  throw new Error(`Unrecognized key DER format: ${der.slice(0, 8)}... — cannot determine signing algorithm`);
}

/**
 * Sign an attestation object (excluding any existing `sig` field).
 * Returns signature string in format: `<algorithm>:<base64_signature>`
 */
export function signAttestation(
  attestation: Record<string, unknown>,
  privateKey: PrivateKey
): string {
  // Remove sig field if present
  const { sig: _, ...rest } = attestation;
  const canonical = canonicalJson(rest);
  const bytes = Buffer.from(canonical, "utf8");
  const signature = privateKey.sign(bytes);
  const algo = keyAlgorithm(privateKey);
  return `${algo}:${Buffer.from(signature).toString("base64")}`;
}

/**
 * Verify a signed attestation.
 * Returns true if signature is valid.
 */
export function verifyAttestation(
  attestation: Record<string, unknown>,
  publicKey: PublicKey
): boolean {
  const sig = attestation.sig as string;
  if (!sig) return false;

  const colonIdx = sig.indexOf(":");
  if (colonIdx < 1) return false;

  const algo = sig.slice(0, colonIdx);
  if (!["ed25519", "ecdsa-secp256k1"].includes(algo)) return false;

  const sigBytes = Buffer.from(sig.slice(colonIdx + 1), "base64");
  const { sig: _, ...rest } = attestation;
  const canonical = canonicalJson(rest);
  const bytes = Buffer.from(canonical, "utf8");

  try {
    return publicKey.verify(bytes, sigBytes);
  } catch {
    return false;
  }
}
