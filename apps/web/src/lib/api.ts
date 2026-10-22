const API_BASE = "http://localhost:3001";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

interface FlattenedError {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

function errorMessage(error: unknown, status: number): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const { formErrors = [], fieldErrors = {} } = error as FlattenedError;
    if (formErrors[0]) return formErrors[0];
    for (const [field, messages] of Object.entries(fieldErrors)) {
      if (messages?.[0]) return `${field}: ${messages[0]}`;
    }
  }
  return `Request failed: ${status}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && token) {
      onUnauthorized?.();
    }
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, errorMessage(body.error, response.status));
  }

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export { ApiError };
