import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Signal, SignalSeverity, SignalSource } from "../types.js";

// Error patterns to detect
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  severity: SignalSeverity;
  category: string;
}> = [
  // JavaScript/TypeScript errors
  { pattern: /TypeError:\s+(.+)/gi, severity: "error", category: "type-error" },
  { pattern: /ReferenceError:\s+(.+)/gi, severity: "error", category: "reference-error" },
  { pattern: /SyntaxError:\s+(.+)/gi, severity: "error", category: "syntax-error" },
  { pattern: /Error:\s+(.+)/gi, severity: "error", category: "generic-error" },

  // API/Network errors
  { pattern: /ECONNREFUSED/gi, severity: "error", category: "connection-error" },
  { pattern: /ETIMEDOUT/gi, severity: "error", category: "timeout-error" },
  { pattern: /ENOTFOUND/gi, severity: "error", category: "dns-error" },
  { pattern: /rate.?limit/gi, severity: "warning", category: "rate-limit" },
  { pattern: /429\s+Too Many Requests/gi, severity: "warning", category: "rate-limit" },
  { pattern: /401\s+Unauthorized/gi, severity: "error", category: "auth-error" },
  { pattern: /403\s+Forbidden/gi, severity: "error", category: "permission-error" },
  { pattern: /500\s+Internal Server Error/gi, severity: "error", category: "server-error" },

  // Tool errors
  { pattern: /tool\s+(?:call\s+)?failed/gi, severity: "warning", category: "tool-failure" },
  { pattern: /tool\s+not\s+found/gi, severity: "error", category: "tool-missing" },

  // Memory/Context issues
  { pattern: /context.?(?:window|length).?exceeded/gi, severity: "warning", category: "context-overflow" },
  { pattern: /token.?limit/gi, severity: "warning", category: "token-limit" },
  { pattern: /truncat(?:ed|ing)/gi, severity: "info", category: "truncation" },

  // Warnings
  { pattern: /\[warn(?:ing)?\]/gi, severity: "warning", category: "warning" },
  { pattern: /deprecated/gi, severity: "info", category: "deprecation" },
];

export type ScanOptions = {
  /** Base directory to scan */
  baseDir?: string;
  /** Glob patterns for files to include */
  include?: string[];
  /** Minimum severity to report */
  minSeverity?: SignalSeverity;
  /** Maximum number of signals to return */
  limit?: number;
  /** Signal source type */
  source?: SignalSource;
};

export type ScanResult = {
  signals: Signal[];
  stats: {
    filesScanned: number;
    totalLines: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
};

const SEVERITY_ORDER: Record<SignalSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
};

/**
 * Scan log files for error patterns.
 */
export async function scanLogs(options: ScanOptions = {}): Promise<ScanResult> {
  const baseDir = options.baseDir || getDefaultLogDir();
  const minSeverity = options.minSeverity || "info";
  const limit = options.limit || 100;
  const source = options.source || "log";

  const signals: Signal[] = [];
  let filesScanned = 0;
  let totalLines = 0;
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  // Find log files
  const logFiles = await findLogFiles(baseDir, options.include);

  for (const filePath of logFiles) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      filesScanned++;
      totalLines += lines.length;

      // Scan each line for patterns
      const fileSignals = scanContent(content, filePath, source);

      for (const signal of fileSignals) {
        // Filter by severity
        if (SEVERITY_ORDER[signal.severity] < SEVERITY_ORDER[minSeverity]) {
          continue;
        }

        // Count by severity
        if (signal.severity === "error" || signal.severity === "critical") {
          errorCount++;
        } else if (signal.severity === "warning") {
          warningCount++;
        } else {
          infoCount++;
        }

        signals.push(signal);
      }
    } catch (error) {
      // Skip files that can't be read
      console.warn(`[evolver] Failed to read ${filePath}: ${error}`);
    }
  }

  // Sort by severity (highest first) then by occurrence count
  const sortedSignals = signals.toSorted((a, b) => {
    const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    return severityDiff !== 0 ? severityDiff : b.occurrences - a.occurrences;
  });

  return {
    signals: sortedSignals.slice(0, limit),
    stats: {
      filesScanned,
      totalLines,
      errorCount,
      warningCount,
      infoCount,
    },
  };
}

/**
 * Scan session files specifically.
 */
export async function scanSessions(options: ScanOptions = {}): Promise<ScanResult> {
  const baseDir = options.baseDir || getDefaultSessionDir();
  return scanLogs({
    ...options,
    baseDir,
    include: ["**/*.jsonl"],
    source: "session",
  });
}

/**
 * Get the default log directory.
 */
function getDefaultLogDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".openclaw");
}

/**
 * Get the default session directory.
 */
function getDefaultSessionDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(homeDir, ".openclaw", "agents");
}

/**
 * Find log files matching patterns.
 */
async function findLogFiles(baseDir: string, _include?: string[]): Promise<string[]> {
  // Note: _include parameter reserved for future glob pattern support
  const files: string[] = [];

  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name === "node_modules" || entry.name.startsWith(".")) {
            continue;
          }
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // Check if file matches any pattern
          const ext = path.extname(entry.name).toLowerCase();
          if (ext === ".log" || ext === ".jsonl") {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Skip directories that can't be read
    }
  }

  await walkDir(baseDir);
  return files;
}

/**
 * Scan content for error patterns.
 */
function scanContent(content: string, filePath: string, source: SignalSource): Signal[] {
  const signalMap = new Map<string, Signal>();
  const lines = content.split("\n");

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    for (const { pattern, severity, category } of ERROR_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;

      const match = pattern.exec(line);
      if (match) {
        const key = `${category}:${match[1]?.slice(0, 100) || match[0]}`;

        if (signalMap.has(key)) {
          // Update existing signal
          const signal = signalMap.get(key)!;
          signal.occurrences++;
          signal.lastSeen = new Date().toISOString();
          signal.lineNumbers?.push(lineNum + 1);
        } else {
          // Create new signal
          const signal: Signal = {
            id: randomUUID(),
            source,
            pattern: category,
            severity,
            occurrences: 1,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            filePath,
            lineNumbers: [lineNum + 1],
            message: match[1] || match[0],
            context: getContext(lines, lineNum),
          };
          signalMap.set(key, signal);
        }
      }
    }
  }

  return Array.from(signalMap.values());
}

/**
 * Get context lines around a match.
 */
function getContext(lines: string[], lineNum: number, contextSize = 2): string {
  const start = Math.max(0, lineNum - contextSize);
  const end = Math.min(lines.length, lineNum + contextSize + 1);

  return lines
    .slice(start, end)
    .map((line, i) => {
      const num = start + i + 1;
      const prefix = num === lineNum + 1 ? ">" : " ";
      return `${prefix} ${num}: ${line}`;
    })
    .join("\n");
}
