const MAX_RETRY_AFTER_SECONDS = 60;

export const sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export class TelegramError extends Error {
  constructor(method, body) {
    super(`${method}: ${body.error_code} ${body.description}`);
    this.code = body.error_code;
    this.retryAfter = body.parameters?.retry_after;
  }
}

export const isFatal = (error) => error instanceof TelegramError && (error.code === 401 || error.code === 404);

export const isTransient = (error) => !(error instanceof TelegramError) || error.code === 429 || error.code >= 500;

export function describeError(error) {
  if (error instanceof TelegramError) return error.message;
  const cause = error.cause?.code ?? error.cause?.message;
  return cause ? `${error.message} (${cause})` : (error.stack ?? error.message);
}

export function createTelegram({ token, apiRoot = "https://api.telegram.org", retryDelayMs = 1000 }) {
  const base = `${apiRoot.replace(/\/+$/, "")}/bot${token}`;

  const request = async (method, params, { timeoutMs, signal }) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    });
    const body = await response.json();
    if (!body.ok) throw new TelegramError(method, body);
    return body.result;
  };

  const call = async (method, params = {}, { attempts = 4, timeoutMs = 15000, signal } = {}) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await request(method, params, { timeoutMs, signal });
      } catch (error) {
        const waitsTooLong = error.retryAfter > MAX_RETRY_AFTER_SECONDS;
        if (attempt >= attempts || !isTransient(error) || waitsTooLong || signal?.aborted) throw error;
        await sleep(error.retryAfter ? error.retryAfter * 1000 : retryDelayMs * 2 ** (attempt - 1));
      }
    }
  };

  return { call };
}
