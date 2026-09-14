type JsonRow = Record<string, any>;

export class BasecampError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "basecamp_error") {
    super(message);
    this.name = "BasecampError";
    this.status = status;
    this.code = code;
  }
}

export function assertBasecampApiUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new BasecampError(500, "Basecamp configuration is invalid."); }
  if (url.protocol !== "https:" || !/(^|\.)basecampapi\.com$/i.test(url.hostname)) {
    throw new BasecampError(500, "Basecamp configuration is invalid.");
  }
  return url;
}

function retryAfterMs(response: Response) {
  const seconds = Number(response.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 30_000) : 1_000;
}

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function basecampRequest(urlValue: string, options: JsonRow) {
  const url = assertBasecampApiUrl(urlValue);
  const method = String(options.method || "GET").toUpperCase();
  const safeToRetry = method === "GET" || method === "HEAD";
  const sleep = options.sleep || defaultSleep;
  const fetchImpl = options.fetchImpl || fetch;
  let accessToken = String(options.accessToken || "");
  let refreshed = false;
  let transientAttempts = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": options.userAgent,
          ...(options.body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
          ...(options.headers || {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch {
      throw new BasecampError(502, "Basecamp could not be reached.", "network_failure");
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && !refreshed && options.refreshAccessToken) {
      try { accessToken = await options.refreshAccessToken(); }
      catch { throw new BasecampError(503, "Basecamp authorization could not be refreshed.", "refresh_failed"); }
      refreshed = true;
      continue;
    }

    if (safeToRetry && transientAttempts < 2 && (response.status === 429 || response.status >= 500)) {
      const delay = response.status === 429 ? retryAfterMs(response) : 500 * (2 ** transientAttempts);
      transientAttempts += 1;
      await sleep(delay);
      continue;
    }
    if (!response.ok) {
      const status = response.status === 404 ? 404 : response.status === 429 ? 503 : response.status >= 500 ? 502 : 409;
      throw new BasecampError(status, "Basecamp rejected the requested operation.", `http_${response.status}`);
    }
    return response;
  }
}

export function nextLink(header: string | null) {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (match) return assertBasecampApiUrl(match[1]).toString();
  }
  return null;
}

export async function collectBasecampPages(firstUrl: string, loadPage: (url: string) => Promise<JsonRow>) {
  const origin = assertBasecampApiUrl(firstUrl).origin;
  const rows: JsonRow[] = [];
  const seen = new Set<string>();
  let url: string | null = firstUrl;
  while (url) {
    const parsed = assertBasecampApiUrl(url);
    if (parsed.origin !== origin || seen.has(parsed.toString())) {
      throw new BasecampError(502, "Basecamp pagination was invalid.");
    }
    seen.add(parsed.toString());
    const page = await loadPage(parsed.toString());
    if (!Array.isArray(page.body)) throw new BasecampError(502, "Basecamp returned an invalid collection.");
    rows.push(...page.body);
    url = page.next || null;
  }
  return rows;
}

export function enabledTodoset(project: JsonRow) {
  const tool = Array.isArray(project?.dock)
    ? project.dock.find((item: JsonRow) => item?.name === "todoset" && item?.enabled === true && item?.id)
    : null;
  if (!tool) throw new BasecampError(409, "The configured Basecamp project does not have To-dos enabled.");
  return String(tool.id);
}
