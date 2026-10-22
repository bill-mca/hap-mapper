// The dark grey backdrop under every year, drawn from OpenStreetMap's
// vector tiles (OpenMapTiles schema, from OpenFreeMap) in the greys of
// Esri's Dark Gray Canvas, which it replaced: land, water, parks,
// buildings, roads and rail, and no names, so the labels in main.js are
// the only ones on the map.

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
                'line-width': ['match', ['get', 'class'], 'river', widths([10, 1, 18, 8]), widths([12, 0.5, 18, 3])]
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
    return layers.map(function (l) {
        var layer = Object.assign({}, l, { id: 'backdrop-' + l.id });
        if (l.type !== 'background') layer.source = source;
        return layer;
    });
}
