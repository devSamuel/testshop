export interface FieldError {
  field: string;
  message: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
  [extension: string]: unknown;
}

export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: QueryParams;
  json?: unknown;
  formData?: FormData;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

const NETWORK_ERROR_MESSAGE = "Could not reach the server. Check your connection and try again.";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "number"
  );
}

export function problemSlug(type: string): string {
  const segments = type.split("/").filter(Boolean);
  return segments.at(-1) ?? type;
}

function cleanValidationMessage(message: string): string {
  return message.replace(/^Value error,\s*/, "");
}

export function toFieldErrors(errors: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!Array.isArray(errors)) return result;
  for (const entry of errors as unknown[]) {
    if (!isRecord(entry)) continue;
    const { field, message } = entry;
    if (typeof field !== "string" || typeof message !== "string") continue;
    result[field] ??= cleanValidationMessage(message);
  }
  return result;
}

function defaultMessage(status: number): string {
  if (status >= 500) return `The server had a problem handling the request (HTTP ${status}).`;
  if (status === 404) return "The requested resource was not found.";
  return `The request failed (HTTP ${status}).`;
}

function problemMessage(problem: ProblemDetails | null, status: number): string {
  if (problem?.detail) return problem.detail;
  if (problem?.title) return problem.title;
  return defaultMessage(status);
}

export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly status: number;
  readonly problem: ProblemDetails | null;
  readonly body: unknown;
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(
    status: number,
    message: string,
    problem: ProblemDetails | null = null,
    body?: unknown,
  ) {
    super(message);
    this.status = status;
    this.problem = problem;
    this.body = body ?? problem;
    this.fieldErrors = toFieldErrors(problem?.errors);
  }

  get problemType(): string | null {
    return this.problem ? problemSlug(this.problem.type) : null;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }

  is(slug: string): boolean {
    return this.problemType === slug;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function parseErrorResponse(response: Response): Promise<ApiError> {
  const body = await readBody(response).catch(() => null);
  const problem = isProblemDetails(body) ? body : null;
  return new ApiError(response.status, problemMessage(problem, response.status), problem, body);
}

export function buildUrl(path: string, query?: QueryParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers({
    Accept: "application/json, application/problem+json",
    ...options.headers,
  });
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  } else if (options.formData) {
    body = options.formData;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) throw await parseErrorResponse(response);

  if (response.status === 204) {
    return { data: undefined as T, status: response.status, headers: response.headers };
  }

  const data = await readBody(response);
  if (typeof data === "string") {
    throw new ApiError(response.status, "The server returned an unexpected response.", null, data);
  }
  return { data: data as T, status: response.status, headers: response.headers };
}

export async function apiFetch<T>(path: string, options?: RequestOptions): Promise<T> {
  const response = await apiRequest<T>(path, options);
  return response.data;
}
