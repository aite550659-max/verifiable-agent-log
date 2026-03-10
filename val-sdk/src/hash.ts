import { createHash } from "crypto";
import { canonicalJson } from "./signing";

/** SHA-256 hash of JSON-serialized data, prefixed with algorithm.
 *  Uses canonical JSON (deep-sorted keys) for reproducible hashing. */
export function sha256(data: unknown): string {
  const json = typeof data === "string" ? data : canonicalJson(data);
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

/** SHA-256 hash of a file's contents */
export function sha256File(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
