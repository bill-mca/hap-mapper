// The map drawn from OpenStreetMap's vector tiles (OpenMapTiles schema,
// from OpenFreeMap), in two parts, neither with names, so the labels in
// main.js are the only ones on the map:
//
// - the dark grey backdrop under every year, in the greys of Esri's
//   Dark Gray Canvas, which it replaced: land, water, parks, buildings,
//   roads and rail;
// - the overlay, which the roads button lays over the photographs, like
//   a hybrid map: today's roads, rail, buildings, lakes and rivers,
//   light and semi-transparent so the year's photograph shows through.

var LAND = '#4c4c4e';
var GREEN = '#494b4a';
var WATER = '#232227';
var BUILDING = '#444446';
var ROAD = '#5c5c5e';
var MAJOR = '#646466';
var MOTORWAY = '#6c6c6e';

var LINES = { 'line-cap': 'round', 'line-join': 'round' };

function polygons(filter) {
    return ['all', ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false], filter];
}

function roadClass(classes) {
    return ['all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], classes, true, false]];
}

// Line widths in pixels by zoom, growing as the map closes in.
function widths(stops) {
    return ['interpolate', ['exponential', 1.5], ['zoom']].concat(stops);
}

// A river's width, or a stream's: [zoom, river, stream] stops. MapLibre
// allows one zoom curve per expression, so the choice goes inside it.
function riverWidths(stops) {
    return widths(stops.flatMap(function (s) {
        return [s[0], ['match', ['get', 'class'], 'river', s[1], s[2]]];
    }));
}

// Bottom to top. `source` is the id of the OpenMapTiles vector source.
export function backdropLayers(source) {
    var layers = [
        { id: 'land', type: 'background', paint: { 'background-color': LAND } },
        {
            id: 'green', type: 'fill', 'source-layer': 'landcover',
            filter: polygons(['match', ['get', 'class'], ['wood', 'grass', 'farmland'], true, false]),
            paint: { 'fill-color': GREEN }
        },
        {
            id: 'parks', type: 'fill', 'source-layer': 'landuse',
            filter: polygons(['match', ['get', 'class'], ['park', 'cemetery', 'pitch', 'stadium'], true, false]),
            paint: { 'fill-color': GREEN }
        },
        {
            id: 'park-reserves', type: 'fill', 'source-layer': 'park',
            filter: polygons(true),
            paint: { 'fill-color': GREEN }
        },
        {
            id: 'water', type: 'fill', 'source-layer': 'water',
            filter: polygons(['!=', ['get', 'brunnel'], 'tunnel']),
            paint: { 'fill-color': WATER, 'fill-antialias': false }
        },
        {
            id: 'waterways', type: 'line', 'source-layer': 'waterway', minzoom: 10,
            filter: ['!=', ['get', 'brunnel'], 'tunnel'],
            layout: LINES,
            paint: {
                'line-color': WATER,
                'line-width': riverWidths([[10, 1, 0.25], [18, 8, 3]])
            }
        },
        {
            id: 'airports', type: 'fill', 'source-layer': 'aeroway',
            filter: polygons(true),
            paint: { 'fill-color': ROAD }
        },
        {
            id: 'buildings', type: 'fill', 'source-layer': 'building', minzoom: 14,
            paint: { 'fill-color': BUILDING, 'fill-outline-color': '#3e3e40' }
        },
        {
            id: 'rail', type: 'line', 'source-layer': 'transportation', minzoom: 12,
            filter: roadClass(['rail', 'transit']),
            layout: LINES,
            paint: { 'line-color': ROAD, 'line-width': widths([12, 0.5, 18, 2]) }
        },
        {
            id: 'roads-minor', type: 'line', 'source-layer': 'transportation', minzoom: 12,
            filter: roadClass(['minor', 'service']),
            layout: LINES,
            paint: { 'line-color': ROAD, 'line-width': widths([12, 0.5, 18, 10]) }
        },
        {
            id: 'roads-major', type: 'line', 'source-layer': 'transportation', minzoom: 8,
            filter: roadClass(['trunk', 'primary', 'secondary', 'tertiary']),
            layout: LINES,
            paint: { 'line-color': MAJOR, 'line-width': widths([8, 0.5, 18, 16]) }
        },
        {
            id: 'motorways', type: 'line', 'source-layer': 'transportation', minzoom: 6,
            filter: roadClass(['motorway']),
            layout: LINES,
            paint: { 'line-color': MOTORWAY, 'line-width': widths([6, 0.5, 18, 20]) }
        },
        {
            id: 'state-borders', type: 'line', 'source-layer': 'boundary',
            filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
            layout: LINES,
            paint: { 'line-color': MOTORWAY, 'line-dasharray': [3, 2], 'line-width': widths([6, 0.5, 18, 3]) }
        }
    ];
    return named('backdrop-', layers, source);
}

var O_WATER = '#8cc4ff';
var O_ROAD = '#ffffff';
var O_BUILDING = '#2a2c2e'; // the page's charcoal
// Main roads in the site's magenta (--hap-accent): paler for the
// arterial roads, full strength for the motorways.
var O_MAJOR = '#ff7cc3';
var O_MOTORWAY = '#e6198a';

// The overlay's lines are see-through, and where two of them overlap
// the photograph is covered twice and shows brighter. Round ends reach
// past the node where one road's line meets the next, so the overlay's
// lines end square, flush with the node.
var O_LINES = { 'line-cap': 'butt', 'line-join': 'round' };

// Standing water only: lakes, ponds and reservoirs. A river's extent is
// left out; its centre line is in the waterways layer.
var STILL_WATER = polygons(['all',
    ['!=', ['get', 'brunnel'], 'tunnel'],
    ['!=', ['get', 'class'], 'river']]);

var MAIN_ROADS = ['trunk', 'primary', 'secondary', 'tertiary'];

// Bottom to top, over the photographs.
export function overlayLayers(source) {
    var layers = [
        {
            id: 'water', type: 'fill', 'source-layer': 'water',
            filter: STILL_WATER,
            paint: { 'fill-color': O_WATER, 'fill-opacity': 0.2 }
        },
        {
            id: 'shores', type: 'line', 'source-layer': 'water',
            filter: STILL_WATER,
            layout: O_LINES,
            paint: { 'line-color': O_WATER, 'line-opacity': 0.7, 'line-width': widths([10, 0.5, 18, 2]) }
        },
        {
            id: 'waterways', type: 'line', 'source-layer': 'waterway', minzoom: 10,
            filter: ['!=', ['get', 'brunnel'], 'tunnel'],
            layout: O_LINES,
            paint: {
                'line-color': O_WATER,
                'line-opacity': 0.7,
                'line-width': riverWidths([[10, 0.75, 0.25], [18, 5, 2]])
            }
        },
        {
            id: 'buildings', type: 'fill', 'source-layer': 'building', minzoom: 14,
            paint: { 'fill-color': O_BUILDING, 'fill-opacity': 0.7 }
        },
        {
            id: 'rail', type: 'line', 'source-layer': 'transportation', minzoom: 12,
            filter: roadClass(['rail', 'transit']),
            paint: { 'line-color': O_ROAD, 'line-opacity': 0.5, 'line-dasharray': [3, 2], 'line-width': widths([12, 1, 18, 3]) }
        },
        {
            id: 'roads-minor', type: 'line', 'source-layer': 'transportation', minzoom: 12,
            filter: roadClass(['minor', 'service']),
            layout: O_LINES,
            paint: { 'line-color': O_ROAD, 'line-opacity': 0.45, 'line-width': widths([12, 0.5, 18, 5]) }
        },
        {
            // A soft magenta glow under the main roads and motorways:
            // the same lines, three times as wide, blurred to nothing at
            // their edges.
            id: 'roads-glow', type: 'line', 'source-layer': 'transportation', minzoom: 8,
            filter: roadClass(MAIN_ROADS.concat(['motorway'])),
            layout: O_LINES,
            paint: {
                'line-color': O_MOTORWAY,
                'line-opacity': 0.35,
                'line-width': widths([8, 3, 18, 30]),
                'line-blur': widths([8, 3, 18, 30])
            }
        },
        {
            id: 'roads-major', type: 'line', 'source-layer': 'transportation', minzoom: 8,
            filter: roadClass(MAIN_ROADS),
            layout: O_LINES,
            paint: { 'line-color': O_MAJOR, 'line-opacity': 0.6, 'line-width': widths([8, 0.75, 18, 8]) }
        },
        {
            id: 'motorways', type: 'line', 'source-layer': 'transportation', minzoom: 6,
            filter: roadClass(['motorway']),
            layout: O_LINES,
            paint: { 'line-color': O_MOTORWAY, 'line-opacity': 0.7, 'line-width': widths([6, 1, 18, 10]) }
        }
    ];
    return named('overlay-', layers, source);
}

function named(prefix, layers, source) {
    return layers.map(function (l) {
        var layer = Object.assign({}, l, { id: prefix + l.id });
        if (l.type !== 'background') layer.source = source;
        return layer;
    });
}
