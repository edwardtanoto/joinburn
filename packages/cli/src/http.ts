export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RequestJsonOptions = {
  attempts?: number;
  timeoutMs?: number;
  fetcher?: FetchLike;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

export class CollectorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
  }
}

function responseErrorMessage(json: any, status: number): string {
  const message = typeof json?.error?.message === "string" ? json.error.message : `HTTP ${status}`;
  const issues = Array.isArray(json?.error?.issues)
    ? json.error.issues
        .slice(0, 3)
        .map((issue: any) => {
          if (typeof issue?.message !== "string") return null;
          return typeof issue.path === "string" && issue.path ? `${issue.path}: ${issue.message}` : issue.message;
        })
        .filter((issue: string | null): issue is string => Boolean(issue))
    : [];
  return issues.length ? `${message} ${issues.join("; ")}` : message;
}

function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - now), 30_000) : null;
}

function retryable(error: unknown): boolean {
  if (!(error instanceof CollectorHttpError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function postJson<T>(
  base: string,
  route: string,
  body: unknown,
  token?: string,
  options: RequestJsonOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 1);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 20_000);
  const fetcher: FetchLike = options.fetcher ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`${base}${route}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        throw new CollectorHttpError(
          responseErrorMessage(json, response.status),
          response.status,
          retryAfterMilliseconds(response.headers.get("retry-after")),
        );
      }
      return json as T;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !retryable(error)) throw error;
      const retryAfter = error instanceof CollectorHttpError ? error.retryAfterMs : null;
      const backoff = Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(random() * 250);
      await sleep(retryAfter ?? backoff);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
