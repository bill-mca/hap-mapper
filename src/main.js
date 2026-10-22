import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MaplibreGeocoder from '@maplibre/maplibre-gl-geocoder';
import '@maplibre/maplibre-gl-geocoder/dist/maplibre-gl-geocoder.css';
import { cogProtocol, prefetchHeaders, toMercator, valueAt } from './cog.js';
import { backdropLayers, overlayLayers } from './vector-map.js';

// Teach MapLibre how to fetch `cog://` raster tiles (src/cog.js).
maplibregl.addProtocol('cog', cogProtocol);
// A year's layers can ask for several dozen tiles at once.
maplibregl.setMaxParallelImageRequests(32);

// ------------------------------------------------------------------
// The layers come straight from the hap-mosaics STAC catalog: every Web
// Mercator mosaic served from this site is a layer, filed under the year
// its flying started, unless /site.json leaves it out. `npm run build`
// writes /site.json from layers.yaml, along with the present-day imagery
// at the top of the timeline and the dark backdrop under it all. A mosaic
// published to the catalog appears on the next page load.
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

// The present day, the newest year on the timeline, and the dark map
// under every year; both from /site.json.
var BASE = { layerId: 'imagery-base', year: 2025, label: '2025' };
var BACKDROP = null;

// Charcoal until the backdrop's first tiles arrive.
var NO_DATA = '#2a2c2e';

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
    // A flat map: no tilting into an oblique view, by mouse or by touch.
    // The two-finger swipe that would tilt it changes the year instead.
    maxPitch: 0,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
    style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': NO_DATA } }
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
// Labels: today's place, street and water names from OpenStreetMap,
// from the same vector tiles as the backdrop (src/vector-map.js), over
// every year. The backdrop draws no names, so these are the only ones.
// Light text in a dark halo reads over pale paddocks and dark roofs
// alike. The labels button turns them off, and the page remembers.
// ------------------------------------------------------------------
var NAME = ['coalesce', ['get', 'name_en'], ['get', 'name']];
var HALO = { 'text-halo-color': 'rgba(0, 0, 0, 0.8)', 'text-halo-width': 1.5, 'text-halo-blur': 0.5 };
var INK = '#f2f2f2';
var WATER_INK = '#b9d6ee';

// Bottom to top: when labels collide, the later layer wins its place.
var LABEL_LAYERS = [
    {
        id: 'labels-streets',
        'source-layer': 'transportation_name',
        minzoom: 13,
        // Roads only: paths and tracks would add cycle routes like "C8"
        filter: ['all',
            ['match', ['get', 'class'], ['path', 'track'], false, true],
            ['any',
                ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'], true, false],
                ['>=', ['zoom'], 15]]],
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 300,
            'text-field': NAME,
            'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14],
            'text-max-angle': 30
        },
        paint: Object.assign({ 'text-color': INK }, HALO)
    },
    {
        id: 'labels-waterways',
        'source-layer': 'waterway',
        minzoom: 12,
        filter: ['has', 'name'],
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 400,
            'text-field': NAME,
            'text-font': ['Noto Sans Italic'],
            'text-size': 12,
            'text-letter-spacing': 0.1
        },
        paint: Object.assign({ 'text-color': WATER_INK }, HALO)
    },
    {
        id: 'labels-water',
        'source-layer': 'water_name',
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        layout: {
            'text-field': NAME,
            'text-font': ['Noto Sans Italic'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 11, 16, 15],
            'text-letter-spacing': 0.1,
            'text-max-width': 8
        },
        paint: Object.assign({ 'text-color': WATER_INK }, HALO)
    },
    {
        id: 'labels-suburbs',
        'source-layer': 'place',
        minzoom: 11,
        maxzoom: 17,
        filter: ['match', ['get', 'class'], ['suburb', 'neighbourhood', 'hamlet', 'isolated_dwelling'], true, false],
        layout: {
            'text-field': NAME,
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 16, 13],
            'text-transform': 'uppercase',
            'text-letter-spacing': 0.12,
            'text-max-width': 8
        },
        paint: Object.assign({ 'text-color': INK }, HALO)
    },
    {
        id: 'labels-towns',
        'source-layer': 'place',
        maxzoom: 14,
        filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
        layout: {
            'text-field': NAME,
            'text-font': ['Noto Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 18],
            'text-max-width': 8
        },
        paint: Object.assign({ 'text-color': INK }, HALO)
    }
];
LABEL_LAYERS = LABEL_LAYERS.map(function (l) { return Object.assign({ type: 'symbol', source: 'osm' }, l); });

// The overlay: today's roads, rail, lakes and rivers drawn light and
// semi-transparent over the year's photographs (src/vector-map.js).
// With the labels as well, it makes a hybrid map of the past. Off
// until the roads button turns it on.
var OVERLAY_LAYERS = overlayLayers('osm');

// The mosaics go in beneath this layer: above the backdrop and the
// present day, below the overlay and the labels.
var ABOVE_PHOTOS = OVERLAY_LAYERS[0].id;

// A button that shows or hides a set of layers. The page remembers the
// choice in the browser, under `key`.
function layerSwitch(key, onByDefault, layers, html, title) {
    var sw = { on: onByDefault, layers: layers, button: document.createElement('button') };
    try {
        var saved = localStorage.getItem(key);
        if (saved) sw.on = saved === 'on';
    } catch (e) { /* storage blocked */ }
    var b = sw.button;
    b.type = 'button';
    b.className = 'switch-btn';
    b.innerHTML = html;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.setAttribute('aria-pressed', String(sw.on));
    b.addEventListener('click', function () {
        sw.on = !sw.on;
        try { localStorage.setItem(key, sw.on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
        layers.forEach(function (l) {
            if (canberraMap.getLayer(l.id)) canberraMap.setLayoutProperty(l.id, 'visibility', sw.on ? 'visible' : 'none');
        });
        b.setAttribute('aria-pressed', String(sw.on));
        if (BACKDROP) renderAttribution();
    });
    return sw;
}

// Add a switch's layers, shown or hidden as it stands.
function addSwitched(sw) {
    sw.layers.forEach(function (l) {
        canberraMap.addLayer(Object.assign({}, l, {
            layout: Object.assign({}, l.layout, { visibility: sw.on ? 'visible' : 'none' })
        }));
    });
}

var labels = layerSwitch('hapmap-labels', true, LABEL_LAYERS, 'Aa', 'Place names');
var overlay = layerSwitch('hapmap-overlay', false, OVERLAY_LAYERS,
    '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M3 16 L17 4"/><path d="M5 3 L15 17"/><path d="M2 9 q2.5 -2 5 0 t5 0" stroke-width="1.5"/></svg>',
    'Roads and water over the photographs');
canberraMap.addControl({
    onAdd: function () {
        var group = document.createElement('div');
        group.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        group.appendChild(labels.button);
        group.appendChild(overlay.button);
        return group;
    },
    onRemove: function () {}
}, 'top-left');

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

// The backdrop goes in first, at the bottom, then the present day
// above it, then the overlay and the labels on top; the mosaics are
// added beneath the overlay as they are first needed, and the timeline
// is built once the catalog has been read.
canberraMap.on('load', async function () {
    var SITE = await sitePromise;
    Object.assign(BASE, SITE.base, { label: String(SITE.base.year) });
    BACKDROP = SITE.backdrop;
    activeYear = BASE.year;
    canberraMap.addSource('osm', { type: 'vector', url: BACKDROP.url });
    backdropLayers('osm').forEach(function (l) { canberraMap.addLayer(l); });
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
    addSwitched(overlay);
    addSwitched(labels);

    MOSAICS = await mosaicsLoaded;
    YEARS = Array.from(new Set(MOSAICS.map(function (m) { return m.year; })));
    buildTimeline();
    onView();
    canberraMap.on('move', onMove);
    canberraMap.on('moveend', onView);
});

// While the map moves, the dots and the stack follow it a few times a
// second, so a layer newly in view starts loading before the map stops.
// The map is left alone while the stack stays the same.
var moveTimer = null;

function onMove() {
    if (moveTimer !== null) return;
    moveTimer = setTimeout(function () {
        moveTimer = null;
        sampleView();
        updateDots();
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
        var inView = MOSAICS.filter(inViewNow).sort(function (a, b) {
            return Math.abs(a.year - activeYear) - Math.abs(b.year - activeYear);
        });
        prefetchHeaders(inView.map(function (m) { return location.origin + m.display; }));
    });
}

// ------------------------------------------------------------------
// What is in view. "The view" is the map left of the timeline, sampled
// as a 16 x 16 grid of points. A mosaic earns its year a dot when it
// covers more than 30% of those points, or when the whole of it fits in
// the view; a sliver at the edge of the view does not.
// ------------------------------------------------------------------
var GRID = 16;
var DOT_SHARE = 0.3;
var FADE_MS = 800;
var samples = []; // [lng, lat] points across the view
var stack = []; // the mosaics drawn now, top first

function viewSize() {
    var canvas = canberraMap.getCanvas();
    var w = canvas.clientWidth - document.getElementById('timeline').offsetWidth;
    return [Math.max(1, w), canvas.clientHeight];
}

// Does the whole of mosaic m fit in a view w x h pixels? Testing the
// corners of its bounding box is exact while the map points north.
function fitsInView(m, w, h) {
    return m.footprint.every(function (poly) {
        var b = poly.bbox;
        return [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]].every(function (c) {
            var pt = canberraMap.project(c);
            return pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h;
        });
    });
}

// Sample the view, then note for every mosaic the share of it that the
// mosaic covers and whether the mosaic fits inside it.
function sampleView() {
    var size = viewSize();
    samples = [];
    for (var i = 0; i < GRID; i++) {
        for (var j = 0; j < GRID; j++) {
            var ll = canberraMap.unproject([(i + 0.5) * size[0] / GRID, (j + 0.5) * size[1] / GRID]);
            samples.push([ll.lng, ll.lat]);
        }
    }
    MOSAICS.forEach(function (m) {
        var hits = 0;
        samples.forEach(function (p) { if (covers(m, p)) hits++; });
        m.share = hits / samples.length;
        m.fits = fitsInView(m, size[0], size[1]);
    });
}

function inViewNow(m) {
    return m.share > 0 || m.fits;
}

function earnsDot(m) {
    return m.share > DOT_SHARE || m.fits;
}

// What to draw. For the chosen year, the newest year at or before it
// with a dot, and every one of that year's mosaics in view, the
// sharpest on top. Nothing older shows through: where that year has no
// photograph, the map is charcoal.
function stackFor(year) {
    if (year >= BASE.year) return [];
    var earlier = litYears.filter(function (y) { return y <= year; });
    if (!earlier.length) return [];
    var shown = earlier[earlier.length - 1];
    // MOSAICS is sorted sharpest first within a year: top first.
    return MOSAICS.filter(function (m) { return m.year === shown && inViewNow(m); });
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
    }, ABOVE_PHOTOS);
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

// Layers joining the stack fade in, in stack order, beneath the overlay;
// layers leaving it fade out. The present day shows only when it is the
// year chosen; under any other year the backdrop shows wherever that
// year has no photograph.
function drawStack() {
    var next = stackFor(activeYear);
    var leaving = stack.filter(function (m) { return next.indexOf(m) < 0; });
    stack = next;
    next.slice().reverse().forEach(function (m) {
        ensureLayer(m);
        canberraMap.moveLayer(m.layerId, ABOVE_PHOTOS);
        fade(m, 1);
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
// the present day, and OpenStreetMap wherever the backdrop shows or
// the overlay or labels are on.
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
    if (activeYear >= BASE.year) parts.push(BASE.attribution);
    var backdropShows = activeYear < BASE.year &&
        samples.some(function (p) { return !stack.some(function (m) { return covers(m, p); }); });
    if (backdropShows || labels.on || overlay.on) parts.push(BACKDROP.attribution);
    attributionEl.innerHTML = parts.join(' &middot; ');
}

// ------------------------------------------------------------------
// Timeline. The handle can rest on any year; a dot marks each year
// with a mosaic that fills enough of the view (see earnsDot), and the
// dots follow the map as it moves.
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

// A year keeps its dot while one of its mosaics earns it. The dot is
// grey when even the sharpest of those is coarser than the screen, so
// zooming in past it would show only bigger pixels.
function updateDots() {
    var sharpest = new Map([[BASE.year, 0]]); // year -> finest gsd earning a dot
    MOSAICS.forEach(function (m) {
        if (sharpest.has(m.year) && sharpest.get(m.year) <= m.gsd) return;
        if (earnsDot(m)) sharpest.set(m.year, m.gsd);
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
// Touch: two fingers side by side, swiped up or down together, step
// between the years with a dot, as the arrow keys do. The handle
// follows the fingers: down the screen is back in time. It is the
// gesture MapLibre would use to tilt the map, which is turned off; a
// pinch moves the fingers apart rather than together, so it still
// zooms. Once a swipe is recognised the map stops panning until the
// fingers lift.
// ------------------------------------------------------------------
var SWIPE_STEP_PX = 40; // finger travel per year
var SWIPE_START_PX = 6; // travel before deciding what the gesture is
var swipe = null; // { start: [p, p], anchor, scrubbing } while two fingers are down

function touchPoints(e) {
    return [0, 1].map(function (i) { return [e.touches[i].clientX, e.touches[i].clientY]; });
}

// Do two finger movements make a vertical swipe together? Each moves
// more up or down than sideways, both the same way, and the fingers
// sit side by side rather than one above the other.
function isYearSwipe(start, now) {
    var a = [now[0][0] - start[0][0], now[0][1] - start[0][1]];
    var b = [now[1][0] - start[1][0], now[1][1] - start[1][1]];
    var apart = [start[1][0] - start[0][0], start[1][1] - start[0][1]];
    return Math.abs(a[1]) > Math.abs(a[0]) && Math.abs(b[1]) > Math.abs(b[0]) &&
        (a[1] > 0) === (b[1] > 0) && Math.abs(apart[0]) > Math.abs(apart[1]);
}

function setMapGestures(on) {
    [canberraMap.dragPan, canberraMap.touchZoomRotate].forEach(function (h) { on ? h.enable() : h.disable(); });
}

// Listening on the map's outer element, in the capture phase, sees each
// touch before MapLibre does, so a swipe's moves can be kept from it.
var mapEl = canberraMap.getContainer();

mapEl.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
        var p = touchPoints(e);
        swipe = { start: p, anchor: (p[0][1] + p[1][1]) / 2, scrubbing: false, decided: false };
    } else if (swipe && !swipe.scrubbing) {
        swipe = null; // a third finger: not a swipe
    }
}, { capture: true, passive: true });

mapEl.addEventListener('touchmove', function (e) {
    if (!swipe || e.touches.length !== 2) return;
    var p = touchPoints(e);
    if (!swipe.decided) {
        var moved = Math.max(Math.abs(p[0][1] - swipe.start[0][1]), Math.abs(p[1][1] - swipe.start[1][1]),
            Math.abs(p[0][0] - swipe.start[0][0]), Math.abs(p[1][0] - swipe.start[1][0]));
        if (moved < SWIPE_START_PX) return;
        swipe.decided = true;
        swipe.scrubbing = isYearSwipe(swipe.start, p);
        if (!swipe.scrubbing) return; // a pinch or a pan: the map's
        stopPlayback();
        closeFrame();
        setMapGestures(false);
        swipe.anchor = (p[0][1] + p[1][1]) / 2;
    }
    if (!swipe.scrubbing) return;
    e.stopPropagation();
    e.preventDefault();
    var y = (p[0][1] + p[1][1]) / 2;
    while (Math.abs(y - swipe.anchor) >= SWIPE_STEP_PX) {
        var down = y > swipe.anchor;
        swipe.anchor += down ? SWIPE_STEP_PX : -SWIPE_STEP_PX;
        var year = nextLitYear(down ? -1 : 1);
        if (year === null) {
            swipe.anchor = y; // at the end of the timeline: wait here
            break;
        }
        setYear(year);
        if (navigator.vibrate) navigator.vibrate(8);
    }
}, { capture: true, passive: false });

function endSwipe(e) {
    if (!swipe || e.touches.length >= 2) return;
    var was = swipe.scrubbing;
    swipe = null;
    if (was) {
        e.stopPropagation();
        setMapGestures(true);
        gestureHint.hidden = true;
    }
}
mapEl.addEventListener('touchend', endSwipe, { capture: true });
mapEl.addEventListener('touchcancel', endSwipe, { capture: true });

// A one-time hint on touch screens, which offer no other clue that the
// gesture exists. It goes at the first tap, the first swipe, or after
// eight seconds, and is not shown again.
var gestureHint = document.getElementById('gesture-hint');
(function () {
    var seen = true;
    try { seen = localStorage.getItem('hapmap-gesture-hint') === 'seen'; } catch (e) { /* storage blocked */ }
    if (seen || !window.matchMedia('(pointer: coarse)').matches) return;
    try { localStorage.setItem('hapmap-gesture-hint', 'seen'); } catch (e) { /* storage blocked */ }
    gestureHint.hidden = false;
    var hide = function () { gestureHint.hidden = true; };
    setTimeout(hide, 8000);
    mapEl.addEventListener('touchstart', hide, { once: true, passive: true });
})();

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
