// The hapmap Worker: everything not in dist/ comes out of the R2 bucket.
//
// Cloudflare's CDN only serves HTTP Range requests from cache, and objects
// larger than the plan's cacheable limit (512 MB on Free/Pro/Business) are
// never cached — so range requests to a large COG on an R2 custom domain come
// back as `200 + full file`, which COG readers reject. Reading the object
// through an R2 binding sidesteps that: R2 supports native ranged reads, and
// we return a proper `206 Partial Content` for any object size.
//
// The Worker has a static-assets binding (see wrangler.jsonc). Assets are
// matched first, so `/` serves dist/index.html directly; only unmatched paths
// reach this handler: /cog/* (the published COGs), /web/* (their WebP web
// copies, which the map draws), /stac/* (the public catalog), and
// /web-items.json (the map's slim index of the catalog, made here).
//
// Range reads are kept, so the next visitor to look at the same place is
// served without a trip to R2: in this isolate's memory, and in Cloudflare's
// edge cache (which only works on a custom domain such as hapmap.app, not on
// workers.dev). Objects are never overwritten in place, so a range of a key
// is the same bytes forever; browsers may keep them for a day.

const RANGE_MAX_AGE = 86400; // seconds a browser or the edge keeps a range
const ITEMS_MAX_AGE = 300; // seconds /web-items.json is kept, like the catalog
const MEMORY_BYTES = 48 * 1024 * 1024; // ranges kept in this isolate
const MEMORY_RANGE_MAX = 2 * 1024 * 1024; // ranges bigger than this are not
const SITE = 'https://hapmap.app/';

export default {
  async fetch(request, env, ctx) {
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
    if (key === 'web-items.json') {
      return webItems(env, ctx);
    }

    // HEAD: return metadata + total size without a body.
    if (request.method === 'HEAD') {
      const head = await env.BUCKET.head(key);
      if (!head) return new Response(null, { status: 404, headers: corsHeaders() });
      const headers = baseHeaders(head);
      headers.set('Content-Length', String(head.size));
      return new Response(null, { status: 200, headers });
    }

    // A single closed range, `bytes=start-end`, is what COG readers send,
    // and is what is kept. Anything else goes straight to R2.
    const m = /^bytes=(\d+)-(\d+)$/.exec((request.headers.get('range') || '').trim());
    if (m) {
      return closedRange(env, ctx, key, Number(m[1]), Number(m[2]));
    }
    return passThrough(request, env, key);
  },
};

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

const memory = new Map(); // "key|start-end" -> { body, headers }, oldest first
let memoryBytes = 0;

function remember(id, entry) {
  if (entry.body.byteLength > MEMORY_RANGE_MAX) return;
  memory.set(id, entry);
  memoryBytes += entry.body.byteLength;
  for (const [k, v] of memory) {
    if (memoryBytes <= MEMORY_BYTES) break;
    memory.delete(k);
    memoryBytes -= v.body.byteLength;
  }
}

function rangeResponse(entry, via) {
  const headers = new Headers(entry.headers);
  headers.set('X-Hapmap-Cache', via);
  return new Response(entry.body, { status: 206, headers });
}

async function closedRange(env, ctx, key, start, end) {
  const id = key + '|' + start + '-' + end;
  const hit = memory.get(id);
  if (hit) {
    memory.delete(id); // to the back of the queue
    memory.set(id, hit);
    return rangeResponse(hit, 'memory');
  }

  // The edge cache will not store a 206, so each range is kept as a 200
  // under its own made-up URL, and turned back into a 206 on the way out.
  const cacheKey = new Request('https://range.cache/' + encodeURIComponent(key) + '?r=' + start + '-' + end);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const entry = { body: await cached.arrayBuffer(), headers: rangeHeadersFrom(cached.headers) };
    remember(id, entry);
    return rangeResponse(entry, 'edge');
  }

  const obj = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
  if (!obj) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }
  const length = obj.range?.length ?? (obj.size - start);
  const headers = baseHeaders(obj);
  headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`);
  headers.set('Content-Length', String(length));
  headers.set('Cache-Control', `public, max-age=${RANGE_MAX_AGE}`);
  const entry = { body: await obj.arrayBuffer(), headers };
  remember(id, entry);

  const stored = new Headers(headers);
  stored.delete('Content-Length');
  stored.set('X-Content-Range', headers.get('Content-Range'));
  ctx.waitUntil(cache.put(cacheKey, new Response(entry.body, { status: 200, headers: stored })).catch(() => {}));
  return rangeResponse(entry, 'r2');
}

function rangeHeadersFrom(stored) {
  const headers = new Headers(stored);
  headers.set('Content-Range', stored.get('X-Content-Range'));
  headers.delete('X-Content-Range');
  return headers;
}

// Whole objects, and open or suffix ranges: straight from R2.
async function passThrough(request, env, key) {
  const rangeHeader = request.headers.get('range');
  let getOptions = {};
  let parsed = null;
  if (rangeHeader) {
    const m = /^bytes=(\d+)-$/.exec(rangeHeader.trim());
    if (m) {
      parsed = { offset: parseInt(m[1], 10) };
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
}

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

// ---------------------------------------------------------------------------
// /web-items.json: every Web Mercator item in the catalog, in one file
// ---------------------------------------------------------------------------
//
// The page needs every Web Mercator item, and the catalog is static files,
// so a browser has to walk it: the catalog, then 25 collections, then 47
// items, three rounds of requests. Here, beside R2, the same walk is quick,
// and its result is kept for five minutes. Each item is the catalog's own
// record, less its frame list (fetched on a click), plus an asset "web" when
// the bucket holds a web copy of its COG under web/.
//
// When hap-mosaics' publish.py writes an ItemCollection of its own, linked
// from catalog.json as rel "items", the page reads that instead.

let itemsMemo = null; // { at, body }

async function webItems(env, ctx) {
  if (itemsMemo && Date.now() - itemsMemo.at < ITEMS_MAX_AGE * 1000) {
    return itemsResponse(itemsMemo.body, 'memory');
  }
  const cacheKey = new Request('https://range.cache/web-items.json');
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    itemsMemo = { at: Date.now(), body: await cached.text() };
    return itemsResponse(itemsMemo.body, 'edge');
  }

  const body = JSON.stringify(await buildWebItems(env));
  itemsMemo = { at: Date.now(), body };
  ctx.waitUntil(caches.default.put(cacheKey, itemsResponse(body, 'r2')).catch(() => {}));
  return itemsResponse(body, 'r2');
}

function itemsResponse(body, via) {
  return new Response(body, {
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/geo+json',
      'Cache-Control': `public, max-age=${ITEMS_MAX_AGE}`,
      'X-Hapmap-Cache': via,
    },
  });
}

async function readJson(env, key) {
  const obj = await env.BUCKET.get(key);
  if (!obj) throw new Error(key + ' not found');
  return obj.json();
}

// A link's bucket key, for an absolute hapmap.app href or one relative to
// the record it is in.
function keyOf(href, fromKey) {
  const abs = new URL(href, SITE + fromKey).href;
  return abs.startsWith(SITE) ? abs.slice(SITE.length) : null;
}

async function webCopies(env) {
  const names = new Set();
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: 'web/', cursor });
    page.objects.forEach((o) => names.add(o.key.slice('web/'.length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return names;
}

async function buildWebItems(env) {
  const [root, copies] = await Promise.all([readJson(env, 'stac/catalog.json'), webCopies(env)]);
  const children = root.links
    .filter((l) => l.rel === 'child' && !l.href.includes('/ga-frames/'))
    .map((l) => keyOf(l.href, 'stac/catalog.json'))
    .filter(Boolean);
  const colls = await Promise.allSettled(children.map((k) => readJson(env, k).then((c) => [k, c])));
  // The pipeline names every Web Mercator item with "-3857".
  const itemKeys = [];
  colls.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    const [k, c] = r.value;
    c.links.forEach((l) => {
      if (l.rel === 'item' && /-3857/.test(l.href)) itemKeys.push(keyOf(l.href, k));
    });
  });
  const items = await Promise.allSettled(itemKeys.filter(Boolean).map((k) => readJson(env, k)));
  const features = [];
  items.forEach((r) => {
    if (r.status !== 'fulfilled') return;
    const item = r.value;
    const sf = item.assets?.source_frame;
    if (sf) delete sf['classification:classes'];
    const data = item.assets?.data;
    const name = data?.href?.startsWith(SITE + 'cog/') ? data.href.slice((SITE + 'cog/').length) : null;
    if (name && copies.has(name)) {
      item.assets.web = {
        href: SITE + 'web/' + name,
        type: 'image/tiff; application=geotiff; profile=cloud-optimized',
        title: 'Web copy: the same pixels as WebP, for the map',
        roles: ['visual'],
      };
    }
    features.push(item);
  });
  return {
    type: 'FeatureCollection',
    features,
    links: [{ rel: 'root', href: SITE + 'stac/catalog.json', type: 'application/json' }],
  };
}
