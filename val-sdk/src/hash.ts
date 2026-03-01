import { createHash } from "crypto";

/** SHA-256 hash of JSON-serialized data, prefixed with algorithm */
export function sha256(data: unknown): string {
  const json =
    typeof data === "string" ? data : JSON.stringify(data, Object.keys(data as object).sort());
  return `sha256:${createHash("sha256").update(json).digest("hex")}`;
}

/** SHA-256 hash of a file's contents */
export function sha256File(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
