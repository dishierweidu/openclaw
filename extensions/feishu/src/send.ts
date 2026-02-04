import type { FeishuConfig } from "openclaw/plugin-sdk";
import type { FeishuCredentials, FeishuSendMessageResponse } from "./types.js";
import {
  buildCardContent,
  buildImageContent,
  buildTextContent,
  replyMessage,
  sendMessage,
  uploadImage,
} from "./api.js";
import { resolveFeishuCredentials } from "./auth.js";

export type SendFeishuMessageParams = {
  cfg: { channels?: { feishu?: FeishuConfig } };
  to: string;
  text: string;
  replyToMessageId?: string;
};

export type SendFeishuMessageResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Send a text message to a Feishu user or chat.
 */
export async function sendFeishuMessage(
  params: SendFeishuMessageParams,
): Promise<SendFeishuMessageResult> {
  const { cfg, to, text, replyToMessageId } = params;

  const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
  if (!credentials) {
    return { ok: false, error: "Feishu credentials not configured" };
  }

  try {
    let response: FeishuSendMessageResponse;

    if (replyToMessageId) {
      // Reply to a specific message
      response = await replyMessage({
        credentials,
        messageId: replyToMessageId,
        msgType: "text",
        content: buildTextContent(text),
      });
    } else {
      // Determine receiver type from target format
      const { receiveIdType, receiveId } = parseTarget(to);

      response = await sendMessage({
        credentials,
        receiveIdType,
        receiveId,
        msgType: "text",
        content: buildTextContent(text),
      });
    }

    if (response.code !== 0) {
      return { ok: false, error: `Feishu API error: ${response.code} ${response.msg}` };
    }

    return { ok: true, messageId: response.data?.messageId };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export type SendFeishuImageParams = {
  cfg: { channels?: { feishu?: FeishuConfig } };
  to: string;
  imageBuffer: Buffer;
  replyToMessageId?: string;
};

/**
 * Send an image message to a Feishu user or chat.
 */
export async function sendFeishuImage(
  params: SendFeishuImageParams,
): Promise<SendFeishuMessageResult> {
  const { cfg, to, imageBuffer, replyToMessageId } = params;

  const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
  if (!credentials) {
    return { ok: false, error: "Feishu credentials not configured" };
  }

  try {
    // First upload the image
    const uploadResponse = await uploadImage(credentials, imageBuffer);
    if (uploadResponse.code !== 0 || !uploadResponse.data?.image_key) {
      return { ok: false, error: `Failed to upload image: ${uploadResponse.msg}` };
    }

    const imageKey = uploadResponse.data.image_key;

    let response: FeishuSendMessageResponse;

    if (replyToMessageId) {
      response = await replyMessage({
        credentials,
        messageId: replyToMessageId,
        msgType: "image",
        content: buildImageContent(imageKey),
      });
    } else {
      const { receiveIdType, receiveId } = parseTarget(to);

      response = await sendMessage({
        credentials,
        receiveIdType,
        receiveId,
        msgType: "image",
        content: buildImageContent(imageKey),
      });
    }

    if (response.code !== 0) {
      return { ok: false, error: `Feishu API error: ${response.code} ${response.msg}` };
    }

    return { ok: true, messageId: response.data?.messageId };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export type SendFeishuCardParams = {
  cfg: { channels?: { feishu?: FeishuConfig } };
  to: string;
  card: {
    config?: { wide_screen_mode?: boolean };
    header?: { title: { tag: string; content: string }; template?: string };
    elements: unknown[];
  };
  replyToMessageId?: string;
};

/**
 * Send an interactive card to a Feishu user or chat.
 */
export async function sendFeishuCard(
  params: SendFeishuCardParams,
): Promise<SendFeishuMessageResult> {
  const { cfg, to, card, replyToMessageId } = params;

  const credentials = resolveFeishuCredentials(cfg.channels?.feishu);
  if (!credentials) {
    return { ok: false, error: "Feishu credentials not configured" };
  }

  try {
    let response: FeishuSendMessageResponse;

    if (replyToMessageId) {
      response = await replyMessage({
        credentials,
        messageId: replyToMessageId,
        msgType: "interactive",
        content: buildCardContent(card),
      });
    } else {
      const { receiveIdType, receiveId } = parseTarget(to);

      response = await sendMessage({
        credentials,
        receiveIdType,
        receiveId,
        msgType: "interactive",
        content: buildCardContent(card),
      });
    }

    if (response.code !== 0) {
      return { ok: false, error: `Feishu API error: ${response.code} ${response.msg}` };
    }

    return { ok: true, messageId: response.data?.messageId };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/**
 * Parse target string to determine receiver type.
 * Formats:
 * - chat:oc_xxx -> chat_id
 * - user:ou_xxx -> open_id
 * - ou_xxx -> open_id (default for open_id format)
 * - oc_xxx -> chat_id (default for chat_id format)
 */
function parseTarget(
  target: string,
): { receiveIdType: "open_id" | "user_id" | "union_id" | "chat_id"; receiveId: string } {
  const trimmed = target.trim();

  // Explicit prefix format
  if (trimmed.startsWith("chat:")) {
    return { receiveIdType: "chat_id", receiveId: trimmed.slice(5) };
  }
  if (trimmed.startsWith("user:")) {
    return { receiveIdType: "open_id", receiveId: trimmed.slice(5) };
  }
  if (trimmed.startsWith("union:")) {
    return { receiveIdType: "union_id", receiveId: trimmed.slice(6) };
  }

  // Infer from ID prefix
  if (trimmed.startsWith("oc_")) {
    return { receiveIdType: "chat_id", receiveId: trimmed };
  }
  if (trimmed.startsWith("ou_")) {
    return { receiveIdType: "open_id", receiveId: trimmed };
  }
  if (trimmed.startsWith("on_")) {
    return { receiveIdType: "union_id", receiveId: trimmed };
  }

  // Default to open_id
  return { receiveIdType: "open_id", receiveId: trimmed };
}

/**
 * Helper to get credentials from config.
 */
export function getFeishuCredentials(
  cfg: { channels?: { feishu?: FeishuConfig } },
): FeishuCredentials | null {
  return resolveFeishuCredentials(cfg.channels?.feishu);
}
