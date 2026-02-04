import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  EvolutionEvent,
  EvolutionEventOutcome,
  EvolutionEventType,
  Signal,
} from "../types.js";

const DEFAULT_EVENTS_PATH = "~/.openclaw/evolver/events.jsonl";

/**
 * Resolve the events file path.
 */
function resolveEventsPath(customPath?: string): string {
  const eventsPath = customPath || DEFAULT_EVENTS_PATH;

  if (eventsPath.startsWith("~/")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(homeDir, eventsPath.slice(2));
  }

  if (path.isAbsolute(eventsPath)) {
    return eventsPath;
  }

  return path.join(process.cwd(), eventsPath);
}

/**
 * Ensure the events directory exists.
 */
async function ensureEventsDir(eventsPath: string): Promise<void> {
  const dir = path.dirname(eventsPath);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Append an event to the events file (JSONL format).
 */
export async function appendEvent(
  event: Omit<EvolutionEvent, "id" | "timestamp">,
  customPath?: string,
): Promise<EvolutionEvent> {
  const eventsPath = resolveEventsPath(customPath);
  await ensureEventsDir(eventsPath);

  const fullEvent: EvolutionEvent = {
    ...event,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  };

  const line = JSON.stringify(fullEvent) + "\n";
  await fs.appendFile(eventsPath, line, "utf-8");

  return fullEvent;
}

/**
 * Read all events from the events file.
 */
export async function readEvents(customPath?: string): Promise<EvolutionEvent[]> {
  const eventsPath = resolveEventsPath(customPath);

  try {
    const content = await fs.readFile(eventsPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    return lines.map((line) => JSON.parse(line) as EvolutionEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Get the most recent event.
 */
export async function getLatestEvent(customPath?: string): Promise<EvolutionEvent | null> {
  const events = await readEvents(customPath);
  return events.length > 0 ? events[events.length - 1] : null;
}

/**
 * Get events by type.
 */
export async function getEventsByType(
  type: EvolutionEventType,
  customPath?: string,
): Promise<EvolutionEvent[]> {
  const events = await readEvents(customPath);
  return events.filter((e) => e.type === type);
}

/**
 * Get events for a specific agent.
 */
export async function getEventsByAgent(
  agentId: string,
  customPath?: string,
): Promise<EvolutionEvent[]> {
  const events = await readEvents(customPath);
  return events.filter((e) => e.agentId === agentId);
}

/**
 * Get the event chain (parent -> child relationships).
 */
export async function getEventChain(
  eventId: string,
  customPath?: string,
): Promise<EvolutionEvent[]> {
  const events = await readEvents(customPath);
  const eventMap = new Map(events.map((e) => [e.id, e]));

  // Walk up to find ancestors (root first)
  const ancestors: EvolutionEvent[] = [];
  let currentId: string | undefined = eventId;
  while (currentId) {
    const event = eventMap.get(currentId);
    if (!event) {
      currentId = undefined;
      continue;
    }
    ancestors.unshift(event);
    currentId = event.parentEventId;
  }

  // Walk down to find descendants
  const descendants: EvolutionEvent[] = [];
  const toVisit = [eventId];
  while (toVisit.length > 0) {
    const id = toVisit.shift()!;
    for (const event of events) {
      if (event.parentEventId === id && event.id !== eventId) {
        descendants.push(event);
        toVisit.push(event.id);
      }
    }
  }

  return [...ancestors, ...descendants];
}

/**
 * Create an analysis event.
 */
export async function recordAnalysis(params: {
  agentId?: string;
  signals: Signal[];
  notes?: string;
  customPath?: string;
}): Promise<EvolutionEvent> {
  return appendEvent(
    {
      type: "analysis",
      agentId: params.agentId,
      signals: params.signals,
      outcome: "success",
      notes: params.notes,
    },
    params.customPath,
  );
}

/**
 * Create an application event.
 */
export async function recordApplication(params: {
  agentId?: string;
  genes: string[];
  capsules?: string[];
  signals?: Signal[];
  outcome: EvolutionEventOutcome;
  notes?: string;
  parentEventId?: string;
  customPath?: string;
}): Promise<EvolutionEvent> {
  return appendEvent(
    {
      type: "application",
      agentId: params.agentId,
      genes: params.genes,
      capsules: params.capsules,
      signals: params.signals,
      outcome: params.outcome,
      notes: params.notes,
      parentEventId: params.parentEventId,
    },
    params.customPath,
  );
}

/**
 * Create a rollback event.
 */
export async function recordRollback(params: {
  agentId?: string;
  genes: string[];
  outcome: EvolutionEventOutcome;
  notes?: string;
  parentEventId: string;
  customPath?: string;
}): Promise<EvolutionEvent> {
  return appendEvent(
    {
      type: "rollback",
      agentId: params.agentId,
      genes: params.genes,
      outcome: params.outcome,
      notes: params.notes,
      parentEventId: params.parentEventId,
    },
    params.customPath,
  );
}

/**
 * Get evolution statistics.
 */
export async function getEvolutionStats(customPath?: string): Promise<{
  totalEvents: number;
  byType: Record<EvolutionEventType, number>;
  byOutcome: Record<EvolutionEventOutcome, number>;
  lastEventAt?: string;
  genesApplied: string[];
}> {
  const events = await readEvents(customPath);

  const byType: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const genesApplied = new Set<string>();

  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    if (event.outcome) {
      byOutcome[event.outcome] = (byOutcome[event.outcome] || 0) + 1;
    }
    if (event.genes && event.type === "application" && event.outcome === "success") {
      for (const gene of event.genes) {
        genesApplied.add(gene);
      }
    }
  }

  return {
    totalEvents: events.length,
    byType: byType as Record<EvolutionEventType, number>,
    byOutcome: byOutcome as Record<EvolutionEventOutcome, number>,
    lastEventAt: events.length > 0 ? events[events.length - 1].timestamp : undefined,
    genesApplied: [...genesApplied],
  };
}
