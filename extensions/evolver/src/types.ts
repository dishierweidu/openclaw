/**
 * GEP (Genome Evolution Protocol) Types
 * Based on the evolver project: https://github.com/autogame-17/evolver
 */

// ============================================
// Gene Types
// ============================================

export type GeneCategory =
  | "capability"   // Adds a new capability to the agent
  | "behavior"     // Modifies agent behavior patterns
  | "constraint"   // Adds constraints or guardrails
  | "repair"       // Fixes specific issues or bugs
  | "optimization" // Performance or efficiency improvements
  | "integration"; // Integration with external systems

export type Gene = {
  /** Unique identifier for the gene */
  id: string;
  /** Human-readable name */
  name: string;
  /** Detailed description of what this gene does */
  description: string;
  /** Category of improvement */
  category: GeneCategory;
  /** Version of the gene definition */
  version?: string;
  /** Tags for filtering and organization */
  tags?: string[];
  /** Parameters that can be customized when applying */
  parameters?: Record<string, GeneParameter>;
  /** Other genes that must be present for this to work */
  dependencies?: string[];
  /** Genes that cannot coexist with this one */
  conflicts?: string[];
  /** Prompt additions or modifications */
  prompt?: GenePromptEffect;
  /** Priority when multiple genes apply (higher = earlier) */
  priority?: number;
};

export type GeneParameter = {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  default?: unknown;
  required?: boolean;
  validation?: string; // Regex or condition
};

export type GenePromptEffect = {
  /** Text to add to system prompt */
  systemPrompt?: string;
  /** Text to prepend to user messages */
  userPrefix?: string;
  /** Rules or constraints to add */
  rules?: string[];
  /** Examples to include */
  examples?: Array<{ input: string; output: string }>;
};

// ============================================
// Capsule Types
// ============================================

export type Capsule = {
  /** Unique identifier for the capsule */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of the combined capability */
  description: string;
  /** List of gene IDs included in this capsule */
  genes: string[];
  /** Order/priority for application */
  priority?: number;
  /** Tags for filtering */
  tags?: string[];
  /** Whether this capsule is recommended for new agents */
  recommended?: boolean;
};

// ============================================
// Event Types
// ============================================

export type EvolutionEventType =
  | "analysis"    // Log/pattern analysis performed
  | "detection"   // Signal/issue detected
  | "selection"   // Gene/capsule selected for application
  | "application" // Gene/capsule applied
  | "rollback"    // Evolution reverted
  | "review";     // Human review completed

export type EvolutionEventOutcome =
  | "success"
  | "failure"
  | "pending"
  | "skipped";

export type EvolutionEvent = {
  /** Unique event ID */
  id: string;
  /** ISO timestamp */
  timestamp: string;
  /** Type of event */
  type: EvolutionEventType;
  /** Agent ID this event applies to */
  agentId?: string;
  /** Genes involved */
  genes?: string[];
  /** Capsules involved */
  capsules?: string[];
  /** Signals that triggered this event */
  signals?: Signal[];
  /** Outcome of the event */
  outcome?: EvolutionEventOutcome;
  /** Human-readable notes */
  notes?: string;
  /** Metadata for audit trail */
  metadata?: Record<string, unknown>;
  /** Parent event ID (for chains) */
  parentEventId?: string;
};

// ============================================
// Signal Types
// ============================================

export type SignalSource =
  | "log"       // From log files
  | "session"   // From session history
  | "memory"    // From memory files
  | "metrics"   // From performance metrics
  | "feedback"; // From user feedback

export type SignalSeverity =
  | "info"
  | "warning"
  | "error"
  | "critical";

export type Signal = {
  /** Unique signal ID */
  id: string;
  /** Source of the signal */
  source: SignalSource;
  /** Pattern that was matched */
  pattern: string;
  /** Severity level */
  severity: SignalSeverity;
  /** Number of occurrences */
  occurrences: number;
  /** First seen timestamp */
  firstSeen: string;
  /** Last seen timestamp */
  lastSeen: string;
  /** Sample context around the match */
  context?: string;
  /** File path where detected */
  filePath?: string;
  /** Line numbers of occurrences */
  lineNumbers?: number[];
  /** Extracted error message */
  message?: string;
  /** Stack trace if available */
  stackTrace?: string;
};

// ============================================
// Repair Directive Types
// ============================================

export type RepairDirective = {
  /** Signal that triggered this directive */
  signal: Signal;
  /** Gene recommended to address the signal */
  gene: Gene;
  /** Explanation for why this gene was selected */
  rationale: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Generated prompt for the repair */
  prompt: string;
  /** Whether human approval is required */
  requiresApproval: boolean;
};

// ============================================
// Analysis Types
// ============================================

export type AnalysisScope = "all" | "logs" | "sessions" | "memory";

export type AnalysisResult = {
  /** Timestamp of analysis */
  timestamp: string;
  /** Scope of the analysis */
  scope: AnalysisScope;
  /** Detected signals */
  signals: Signal[];
  /** Recommended genes */
  recommendations: RepairDirective[];
  /** Summary statistics */
  stats: {
    filesScanned: number;
    totalLines: number;
    signalsFound: number;
    errorCount: number;
    warningCount: number;
  };
};

// ============================================
// Tool Parameter Types
// ============================================

export type EvolverAction =
  | "analyze"   // Scan logs and detect signals
  | "review"    // Review detected signals and recommendations
  | "apply"     // Apply selected genes/capsules
  | "rollback"  // Revert last evolution
  | "status"    // Show current evolution state
  | "list";     // List available genes/capsules

export type EvolverToolParams = {
  action: EvolverAction;
  // For analyze/review
  scope?: AnalysisScope;
  severity?: SignalSeverity;
  limit?: number;
  // For apply
  genes?: string[];
  capsules?: string[];
  dryRun?: boolean;
  // For rollback
  eventId?: string;
  // For list
  category?: GeneCategory;
  tag?: string;
};

export type EvolverToolResult = {
  ok: boolean;
  action: EvolverAction;
  data?: unknown;
  error?: string;
};

// ============================================
// Store Types
// ============================================

export type GeneStore = {
  version: number;
  genes: Record<string, Gene>;
  capsules: Record<string, Capsule>;
};

export type EventStore = {
  events: EvolutionEvent[];
};
