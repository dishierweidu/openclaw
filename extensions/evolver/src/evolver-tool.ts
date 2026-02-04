import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type {
  AnalysisResult,
  EvolverAction,
  EvolverToolResult,
  GeneCategory,
  SignalSeverity,
} from "./types.js";
import { scanLogs, scanSessions } from "./analysis/log-scanner.js";
import { generateDirectives, summarizeDirectives } from "./analysis/directive-generator.js";
import { checkGeneConflicts, listGenes, buildCombinedPromptEffect } from "./gep/genes.js";
import { expandSelection, listCapsules } from "./gep/capsules.js";
import {
  getEvolutionStats,
  getLatestEvent,
  recordAnalysis,
  recordApplication,
  recordRollback,
} from "./gep/events.js";

const EvolverToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("analyze"),
    Type.Literal("review"),
    Type.Literal("apply"),
    Type.Literal("rollback"),
    Type.Literal("status"),
    Type.Literal("list"),
  ]),
  scope: Type.Optional(
    Type.Union([
      Type.Literal("all"),
      Type.Literal("logs"),
      Type.Literal("sessions"),
      Type.Literal("memory"),
    ]),
  ),
  severity: Type.Optional(
    Type.Union([
      Type.Literal("info"),
      Type.Literal("warning"),
      Type.Literal("error"),
      Type.Literal("critical"),
    ]),
  ),
  limit: Type.Optional(Type.Number()),
  genes: Type.Optional(Type.Array(Type.String())),
  capsules: Type.Optional(Type.Array(Type.String())),
  dryRun: Type.Optional(Type.Boolean()),
  eventId: Type.Optional(Type.String()),
  category: Type.Optional(Type.String()),
  tag: Type.Optional(Type.String()),
});

export function createEvolverTool(_api: OpenClawPluginApi) {
  return {
    name: "evolver",
    description: `Self-improvement tool using the GEP (Genome Evolution Protocol).

Actions:
- analyze: Scan logs and sessions for error patterns and issues
- review: Review detected signals and get improvement recommendations
- apply: Apply selected genes or capsules (improvements)
- rollback: Revert the last evolution
- status: Show current evolution state and statistics
- list: List available genes and capsules

Examples:
- Analyze logs: { "action": "analyze", "scope": "logs", "severity": "warning" }
- Review and recommend: { "action": "review" }
- Apply improvements: { "action": "apply", "genes": ["error-handling-improvement"] }
- Apply a capsule: { "action": "apply", "capsules": ["stability-pack"] }
- Check status: { "action": "status" }
- List genes: { "action": "list", "category": "repair" }`,

    parameters: EvolverToolSchema,

    async execute(params: {
      action: EvolverAction;
      scope?: "all" | "logs" | "sessions" | "memory";
      severity?: SignalSeverity;
      limit?: number;
      genes?: string[];
      capsules?: string[];
      dryRun?: boolean;
      eventId?: string;
      category?: string;
      tag?: string;
    }): Promise<EvolverToolResult> {
      try {
        switch (params.action) {
          case "analyze":
            return await handleAnalyze(params);
          case "review":
            return await handleReview(params);
          case "apply":
            return await handleApply(params);
          case "rollback":
            return await handleRollback(params);
          case "status":
            return await handleStatus();
          case "list":
            return await handleList(params);
          default: {
            const unknownAction: never = params.action;
            return { ok: false, action: unknownAction as EvolverAction, error: `Unknown action: ${String(unknownAction)}` };
          }
        }
      } catch (error) {
        return {
          ok: false,
          action: params.action,
          error: String(error),
        };
      }
    },
  };
}

/**
 * Handle the analyze action.
 */
async function handleAnalyze(params: {
  scope?: "all" | "logs" | "sessions" | "memory";
  severity?: SignalSeverity;
  limit?: number;
}): Promise<EvolverToolResult> {
  const scope = params.scope || "all";
  const severity = params.severity || "warning";
  const limit = params.limit || 50;

  let result: AnalysisResult;

  if (scope === "sessions" || scope === "all") {
    const sessionResult = await scanSessions({ minSeverity: severity, limit });
    result = {
      timestamp: new Date().toISOString(),
      scope,
      signals: sessionResult.signals,
      recommendations: [],
      stats: sessionResult.stats,
    };
  } else {
    const logResult = await scanLogs({ minSeverity: severity, limit });
    result = {
      timestamp: new Date().toISOString(),
      scope,
      signals: logResult.signals,
      recommendations: [],
      stats: logResult.stats,
    };
  }

  // Record the analysis
  await recordAnalysis({
    signals: result.signals,
    notes: `Scanned ${result.stats.filesScanned} files, found ${result.signals.length} signals`,
  });

  return {
    ok: true,
    action: "analyze",
    data: {
      summary: `Analyzed ${result.stats.filesScanned} files (${result.stats.totalLines} lines)`,
      signalsFound: result.signals.length,
      errors: result.stats.errorCount,
      warnings: result.stats.warningCount,
      signals: result.signals.slice(0, 10).map((s) => ({
        pattern: s.pattern,
        severity: s.severity,
        occurrences: s.occurrences,
        message: s.message?.slice(0, 100),
      })),
    },
  };
}

/**
 * Handle the review action.
 */
async function handleReview(params: {
  severity?: SignalSeverity;
  limit?: number;
}): Promise<EvolverToolResult> {
  // First analyze
  const severity = params.severity || "warning";
  const limit = params.limit || 20;

  const logResult = await scanLogs({ minSeverity: severity, limit });
  const sessionResult = await scanSessions({ minSeverity: severity, limit });

  const allSignals = [...logResult.signals, ...sessionResult.signals];

  // Generate directives
  const directives = await generateDirectives(allSignals);
  const summary = summarizeDirectives(directives);

  return {
    ok: true,
    action: "review",
    data: {
      summary,
      signalsAnalyzed: allSignals.length,
      recommendationsCount: directives.length,
      recommendations: directives.map((d) => ({
        gene: d.gene.id,
        geneName: d.gene.name,
        confidence: Math.round(d.confidence * 100),
        requiresApproval: d.requiresApproval,
        signal: d.signal.pattern,
        occurrences: d.signal.occurrences,
      })),
    },
  };
}

/**
 * Handle the apply action.
 */
async function handleApply(params: {
  genes?: string[];
  capsules?: string[];
  dryRun?: boolean;
}): Promise<EvolverToolResult> {
  const { genes = [], capsules = [], dryRun = false } = params;

  if (genes.length === 0 && capsules.length === 0) {
    return {
      ok: false,
      action: "apply",
      error: "No genes or capsules specified. Use 'list' to see available options.",
    };
  }

  // Expand capsules to genes
  const expandedGenes = await expandSelection({ genes, capsules });
  const geneIds = expandedGenes.map((g) => g.id);

  // Check for conflicts
  const conflicts = await checkGeneConflicts(geneIds);
  if (!conflicts.ok) {
    return {
      ok: false,
      action: "apply",
      error: `Gene conflicts detected: ${JSON.stringify(conflicts)}`,
    };
  }

  // Build combined prompt effect
  const promptEffect = await buildCombinedPromptEffect(geneIds);

  if (dryRun) {
    return {
      ok: true,
      action: "apply",
      data: {
        dryRun: true,
        genesWouldApply: geneIds,
        capsulesExpanded: capsules,
        promptEffect: {
          rulesCount: promptEffect.rules.length,
          rules: promptEffect.rules,
          hasSystemPrompt: Boolean(promptEffect.systemPrompt),
        },
      },
    };
  }

  // Record the application
  const event = await recordApplication({
    genes: geneIds,
    capsules,
    outcome: "success",
    notes: `Applied ${geneIds.length} genes`,
  });

  return {
    ok: true,
    action: "apply",
    data: {
      eventId: event.id,
      genesApplied: geneIds,
      capsulesExpanded: capsules,
      rulesAdded: promptEffect.rules.length,
      message: `Successfully applied ${geneIds.length} gene(s). Use 'status' to verify.`,
    },
  };
}

/**
 * Handle the rollback action.
 */
async function handleRollback(params: {
  eventId?: string;
}): Promise<EvolverToolResult> {
  // Get the event to rollback
  let eventId = params.eventId;

  if (!eventId) {
    const latest = await getLatestEvent();
    if (!latest || latest.type !== "application") {
      return {
        ok: false,
        action: "rollback",
        error: "No application event found to rollback",
      };
    }
    eventId = latest.id;
  }

  // Record the rollback
  const event = await recordRollback({
    genes: [],
    outcome: "success",
    notes: `Rolled back event ${eventId}`,
    parentEventId: eventId,
  });

  return {
    ok: true,
    action: "rollback",
    data: {
      eventId: event.id,
      rolledBackEvent: eventId,
      message: "Rollback recorded. Previous evolution has been reverted.",
    },
  };
}

/**
 * Handle the status action.
 */
async function handleStatus(): Promise<EvolverToolResult> {
  const stats = await getEvolutionStats();
  const latestEvent = await getLatestEvent();

  return {
    ok: true,
    action: "status",
    data: {
      totalEvents: stats.totalEvents,
      eventsByType: stats.byType,
      eventsByOutcome: stats.byOutcome,
      lastEventAt: stats.lastEventAt,
      genesCurrentlyApplied: stats.genesApplied,
      latestEvent: latestEvent
        ? {
            id: latestEvent.id,
            type: latestEvent.type,
            outcome: latestEvent.outcome,
            timestamp: latestEvent.timestamp,
          }
        : null,
    },
  };
}

/**
 * Handle the list action.
 */
async function handleList(params: {
  category?: string;
  tag?: string;
}): Promise<EvolverToolResult> {
  const genes = await listGenes({
    category: params.category as GeneCategory | undefined,
    tag: params.tag,
  });

  const capsules = await listCapsules({ tag: params.tag });

  return {
    ok: true,
    action: "list",
    data: {
      genes: genes.map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        description: g.description.slice(0, 100),
        tags: g.tags,
      })),
      capsules: capsules.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description.slice(0, 100),
        geneCount: c.genes.length,
        recommended: c.recommended,
      })),
    },
  };
}
