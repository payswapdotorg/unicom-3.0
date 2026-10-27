// ============================================================
// Store search - HTTP transport + error taxonomy
// ============================================================
//
// Ported verbatim in law from the live-verified FE3 connector transport
// (my-project connectors/errors.ts): every platform HTTP failure is CLASSIFIED,
// never passed through raw, and every message is honest + actionable. The
// taxonomy refinement for search: a 10s abort is its own `timeout` code (the
// FE3 transport folded it into `unreachable`), everything else maps 1:1.
//
//   401                          -> invalid_credentials
//   403 + scope language         -> insufficient_scope
//   403 otherwise                -> invalid_credentials
//   429                          -> rate_limited (+ Retry-After seconds)
//   other 4xx / 5xx              -> platform_error (platform's verbatim message)
//   DNS / connection refused     -> unreachable
//   10s AbortController timeout  -> timeout

/** Every platform fetch carries a hard 10s abort — a hung connection is an
 * honest `timeout`, never a spinner forever. */
export const FETCH_TIMEOUT_MS = 10_000;

/** The connector error taxonomy (per-store status codes in the tool result). */
export type StoreSearchErrorCode =
  | "invalid_credentials"
  | "insufficient_scope"
  | "rate_limited"
  | "platform_error"
  | "unreachable"
  | "timeout"
  | "not_configured"
  | "not_supported";

/** One honest per-store failure. `retryAfterSeconds` surfaces the platform's
 * own Retry-After on 429 answers. */
export interface StoreSearchError {
  code: StoreSearchErrorCode;
  message: string;
  retryAfterSeconds?: number;
}

/** fetch + AbortController timeout. Re-throws whatever the transport threw;
 * callers classify via classifyFetchThrow. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Map a platform's own error body text (JSON errors field or raw text) to
 * a short honest snippet — never a silent passthrough. Ported from FE3. */
export function bodySnippet(bodyText: string, max = 140): string {
  const trimmed = bodyText.trim();
  if (trimmed.length === 0) return "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const rec = parsed as Record<string, unknown>;
      for (const key of ["errors", "error", "message", "code"]) {
        const v = rec[key];
        if (typeof v === "string" && v.trim().length > 0) {
          return v.trim().slice(0, max);
        }
      }
    }
  } catch {
    // not JSON — fall through to raw text
  }
  return trimmed.slice(0, max);
}

/**
 * Classify a thrown fetch (DNS failure, connection refused, 10s abort) onto
 * the taxonomy. Abort -> `timeout`; everything else -> `unreachable` with the
 * transport's own reason in the message.
 */
export function classifyFetchThrow(platform: string, e: unknown): StoreSearchError {
  if (e instanceof Error && e.name === "AbortError") {
    return {
      code: "timeout",
      message: `${platform} didn't answer within 10 seconds — the connection was aborted. Nothing was searched; retry shortly.`,
    };
  }
  const reason = e instanceof Error ? e.message : String(e);
  return {
    code: "unreachable",
    message: `${platform} was unreachable (${reason.slice(0, 120)}) — check the store domain and the network.`,
  };
}

/**
 * Classify a completed platform HTTP response (non-2xx) onto the taxonomy.
 * Body snippets come from the platform's own error payload, surfaced verbatim.
 */
export function classifyPlatformFetch(
  platform: string,
  status: number,
  headers: Headers,
  bodyText: string,
): StoreSearchError {
  const snippet = bodySnippet(bodyText);
  const suffix = snippet.length > 0 ? ` (platform said: "${snippet}")` : "";

  // —— 401: the credentials are wrong — or, for a public-catalog connector,
  // the storefront simply does not expose its catalog publicly. ——
  if (status === 401) {
    return {
      code: "invalid_credentials",
      message: `${platform} rejected the request (401)${suffix}. For a public catalog connector this usually means the store does not expose its product API publicly — credentials or a different store are needed.`,
    };
  }

  // —— 403: scope language vs plain access denial ——
  if (status === 403) {
    const scopeLanguage = /scope|permission|not authorized/i.test(bodyText);
    if (scopeLanguage) {
      return {
        code: "insufficient_scope",
        message: `${platform} denied the call (403) — the credentials' access scopes don't cover it${suffix}.`,
      };
    }
    return {
      code: "invalid_credentials",
      message: `${platform} denied access (403)${suffix}.`,
    };
  }

  // —— 429: the platform throttled us; surface Retry-After when present ——
  if (status === 429) {
    const retryAfter = headers.get("retry-after");
    const seconds =
      retryAfter !== null &&
      retryAfter.trim().length > 0 &&
      Number.isFinite(Number(retryAfter))
        ? Number(retryAfter)
        : undefined;
    return {
      code: "rate_limited",
      message:
        seconds !== undefined
          ? `${platform} is rate-limiting this connection (429) — Retry-After says ${seconds}s. Retry in ${seconds} seconds.`
          : `${platform} is rate-limiting this connection (429) — wait a moment and try again.`,
      ...(seconds !== undefined ? { retryAfterSeconds: seconds } : {}),
    };
  }

  // —— other 4xx / 5xx: honest platform_error with the platform's own message ——
  return {
    code: "platform_error",
    message: `${platform} answered ${status}${suffix}.`,
  };
}

/** The honest not_configured error for a Tier-2 store without credentials —
 * never a fake search. */
export function notConfiguredError(platform: string): StoreSearchError {
  return {
    code: "not_configured",
    message: `${platform} credentials are not configured for this store — open Settings -> Connected Stores to add them. Nothing was searched.`,
  };
}
