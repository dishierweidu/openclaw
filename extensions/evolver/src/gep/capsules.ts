import fs from "node:fs/promises";
import path from "node:path";
import type { Capsule, Gene } from "../types.js";
import { getGene } from "./genes.js";

const DEFAULT_CAPSULES_PATH = "assets/gep/capsules.json";

// Built-in capsules for common use cases
const BUILTIN_CAPSULES: Capsule[] = [
  {
    id: "stability-pack",
    name: "Stability Pack",
    description: "Comprehensive stability improvements including error handling and rate limiting",
    genes: ["error-handling-improvement", "rate-limit-awareness", "safety-guardrails"],
    priority: 100,
    tags: ["stability", "recommended"],
    recommended: true,
  },
  {
    id: "efficiency-pack",
    name: "Efficiency Pack",
    description: "Optimizations for better performance and resource usage",
    genes: ["tool-usage-optimization", "context-preservation"],
    priority: 80,
    tags: ["efficiency", "optimization"],
    recommended: false,
  },
  {
    id: "communication-pack",
    name: "Communication Pack",
    description: "Improvements for clearer and more effective communication",
    genes: ["output-clarity", "context-preservation"],
    priority: 70,
    tags: ["communication", "clarity"],
    recommended: false,
  },
  {
    id: "full-enhancement",
    name: "Full Enhancement",
    description: "Complete package of all built-in improvements",
    genes: [
      "error-handling-improvement",
      "rate-limit-awareness",
      "context-preservation",
      "tool-usage-optimization",
      "output-clarity",
      "safety-guardrails",
    ],
    priority: 50,
    tags: ["comprehensive"],
    recommended: false,
  },
];

let capsuleStore: Record<string, Capsule> | null = null;

/**
 * Load capsules from file or use built-ins.
 */
export async function loadCapsules(customPath?: string): Promise<Record<string, Capsule>> {
  if (capsuleStore) {
    return capsuleStore;
  }

  const capsules: Record<string, Capsule> = {};

  // Load built-in capsules
  for (const capsule of BUILTIN_CAPSULES) {
    capsules[capsule.id] = capsule;
  }

  // Try to load custom capsules from file
  const capsulesPath = customPath || DEFAULT_CAPSULES_PATH;
  try {
    const resolvedPath = path.isAbsolute(capsulesPath)
      ? capsulesPath
      : path.join(process.cwd(), capsulesPath);
    const content = await fs.readFile(resolvedPath, "utf-8");
    const customCapsules = JSON.parse(content) as { capsules?: Capsule[] };

    if (customCapsules.capsules) {
      for (const capsule of customCapsules.capsules) {
        capsules[capsule.id] = capsule;
      }
    }
  } catch {
    // Custom file doesn't exist, use built-ins only
  }

  capsuleStore = capsules;
  return capsuleStore;
}

/**
 * Get a capsule by ID.
 */
export async function getCapsule(id: string): Promise<Capsule | undefined> {
  const store = await loadCapsules();
  return store[id];
}

/**
 * List all available capsules.
 */
export async function listCapsules(filter?: {
  tag?: string;
  recommended?: boolean;
}): Promise<Capsule[]> {
  const store = await loadCapsules();
  let capsules = Object.values(store);

  if (filter?.tag) {
    capsules = capsules.filter((c) => c.tags?.includes(filter.tag));
  }

  if (filter?.recommended !== undefined) {
    capsules = capsules.filter((c) => c.recommended === filter.recommended);
  }

  return capsules.toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Expand a capsule to its constituent genes.
 */
export async function expandCapsule(capsuleId: string): Promise<Gene[]> {
  const capsule = await getCapsule(capsuleId);
  if (!capsule) {
    return [];
  }

  const genes: Gene[] = [];
  for (const geneId of capsule.genes) {
    const gene = await getGene(geneId);
    if (gene) {
      genes.push(gene);
    }
  }

  return genes.toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Expand multiple capsules and genes, deduplicating and sorting.
 */
export async function expandSelection(params: {
  capsules?: string[];
  genes?: string[];
}): Promise<Gene[]> {
  const geneIds = new Set<string>(params.genes ?? []);

  // Expand capsules
  for (const capsuleId of params.capsules ?? []) {
    const capsule = await getCapsule(capsuleId);
    if (capsule) {
      for (const geneId of capsule.genes) {
        geneIds.add(geneId);
      }
    }
  }

  // Get all genes
  const genes: Gene[] = [];
  for (const geneId of geneIds) {
    const gene = await getGene(geneId);
    if (gene) {
      genes.push(gene);
    }
  }

  return genes.toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Get recommended capsules.
 */
export async function getRecommendedCapsules(): Promise<Capsule[]> {
  return listCapsules({ recommended: true });
}

/**
 * Clear the capsule cache.
 */
export function clearCapsuleCache(): void {
  capsuleStore = null;
}
