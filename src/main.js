import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MaplibreGeocoder from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { cogProtocol, prefetchHeaders, toMercator, valueAt } from './cog.js';

// Teach MapLibre how to fetch `cog://` raster tiles (src/cog.js).
maplibregl.addProtocol('cog', cogProtocol);
// A year's layers can ask for several dozen tiles at once.
maplibregl.setMaxParallelImageRequests(32);

// ------------------------------------------------------------------
// The layers come straight from the hap-mosaics STAC catalog: every Web
// Mercator mosaic served from this site is a layer, filed under the year
// its flying started, unless /site.json leaves it out. `npm run build`
// writes /site.json from layers.yaml, along with the present-day imagery
// drawn underneath. A mosaic published to the catalog appears on the next
// page load.
// ------------------------------------------------------------------
var SITE_URL = 'https://hapmap.app';

// ------------------------------------------------------------------
// The spinner shows while the map is loading tiles or the page is
// fetching anything itself: the catalog, a search, the photograph
// behind a click. It waits a moment before showing, so a quick load
// does not make it flicker.
// ------------------------------------------------------------------
var spinner = document.getElementById('spinner');
var mapBusy = true; // until the map first goes idle
var pending = 0; // the page's own fetches in flight
var spinTimer = null;

function setBusy() {
    if (mapBusy || pending > 0) {
        if (spinner.hidden && spinTimer === null) {
            spinTimer = setTimeout(function () { spinner.hidden = false; }, 250);
        }
    } else {
        clearTimeout(spinTimer);
        spinTimer = null;
        spinner.hidden = true;
    }
}

function busyWhile(promise) {
    pending++;
    setBusy();
    return promise.finally(function () {
        pending--;
        setBusy();
    });
}

function fetchJson(path) {
    return busyWhile(fetch(path).then(function (r) {
        if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
        return r.json();
    }));
}

// hapmap.app/cog/x.tif -> /cog/x.tif, so either Worker serves it.
function local(href) {
    return href ? href.replace(SITE_URL, '') : null;
}

// STAC Browser's address for a catalog object, in hash mode.
function browse(href) {
    return '/browse/#/' + href.replace(SITE_URL + '/stac/', '');
}

// "1974–75" for a mosaic flown across a new year.
function flightLabel(start, end) {
    var y0 = start.slice(0, 4);
    var y1 = end.slice(0, 4);
    return y0 === y1 ? y0 : y0 + '–' + y1.slice(2);
}

// A footprint as polygons of [lng, lat] rings, each with its bounding
// box, for the point-in-footprint tests that decide what to draw.
function footprintOf(geometry) {
    var polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
    return polys.map(function (rings) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        rings[0].forEach(function (c) {
            b[0] = Math.min(b[0], c[0]);
            b[1] = Math.min(b[1], c[1]);
            b[2] = Math.max(b[2], c[0]);
            b[3] = Math.max(b[3], c[1]);
        });
        return { rings: rings, bbox: b };
    });
}

function inRing(ring, x, y) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// Does mosaic m have imagery at p = [lng, lat]? Holes count as no.
function covers(m, p) {
    return m.footprint.some(function (poly) {
        var b = poly.bbox;
        if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return false;
        if (!inRing(poly.rings[0], p[0], p[1])) return false;
        for (var i = 1; i < poly.rings.length; i++) {
            if (inRing(poly.rings[i], p[0], p[1])) return false;
        }
        return true;
    });
}

function mosaicFromItem(item, href) {
    var p = item.properties;
    var start = p.start_datetime || p.datetime;
    var end = p.end_datetime || p.datetime;
    var data = item.assets.data;
    var sf = item.assets.source_frame;
    var self = (item.links.find(function (l) { return l.rel === 'self'; }) || { href: href }).href;
    return {
        id: item.id,
        layerId: 'mosaic-' + item.id,
        year: Number(start.slice(0, 4)),
        label: flightLabel(start, end),
        title: p.title,
        gsd: p.gsd,
        georef: {
            status: p['hap:georef_status'],
            method: p['hap:georef_method']
        },
        cog: local(data.href),
        // What the map draws: the WebP web copy where the Worker has one,
        // or else the published COG itself.
        display: local((item.assets.web || data).href),
        href: local(self),
        record: browse(self),
        footprint: footprintOf(item.geometry),
        // Which photograph made each pixel, for a Blag Map mosaic. A
        // slim index leaves out the frame list; classFor() fetches it.
        sourceFrame: sf ? {
            cog: local(sf.href),
            classes: sf['classification:classes'] ? compactClasses(sf['classification:classes']) : null,
            frameRecord: local(sf['hap:frame_href']),
            frameBrowse: browse(sf['hap:frame_href'])
        } : null
    };
}

// [value, GFID, title, date]: 949 frames for 1985
function compactClasses(classes) {
    return classes.map(function (c) { return [c.value, c.name, c.title, c['hap:date']]; });
}

function isShown(item, exclude) {
    var data = item.assets && item.assets.data;
    return item.properties['proj:code'] === 'EPSG:3857' &&
        !!data && data.href.indexOf(SITE_URL + '/cog/') === 0 &&
        !exclude.has(item.id);
}

// Every Web Mercator item, as [item, href] pairs. The Worker's
// /web-items.json has them all in one request, with the web copies
// marked; if it fails, the page reads the catalog itself: one
// ItemCollection where the catalog links one (rel "items"), or else the
// catalog, every collection, and the items named as Web Mercator.
async function loadItems() {
    try {
        return (await fetchJson('/web-items.json')).features.map(function (f) { return [f, null]; });
    } catch (err) {
        console.warn('Reading the catalog instead:', err);
    }
    var root = await fetchJson('/stac/catalog.json');
    var index = root.links.find(function (l) { return l.rel === 'items'; });
    if (index) {
        return (await fetchJson(local(index.href))).features.map(function (f) { return [f, null]; });
    }
    var children = root.links.filter(function (l) {
        return l.rel === 'child' && l.href.indexOf('/ga-frames/') < 0;
    });
    var colls = await Promise.allSettled(children.map(function (l) { return fetchJson(local(l.href)); }));
    // The pipeline names every Web Mercator item with "-3857", so the
    // native-grid items, half the catalog by weight, are not fetched.
    var links = [];
    colls.forEach(function (c) {
        if (c.status !== 'fulfilled') return console.warn(c.reason);
        c.value.links.forEach(function (l) {
            if (l.rel === 'item' && /-3857/.test(l.href)) links.push(l.href);
        });
    });
    var items = await Promise.allSettled(links.map(function (h) { return fetchJson(local(h)); }));
    var found = [];
    items.forEach(function (r, i) {
        if (r.status !== 'fulfilled') return console.warn(r.reason);
        found.push([r.value, links[i]]);
    });
    return found;
}

// The settings and the catalog are fetched at once, alongside the map
// starting up; index.html preloads both.
var sitePromise = fetchJson('/site.json');
var itemsPromise = loadItems();
var mosaicsLoaded = Promise.all([sitePromise, itemsPromise]).then(function (r) {
    var exclude = new Set(r[0].exclude || []);
    return r[1]
        .filter(function (f) { return isShown(f[0], exclude); })
        .map(function (f) { return mosaicFromItem(f[0], f[1]); })
        .sort(function (a, b) { return a.year - b.year || a.gsd - b.gsd; });
});

// Every historical layer is GA's photography under CC BY 4.0, made
// into a mosaic by the hapmap project, also CC BY 4.0.
var GA_CREDIT = 'Photographs &copy; <a href="https://www.ga.gov.au/scientific-topics/national-location-information/historical-aerial-photography" target="_blank" rel="noopener">Geoscience Australia</a>, CC BY 4.0';

// The present day, the newest year on the timeline, and the street map
// under every other year; both from /site.json.
var BASE = { layerId: 'imagery-base', year: 2025, label: '2025' };
var BACKDROP = null;

var MOSAICS = []; // every mosaic shown, oldest first
var YEARS = []; // the years they start in

// ------------------------------------------------------------------
// Map setup. The map starts at once, before anything has been fetched.
// ------------------------------------------------------------------
var canberraMap = new maplibregl.Map({
    container: 'map',
    // Default view: all of Lake Burley Griffin, Scrivener Dam to the
    // Molonglo Reach (bbox via Nominatim), padded so the shoreline
    // isn't flush against the edges.
    bounds: [[149.0712015, -35.3140388], [149.1567188, -35.2841504]],
    fitBoundsOptions: { padding: 40 },
    maxZoom: 21,
    attributionControl: false,
    style: {
        version: 8,
        sources: {},
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#0b1622' } }
        ]
    }
});

// Busy from the first tile asked for until every tile in view has
// arrived and every fade has finished.
canberraMap.on('dataloading', function () { mapBusy = true; setBusy(); });
canberraMap.on('idle', function () { mapBusy = false; setBusy(); });

canberraMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
canberraMap.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    fitBoundsOptions: { maxZoom: 15 }
}), 'top-left');
// ------------------------------------------------------------------
// Search for a present-day place. MapLibre's geocoder plugin asks
// Nominatim only when Enter is pressed, as Nominatim's usage policy
// requires, and flies to the place it picks.
// ------------------------------------------------------------------
var nominatim = {
    forwardGeocode: async function (config) {
        var url = 'https://nominatim.openstreetmap.org/search?format=geojson&countrycodes=au&limit=5&q=' +
            encodeURIComponent(config.query);
        var geojson = await fetchJson(url);
        return {
            type: 'FeatureCollection',
            features: geojson.features.map(function (f) {
                var b = f.bbox;
                var center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: center },
                    center: center,
                    bbox: b,
                    place_name: f.properties.display_name,
                    text: f.properties.display_name,
                    place_type: ['place'],
                    properties: f.properties
                };
            })
        };
    }
};
var geocoder = new MaplibreGeocoder(nominatim, {
    placeholder: 'Search a place',
    flyTo: { maxZoom: 16 },
    marker: false,
    enableEventLogging: false
});
document.getElementById('search').appendChild(geocoder.onAdd(canberraMap));

// The street map goes in first, at the bottom, then the present day
// above it; the mosaics are added above both as they are first
// needed, and the timeline is built once the catalog has been read.
canberraMap.on('load', async function () {
    var SITE = await sitePromise;
    Object.assign(BASE, SITE.base, { label: String(SITE.base.year) });
    BACKDROP = SITE.backdrop;
    activeYear = BASE.year;
    canberraMap.addSource('backdrop', {
        type: 'raster',
        tiles: [BACKDROP.tiles],
        tileSize: BACKDROP.tileSize,
        maxzoom: BACKDROP.maxzoom
    });
    canberraMap.addLayer({ id: 'backdrop', type: 'raster', source: 'backdrop' });
    canberraMap.addSource(BASE.layerId, {
        type: 'raster',
        tiles: [BASE.tiles],
        tileSize: BASE.tileSize,
        maxzoom: BASE.maxzoom
    });
    canberraMap.addLayer({
        id: BASE.layerId,
        type: 'raster',
        source: BASE.layerId,
        paint: { 'raster-opacity-transition': { duration: FADE_MS, delay: 0 } }
    });

    MOSAICS = await mosaicsLoaded;
    YEARS = Array.from(new Set(MOSAICS.map(function (m) { return m.year; })));
    buildTimeline();
    onView();
    canberraMap.on('move', onMove);
    canberraMap.on('moveend', onView);
});

// While the map moves, the stack follows it a few times a second, so
// a layer newly in view starts loading before the map stops. The map is
// left alone while the stack stays the same.
var moveTimer = null;

function onMove() {
    if (moveTimer !== null) return;
    moveTimer = setTimeout(function () {
        moveTimer = null;
        sampleView();
        var next = stackFor(activeYear);
        if (next.length !== stack.length || next.some(function (m, i) { return m !== stack[i]; })) drawStack();
    }, 250);
}

function onView() {
    sampleView();
    updateDots();
    drawStack();
    prefetchInView();
}

// ------------------------------------------------------------------
// Read ahead: the header of every mosaic with imagery in view, nearest
// years first, once the map has settled, so that changing year starts
// straight away on tiles. A header is a few tens of kilobytes.
// ------------------------------------------------------------------
function prefetchInView() {
    canberraMap.once('idle', function () {
        var inView = MOSAICS.filter(function (m) {
            return samples.some(function (p) { return covers(m, p); });
        }).sort(function (a, b) {
            return Math.abs(a.year - activeYear) - Math.abs(b.year - activeYear);
        });
        prefetchHeaders(inView.map(function (m) { return location.origin + m.display; }));
    });
}

// ------------------------------------------------------------------
// What to draw. For the chosen year, every mosaic from that year or
// before with imagery in view, newest year on top and the finest
// mosaic on top within a year, so where nothing was flown in the
// chosen year the most recent earlier photograph shows through.
//
// Walking down from the top, every mosaic of the newest year with
// imagery in view is drawn; an older one is skipped if it would show
// in less than 2% of the view. The walk stops once the view is
// covered: nothing older could be seen, and every layer costs tile
// requests. "The view" is a 16 x 16 grid of points across the map.
// ------------------------------------------------------------------
var GRID = 16;
var MIN_SHARE = 0.02;
var FADE_MS = 800;
var samples = []; // [lng, lat] points across the view
var stack = []; // the mosaics drawn now, top first

function sampleView() {
    var canvas = canberraMap.getCanvas();
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    samples = [];
    for (var i = 0; i < GRID; i++) {
        for (var j = 0; j < GRID; j++) {
            var ll = canberraMap.unproject([(i + 0.5) * w / GRID, (j + 0.5) * h / GRID]);
            samples.push([ll.lng, ll.lat]);
        }
    }
}

function stackFor(year) {
    if (year >= BASE.year) return [];
    var open = samples.map(function () { return true; });
    var left = samples.length;
    var out = [];
    var candidates = MOSAICS
        .filter(function (m) { return m.year <= year; })
        .sort(function (a, b) { return b.year - a.year || a.gsd - b.gsd; });
    var newest = null; // the newest year with imagery in view keeps every mosaic
    for (var i = 0; i < candidates.length && left > 0; i++) {
        var m = candidates[i];
        var hits = [];
        samples.forEach(function (p, k) {
            if (open[k] && covers(m, p)) hits.push(k);
        });
        if (hits.length === 0) continue;
        if (newest === null) newest = m.year;
        if (m.year !== newest && hits.length < MIN_SHARE * samples.length) continue;
        hits.forEach(function (k) { open[k] = false; });
        left -= hits.length;
        out.push(m);
    }
    return out;
}

// A mosaic's source and layer are made the first time it is drawn, so
// the page reads no COG header it does not need.
function ensureLayer(m) {
    if (canberraMap.getLayer(m.layerId)) return;
    // src/cog.js draws 512 px tiles; its TileJSON carries the COG's
    // bounds, so no tile is asked for outside them.
    canberraMap.addSource(m.layerId, {
        type: 'raster',
        url: 'cog://' + location.origin + m.display,
        tileSize: 512
    });
    canberraMap.addLayer({
        id: m.layerId,
        type: 'raster',
        source: m.layerId,
        layout: { visibility: 'none' },
        paint: {
            'raster-opacity': 0,
            'raster-opacity-transition': { duration: FADE_MS, delay: 0 }
        }
    });
}

// Fade a layer to an opacity, or fade it out and then hide it, so it
// fetches nothing more.
function fade(layer, opacity) {
    clearTimeout(layer.hideTimer);
    if (opacity > 0) {
        canberraMap.setLayoutProperty(layer.layerId, 'visibility', 'visible');
        canberraMap.setPaintProperty(layer.layerId, 'raster-opacity', opacity);
    } else {
        canberraMap.setPaintProperty(layer.layerId, 'raster-opacity', 0);
        layer.hideTimer = setTimeout(function () {
            canberraMap.setLayoutProperty(layer.layerId, 'visibility', 'none');
        }, FADE_MS);
    }
}

// Layers joining the stack fade in, in stack order; layers leaving it
// fade out. The newest year drawn, the top of the stack, is solid;
// the older years showing through beneath it are faint, so they read
// as stand-ins rather than the year on the map. The present day
// shows only when it is the year chosen; under any other year the
// street map shows through instead.
var UNDER_OPACITY = 0.4;

function drawStack() {
    var next = stackFor(activeYear);
    var leaving = stack.filter(function (m) { return next.indexOf(m) < 0; });
    stack = next;
    next.slice().reverse().forEach(function (m) {
        ensureLayer(m);
        canberraMap.moveLayer(m.layerId);
        fade(m, m.year === next[0].year ? 1 : UNDER_OPACITY);
    });
    leaving.forEach(function (m) { fade(m, 0); });
    fade(BASE, activeYear >= BASE.year ? 1 : 0);
    renderCoarse();
    renderAttribution();
}

// For looking from the browser console: hapmap.stack() lists what is drawn.
window.hapmap = {
    map: canberraMap,
    setYear: function (year) { setYear(year); },
    stack: function () { return stack.map(function (m) { return m.id; }); },
    mosaics: function () { return MOSAICS; }
};

// Ground metres across one screen pixel at the centre of the map.
// MapLibre's world is 512 pixels wide at zoom 0.
function metresPerPixel() {
    var lat = canberraMap.getCenter().lat * Math.PI / 180;
    return 40075016.686 * Math.cos(lat) / (512 * Math.pow(2, canberraMap.getZoom()));
}

// The handle turns grey when every photograph drawn is coarser than
// the screen: zoomed in past what they can show.
function renderCoarse() {
    var mpp = metresPerPixel();
    var coarse = stack.length > 0 && stack.every(function (m) { return m.gsd > mpp; });
    handle.classList.toggle('coarse', coarse);
    handle.title = coarse ? 'Zoomed in past the photographs here: each of their pixels is wider than a pixel of your screen' : '';
}

// ------------------------------------------------------------------
// Attribution, for only what is on screen: a link to the catalog
// record of each mosaic drawn, GA's credit for the photographs, and
// the present day or the street map wherever either shows.
// ------------------------------------------------------------------
var attributionEl = document.getElementById('attribution');

function renderAttribution() {
    var parts = [];
    if (stack.length) {
        parts.push('Mosaics ' + stack.map(function (m) {
            return '<a href="' + esc(m.record) + '" target="_blank" rel="noopener" title="' + esc(m.title) + '">' + esc(m.label) + '</a>';
        }).join(', ') + ' by hapmap, CC BY 4.0');
        parts.push(GA_CREDIT);
    }
    if (activeYear >= BASE.year) {
        parts.push(BASE.attribution);
    } else if (samples.some(function (p) { return !stack.some(function (m) { return covers(m, p); }); })) {
        parts.push(BACKDROP.attribution);
    }
    attributionEl.innerHTML = parts.join(' &middot; ');
}

// ------------------------------------------------------------------
// Timeline. The handle can rest on any year; a dot marks each year
// with imagery in view, and the dots follow the map as it moves.
// ------------------------------------------------------------------
var TIMELINE_MIN = 1920;
var TIMELINE_MAX = 2030;

var track = document.getElementById('track');
var handle = document.getElementById('handle');
var playBtn = document.getElementById('play-btn');

var activeYear = BASE.year;
var dots = new Map(); // year -> dot
var litYears = [BASE.year]; // years with a dot showing, oldest first

// Year <-> vertical position (newest at the top, like topotijdreis)
function yearToPercent(year) {
    return (TIMELINE_MAX - year) / (TIMELINE_MAX - TIMELINE_MIN) * 100;
}

function offsetToYear(offsetY) {
    var rect = track.getBoundingClientRect();
    var fraction = Math.min(1, Math.max(0, (offsetY - rect.top) / rect.height));
    return TIMELINE_MAX - fraction * (TIMELINE_MAX - TIMELINE_MIN);
}

// Any whole year from the oldest mosaic's to the present day's.
function clampYear(year) {
    return Math.min(BASE.year, Math.max(YEARS.length ? YEARS[0] : BASE.year, Math.round(year)));
}

function buildTimeline() {
    // Start on the decade before the oldest year, so it never sits on the edge.
    TIMELINE_MIN = Math.floor((YEARS[0] - 4) / 10) * 10;

    // Tick marks: yearly minor ticks, labelled decade ticks
    for (var y = TIMELINE_MIN; y <= TIMELINE_MAX; y++) {
        var tick = document.createElement('div');
        tick.className = 'tick' + (y % 10 === 0 ? ' decade' : '');
        tick.style.top = yearToPercent(y) + '%';
        track.appendChild(tick);

        if (y % 10 === 0) {
            var label = document.createElement('div');
            label.className = 'tick-label';
            label.textContent = y;
            label.style.top = yearToPercent(y) + '%';
            track.appendChild(label);
        }
    }

    YEARS.concat([BASE.year]).forEach(function (year) {
        var dot = document.createElement('div');
        dot.className = 'year-dot';
        dot.title = String(year);
        dot.style.top = yearToPercent(year) + '%';
        dot.addEventListener('click', function (e) {
            e.stopPropagation();
            stopPlayback();
            setYear(year);
        });
        track.appendChild(dot);
        dots.set(year, dot);
    });
    updateHandle(activeYear);
}

// A year keeps its dot while any of its mosaics has imagery in view.
// The dot is grey when even the sharpest of them is coarser than the
// screen, so zooming in past it would show only bigger pixels.
function updateDots() {
    var sharpest = new Map([[BASE.year, 0]]); // year -> finest gsd in view
    MOSAICS.forEach(function (m) {
        if (sharpest.has(m.year) && sharpest.get(m.year) <= m.gsd) return;
        if (samples.some(function (p) { return covers(m, p); })) sharpest.set(m.year, m.gsd);
    });
    var mpp = metresPerPixel();
    dots.forEach(function (dot, year) {
        dot.hidden = !sharpest.has(year);
        dot.classList.toggle('coarse', sharpest.get(year) > mpp);
    });
    litYears = Array.from(sharpest.keys()).sort(function (a, b) { return a - b; });
}

function updateHandle(year) {
    handle.style.top = yearToPercent(year) + '%';
    handle.textContent = String(clampYear(year));
}

function setYear(year) {
    year = clampYear(year);
    updateHandle(year);
    if (year === activeYear) return;
    activeYear = year;
    closeFrame();
    drawStack();
}

// Dragging: the handle follows the pointer, the map changes at each
// whole year, and the handle settles on that year on release.
var dragging = false;

function onPointerMove(e) {
    if (!dragging) return;
    var year = offsetToYear(e.clientY);
    handle.style.top = yearToPercent(year) + '%';
    handle.textContent = String(clampYear(year));
    if (clampYear(year) !== activeYear) {
        activeYear = clampYear(year);
        closeFrame();
        drawStack();
    }
}

function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    updateHandle(activeYear);
}

track.addEventListener('pointerdown', function (e) {
    stopPlayback();
    dragging = true;
    handle.classList.add('dragging');
    track.setPointerCapture(e.pointerId);
    onPointerMove(e);
});
track.addEventListener('pointermove', onPointerMove);
track.addEventListener('pointerup', onPointerUp);
track.addEventListener('pointercancel', onPointerUp);

// The next year with a dot, after (step 1) or before (step -1) this one
function nextLitYear(step) {
    var later = litYears.filter(function (y) { return step > 0 ? y > activeYear : y < activeYear; });
    if (!later.length) return null;
    return step > 0 ? later[0] : later[later.length - 1];
}

// Keyboard: step between the years with a dot; Escape closes things
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closePhoto();
        return;
    }
    if (e.target.closest('input')) return; // the arrows belong to the search box there
    var year = e.key === 'ArrowUp' ? nextLitYear(1) : e.key === 'ArrowDown' ? nextLitYear(-1) : null;
    if (year !== null) setYear(year);
});

// ------------------------------------------------------------------
// Playback: animate through the years with a dot
// ------------------------------------------------------------------
var playTimer = null;

function stopPlayback() {
    if (playTimer !== null) {
        clearInterval(playTimer);
        playTimer = null;
        playBtn.innerHTML = '&#9654;';
        playBtn.title = 'Play through the years';
    }
}

playBtn.addEventListener('click', function () {
    if (playTimer !== null) {
        stopPlayback();
        return;
    }
    playBtn.innerHTML = '&#10074;&#10074;';
    playBtn.title = 'Pause';
    // Start from the oldest year here, then step forward on each tick
    setYear(litYears[0]);
    playTimer = setInterval(function () {
        var next = nextLitYear(1);
        setYear(next === null ? litYears[0] : next);
    }, 2500);
});

function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

// GA records a day, a month or only a year; say no more than it knows.
function niceDate(iso) {
    if (!iso) return '';
    var p = String(iso).slice(0, 10).split('-');
    if (p.length === 1) return p[0] + ' (day not recorded)';
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
}

var GEOREF = {
    automated: 'Placed automatically.',
    manual: 'Placed by hand.',
    unverified: 'Placement not checked.',
    wrong: 'Known to be out of place.'
};

// ------------------------------------------------------------------
// Click a spot: which photograph made it. Blag Map records the
// source frame of every pixel; the map reads one pixel of that raster.
// ------------------------------------------------------------------
var records = new Map(); // item path -> Promise<JSON>
var popup = null;
var shown = null; // { layer, gfid } the popup is about

function cached(map, key, make) {
    if (!map.has(key)) map.set(key, make());
    return map.get(key);
}

async function frameValueAt(sf, lngLat) {
    var xy = toMercator(lngLat.lng, lngLat.lat);
    return (await valueAt(location.origin + sf.cog, xy[0], xy[1])) || 0;
}

// The frame list, from the mosaic's own record when the index left it out
async function classFor(layer, value) {
    var sf = layer.sourceFrame;
    if (!sf.classes) {
        var item = await cached(records, layer.href, function () { return fetchJson(layer.href); });
        sf.classes = compactClasses(item.assets.source_frame['classification:classes']);
    }
    var c = sf.classes.find(function (k) { return k[0] === value; });
    return c && { value: c[0], gfid: c[1], title: c[2], date: c[3] };
}

// The click goes to the topmost mosaic drawn at that spot.
canberraMap.on('click', async function (e) {
    var p = [e.lngLat.lng, e.lngLat.lat];
    var layer = stack.find(function (m) { return covers(m, p); });
    if (!layer) return;
    closeFrame();
    popup = new maplibregl.Popup({ maxWidth: '320px' }).setLngLat(e.lngLat)
        .setHTML('<div class="frame-pop"><p class="muted">Looking…</p></div>').addTo(canberraMap);
    var mine = popup;
    try {
        var html = layer.sourceFrame ? await busyWhile(framePopup(layer, e.lngLat)) : layerPopup(layer);
        if (mine === popup) popup.setHTML(html);
    } catch (err) {
        console.error(err);
        if (mine === popup) popup.setHTML('<div class="frame-pop"><p>Could not read this spot: ' + esc(err.message) + '</p></div>');
    }
});

// For a layer without per-pixel provenance, say what the layer is.
function layerPopup(layer) {
    return '<div class="frame-pop"><h4>' + esc(layer.label) + '</h4><p>' + esc(layer.title) + '.</p>' +
        '<p class="muted">' + esc(GEOREF[layer.georef.status] || '') + ' ' + esc(layer.georef.method || '') + '</p>' +
        '<p class="muted">This mosaic does not record which photograph each spot came from.</p>' +
        '<div class="actions"><a class="btn" href="' + esc(layer.record) + '" target="_blank" rel="noopener">Catalog record</a></div></div>';
}

async function framePopup(layer, lngLat) {
    var sf = layer.sourceFrame;
    var value = await frameValueAt(sf, lngLat);
    if (!value) {
        return '<div class="frame-pop"><p>No ' + esc(layer.label) + ' photograph covers this spot.</p></div>';
    }
    var frame = await classFor(layer, value);
    if (!frame) {
        return '<div class="frame-pop"><p>The ' + esc(layer.label) + ' mosaic does not say which photograph made this spot.</p></div>';
    }
    shown = { layer: layer, frame: frame };
    return '<div class="frame-pop"><h4>' + esc(frame.title) + '</h4>' +
        '<p class="muted">' + esc(niceDate(frame.date)) + '</p>' +
        '<div class="actions">' +
        '<button type="button" data-act="photo">View photograph</button>' +
        '<a class="btn" href="' + esc(sf.frameBrowse.replace('{name}', frame.gfid)) + '" target="_blank" rel="noopener">Record</a>' +
        '</div></div>';
}

// The popup's button, delegated so it survives setHTML.
document.getElementById('map').addEventListener('click', function (e) {
    var btn = e.target.closest('.frame-pop [data-act]');
    if (!btn || !shown) return;
    if (btn.dataset.act === 'photo') openPhoto();
});

function closeFrame() {
    shown = null;
    if (popup) {
        var p = popup;
        popup = null;
        p.remove();
    }
}

// ------------------------------------------------------------------
// The photograph itself, from GA. Clicking it opens it in a new tab;
// the caption links the full scan, where GA has one.
// ------------------------------------------------------------------
var photoBox = document.getElementById('photo');
var photoImg = document.getElementById('photo-img');
var photoLink = document.getElementById('photo-link');

async function openPhoto() {
    var s = shown;
    var record = await fetchJson(s.layer.sourceFrame.frameRecord.replace('{name}', s.frame.gfid));
    var preview = record.assets.preview && record.assets.preview.href;
    var scan = record.assets.scan;
    document.getElementById('photo-title').textContent = s.frame.title + ' · ' + niceDate(s.frame.date);
    var caption = 'GA\'s preview of the photograph. ';
    if (scan) {
        caption += '<a href="' + esc(scan.href) + '" target="_blank" rel="noopener">Download the full scan</a>' +
            (record.properties['hap:scan_size'] ? ' (' + esc(record.properties['hap:scan_size']) + ').' : '.');
    }
    document.getElementById('photo-caption').innerHTML = caption;
    busyWhile(new Promise(function (done) { photoImg.onload = photoImg.onerror = done; }));
    photoImg.src = preview;
    photoImg.alt = s.frame.title;
    photoLink.href = preview;
    photoBox.hidden = false;
}

function closePhoto() {
    photoBox.hidden = true;
    photoImg.removeAttribute('src');
}
document.getElementById('photo-close').addEventListener('click', closePhoto);
photoBox.addEventListener('click', function (e) { if (e.target === photoBox) closePhoto(); });

// Reflect the starting handle position before the map finishes loading.
updateHandle(BASE.year);
