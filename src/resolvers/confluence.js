import { UserError } from "../manifest.js";

const TIMEOUT_MS = 30_000;

/**
 * A Confluence page carries its own version counter, which is a far better
 * marker than anything derived from the rendered body: it moves on exactly the
 * edits a human would call a change, and not on re-renders.
 *
 * Which variables the credentials arrive in is configurable, because a pipeline
 * that already exposes them under its own names should not have to rename its
 * secrets to suit this tool. Names rather than values: a token passed as an
 * argument would be visible in the process list and in shell history.
 */
export function createConfluenceResolver({
  fetchImpl = fetch,
  env = process.env,
  emailVar = "CONFLUENCE_EMAIL",
  tokenVar = "CONFLUENCE_API_TOKEN",
} = {}) {
  return {
    async resolve(upstream) {
      const { origin, pageId } = parsePageUrl(upstream.uri);
      const email = env[emailVar];
      const token = env[tokenVar];
      if (!email || !token) {
        throw new UserError(
          `Confluence sources need ${emailVar} and ${tokenVar} to be set`,
        );
      }

      const auth = Buffer.from(`${email}:${token}`).toString("base64");
      const res = await fetchImpl(`${origin}/wiki/api/v2/pages/${pageId}`, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.status === 401 || res.status === 403) {
        throw new UserError(
          `Confluence rejected the credentials for ${upstream.uri}`,
        );
      }
      if (!res.ok)
        throw new Error(`${upstream.uri} returned HTTP ${res.status}`);

      const body = await res.json();
      const version = body?.version?.number;
      if (version === undefined)
        throw new Error(`no version in response for ${upstream.uri}`);
      return String(version);
    },
  };
}

/** Page URLs look like https://host/wiki/spaces/KEY/pages/<id>/Title. */
export function parsePageUrl(uri) {
  let url;
  try {
    url = new URL(uri);
  } catch {
    throw new UserError(`'${uri}' is not a valid URL`);
  }
  const match = url.pathname.match(/\/pages\/(\d+)/);
  if (!match) {
    throw new UserError(`could not find a page id in ${uri}`);
  }
  return { origin: url.origin, pageId: match[1] };
}
