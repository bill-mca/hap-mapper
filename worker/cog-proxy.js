// Dev COG range-proxy.
//
// Cloudflare's CDN only serves HTTP Range requests from cache, and objects
// larger than the plan's cacheable limit (512 MB on Free/Pro/Business) are
// never cached — so range requests to a large COG on an R2 custom domain come
// back as `200 + full file`, which geotiff.js/maplibre-cog-protocol rejects
// ("Server responded with full file"). Reading the object through an R2
// binding sidesteps the cache entirely: R2 supports native ranged reads, and
// we return a proper `206 Partial Content` for any object size.
//
// This Worker also has a static-assets binding (see wrangler.dev.jsonc). Assets
// are matched first, so `/` serves dev/index.html directly; only unmatched
// paths (i.e. /cog/*) reach this handler. The COG is therefore same-origin
// with the app page, so no CORS dance is needed.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders() });
    }
    if (!key) {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    // HEAD: return metadata + total size without a body.
    if (request.method === 'HEAD') {
      const head = await env.BUCKET.head(key);
      if (!head) return new Response(null, { status: 404, headers: corsHeaders() });
      const headers = baseHeaders(head);
      headers.set('Content-Length', String(head.size));
      return new Response(null, { status: 200, headers });
    }

    // Parse a single-range request: `bytes=start-` or `bytes=start-end`.
    const rangeHeader = request.headers.get('range');
    let getOptions = {};
    let parsed = null;
    if (rangeHeader) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (m) {
        const offset = parseInt(m[1], 10);
        parsed = { offset };
        if (m[2] !== '') {
          parsed.length = parseInt(m[2], 10) - offset + 1;
        }
        getOptions.range = parsed;
      }
    }

    const obj = await env.BUCKET.get(key, getOptions);
    if (!obj) {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    const headers = baseHeaders(obj);
    const totalSize = obj.size; // full object size, regardless of range

    if (parsed) {
      const start = obj.range?.offset ?? parsed.offset ?? 0;
      const length = obj.range?.length ?? (totalSize - start);
      const end = start + length - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      headers.set('Content-Length', String(length));
      return new Response(obj.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(totalSize));
    return new Response(obj.body, { status: 200, headers });
  },
};

function baseHeaders(obj) {
  const headers = new Headers(corsHeaders());
  obj.writeHttpMetadata(headers); // content-type, cache-control, etc. from R2
  if (obj.httpEtag) headers.set('ETag', obj.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'image/tiff');
  return headers;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'range, if-match, if-none-match, content-type',
    'Access-Control-Expose-Headers': 'content-length, content-range, accept-ranges, etag',
    'Access-Control-Max-Age': '3600',
  };
}
