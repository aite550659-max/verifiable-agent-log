export { VAL, InsufficientBalanceError, SwapInProgressError, ApprovalNeededError } from "./val";
export { ensureFunded } from "./autofund";
export type { WalletBalance, FundingResult } from "./autofund";
export { VALReader } from "./reader";
export { PolicyEngine } from "./policy";
export { generateKeypair, createAccount, fundAccount, getBalance, estimateAttestations } from "./wallet";
export { loadWallet, saveWallet, provisionViaRelay, checkBalanceViaRelay } from "./provision";
export { signAttestation, verifyAttestation, canonicalJson, deepCanonicalize } from "./signing";
export {
  isHederaDID,
  extractTopicFromDID,
  extractNetworkFromDID,
  constructDID,
  resolveToTopicId,
  generateDIDDocument,
  generateERC8004Registration,
  generateA2ACard,
  createBridgedPayload,
  encodePublicKeyMultibase,
  base58btcEncode,
} from "./identity";
export { sha256, sha256File } from "./hash";
export type { WalletInfo } from "./wallet";
export type { StoredWallet } from "./provision";
export type { DIDDocument, ERC8004RegistrationFile, A2AAgentCard } from "./identity";
export type {
  VALConfig,
  VALVersion,
  Attestation,
  AttestationV1,
  ActionData,
  AgentCreateData,
  SoulVerifyData,
  HeartbeatData,
  AttestOptions,
  EnforcementLevel,
  RentalConstraints,
  TEEAttestation,
  RuntimeAttestationPayload,
  AgentBridgedPayload,
  ATPMessage,
} from "./types";
export type {
  PolicyLevel,
  PrivacyLevel,
  AttestPolicy,
  PolicyFilter,
  ActionCategory,
} from "./policy";
