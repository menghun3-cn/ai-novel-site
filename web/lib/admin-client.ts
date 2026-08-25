// 管理后台浏览器端 API 客户端:令牌存取 + 统一错误
// 会话令牌保存在 localStorage(x-admin-token 头携带);401 时自动清除并要求重新登录
// 403 PASSWORD_CHANGE_REQUIRED(首登待改密)不清令牌——改密页仍需它

const TOKEN_KEY = 'novel:admin-token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 统一请求:x-admin-token 鉴权、JSON 编解码、错误归一为 ApiError */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['x-admin-token'] = token;
  if (init?.body !== undefined && !(init.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  if (res.status === 401) {
    clearToken();
    throw new ApiError(res.status, 'UNAUTHORIZED', '登录已失效,请重新登录');
  }
  if (!res.ok) {
    let code = 'ERROR';
    let message = `请求失败(HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string | null };
      if (body.error) code = body.error;
      if (body.message) message = body.message;
    } catch {
      /* 非 JSON 响应保持默认文案 */
    }
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}
