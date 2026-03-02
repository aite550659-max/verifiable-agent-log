/**
 * Attestation Policy — defines what "significant" means and what's visible.
 *
 * Two dimensions:
 *   1. SIGNIFICANCE: if the action can't be undone, it should be attested.
 *   2. PRIVACY: attest the shape, not the content. Hashes prove everything;
 *      descriptions are redacted by default for private categories.
 *
 * Privacy principle: every agent has private context. Redacted attestation
 * is the standard, not the exception. Hashes allow selective disclosure —
 * privacy by default, transparency on demand.
 */

/** Categories of agent actions */
export type ActionCategory =
  | "value_transfer"    // Token/crypto sends, swaps, stakes, locks, unlocks
  | "value_approve"     // Allowances, approvals, delegations
  | "external_comms"    // Emails, messages, posts, API calls that change external state
  | "identity_change"   // System prompt, capabilities, keys, permissions
  | "data_write"        // File writes, DB mutations, contract deployments
  | "data_read"         // Reads, queries, searches (reversible)
  | "internal"          // Thinking, planning, internal state (reversible)
  | "unknown";          // Unclassified

/** Privacy level for attestation content */
export type PrivacyLevel = "public" | "redacted" | "hashed_only";

/** Built-in policy levels */
export type PolicyLevel = "minimal" | "standard" | "strict" | "custom";

/** Custom filter function */
export type PolicyFilter = (tool: string, category: ActionCategory, meta?: Record<string, unknown>) => boolean;

/** Policy configuration */
export interface AttestPolicy {
  level: PolicyLevel;
  /** Custom filter (only used when level = "custom") */
  filter?: PolicyFilter;
  /** Additional tools to always attest regardless of category */
  alwaysAttest?: string[];
  /** Tools to never attest regardless of category */
  neverAttest?: string[];
}

/**
 * Default privacy level per category.
 *
 * Public: full desc, amounts, addresses — nothing sensitive.
 * Redacted: tool name, category, hashes, status. No content, recipients, subjects.
 * Hashed only: only hashes + status. Not even the tool name. (Reserved for future use.)
 *
 * An agent or its owner can selectively disclose the original content for any
 * redacted/hashed attestation. The verifier checks content against the hash.
 * Privacy by default, transparency on demand.
 */
const PRIVACY_DEFAULTS: Record<ActionCategory, PrivacyLevel> = {
  value_transfer: "public",       // Financial actions — transparency is the point
  value_approve: "public",        // Approvals affect third parties
  identity_change: "public",      // Identity changes should be visible
  external_comms: "redacted",     // Who you talk to and what you say is private
  data_write: "redacted",         // File contents, DB mutations — private by default
  data_read: "redacted",          // What you read reveals intent — private
  internal: "redacted",           // Thinking and planning — private
  unknown: "redacted",            // When in doubt, redact
};

/** Categories that each policy level attests */
const POLICY_CATEGORIES: Record<Exclude<PolicyLevel, "custom">, Set<ActionCategory>> = {
  minimal: new Set(["value_transfer", "value_approve", "identity_change"]),
  standard: new Set(["value_transfer", "value_approve", "identity_change", "external_comms", "data_write"]),
  strict: new Set(["value_transfer", "value_approve", "identity_change", "external_comms", "data_write", "data_read"]),
};

/**
 * Known tool → category mappings.
 * Frameworks can extend this via val.registerTool().
 */
const TOOL_CATEGORIES: Record<string, ActionCategory> = {
  // Value movement
  transfer: "value_transfer",
  send: "value_transfer",
  swap: "value_transfer",
  bridge: "value_transfer",
  stake: "value_transfer",
  unstake: "value_transfer",
  deposit: "value_transfer",
  withdraw: "value_transfer",
  lock: "value_transfer",
  claim: "value_transfer",
  mint: "value_transfer",
  burn: "value_transfer",
  // Approvals
  approve: "value_approve",
  revoke: "value_approve",
  delegate: "value_approve",
  allowance: "value_approve",
  permit: "value_approve",
  // External comms
  send_email: "external_comms",
  send_message: "external_comms",
  post_tweet: "external_comms",
  post: "external_comms",
  reply: "external_comms",
  notify: "external_comms",
  webhook: "external_comms",
  api_call: "external_comms",
  // Identity
  update_prompt: "identity_change",
  update_soul: "identity_change",
  rotate_key: "identity_change",
  grant_access: "identity_change",
  revoke_access: "identity_change",
  update_config: "identity_change",
  // Data writes
  deploy_contract: "data_write",
  create_topic: "data_write",
  write_file: "data_write",
  create_account: "data_write",
  // Reads
  get_balance: "data_read",
  get_price: "data_read",
  web_search: "data_read",
  read_file: "data_read",
  query: "data_read",
};

/**
 * Distill a tool name to a single action word.
 * "send_email" → "email", "hbar_transfer" → "transaction",
 * "web_search" → "search", "deploy_contract" → "deployment"
 */
const TOOL_LABELS: Record<string, string> = {
  // Value movement → "transaction"
  transfer: "transaction", send: "transaction", swap: "transaction",
  bridge: "transaction", stake: "transaction", unstake: "transaction",
  deposit: "transaction", withdraw: "transaction", lock: "transaction",
  claim: "transaction", mint: "transaction", burn: "transaction",
  // Approvals → "authorization"
  approve: "authorization", revoke: "authorization", delegate: "authorization",
  allowance: "authorization", permit: "authorization",
  // Comms → the medium
  send_email: "email", send_message: "message", post_tweet: "post",
  post: "post", reply: "reply", notify: "notification", webhook: "webhook",
  // Identity → "configuration"
  update_prompt: "configuration", update_soul: "configuration",
  rotate_key: "configuration", grant_access: "configuration",
  revoke_access: "configuration", update_config: "configuration",
  // Data → the verb
  deploy_contract: "deployment", create_topic: "creation",
  write_file: "write", create_account: "creation",
  get_balance: "query", get_price: "query", web_search: "search",
  read_file: "read", query: "query",
};

function simplifyTool(tool: string): string {
  const key = tool.toLowerCase();
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  // Partial match
  for (const [known, label] of Object.entries(TOOL_LABELS)) {
    if (key.includes(known)) return label;
  }
  // Fallback: use the tool name itself, stripped of underscores
  return key.replace(/_/g, " ").split(" ").pop() || key;
}

export class PolicyEngine {
  private policy: AttestPolicy;
  private customCategories: Map<string, ActionCategory> = new Map();

  constructor(policy: AttestPolicy | PolicyLevel = "standard") {
    this.policy = typeof policy === "string" ? { level: policy } : policy;
  }

  /** Register a tool with its category (for framework-specific tools) */
  registerTool(tool: string, category: ActionCategory): void {
    this.customCategories.set(tool.toLowerCase(), category);
  }

  /** Register multiple tools at once */
  registerTools(mappings: Record<string, ActionCategory>): void {
    for (const [tool, cat] of Object.entries(mappings)) {
      this.customCategories.set(tool.toLowerCase(), cat);
    }
  }

  /** Classify a tool into a category */
  classify(tool: string): ActionCategory {
    const key = tool.toLowerCase();
    // Custom registrations take priority
    if (this.customCategories.has(key)) return this.customCategories.get(key)!;
    // Check built-in mappings (also check partial matches)
    if (TOOL_CATEGORIES[key]) return TOOL_CATEGORIES[key];
    // Partial match: "hbar_transfer" matches "transfer"
    for (const [known, cat] of Object.entries(TOOL_CATEGORIES)) {
      if (key.includes(known)) return cat;
    }
    return "unknown";
  }

  /** Determine the privacy level for an action */
  privacyLevel(tool: string, categoryOverride?: ActionCategory): PrivacyLevel {
    const category = categoryOverride ?? this.classify(tool);
    return PRIVACY_DEFAULTS[category] ?? "redacted";
  }

  /**
   * Redact attestation data based on privacy level.
   * Public: pass through as-is.
   * Redacted: strip desc, keep tool/category/hashes/status, add privacy marker.
   * Hashed_only: strip everything except hashes and status.
   */
  redact(data: Record<string, unknown>, tool: string, categoryOverride?: ActionCategory): Record<string, unknown> {
    const privacy = this.privacyLevel(tool, categoryOverride);
    const category = categoryOverride ?? this.classify(tool);

    if (privacy === "public") {
      // Public: keep tool + hashes + status, simplify desc to action label
      const out: Record<string, unknown> = { ...data, privacy: "public" };
      if (out.desc && typeof out.desc === "string" && out.desc.length > 30) {
        out.desc = simplifyTool(String(data.tool ?? ""));
      }
      return out;
    }

    if (privacy === "hashed_only") {
      // Most restrictive: only hashes and status survive
      const out: Record<string, unknown> = { privacy: "hashed_only", status: data.status };
      if (data.input_hash) out.input_hash = data.input_hash;
      if (data.output_hash) out.output_hash = data.output_hash;
      if (data.context_hash) out.context_hash = data.context_hash;
      return out;
    }

    // Redacted: tool label, hashes, status — no desc, no category, no content
    const out: Record<string, unknown> = {
      tool: simplifyTool(String(data.tool ?? "")),
      status: data.status,
      privacy: "redacted",
    };
    if (data.input_hash) out.input_hash = data.input_hash;
    if (data.output_hash) out.output_hash = data.output_hash;
    if (data.context_hash) out.context_hash = data.context_hash;
    return out;
  }

  /** Should this action be attested? */
  shouldAttest(tool: string, categoryOverride?: ActionCategory, meta?: Record<string, unknown>): boolean {
    const normalizedTool = tool.toLowerCase();

    // Explicit overrides
    if (this.policy.alwaysAttest?.some(t => normalizedTool.includes(t.toLowerCase()))) return true;
    if (this.policy.neverAttest?.some(t => normalizedTool.includes(t.toLowerCase()))) return false;

    const category = categoryOverride ?? this.classify(tool);

    // Custom policy
    if (this.policy.level === "custom" && this.policy.filter) {
      return this.policy.filter(tool, category, meta);
    }

    const allowedCategories = POLICY_CATEGORIES[this.policy.level as Exclude<PolicyLevel, "custom">];
    if (!allowedCategories) return true; // fallback: attest everything

    // "unknown" tools: attest in standard+strict, skip in minimal
    if (category === "unknown") {
      return this.policy.level !== "minimal";
    }

    return allowedCategories.has(category);
  }
}
