import type { FeishuConfig } from "openclaw/plugin-sdk";
import type {
  FeishuCredentials,
  FeishuEventEnvelope,
  FeishuMessage,
  FeishuMessageReceiveEvent,
  FeishuUrlVerificationEvent,
} from "./types.js";
import { decryptEventPayload, verifyEventToken } from "./auth.js";
import { getFeishuRuntime } from "./runtime.js";

export type FeishuMonitorConfig = {
  port: number;
  path: string;
  credentials: FeishuCredentials;
  onMessage: (event: FeishuInboundMessage) => Promise<void>;
};

export type FeishuInboundMessage = {
  messageId: string;
  chatId: string;
  chatType: "p2p" | "group";
  senderId: string;
  senderType: "user" | "app";
  text: string;
  messageType: string;
  rootId?: string;
  parentId?: string;
  mentions?: Array<{ key: string; id: string; name: string }>;
  createTime: string;
  raw: FeishuMessage;
};

let server: Awaited<ReturnType<typeof import("node:http").createServer>> | null = null;
let messageHandler: ((event: FeishuInboundMessage) => Promise<void>) | null = null;

/**
 * Start the Feishu webhook monitor.
 */
export async function startFeishuMonitor(config: FeishuMonitorConfig): Promise<void> {
  if (server) {
    console.warn("[feishu] Monitor already running");
    return;
  }

  const http = await import("node:http");
  messageHandler = config.onMessage;

  server = http.createServer(async (req, res) => {
    // Only handle POST requests to the configured path
    if (req.method !== "POST" || req.url !== config.path) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    try {
      const body = await readRequestBody(req);
      const response = await handleWebhookEvent(body, config.credentials);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (error) {
      console.error("[feishu] Webhook error:", error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  });

  server.listen(config.port, () => {
    console.log(`[feishu] Webhook monitor listening on port ${config.port}${config.path}`);
  });
}

/**
 * Stop the Feishu webhook monitor.
 */
export async function stopFeishuMonitor(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
    messageHandler = null;
    console.log("[feishu] Webhook monitor stopped");
  }
}

/**
 * Read request body as string.
 */
async function readRequestBody(
  req: import("node:http").IncomingMessage,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Type guard for v2 event envelope.
 */
function isFeishuEventEnvelope(
  payload: unknown,
): payload is FeishuEventEnvelope {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "schema" in payload &&
    (payload as { schema: unknown }).schema === "2.0"
  );
}

/**
 * Handle incoming webhook event.
 */
async function handleWebhookEvent(
  body: string,
  credentials: FeishuCredentials,
): Promise<Record<string, unknown>> {
  let payload: FeishuEventEnvelope | { encrypt?: string; challenge?: string; token?: string };

  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    console.error("[feishu] Invalid JSON payload");
    return { code: 400, msg: "Invalid JSON" };
  }

  // Handle encrypted payload
  if ("encrypt" in payload && payload.encrypt && credentials.encryptKey) {
    const decrypted = await decryptEventPayload(payload.encrypt, credentials.encryptKey);
    payload = JSON.parse(decrypted) as FeishuEventEnvelope;
  }

  // Handle URL verification challenge (v1 format)
  if ("challenge" in payload && payload.challenge) {
    const v1Event = payload as FeishuUrlVerificationEvent & { token?: string };
    if (credentials.verificationToken && v1Event.token) {
      if (!verifyEventToken(v1Event.token, credentials.verificationToken)) {
        console.warn("[feishu] URL verification token mismatch");
        return { code: 401, msg: "Token mismatch" };
      }
    }
    return { challenge: payload.challenge };
  }

  // Handle v2 event envelope
  if (isFeishuEventEnvelope(payload)) {
    // Verify token if configured
    if (credentials.verificationToken) {
      if (!verifyEventToken(payload.header.token, credentials.verificationToken)) {
        console.warn("[feishu] Event token mismatch");
        return { code: 401, msg: "Token mismatch" };
      }
    }

    // Handle different event types
    const eventType = payload.header.eventType;

    if (eventType === "im.message.receive_v1") {
      await handleMessageReceiveEvent(payload.event as FeishuMessageReceiveEvent);
    } else {
      console.log(`[feishu] Unhandled event type: ${eventType}`);
    }

    return { code: 0, msg: "ok" };
  }

  console.warn("[feishu] Unknown payload format");
  return { code: 400, msg: "Unknown format" };
}

/**
 * Handle incoming message event.
 */
async function handleMessageReceiveEvent(event: FeishuMessageReceiveEvent): Promise<void> {
  const { sender, message } = event;

  // Skip messages from bots (including self)
  if (sender.senderType === "app") {
    return;
  }

  // Parse message content
  let text = "";
  try {
    const content = JSON.parse(message.content) as { text?: string };
    text = content.text ?? "";
  } catch {
    // Non-text message or parse error
    text = message.content;
  }

  // Build inbound message
  const inbound: FeishuInboundMessage = {
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: sender.senderId.openId,
    senderType: sender.senderType,
    text,
    messageType: message.messageType,
    rootId: message.rootId,
    parentId: message.parentId,
    mentions: message.mentions?.map((m) => ({
      key: m.key,
      id: m.id.openId,
      name: m.name,
    })),
    createTime: message.createTime,
    raw: message,
  };

  // Dispatch to handler
  if (messageHandler) {
    try {
      await messageHandler(inbound);
    } catch (error) {
      console.error("[feishu] Message handler error:", error);
    }
  }
}

/**
 * Create message handler that integrates with OpenClaw auto-reply.
 */
export function createFeishuMessageHandler(cfg: {
  channels?: { feishu?: FeishuConfig };
}): (event: FeishuInboundMessage) => Promise<void> {
  return async (event: FeishuInboundMessage) => {
    const runtime = getFeishuRuntime();

    // Build context for auto-reply
    const context = {
      channel: "feishu" as const,
      accountId: "default",
      peer: {
        kind: event.chatType === "p2p" ? ("dm" as const) : ("group" as const),
        id: event.chatId,
      },
      sender: event.senderId,
      messageId: event.messageId,
      text: event.text,
      replyToId: event.parentId,
      mentions: event.mentions,
      timestamp: Number(event.createTime),
    };

    // Check DM policy and allowlists
    const feishuConfig = cfg.channels?.feishu;
    const dmPolicy = feishuConfig?.dmPolicy ?? "pairing";
    const allowFrom = feishuConfig?.allowFrom ?? [];
    const groupPolicy = feishuConfig?.groupPolicy ?? "allowlist";
    const groupAllowFrom = feishuConfig?.groupAllowFrom ?? [];

    // Apply DM policy
    if (context.peer.kind === "dm") {
      if (dmPolicy === "allow") {
        // Allow all DMs
      } else if (dmPolicy === "open") {
        // Allow all DMs
      } else {
        // Pairing mode - check allowlist
        if (!allowFrom.includes(event.senderId)) {
          console.log(`[feishu] DM from ${event.senderId} not in allowlist (dmPolicy=${dmPolicy})`);
          // Could trigger pairing flow here
          return;
        }
      }
    }

    // Apply group policy
    if (context.peer.kind === "group") {
      if (groupPolicy === "disabled") {
        console.log("[feishu] Group messages disabled");
        return;
      }
      if (groupPolicy === "allowlist") {
        const combined = [...allowFrom, ...groupAllowFrom];
        if (!combined.includes(event.senderId)) {
          console.log(`[feishu] Group message from ${event.senderId} not in allowlist`);
          return;
        }
      }
      // Check mention requirement
      const requireMention = feishuConfig?.requireMention ?? true;
      if (requireMention && (!event.mentions || event.mentions.length === 0)) {
        // No mention, skip (could check if bot is mentioned specifically)
        return;
      }
    }

    // Route to auto-reply via runtime
    try {
      await runtime.channel.feishu?.handleInboundMessage?.(context);
    } catch (error) {
      console.error("[feishu] Failed to route message:", error);
    }
  };
}
