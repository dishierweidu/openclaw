import type { FeishuCredentials, FeishuTenantToken } from "./types.js";

const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// In-memory token cache
let cachedToken: FeishuTenantToken | null = null;

/**
 * Resolve Feishu credentials from config or environment variables.
 */
export function resolveFeishuCredentials(config?: {
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
}): FeishuCredentials | null {
  const appId = config?.appId || process.env.FEISHU_APP_ID;
  const appSecret = config?.appSecret || process.env.FEISHU_APP_SECRET;

  if (!appId || !appSecret) {
    return null;
  }

  return {
    appId,
    appSecret,
    encryptKey: config?.encryptKey || process.env.FEISHU_ENCRYPT_KEY,
    verificationToken: config?.verificationToken || process.env.FEISHU_VERIFICATION_TOKEN,
  };
}

/**
 * Get tenant access token from Feishu API.
 * Implements caching with automatic refresh before expiry.
 */
export async function getTenantAccessToken(
  credentials: FeishuCredentials,
): Promise<string> {
  // Check if cached token is still valid
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.tenantAccessToken;
  }

  // Fetch new token
  const response = await fetch(
    `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        app_id: credentials.appId,
        app_secret: credentials.appSecret,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to get tenant access token: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  };

  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Feishu API error: ${data.code} ${data.msg}`);
  }

  // Cache the token (expire is in seconds)
  cachedToken = {
    tenantAccessToken: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
  };

  return cachedToken.tenantAccessToken;
}

/**
 * Clear the cached token (useful for testing or forced refresh).
 */
export function clearTokenCache(): void {
  cachedToken = null;
}

/**
 * Verify webhook event signature.
 * Feishu uses verification token for simple validation.
 */
export function verifyEventToken(token: string, verificationToken: string): boolean {
  return token === verificationToken;
}

/**
 * Decrypt event payload if encrypted.
 * Uses AES-256-CBC with encrypt key.
 */
export async function decryptEventPayload(
  encrypted: string,
  encryptKey: string,
): Promise<string> {
  // Feishu uses AES-256-CBC encryption
  // The encrypt key is used to derive the actual key via SHA256
  const crypto = await import("node:crypto");

  const key = crypto.createHash("sha256").update(encryptKey).digest();
  const encryptedBuffer = Buffer.from(encrypted, "base64");

  // First 16 bytes are IV
  const iv = encryptedBuffer.subarray(0, 16);
  const ciphertext = encryptedBuffer.subarray(16);

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf-8");
}
