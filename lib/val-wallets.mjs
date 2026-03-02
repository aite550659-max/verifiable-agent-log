/**
 * VAL Multi-Chain Wallet Generator
 *
 * Generates a single BIP-39 mnemonic and derives wallets for:
 * - All EVM chains (ETH, Base, Optimism, Arbitrum, BSC, Polygon, Avalanche)
 * - Solana
 *
 * Stores mnemonic in macOS Keychain. Wallet addresses saved to file.
 */

import { mnemonicToAccount, generateMnemonic } from "viem/accounts";
import { english } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import { derivePath } from "ed25519-hd-key";
import * as bip39 from "bip39";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const WALLET_DIR = path.join(process.env.HOME, ".val", "wallets");
const WALLET_FILE = path.join(WALLET_DIR, "multi-chain.json");
const KEYCHAIN_SERVICE = "val-wallet-mnemonic";

// EVM chains we care about (all use same address from same key)
const EVM_CHAINS = [
  { name: "Ethereum", chainId: 1, symbol: "ETH" },
  { name: "Base", chainId: 8453, symbol: "ETH" },
  { name: "Optimism", chainId: 10, symbol: "ETH" },
  { name: "Arbitrum", chainId: 42161, symbol: "ETH" },
  { name: "BSC", chainId: 56, symbol: "BNB" },
  { name: "Polygon", chainId: 137, symbol: "MATIC" },
  { name: "Avalanche C-Chain", chainId: 43114, symbol: "AVAX" },
  { name: "Hedera (EVM)", chainId: 295, symbol: "HBAR" },
];

function storeInKeychain(mnemonic) {
  // Delete existing if any
  try {
    execSync(
      `security delete-generic-password -s "${KEYCHAIN_SERVICE}" 2>/dev/null`,
      { stdio: "ignore" }
    );
  } catch {}
  execSync(
    `security add-generic-password -s "${KEYCHAIN_SERVICE}" -a "val-agent" -w "${mnemonic}" -U`,
    { stdio: "pipe" }
  );
}

function loadFromKeychain() {
  try {
    return execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`,
      { encoding: "utf8" }
    ).trim();
  } catch {
    return null;
  }
}

async function generateWallets() {
  console.log("🔑 Generating new BIP-39 mnemonic...\n");

  // Generate mnemonic
  const mnemonic = generateMnemonic(english);

  // Store in macOS Keychain
  storeInKeychain(mnemonic);
  console.log("✅ Mnemonic stored in macOS Keychain (service: val-wallet-mnemonic)\n");

  // Derive EVM wallet (same address for all EVM chains)
  const evmAccount = mnemonicToAccount(mnemonic);
  console.log(`🔷 EVM Address: ${evmAccount.address}`);
  console.log(`   Works on: ${EVM_CHAINS.map((c) => c.name).join(", ")}\n`);

  // Derive Solana wallet
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex"));
  const solKeypair = Keypair.fromSeed(Uint8Array.from(derivedSeed.key));
  const solAddress = solKeypair.publicKey.toBase58();
  console.log(`🟣 Solana Address: ${solAddress}\n`);

  // Build wallet record
  const wallets = {
    generated: new Date().toISOString(),
    keychainService: KEYCHAIN_SERVICE,
    evm: {
      address: evmAccount.address,
      derivationPath: "m/44'/60'/0'/0/0",
      chains: EVM_CHAINS,
    },
    solana: {
      address: solAddress,
      derivationPath: "m/44'/501'/0'/0'",
    },
  };

  // Save wallet file (addresses only, no keys)
  mkdirSync(WALLET_DIR, { recursive: true });
  writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2), { mode: 0o600 });
  console.log(`📁 Wallet addresses saved to ${WALLET_FILE}`);
  console.log("   (No private keys in file — mnemonic is in Keychain only)\n");

  return wallets;
}

async function loadWallets() {
  if (!existsSync(WALLET_FILE)) {
    return null;
  }
  return JSON.parse(readFileSync(WALLET_FILE, "utf8"));
}

// CLI
const cmd = process.argv[2];

if (cmd === "generate") {
  const wallets = await generateWallets();
  console.log("📋 Summary:");
  console.log(JSON.stringify(wallets, null, 2));
} else if (cmd === "show") {
  const wallets = await loadWallets();
  if (!wallets) {
    console.log("No wallets found. Run: node lib/val-wallets.mjs generate");
  } else {
    console.log(JSON.stringify(wallets, null, 2));
  }
} else if (cmd === "verify") {
  const mnemonic = loadFromKeychain();
  if (!mnemonic) {
    console.log("❌ No mnemonic in Keychain");
    process.exit(1);
  }
  const evmAccount = mnemonicToAccount(mnemonic);
  const wallets = await loadWallets();
  if (wallets && wallets.evm.address === evmAccount.address) {
    console.log("✅ Keychain mnemonic matches wallet file");
    console.log(`   EVM: ${evmAccount.address}`);
  } else {
    console.log("❌ Mismatch between Keychain and wallet file");
    process.exit(1);
  }
} else {
  console.log("Usage: node lib/val-wallets.mjs <generate|show|verify>");
}
