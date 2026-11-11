import { getCloudflareContext } from "@opennextjs/cloudflare";

// Bindings are resolved per request. Never cache env/bindings in module scope.

export type SecretName =
  | "OPENROUTER_API_KEY"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "AUTH_SECRET";

/** Sync form: works in route handlers, server components and server actions. */
export function getEnv(): CloudflareEnv {
  return getCloudflareContext().env;
}

/** Async form: use from static/ISR contexts (e.g. generateStaticParams, build time). */
export async function getEnvAsync(): Promise<CloudflareEnv> {
  return (await getCloudflareContext({ async: true })).env;
}

/** Execution context, e.g. for `getCtx().waitUntil(promise)`. */
export function getCtx(): ExecutionContext {
  return getCloudflareContext().ctx;
}

export function getDb(): D1Database {
  return getEnv().DB;
}

export function getBucket(): R2Bucket {
  return getEnv().PAPERS_BUCKET;
}

export function getVectors(): VectorizeIndex {
  return getEnv().PAPER_VECTORS;
}

export function getAI(): Ai {
  return getEnv().AI;
}

/** Reads a secret from the Worker env, falling back to process.env. Throws if missing. */
export function getSecret(name: SecretName): string {
  const value = getOptionalSecret(name);

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

export function getOptionalSecret(name: SecretName): string | undefined {
  let value: unknown;

  try {
    value = (getEnv() as unknown as Record<string, unknown>)[name];
  } catch {
    value = undefined;
  }

  if (typeof value === "string" && value !== "") {
    return value;
  }

  return process.env[name] || undefined;
}

// D1 helpers ----------------------------------------------------------------

/** Current time as ISO-8601 UTC string (matches the schema's default format). */
export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function jsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === "") {
    return fallback;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** D1 stores booleans as 0/1. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

/**
 * Subquery that expands a single JSON-array parameter into rows, avoiding
 * D1's bound-parameter limit for large IN lists:
 *   `WHERE id IN ${IN_JSON}` bound with `jsonList(ids)`.
 */
export const IN_JSON = "(SELECT value FROM json_each(?))";

export function jsonList(values: readonly (string | number)[]): string {
  return JSON.stringify(values);
}

/**
 * Runs a query whose FIRST `?` placeholder is a JSON-array list, typically
 * written as `... IN (SELECT value FROM json_each(?)) ...` (see IN_JSON).
 * Remaining placeholders are bound from `binds` in order.
 * Returns [] without querying when `values` is empty.
 */
export async function queryIn<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  values: readonly (string | number)[],
  binds: unknown[] = [],
): Promise<T[]> {
  if (values.length === 0) {
    return [];
  }

  const { results } = await db
    .prepare(sql)
    .bind(jsonList(values), ...binds)
    .all<T>();

  return results;
}
