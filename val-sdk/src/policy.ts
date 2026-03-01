/**
 * Attestation Policy — defines what "significant" means.
 *
 * The core principle: if the action can't be undone, it should be attested.
 * Reading is reversible. Sending money is not. Sending an email is not.
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
