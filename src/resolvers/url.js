import { createHash } from "node:crypto";

const TIMEOUT_MS = 30_000;

/**
 * Markers are tried strongest first. A strong ETag is the server telling us the
 * representation changed; Last-Modified is weaker but still an assertion by the
 * server; hashing the body is the fallback that always works but is the most
 * likely to be noisy, because anything dynamic in the page moves the hash.
 *
 * Weak ETags (W/"…") are deliberately skipped — they promise semantic rather
 * than byte equivalence, so two different documents can share one.
 */
export function createUrlResolver({ fetchImpl = fetch } = {}) {
  return {
    async resolve(upstream) {
      const url = upstream.uri;

      const head = await request(fetchImpl, url, "HEAD");
      if (head) {
        const marker = validatorFrom(head);
        if (marker) return marker;
      }

      const res = await request(fetchImpl, url, "GET");
      if (!res) throw new Error(`could not fetch ${url}`);
      if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);

      const marker = validatorFrom(res);
      if (marker) return marker;

      const body = await res.text();
      return `sha256:${createHash("sha256").update(body).digest("hex")}`;
    },
  };
}

function validatorFrom(res) {
  if (!res.ok) return null;
  const etag = res.headers.get("etag");
  if (etag && !etag.startsWith("W/")) return `etag:${etag.replaceAll('"', "")}`;
  const modified = res.headers.get("last-modified");
  if (modified) return `modified:${new Date(modified).toISOString()}`;
  return null;
}

async function request(fetchImpl, url, method) {
  try {
    return await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // A server that rejects HEAD outright should fall through to GET rather
    // than fail the whole run.
    return null;
  }
}
