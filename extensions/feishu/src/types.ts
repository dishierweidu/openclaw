/**
 * Feishu (Lark) API types
 * Based on Feishu Open Platform API: https://open.feishu.cn/document
 */

// Authentication
export type FeishuCredentials = {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
};

export type FeishuTenantToken = {
  tenantAccessToken: string;
  expiresAt: number; // Unix timestamp in ms
};

// User identity
export type FeishuUserId = {
  unionId?: string;
  userId?: string;
  openId: string;
};

export type FeishuSender = {
  senderId: FeishuUserId;
  senderType: "user" | "app";
  tenantKey?: string;
};

// Message types
export type FeishuMessageType =
  | "text"
  | "post"
  | "image"
  | "file"
  | "audio"
  | "media"
  | "sticker"
  | "interactive"
  | "share_chat"
  | "share_user";

export type FeishuChatType = "p2p" | "group";

export type FeishuMessage = {
  messageId: string;
  rootId?: string;
  parentId?: string;
  createTime: string;
  updateTime?: string;
  chatId: string;
  chatType: FeishuChatType;
  messageType: FeishuMessageType;
  content: string; // JSON string
  sender: FeishuSender;
  mentions?: FeishuMention[];
};

export type FeishuMention = {
  key: string;
  id: FeishuUserId;
  name: string;
  tenantKey?: string;
};

// Event types
export type FeishuEventHeader = {
  eventId: string;
  eventType: string;
  createTime: string;
  token: string;
  appId: string;
  tenantKey: string;
};

export type FeishuEventEnvelope = {
  schema: string;
  header: FeishuEventHeader;
  event: FeishuMessageReceiveEvent | FeishuUrlVerificationEvent;
};

export type FeishuMessageReceiveEvent = {
  sender: FeishuSender;
  message: FeishuMessage;
};

export type FeishuUrlVerificationEvent = {
  type: "url_verification";
  challenge: string;
  token: string;
};

// Send message types
export type FeishuSendMessageRequest = {
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  receiveId: string;
  msgType: FeishuMessageType;
  content: string; // JSON string
  uuid?: string;
};

export type FeishuSendMessageResponse = {
  code: number;
  msg: string;
  data?: {
    messageId: string;
    rootId?: string;
    parentId?: string;
    createTime: string;
    updateTime?: string;
    chatId: string;
    msgType: FeishuMessageType;
    body: {
      content: string;
    };
  };
};

// Reply message types
export type FeishuReplyMessageRequest = {
  content: string;
  msgType: FeishuMessageType;
  uuid?: string;
};

// Text content
export type FeishuTextContent = {
  text: string;
};

// Post (rich text) content
export type FeishuPostContent = {
  zhCn?: FeishuPostBody;
  enUs?: FeishuPostBody;
};

export type FeishuPostBody = {
  title?: string;
  content: FeishuPostElement[][];
};

export type FeishuPostElement =
  | { tag: "text"; text: string; unEscape?: boolean }
  | { tag: "a"; text: string; href: string }
  | { tag: "at"; userId: string; userName?: string }
  | { tag: "img"; imageKey: string; width?: number; height?: number }
  | { tag: "media"; fileKey: string; imageKey?: string }
  | { tag: "emotion"; emojiType: string };

// Interactive card content
export type FeishuInteractiveContent = {
  config?: {
    wideScreenMode?: boolean;
    enableForward?: boolean;
  };
  header?: {
    title: {
      tag: "plain_text" | "lark_md";
      content: string;
    };
    template?: string;
  };
  elements: FeishuCardElement[];
};

export type FeishuCardElement =
  | { tag: "div"; text?: { tag: string; content: string }; fields?: Array<{ isShort: boolean; text: { tag: string; content: string } }> }
  | { tag: "hr" }
  | { tag: "markdown"; content: string }
  | { tag: "action"; actions: FeishuCardAction[] }
  | { tag: "note"; elements: Array<{ tag: string; content?: string; imgKey?: string }> };

export type FeishuCardAction = {
  tag: "button";
  text: { tag: string; content: string };
  type?: "default" | "primary" | "danger";
  url?: string;
  value?: Record<string, unknown>;
};

// API response wrapper
export type FeishuApiResponse<T> = {
  code: number;
  msg: string;
  data?: T;
};

// Chat info
export type FeishuChat = {
  chatId: string;
  avatar?: string;
  name: string;
  description?: string;
  ownerId?: string;
  ownerIdType?: string;
  chatType: "group" | "topic_group" | "p2p";
  chatMode: "group" | "thread" | "topic";
  chatTag?: string;
  external: boolean;
  tenantKey: string;
};

// User info
export type FeishuUser = {
  userId?: string;
  openId: string;
  unionId?: string;
  name: string;
  enName?: string;
  nickname?: string;
  email?: string;
  mobile?: string;
  avatar?: {
    avatar72: string;
    avatar240: string;
    avatar640: string;
    avatarOrigin: string;
  };
};

// Resolved account for plugin
export type ResolvedFeishuAccount = {
  accountId: string;
  appId: string;
  enabled: boolean;
  configured: boolean;
  credentials?: FeishuCredentials;
};
