import type {
  FeishuApiResponse,
  FeishuChat,
  FeishuCredentials,
  FeishuMessageType,
  FeishuSendMessageResponse,
  FeishuUser,
} from "./types.js";
import { getTenantAccessToken } from "./auth.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  params?: Record<string, string>;
};

/**
 * Make an authenticated request to Feishu API.
 */
async function feishuRequest<T>(
  credentials: FeishuCredentials,
  endpoint: string,
  options: RequestOptions = {},
): Promise<FeishuApiResponse<T>> {
  const token = await getTenantAccessToken(credentials);

  let url = `${FEISHU_API_BASE}${endpoint}`;
  if (options.params) {
    const searchParams = new URLSearchParams(options.params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Feishu API request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as FeishuApiResponse<T>;
}

// ============================================
// Message APIs
// ============================================

export type SendMessageParams = {
  credentials: FeishuCredentials;
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  receiveId: string;
  msgType: FeishuMessageType;
  content: string; // JSON string
  uuid?: string;
};

/**
 * Send a message to a user or chat.
 */
export async function sendMessage(
  params: SendMessageParams,
): Promise<FeishuSendMessageResponse> {
  const { credentials, receiveIdType, receiveId, msgType, content, uuid } = params;

  const response = await feishuRequest<FeishuSendMessageResponse["data"]>(
    credentials,
    "/im/v1/messages",
    {
      method: "POST",
      params: { receive_id_type: receiveIdType },
      body: {
        receive_id: receiveId,
        msg_type: msgType,
        content,
        uuid,
      },
    },
  );

  return {
    code: response.code,
    msg: response.msg,
    data: response.data,
  };
}

export type ReplyMessageParams = {
  credentials: FeishuCredentials;
  messageId: string;
  msgType: FeishuMessageType;
  content: string;
  uuid?: string;
};

/**
 * Reply to a specific message.
 */
export async function replyMessage(
  params: ReplyMessageParams,
): Promise<FeishuSendMessageResponse> {
  const { credentials, messageId, msgType, content, uuid } = params;

  const response = await feishuRequest<FeishuSendMessageResponse["data"]>(
    credentials,
    `/im/v1/messages/${messageId}/reply`,
    {
      method: "POST",
      body: {
        msg_type: msgType,
        content,
        uuid,
      },
    },
  );

  return {
    code: response.code,
    msg: response.msg,
    data: response.data,
  };
}

/**
 * Get message details by message ID.
 */
export async function getMessage(
  credentials: FeishuCredentials,
  messageId: string,
): Promise<FeishuApiResponse<{ items: Array<{ message_id: string; body: { content: string } }> }>> {
  return feishuRequest(credentials, `/im/v1/messages/${messageId}`, {
    method: "GET",
  });
}

// ============================================
// Chat APIs
// ============================================

/**
 * Get chat information by chat ID.
 */
export async function getChat(
  credentials: FeishuCredentials,
  chatId: string,
): Promise<FeishuApiResponse<FeishuChat>> {
  return feishuRequest(credentials, `/im/v1/chats/${chatId}`, {
    method: "GET",
  });
}

/**
 * List members of a chat.
 */
export async function getChatMembers(
  credentials: FeishuCredentials,
  chatId: string,
  pageToken?: string,
  pageSize = 100,
): Promise<
  FeishuApiResponse<{
    items: Array<{ member_id: string; member_id_type: string; name?: string }>;
    page_token?: string;
    has_more: boolean;
  }>
> {
  return feishuRequest(credentials, `/im/v1/chats/${chatId}/members`, {
    method: "GET",
    params: {
      page_size: String(pageSize),
      ...(pageToken ? { page_token: pageToken } : {}),
    },
  });
}

// ============================================
// User APIs
// ============================================

/**
 * Get user information by user ID.
 */
export async function getUser(
  credentials: FeishuCredentials,
  userId: string,
  userIdType: "open_id" | "user_id" | "union_id" = "open_id",
): Promise<FeishuApiResponse<{ user: FeishuUser }>> {
  return feishuRequest(credentials, `/contact/v3/users/${userId}`, {
    method: "GET",
    params: { user_id_type: userIdType },
  });
}

/**
 * Get bot info (self).
 */
export async function getBotInfo(
  credentials: FeishuCredentials,
): Promise<FeishuApiResponse<{ bot: { app_name: string; open_id: string } }>> {
  return feishuRequest(credentials, "/bot/v3/info", {
    method: "GET",
  });
}

// ============================================
// Media APIs
// ============================================

/**
 * Upload an image and get image key.
 */
export async function uploadImage(
  credentials: FeishuCredentials,
  imageBuffer: Buffer,
  imageType: "message" | "avatar" = "message",
): Promise<FeishuApiResponse<{ image_key: string }>> {
  const token = await getTenantAccessToken(credentials);

  const formData = new FormData();
  formData.append("image_type", imageType);
  formData.append("image", new Blob([imageBuffer]), "image.png");

  const response = await fetch(`${FEISHU_API_BASE}/im/v1/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload image: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as FeishuApiResponse<{ image_key: string }>;
}

/**
 * Download an image by image key.
 */
export async function downloadImage(
  credentials: FeishuCredentials,
  imageKey: string,
): Promise<Buffer> {
  const token = await getTenantAccessToken(credentials);

  const response = await fetch(`${FEISHU_API_BASE}/im/v1/images/${imageKey}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ============================================
// File APIs
// ============================================

/**
 * Upload a file and get file key.
 */
export async function uploadFile(
  credentials: FeishuCredentials,
  fileBuffer: Buffer,
  fileName: string,
  fileType: "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream",
): Promise<FeishuApiResponse<{ file_key: string }>> {
  const token = await getTenantAccessToken(credentials);

  const formData = new FormData();
  formData.append("file_type", fileType);
  formData.append("file_name", fileName);
  formData.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(`${FEISHU_API_BASE}/im/v1/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as FeishuApiResponse<{ file_key: string }>;
}

// ============================================
// Helpers
// ============================================

/**
 * Build text message content JSON.
 */
export function buildTextContent(text: string): string {
  return JSON.stringify({ text });
}

/**
 * Build image message content JSON.
 */
export function buildImageContent(imageKey: string): string {
  return JSON.stringify({ image_key: imageKey });
}

/**
 * Build interactive card content JSON.
 */
export function buildCardContent(card: {
  config?: { wide_screen_mode?: boolean };
  header?: { title: { tag: string; content: string }; template?: string };
  elements: unknown[];
}): string {
  return JSON.stringify(card);
}
