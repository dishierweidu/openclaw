import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk";
import type { ResolvedFeishuAccount } from "./types.js";
import { resolveFeishuCredentials } from "./auth.js";
import { getBotInfo } from "./api.js";
import { sendFeishuMessage } from "./send.js";
import {
  createFeishuMessageHandler,
  startFeishuMonitor,
  stopFeishuMonitor,
} from "./monitor.js";

const meta = {
  id: "feishu",
  label: "Feishu",
  selectionLabel: "Feishu (Lark)",
  docsPath: "/channels/feishu",
  docsLabel: "feishu",
  blurb: "Feishu/Lark Bot API; enterprise messaging.",
  aliases: ["lark"],
  order: 65,
} as const;

export const feishuPlugin: ChannelPlugin<ResolvedFeishuAccount> = {
  id: "feishu",
  meta: {
    ...meta,
  },

  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    threads: true,
    reactions: false,
    edit: false,
    unsend: false,
  },

  agentPrompt: {
    messageToolHints: () => [
      "- Feishu supports text, image, and interactive card messages.",
      "- Targeting: omit `target` to reply to current conversation. Explicit targets: `user:ou_xxx` for DMs, `chat:oc_xxx` for groups.",
      "- Interactive cards supported via `card={...}` parameter.",
    ],
  },

  reload: { configPrefixes: ["channels.feishu"] },

  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],

    resolveAccount: (cfg): ResolvedFeishuAccount => {
      const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
      return {
        accountId: DEFAULT_ACCOUNT_ID,
        appId: credentials?.appId ?? "",
        enabled: cfg.channels?.feishu?.enabled !== false,
        configured: Boolean(credentials),
        credentials: credentials ?? undefined,
      };
    },

    defaultAccountId: () => DEFAULT_ACCOUNT_ID,

    setAccountEnabled: ({ cfg, enabled }): OpenClawConfig => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled,
        },
      },
    }),

    deleteAccount: ({ cfg }): OpenClawConfig => {
      const next = { ...cfg };
      const nextChannels = { ...cfg.channels };
      delete nextChannels.feishu;
      if (Object.keys(nextChannels).length > 0) {
        next.channels = nextChannels;
      } else {
        delete next.channels;
      }
      return next;
    },

    isConfigured: (_account, cfg): boolean => Boolean(resolveFeishuCredentials(cfg.channels?.feishu)),

    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.appId ? `App: ${account.appId}` : undefined,
    }),

    resolveAllowFrom: ({ cfg }) => cfg.channels?.feishu?.allowFrom ?? [],

    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },

  security: {
    resolveDmPolicy: ({ cfg }) => ({
      policy: cfg.channels?.feishu?.dmPolicy ?? "pairing",
      allowFrom: cfg.channels?.feishu?.allowFrom ?? [],
      policyPath: "channels.feishu.",
      normalizeEntry: (raw: string) => raw.replace(/^(feishu|user):/i, "").trim().toLowerCase(),
    }),

    collectWarnings: ({ cfg }) => {
      const groupPolicy = cfg.channels?.feishu?.groupPolicy ?? "allowlist";
      if (groupPolicy !== "open") {
        return [];
      }
      return [
        `- Feishu groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.feishu.groupPolicy="allowlist" + channels.feishu.groupAllowFrom to restrict senders.`,
      ];
    },
  },

  pairing: {
    idLabel: "feishuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(feishu|user):/i, "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      await sendFeishuMessage({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },

  threading: {
    buildToolContext: ({ context, hasRepliedRef }) => ({
      currentChatId: context.To?.trim() || undefined,
      currentMessageId: context.ReplyToId,
      hasRepliedRef,
    }),
  },

  groups: {
    resolveToolPolicy: ({ cfg, groupId }) => {
      const groups = cfg.channels?.feishu?.groups;
      const groupConfig = groupId ? groups?.[groupId] : undefined;
      return {
        tools: groupConfig?.tools ?? cfg.channels?.feishu?.groups?.["*"]?.tools,
        toolsBySender: groupConfig?.toolsBySender,
      };
    },
    resolveMentionGating: ({ cfg, groupId }) => {
      const groups = cfg.channels?.feishu?.groups;
      const groupConfig = groupId ? groups?.[groupId] : undefined;
      return {
        requireMention: groupConfig?.requireMention ?? cfg.channels?.feishu?.requireMention ?? true,
      };
    },
  },

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg }): OpenClawConfig => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: {
          ...cfg.channels?.feishu,
          enabled: true,
        },
      },
    }),
  },

  messaging: {
    normalizeTarget: ({ target }) => {
      const trimmed = target.trim();
      // Handle various target formats
      if (trimmed.startsWith("chat:") || trimmed.startsWith("user:")) {
        return { ok: true, to: trimmed };
      }
      if (trimmed.startsWith("oc_")) {
        return { ok: true, to: `chat:${trimmed}` };
      }
      if (trimmed.startsWith("ou_")) {
        return { ok: true, to: `user:${trimmed}` };
      }
      return { ok: true, to: trimmed };
    },
  },

  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,

    sendText: async ({ cfg, to, text, replyToId }) => {
      const result = await sendFeishuMessage({
        cfg,
        to,
        text,
        replyToMessageId: replyToId,
      });

      if (!result.ok) {
        return { ok: false, error: result.error ?? "Unknown error" };
      }

      return {
        ok: true,
        messageId: result.messageId,
      };
    },
  },

  status: {
    probeAccount: async ({ cfg }) => {
      const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
      if (!credentials) {
        return { ok: false, error: "No credentials configured" };
      }

      try {
        const botInfo = await getBotInfo(credentials);
        if (botInfo.code !== 0) {
          return { ok: false, error: `API error: ${botInfo.code} ${botInfo.msg}` };
        }
        return {
          ok: true,
          botName: botInfo.data?.bot.app_name,
          botId: botInfo.data?.bot.open_id,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    },

    buildAccountSnapshot: async ({ cfg, account }) => {
      const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
      let connected = false;
      let botName: string | undefined;
      let lastError: string | undefined;

      if (credentials) {
        try {
          const botInfo = await getBotInfo(credentials);
          if (botInfo.code === 0) {
            connected = true;
            botName = botInfo.data?.bot.app_name;
          } else {
            lastError = `API error: ${botInfo.code} ${botInfo.msg}`;
          }
        } catch (error) {
          lastError = String(error);
        }
      }

      return {
        accountId: account.accountId,
        name: botName,
        enabled: account.enabled,
        configured: account.configured,
        connected,
        lastError,
      };
    },
  },

  gateway: {
    startAccount: async ({ cfg }) => {
      const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
      if (!credentials) {
        console.warn("[feishu] No credentials configured, skipping monitor start");
        return;
      }

      const webhookConfig = cfg.channels?.feishu?.webhook;
      const port = webhookConfig?.port ?? 3979;
      const path = webhookConfig?.path ?? "/feishu/events";

      await startFeishuMonitor({
        port,
        path,
        credentials,
        onMessage: createFeishuMessageHandler(cfg),
      });
    },

    stopAccount: async () => {
      await stopFeishuMonitor();
    },
  },
};
