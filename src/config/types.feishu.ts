import type {
  BlockStreamingCoalesceConfig,
  DmPolicy,
  GroupPolicy,
  MarkdownConfig,
} from "./types.base.js";
import type { ChannelHeartbeatVisibilityConfig } from "./types.channels.js";
import type { DmConfig } from "./types.messages.js";
import type { GroupToolPolicyBySenderConfig, GroupToolPolicyConfig } from "./types.tools.js";

/** Webhook server configuration for Feishu events. */
export type FeishuWebhookConfig = {
  /** Port for the webhook server. Default: 3979. */
  port?: number;
  /** Path for the events endpoint. Default: /feishu/events. */
  path?: string;
  /** Public URL for webhook registration (required for Feishu callback). */
  publicUrl?: string;
};

/** Reply style for Feishu messages. */
export type FeishuReplyStyle = "reply" | "new";

/** Group-level config for Feishu chats. */
export type FeishuGroupConfig = {
  /** Require @mention to respond in this group. Default: true. */
  requireMention?: boolean;
  /** Optional tool policy overrides for this group. */
  tools?: GroupToolPolicyConfig;
  toolsBySender?: GroupToolPolicyBySenderConfig;
  /** Reply style: "reply" replies to the message, "new" posts a new message. */
  replyStyle?: FeishuReplyStyle;
};

/** Main Feishu channel configuration. */
export type FeishuConfig = {
  /** If false, do not start the Feishu provider. Default: true. */
  enabled?: boolean;
  /** Optional provider capability tags used for agent/runtime guidance. */
  capabilities?: string[];
  /** Markdown formatting overrides. */
  markdown?: MarkdownConfig;
  /** Allow channel-initiated config writes (default: true). */
  configWrites?: boolean;

  // Authentication
  /** Feishu App ID from Feishu Open Platform. */
  appId?: string;
  /** Feishu App Secret from Feishu Open Platform. */
  appSecret?: string;
  /** Event subscription encrypt key (for decrypting event payloads). */
  encryptKey?: string;
  /** Verification token for webhook validation. */
  verificationToken?: string;

  /** Webhook server configuration. */
  webhook?: FeishuWebhookConfig;

  // DM policy
  /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy;
  /** Allowlist for DM senders (Feishu open_id or user_id). */
  allowFrom?: Array<string>;
  /** Optional allowlist for group senders (Feishu open_id or user_id). */
  groupAllowFrom?: Array<string>;
  /**
   * Controls how group messages are handled:
   * - "open": groups bypass allowFrom; mention-gating applies
   * - "disabled": block all group messages
   * - "allowlist": only allow group messages from senders in groupAllowFrom/allowFrom
   */
  groupPolicy?: GroupPolicy;

  // Message handling
  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number;
  /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  /** Merge streamed block replies before sending. */
  blockStreamingCoalesce?: BlockStreamingCoalesceConfig;

  // Group settings
  /** Default: require @mention to respond in groups. */
  requireMention?: boolean;
  /** Max group messages to keep as history context (0 disables). */
  historyLimit?: number;
  /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number;
  /** Per-DM config overrides keyed by user open_id. */
  dms?: Record<string, DmConfig>;
  /** Default reply style: "reply" replies to the message, "new" posts a new message. */
  replyStyle?: FeishuReplyStyle;
  /** Per-group config. Key is chat_id. */
  groups?: Record<string, FeishuGroupConfig>;

  // Media settings
  /** Max media size in MB (default: 20MB). */
  mediaMaxMb?: number;

  /** Heartbeat visibility settings for this channel. */
  heartbeat?: ChannelHeartbeatVisibilityConfig;
};
