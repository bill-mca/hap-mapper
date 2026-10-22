// A `cog://` protocol for MapLibre: draws Web Mercator COGs as 512 px raster
// tiles, reading only the blocks it needs, each one once.
//
// It replaces @geomatico/maplibre-cog-protocol, which was slow here for
// reasons measured in docs/loading-performance.md:
//
// - Every read goes to its own URL, /cog/x.tif?r=<start>-<end>, with the
//   matching Range header. Chrome lets only one request at a time write to a
//   cache entry, so range reads that share a URL wait in line; with a URL per
//   range they all go at once, and each can still be cached.
// - The header is read in 64 kB blocks, so walking a COG's IFDs and looking up
//   tile offsets takes one or two requests instead of twenty-odd tiny ones.
// - A COG block is fetched and decoded once and kept, in a cache shared by
//   every layer, so the map tiles that straddle it all reuse it.
// - Decoding happens in workers: WebP and JPEG blocks with the browser's own
//   decoder, anything else with geotiff.js's.
// - A tile MapLibre no longer wants stops its downloads, unless another tile
//   is waiting on the same block.
// - Tiles are drawn at the resolution the screen needs: 512 px tiles from the
//   overview whose pixels are no more than a quarter coarser than the tile's.

import { GeoTIFF } from 'geotiff';

const R = 6378137;
const WORLD = 2 * Math.PI * R; // metres across the Web Mercator world
const OUT = 512; // tile size in pixels; the map's sources must say the same
const SLACK = 1.25; // how much coarser than the tile an overview may be
const HEADER_BLOCK = 65536; // header reads are rounded out to blocks this big
const CACHE_BYTES = 128 * 1024 * 1024; // decoded blocks kept, across all layers

// ---------------------------------------------------------------------------
// Workers that decode blocks
// ---------------------------------------------------------------------------

const workers = [];
const jobs = new Map();
let nextJob = 0;

function decoder() {
    if (!workers.length) {
        const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
        for (let i = 0; i < n; i++) {
            const w = new Worker(new URL('./decoder.worker.js', import.meta.url), { type: 'module' });
            w.busy = 0;
            w.onmessage = (e) => {
                const job = jobs.get(e.data.id);
                jobs.delete(e.data.id);
                w.busy--;
                if (e.data.error) job.reject(new Error(e.data.error));
                else job.resolve(e.data);
            };
            workers.push(w);
        }
    }
    return workers.reduce((a, b) => (a.busy <= b.busy ? a : b));
}

// -> { data: Uint8Array, rgba: boolean }: RGBA when the browser decoded it,
// otherwise the block's own samples, interleaved.
function decode(level, buffer) {
    const w = decoder();
    const id = nextJob++;
    w.busy++;
    return new Promise((resolve, reject) => {
        jobs.set(id, { resolve, reject });
        w.postMessage({ id, compression: level.compression, params: level.params, buffer }, [buffer]);
    }).then((r) => ({ data: new Uint8Array(r.out), rgba: r.rgba }));
}

// ---------------------------------------------------------------------------
// Decoded blocks, shared by every COG, least recently used out first
// ---------------------------------------------------------------------------

const blocks = new Map(); // key -> entry
let cachedBytes = 0;

function evict() {
    for (const [key, entry] of blocks) {
        if (cachedBytes <= CACHE_BYTES) break;
        if (!entry.size) continue; // still loading
        blocks.delete(key);
        cachedBytes -= entry.size;
    }
}

function abortError() {
    return new DOMException('Tile no longer needed', 'AbortError');
}

// Wait for a block on behalf of one tile. If every tile waiting for a block
// gives up before it arrives, its download is abandoned.
function acquire(entry, signal) {
    if (entry.value) return Promise.resolve(entry.value);
    entry.users++;
    return new Promise((resolve, reject) => {
        let done = false;
        const onAbort = () => {
            if (done) return;
            done = true;
            if (--entry.users === 0 && !entry.value) {
                entry.controller.abort();
                if (blocks.get(entry.key) === entry) blocks.delete(entry.key);
            }
            reject(abortError());
        };
        if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }
        entry.promise.then((v) => {
            if (done) return;
            done = true;
            entry.users--;
            signal?.removeEventListener('abort', onAbort);
            resolve(v);
        }, (err) => {
            if (done) return;
            done = true;
            entry.users--;
            reject(err);
        });
    });
}

// ---------------------------------------------------------------------------
// One COG
// ---------------------------------------------------------------------------

class Cog {
    constructor(url) {
        this.url = url;
        this.headerBlocks = new Map(); // block number -> Promise<ArrayBuffer>
        this.ready = this.open();
    }

    // One range read, from its own URL; see the top of the file.
    async range(offset, length, signal) {
        const end = offset + length - 1;
        const r = await fetch(this.url + '?r=' + offset + '-' + end, {
            headers: { Range: 'bytes=' + offset + '-' + end },
            signal,
        });
        if (r.status === 200) return (await r.arrayBuffer()).slice(offset, end + 1);
        if (r.status !== 206) throw new Error(this.url + ': HTTP ' + r.status);
        return r.arrayBuffer();
    }

    headerBlock(n) {
        if (!this.headerBlocks.has(n)) {
            const p = this.range(n * HEADER_BLOCK, HEADER_BLOCK);
            p.catch(() => this.headerBlocks.delete(n));
            this.headerBlocks.set(n, p);
        }
        return this.headerBlocks.get(n);
    }

    // geotiff.js reads through this, as its source.
    async fetch(slices, signal) {
        return Promise.all(slices.map((s) => this.read(s.offset, s.length, signal)));
    }

    async read(offset, length, signal) {
        if (length > HEADER_BLOCK) return this.range(offset, length, signal);
        const first = Math.floor(offset / HEADER_BLOCK);
        const last = Math.floor((offset + length - 1) / HEADER_BLOCK);
        const parts = [];
        for (let n = first; n <= last; n++) parts.push(this.headerBlock(n));
        const bufs = await Promise.all(parts);
        const out = new Uint8Array(length);
        let at = 0;
        bufs.forEach((buf, i) => {
            const start = i === 0 ? offset - first * HEADER_BLOCK : 0;
            const take = Math.min(buf.byteLength - start, length - at);
            if (take > 0) out.set(new Uint8Array(buf, start, take), at);
            at += Math.max(take, 0);
        });
        return out.buffer;
    }

    async open() {
        const tiff = await GeoTIFF.fromSource(this);
        const count = await tiff.getImageCount();
        const images = [];
        for (let i = 0; i < count; i++) images.push(await tiff.getImage(i));
        const first = images[0];
        const epsg = first.getGeoKeys()?.ProjectedCSTypeGeoKey;
        if (epsg !== undefined && epsg !== 3857 && epsg !== 102113) {
            throw new Error(this.url + ': EPSG:' + epsg + ', not Web Mercator');
        }
        const [minX, minY, maxX, maxY] = first.getBoundingBox();
        this.tiff = tiff;
        this.bbox = [minX, minY, maxX, maxY];
        this.nodata = first.getGDALNoData();

        const levels = [];
        const masks = [];
        for (const image of images) {
            const fd = image.fileDirectory;
            const kind = (await fd.loadValue('NewSubfileType')) || 0;
            const rawBits = await fd.loadValue('BitsPerSample');
            const bits = typeof rawBits === 'number' ? [rawBits] : Array.from(rawBits);
            const level = {
                image,
                fd,
                width: image.getWidth(),
                height: image.getHeight(),
                tw: image.getTileWidth(),
                th: image.getTileHeight(),
                spp: image.getSamplesPerPixel(),
                planar: image.planarConfiguration,
                compression: await fd.loadValue('Compression'),
                photometric: await fd.loadValue('PhotometricInterpretation'),
            };
            level.res = (maxX - minX) / level.width;
            level.nx = Math.ceil(level.width / level.tw);
            level.ny = Math.ceil(level.height / level.th);
            level.params = {
                tileWidth: level.tw,
                tileHeight: level.th,
                planarConfiguration: level.planar,
                bitsPerSample: bits,
                predictor: (await fd.loadValue('Predictor')) || 1,
                samplesPerPixel: level.spp,
                photometric: level.photometric,
                JPEGTables: level.compression === 7 ? await fd.loadValue('JPEGTables') : undefined,
            };
            (kind & 4 ? masks : levels).push(level);
        }
        levels.forEach((l) => { l.mask = masks.find((m) => m.width === l.width) || null; });
        this.levels = levels.sort((a, b) => a.res - b.res); // finest first
        // The zoom at which a 512 px tile first wants the full resolution.
        this.maxzoom = Math.max(0, Math.ceil(Math.log2(WORLD / (OUT * this.levels[0].res * SLACK))));
        return this;
    }

    tilejson(tilesUrl) {
        const [w, s] = toLngLat(this.bbox[0], this.bbox[1]);
        const [e, n] = toLngLat(this.bbox[2], this.bbox[3]);
        return {
            tilejson: '2.2.0',
            tiles: [tilesUrl + '/{z}/{x}/{y}'],
            minzoom: 0,
            maxzoom: this.maxzoom,
            bounds: [w, s, e, n],
        };
    }

    // The coarsest level whose pixels are fine enough for a tile of this
    // resolution, or the finest there is.
    levelFor(tileRes) {
        let pick = 0;
        this.levels.forEach((l, i) => { if (l.res <= tileRes * SLACK) pick = i; });
        return pick;
    }

    // Byte offset and length of one block of a level, or of its mask.
    async where(level, index) {
        const [off, len] = await Promise.all([
            level.fd.loadValueIndexed('TileOffsets', index),
            level.fd.loadValueIndexed('TileByteCounts', index),
        ]);
        return [Number(off), Number(len)];
    }

    block(li, bx, by) {
        const key = this.url + '|' + li + '|' + bx + '|' + by;
        let entry = blocks.get(key);
        if (entry) {
            blocks.delete(key); // to the back of the queue
            blocks.set(key, entry);
            return entry;
        }
        entry = { key, users: 0, size: 0, value: null, controller: new AbortController() };
        entry.promise = this.loadBlock(this.levels[li], bx, by, entry.controller.signal).then((v) => {
            entry.value = v;
            entry.size = (v.data ? v.data.byteLength : 0) + (v.mask ? v.mask.byteLength : 0) + 64;
            if (blocks.get(key) === entry) {
                cachedBytes += entry.size;
                evict();
            }
            return v;
        }, (err) => {
            if (blocks.get(key) === entry) blocks.delete(key);
            throw err;
        });
        blocks.set(key, entry);
        return entry;
    }

    async loadBlock(level, bx, by, signal) {
        const index = by * level.nx + bx;
        const planes = level.planar === 2 ? level.spp : 1;
        const per = level.nx * level.ny;
        const places = await Promise.all(Array.from({ length: planes }, (_, s) => this.where(level, s * per + index)));
        const maskPlace = level.mask ? await this.where(level.mask, index) : null;
        if (places.every((p) => p[1] === 0)) return { empty: true };

        // GDAL writes a block's mask straight after it, so one read gets both.
        let bufs;
        let maskBuf = null;
        if (planes === 1 && maskPlace && maskPlace[1] > 0 && maskPlace[0] === places[0][0] + places[0][1]) {
            const both = await this.range(places[0][0], places[0][1] + maskPlace[1], signal);
            bufs = [both.slice(0, places[0][1])];
            maskBuf = both.slice(places[0][1]);
        } else {
            const reads = places.map((p) => this.range(p[0], p[1], signal));
            if (maskPlace && maskPlace[1] > 0) reads.push(this.range(maskPlace[0], maskPlace[1], signal));
            const got = await Promise.all(reads);
            bufs = got.slice(0, planes);
            if (maskPlace && maskPlace[1] > 0) maskBuf = got[planes];
        }

        const decoded = await Promise.all(bufs.map((b) => decode(level, b)));
        const mask = maskBuf ? (await decode(level.mask, maskBuf)).data : null;
        if (planes === 1) return { data: decoded[0].data, rgba: decoded[0].rgba, mask };
        // Interleave separate planes.
        const n = level.tw * level.th;
        const data = new Uint8Array(n * planes);
        decoded.forEach((d, s) => { for (let i = 0; i < n; i++) data[i * planes + s] = d.data[i]; });
        return { data, rgba: false, mask };
    }

    async tile(z, x, y, signal) {
        await this.ready;
        const size = WORLD / Math.pow(2, z);
        const minX = -WORLD / 2 + x * size;
        const maxY = WORLD / 2 - y * size;
        const tileRes = size / OUT;
        const [ox, , , oy] = this.bbox;
        const li = this.levelFor(tileRes);
        const level = this.levels[li];
        if (level.params.bitsPerSample.some((b) => b !== 8)) throw new Error(this.url + ': only 8-bit COGs are drawn');

        // Source column and row for each output column and row (nearest).
        const cols = new Int32Array(OUT);
        const rows = new Int32Array(OUT);
        for (let i = 0; i < OUT; i++) {
            const c = Math.floor((minX + (i + 0.5) * tileRes - ox) / level.res);
            cols[i] = c >= 0 && c < level.width ? c : -1;
            const r = Math.floor((oy - (maxY - (i + 0.5) * tileRes)) / level.res);
            rows[i] = r >= 0 && r < level.height ? r : -1;
        }
        const bxs = new Set();
        const bys = new Set();
        cols.forEach((c) => { if (c >= 0) bxs.add(Math.floor(c / level.tw)); });
        rows.forEach((r) => { if (r >= 0) bys.add(Math.floor(r / level.th)); });
        const rgba = new Uint8ClampedArray(OUT * OUT * 4);
        if (!bxs.size || !bys.size) return createImageBitmap(new ImageData(rgba, OUT, OUT));

        const wanted = [];
        for (const by of bys) for (const bx of bxs) wanted.push([bx, by]);
        const got = await Promise.all(wanted.map(([bx, by]) => acquire(this.block(li, bx, by), signal)));

        // The tile touches a small grid of blocks, bx0.. across and by0.. down.
        // For each output column, which block column and which pixel in it.
        const tw = level.tw;
        const th = level.th;
        const bx0 = Math.min(...bxs);
        const by0 = Math.min(...bys);
        const across = Math.max(...bxs) - bx0 + 1;
        const grid = new Array(across * (Math.max(...bys) - by0 + 1)).fill(null);
        wanted.forEach(([bx, by], k) => { grid[(by - by0) * across + (bx - bx0)] = got[k]; });
        const colBlock = new Int32Array(OUT);
        const colPixel = new Int32Array(OUT);
        for (let i = 0; i < OUT; i++) {
            const c = cols[i];
            colBlock[i] = c < 0 ? -1 : Math.floor(c / tw) - bx0;
            colPixel[i] = c < 0 ? 0 : c % tw;
        }

        const out32 = new Uint32Array(rgba.buffer);
        const spp = level.spp;
        const nodata = this.nodata;
        const hasNodata = nodata !== null && nodata !== undefined && !Number.isNaN(nodata);
        const gray = spp === 1 || spp === 2;
        for (let j = 0; j < OUT; j++) {
            const r = rows[j];
            if (r < 0) continue;
            const by = Math.floor(r / th);
            const rowStart = (r - by * th) * tw;
            const rowBlocks = (by - by0) * across;
            const o0 = j * OUT;
            for (let i = 0; i < OUT; i++) {
                const cb = colBlock[i];
                if (cb < 0) continue;
                const b = grid[rowBlocks + cb];
                if (b === null || b.empty) continue;
                const p = rowStart + colPixel[i];
                const d = b.data;
                if (b.rgba) {
                    // RGBA from the browser's decoder: one 32-bit copy a pixel.
                    if (b.mask && b.mask[p] === 0) continue;
                    const u = b.u32 || (b.u32 = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2));
                    out32[o0 + i] = u[p];
                    continue;
                }
                if (b.mask && b.mask[p] === 0) continue;
                const o = (o0 + i) * 4;
                if (gray) {
                    const v = d[p * spp];
                    if (hasNodata && v === nodata) continue;
                    rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
                    rgba[o + 3] = spp === 2 ? d[p * 2 + 1] : 255;
                } else {
                    const q = p * spp;
                    const rr = d[q], gg = d[q + 1], bb = d[q + 2];
                    if (hasNodata && rr === nodata && gg === nodata && bb === nodata) continue;
                    rgba[o] = rr;
                    rgba[o + 1] = gg;
                    rgba[o + 2] = bb;
                    rgba[o + 3] = spp >= 4 ? d[q + 3] : 255;
                }
            }
        }
        return createImageBitmap(new ImageData(rgba, OUT, OUT));
    }
}

function toLngLat(x, y) {
    return [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
}

// ---------------------------------------------------------------------------
// The protocol, and what the page uses
// ---------------------------------------------------------------------------

const cogs = new Map(); // url -> Cog

export function openCog(url) {
    if (!cogs.has(url)) {
        const cog = new Cog(url);
        cog.ready.catch(() => cogs.delete(url));
        cogs.set(url, cog);
    }
    return cogs.get(url);
}

// cog://https://host/cog/x.tif for the TileJSON, then .../{z}/{x}/{y} per tile.
export async function cogProtocol(params, abortController) {
    const signal = abortController?.signal;
    if (params.type === 'json') {
        const url = params.url.slice('cog://'.length);
        const cog = await openCog(url).ready;
        return { data: cog.tilejson(params.url) };
    }
    const m = /^cog:\/\/(.+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
    if (!m) throw new Error('Not a cog:// tile: ' + params.url);
    const data = await openCog(m[1]).tile(Number(m[2]), Number(m[3]), Number(m[4]), signal);
    return { data };
}

// Read the headers of these COGs a few at a time, so that the first tile of
// a layer drawn later does not wait for them.
export function prefetchHeaders(urls, inParallel = 3) {
    const queue = urls.filter((u) => !cogs.has(u));
    const next = () => {
        const url = queue.shift();
        if (!url) return Promise.resolve();
        return openCog(url).ready.catch(() => {}).then(next);
    };
    return Promise.all(Array.from({ length: inParallel }, next));
}

// The value of one pixel of the first band of a COG, at a Web Mercator point,
// or null outside it. Any bit depth; decoded here rather than in a worker.
export async function valueAt(url, x, y) {
    const cog = await openCog(url).ready;
    const level = cog.levels[0];
    const col = Math.floor((x - cog.bbox[0]) / level.res);
    const row = Math.floor((cog.bbox[3] - y) / level.res);
    if (col < 0 || row < 0 || col >= level.width || row >= level.height) return null;
    const r = await level.image.readRasters({ window: [col, row, col + 1, row + 1] });
    return r[0][0];
}

export function toMercator(lng, lat) {
    return [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
}
