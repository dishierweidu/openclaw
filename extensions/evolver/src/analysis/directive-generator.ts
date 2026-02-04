import type { Gene, RepairDirective, Signal } from "../types.js";
import { listGenes } from "../gep/genes.js";

// Mapping from signal patterns to recommended genes
const SIGNAL_TO_GENE_MAP: Record<string, { geneId: string; confidence: number }[]> = {
  // Error handling
  "type-error": [{ geneId: "error-handling-improvement", confidence: 0.9 }],
  "reference-error": [{ geneId: "error-handling-improvement", confidence: 0.9 }],
  "syntax-error": [{ geneId: "error-handling-improvement", confidence: 0.7 }],
  "generic-error": [{ geneId: "error-handling-improvement", confidence: 0.8 }],

  // Network/API errors
  "connection-error": [
    { geneId: "error-handling-improvement", confidence: 0.8 },
    { geneId: "rate-limit-awareness", confidence: 0.6 },
  ],
  "timeout-error": [
    { geneId: "error-handling-improvement", confidence: 0.8 },
    { geneId: "rate-limit-awareness", confidence: 0.7 },
  ],
  "dns-error": [{ geneId: "error-handling-improvement", confidence: 0.7 }],
  "rate-limit": [{ geneId: "rate-limit-awareness", confidence: 0.95 }],
  "auth-error": [{ geneId: "safety-guardrails", confidence: 0.6 }],
  "permission-error": [{ geneId: "safety-guardrails", confidence: 0.7 }],
  "server-error": [{ geneId: "error-handling-improvement", confidence: 0.8 }],

  // Tool errors
  "tool-failure": [
    { geneId: "tool-usage-optimization", confidence: 0.8 },
    { geneId: "error-handling-improvement", confidence: 0.6 },
  ],
  "tool-missing": [{ geneId: "tool-usage-optimization", confidence: 0.7 }],

  // Context issues
  "context-overflow": [{ geneId: "context-preservation", confidence: 0.9 }],
  "token-limit": [{ geneId: "context-preservation", confidence: 0.85 }],
  "truncation": [{ geneId: "context-preservation", confidence: 0.7 }],

  // General
  warning: [{ geneId: "safety-guardrails", confidence: 0.5 }],
  deprecation: [{ geneId: "error-handling-improvement", confidence: 0.4 }],
};

/**
 * Generate repair directives for detected signals.
 */
export async function generateDirectives(
  signals: Signal[],
): Promise<RepairDirective[]> {
  const directives: RepairDirective[] = [];
  const genes = await listGenes();
  const geneMap = new Map(genes.map((g) => [g.id, g]));

  // Track which genes have been recommended to avoid duplicates
  const recommendedGenes = new Set<string>();

  for (const signal of signals) {
    const mappings = SIGNAL_TO_GENE_MAP[signal.pattern];
    if (!mappings) {
      continue;
    }

    for (const mapping of mappings) {
      // Skip if already recommended
      if (recommendedGenes.has(mapping.geneId)) {
        continue;
      }

      const gene = geneMap.get(mapping.geneId);
      if (!gene) {
        continue;
      }

      // Adjust confidence based on occurrence count
      let adjustedConfidence = mapping.confidence;
      if (signal.occurrences > 10) {
        adjustedConfidence = Math.min(1, adjustedConfidence * 1.2);
      } else if (signal.occurrences > 5) {
        adjustedConfidence = Math.min(1, adjustedConfidence * 1.1);
      }

      // Adjust confidence based on severity
      if (signal.severity === "critical") {
        adjustedConfidence = Math.min(1, adjustedConfidence * 1.3);
      } else if (signal.severity === "error") {
        adjustedConfidence = Math.min(1, adjustedConfidence * 1.15);
      }

      const directive: RepairDirective = {
        signal,
        gene,
        rationale: buildRationale(signal, gene),
        confidence: adjustedConfidence,
        prompt: buildPrompt(signal, gene),
        requiresApproval: adjustedConfidence < 0.8,
      };

      directives.push(directive);
      recommendedGenes.add(mapping.geneId);
    }
  }

  // Sort by confidence (highest first)
  return directives.toSorted((a, b) => b.confidence - a.confidence);
}

/**
 * Build a rationale explaining why a gene is recommended.
 */
function buildRationale(signal: Signal, gene: Gene): string {
  const parts: string[] = [];

  parts.push(`Detected ${signal.occurrences} occurrence(s) of "${signal.pattern}" pattern.`);

  if (signal.severity === "critical" || signal.severity === "error") {
    parts.push(`This is a ${signal.severity}-level issue that should be addressed.`);
  }

  parts.push(`The "${gene.name}" gene addresses this by: ${gene.description}`);

  if (gene.prompt?.rules) {
    parts.push(`It adds the following rules: ${gene.prompt.rules.slice(0, 2).join("; ")}`);
  }

  return parts.join(" ");
}

/**
 * Build a prompt for applying the repair.
 */
function buildPrompt(signal: Signal, gene: Gene): string {
  const parts: string[] = [];

  parts.push(`## Evolution Directive: ${gene.name}`);
  parts.push("");
  parts.push(`### Issue Detected`);
  parts.push(`- Pattern: ${signal.pattern}`);
  parts.push(`- Severity: ${signal.severity}`);
  parts.push(`- Occurrences: ${signal.occurrences}`);
  if (signal.message) {
    parts.push(`- Message: ${signal.message}`);
  }
  parts.push("");

  parts.push(`### Recommended Action`);
  parts.push(gene.description);
  parts.push("");

  if (gene.prompt?.rules) {
    parts.push(`### Rules to Apply`);
    for (const rule of gene.prompt.rules) {
      parts.push(`- ${rule}`);
    }
    parts.push("");
  }

  if (gene.prompt?.systemPrompt) {
    parts.push(`### System Prompt Addition`);
    parts.push("```");
    parts.push(gene.prompt.systemPrompt);
    parts.push("```");
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Get a summary of recommended actions.
 */
export function summarizeDirectives(directives: RepairDirective[]): string {
  if (directives.length === 0) {
    return "No repair directives generated. The system appears healthy.";
  }

  const parts: string[] = [];
  parts.push(`## Evolution Summary`);
  parts.push("");
  parts.push(`Found ${directives.length} recommended improvement(s):`);
  parts.push("");

  for (const directive of directives) {
    const approvalNote = directive.requiresApproval ? " (requires approval)" : "";
    parts.push(
      `- **${directive.gene.name}** (confidence: ${Math.round(directive.confidence * 100)}%)${approvalNote}`,
    );
    parts.push(`  - Addresses: ${directive.signal.pattern} (${directive.signal.occurrences} occurrences)`);
  }

  return parts.join("\n");
}
