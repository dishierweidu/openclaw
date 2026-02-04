import fs from "node:fs/promises";
import path from "node:path";
import type { Gene, GeneCategory, GeneStore } from "../types.js";

const DEFAULT_GENES_PATH = "assets/gep/genes.json";

// Built-in genes for common repairs
const BUILTIN_GENES: Gene[] = [
  {
    id: "error-handling-improvement",
    name: "Error Handling Improvement",
    description: "Improves error handling by adding better try-catch patterns and error messages",
    category: "repair",
    version: "1.0.0",
    tags: ["error", "stability", "repair"],
    prompt: {
      rules: [
        "Always wrap external API calls in try-catch blocks",
        "Provide meaningful error messages that include context",
        "Log errors with full stack traces for debugging",
      ],
    },
    priority: 100,
  },
  {
    id: "rate-limit-awareness",
    name: "Rate Limit Awareness",
    description: "Adds awareness of API rate limits and implements backoff strategies",
    category: "constraint",
    version: "1.0.0",
    tags: ["rate-limit", "api", "reliability"],
    prompt: {
      rules: [
        "Respect API rate limits by implementing exponential backoff",
        "Track and report rate limit errors",
        "Suggest alternative approaches when rate limited",
      ],
    },
    priority: 90,
  },
  {
    id: "context-preservation",
    name: "Context Preservation",
    description: "Improves conversation context management to avoid losing important information",
    category: "behavior",
    version: "1.0.0",
    tags: ["context", "memory", "conversation"],
    prompt: {
      rules: [
        "Summarize key information periodically to avoid context loss",
        "Reference previous important decisions when relevant",
        "Explicitly confirm understanding of complex requirements",
      ],
    },
    priority: 80,
  },
  {
    id: "tool-usage-optimization",
    name: "Tool Usage Optimization",
    description: "Optimizes tool usage patterns to reduce unnecessary calls",
    category: "optimization",
    version: "1.0.0",
    tags: ["tools", "efficiency", "optimization"],
    prompt: {
      rules: [
        "Batch similar operations when possible",
        "Check if information is already available before making API calls",
        "Use the most specific tool for the task",
      ],
    },
    priority: 70,
  },
  {
    id: "output-clarity",
    name: "Output Clarity",
    description: "Improves output formatting and clarity",
    category: "behavior",
    version: "1.0.0",
    tags: ["output", "clarity", "formatting"],
    prompt: {
      rules: [
        "Use clear section headers for organized output",
        "Provide concise summaries before detailed explanations",
        "Use bullet points and numbered lists for multiple items",
      ],
    },
    priority: 60,
  },
  {
    id: "safety-guardrails",
    name: "Safety Guardrails",
    description: "Adds safety checks and guardrails for sensitive operations",
    category: "constraint",
    version: "1.0.0",
    tags: ["safety", "security", "guardrails"],
    prompt: {
      rules: [
        "Always confirm before destructive operations",
        "Validate inputs before processing",
        "Never expose sensitive information in outputs",
      ],
    },
    priority: 95,
  },
];

let geneStore: GeneStore | null = null;

/**
 * Load genes from file or use built-ins.
 */
export async function loadGenes(customPath?: string): Promise<GeneStore> {
  if (geneStore) {
    return geneStore;
  }

  const genes: Record<string, Gene> = {};

  // Load built-in genes
  for (const gene of BUILTIN_GENES) {
    genes[gene.id] = gene;
  }

  // Try to load custom genes from file
  const genesPath = customPath || DEFAULT_GENES_PATH;
  try {
    const resolvedPath = path.isAbsolute(genesPath)
      ? genesPath
      : path.join(process.cwd(), genesPath);
    const content = await fs.readFile(resolvedPath, "utf-8");
    const customGenes = JSON.parse(content) as { genes?: Gene[] };

    if (customGenes.genes) {
      for (const gene of customGenes.genes) {
        genes[gene.id] = gene;
      }
    }
  } catch {
    // Custom file doesn't exist, use built-ins only
  }

  geneStore = {
    version: 1,
    genes,
    capsules: {},
  };

  return geneStore;
}

/**
 * Get a gene by ID.
 */
export async function getGene(id: string): Promise<Gene | undefined> {
  const store = await loadGenes();
  return store.genes[id];
}

/**
 * List all available genes.
 */
export async function listGenes(filter?: {
  category?: GeneCategory;
  tag?: string;
}): Promise<Gene[]> {
  const store = await loadGenes();
  let genes = Object.values(store.genes);

  if (filter?.category) {
    genes = genes.filter((g) => g.category === filter.category);
  }

  if (filter?.tag) {
    genes = genes.filter((g) => g.tags?.includes(filter.tag));
  }

  return genes.toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Check if genes have dependency conflicts.
 */
export async function checkGeneConflicts(geneIds: string[]): Promise<{
  ok: boolean;
  conflicts: Array<{ gene1: string; gene2: string; reason: string }>;
  missingDeps: Array<{ gene: string; missing: string[] }>;
}> {
  const store = await loadGenes();
  const conflicts: Array<{ gene1: string; gene2: string; reason: string }> = [];
  const missingDeps: Array<{ gene: string; missing: string[] }> = [];

  for (const geneId of geneIds) {
    const gene = store.genes[geneId];
    if (!gene) {
      continue;
    }

    // Check for conflicts
    if (gene.conflicts) {
      for (const conflictId of gene.conflicts) {
        if (geneIds.includes(conflictId)) {
          conflicts.push({
            gene1: geneId,
            gene2: conflictId,
            reason: `${geneId} conflicts with ${conflictId}`,
          });
        }
      }
    }

    // Check dependencies
    if (gene.dependencies) {
      const missing = gene.dependencies.filter((dep) => !geneIds.includes(dep));
      if (missing.length > 0) {
        missingDeps.push({ gene: geneId, missing });
      }
    }
  }

  return {
    ok: conflicts.length === 0 && missingDeps.length === 0,
    conflicts,
    missingDeps,
  };
}

/**
 * Build combined prompt effect from multiple genes.
 */
export async function buildCombinedPromptEffect(geneIds: string[]): Promise<{
  systemPrompt: string;
  rules: string[];
}> {
  const store = await loadGenes();
  const rules: string[] = [];
  const systemPromptParts: string[] = [];

  // Get genes sorted by priority
  const genes = geneIds
    .map((id) => store.genes[id])
    .filter((g): g is Gene => Boolean(g))
    .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const gene of genes) {
    if (gene.prompt?.systemPrompt) {
      systemPromptParts.push(gene.prompt.systemPrompt);
    }
    if (gene.prompt?.rules) {
      rules.push(...gene.prompt.rules);
    }
  }

  return {
    systemPrompt: systemPromptParts.join("\n\n"),
    rules: [...new Set(rules)], // Deduplicate
  };
}

/**
 * Clear the gene cache.
 */
export function clearGeneCache(): void {
  geneStore = null;
}
