import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export interface StoredWallet {
  accountId: string;
  privateKey: string;
  publicKey: string;
  network: string;
  topicId?: string;
  agentName?: string;
  provisionedAt?: string;
}

const DEFAULT_WALLET_PATH = join(homedir(), ".val", "wallet.json");

/** Load stored wallet from disk */
export function loadWallet(path?: string): StoredWallet | null {
  const p = path || DEFAULT_WALLET_PATH;
  try {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf8"));
    }
  } catch {}
  return null;
}

/** Save wallet to disk */
export function saveWallet(wallet: StoredWallet, path?: string): void {
  const p = path || DEFAULT_WALLET_PATH;
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(wallet, null, 2), { mode: 0o600 });
}

/** Provision a new wallet via the VAL relay */
export async function provisionViaRelay(
  relayUrl: string,
  apiKey: string,
  agentName: string
): Promise<StoredWallet> {
  const res = await fetch(`${relayUrl}/v1/provision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({ agentName }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Relay provision failed (${res.status}): ${(err as any).error}`);
  }

  const data = (await res.json()) as {
    accountId: string;
    privateKey: string;
    publicKey: string;
    network: string;
  };

  return {
    accountId: data.accountId,
    privateKey: data.privateKey,
    publicKey: data.publicKey,
    network: data.network,
    agentName,
    provisionedAt: new Date().toISOString(),
  };
}

/** Check balance via relay (no SDK needed) */
export async function checkBalanceViaRelay(
  relayUrl: string,
  accountId: string
): Promise<{ hbar: number; estimatedAttestations: number; needsFunding: boolean }> {
  const res = await fetch(`${relayUrl}/v1/balance?accountId=${accountId}`);
  if (!res.ok) throw new Error(`Balance check failed: ${res.status}`);
  return res.json() as any;
}
