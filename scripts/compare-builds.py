"""Compare two or more builds of the map for speed, from a fresh browser each run.

For each build: the page load to its first complete map (2025, over the lake),
a tour of six backdrop-only views (time until each view's tiles have arrived),
a three-second pan over new ground (frame times), and the bytes and requests
by host. Bytes come from Playwright's request log, which sees MapLibre's web
workers; Chrome's own (CDP) log does not, and CDP's CPU and network throttling
do not reach them either, so for a slow device run the whole thing inside a
CPU-limited cgroup instead. A warm-up run of each build comes first, to fill
the edge caches, then the builds alternate.

    uv run --with playwright python scripts/compare-builds.py out.json 5 \
        esri=https://984a32eb-hapmap-dev.u5007063.workers.dev/ \
        ofm=https://4efb34c4-hapmap-dev.u5007063.workers.dev/
    systemd-run --user --scope -p CPUQuota=100% uv run ...   # one CPU core

Chromium is /usr/bin/chromium, as on hectar. See docs/backdrop-performance.md.
"""
import json, statistics, sys, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

OUT, TRIALS = sys.argv[1], int(sys.argv[2])
TARGETS = [a.split('=', 1) for a in sys.argv[3:]]

TOUR = [  # backdrop only: a year before any photograph
    [149.08, -35.41, 13],   # Tuggeranong
    [149.13, -35.18, 14],   # Gungahlin
    [149.23, -35.35, 15],   # Queanbeyan
    [149.13, -35.28, 16],   # Civic
    [149.06, -35.24, 12],   # Belconnen
    [149.09, -35.345, 17],  # Woden
]


INIT = '''
window.__idles = [];
(function hook() {
  if (!window.hapmap) return setTimeout(hook, 5);
  window.hapmap.map.on('idle', function () {
    var m = window.hapmap.map;
    if (m.getLayer('imagery-base') && window.hapmap.mosaics().length) window.__idles.push(performance.now());
  });
})();
'''

# Resolve when the map has settled: at once if it already has, else on
# its next idle event, and give up after 20 s rather than hang.
SETTLED = '''() => new Promise(r => {
    var m = window.hapmap.map;
    if (m.loaded() && m.areTilesLoaded() && !m.isMoving()) return r('already');
    var t = setTimeout(() => r('timeout'), 20000);
    m.once('idle', () => { clearTimeout(t); r('idle'); });
})'''

def host_group(url):
    h = urlparse(url).hostname or ''
    if 'openfreemap' in h: return 'openfreemap'
    if 'arcgisonline' in h:
        return 'esri-canvas' if 'Canvas' in url else 'esri-imagery'
    if 'workers.dev' in h or 'hapmap' in h: return 'hapmap'
    return 'other'

def run(browser, url):
    ctx = browser.new_context(viewport={'width': 1400, 'height': 900})
    pg = ctx.new_page()
    done = []  # (url, bytes)

    def finished(req):
        try:
            sz = req.sizes()
            done.append((req.url, sz['responseBodySize'] + sz['responseHeadersSize']))
        except Exception:
            pass
    ctx.on('requestfinished', finished)
    pg.add_init_script(INIT)

    pg.goto(url)
    pg.wait_for_function('window.__idles && window.__idles.length > 0', timeout=180000)
    load = pg.evaluate('window.__idles[0]')
    bytes_load = sum(n for _, n in done)

    # The tour: jump, then time until every tile in view has arrived,
    # checked each frame; each view is new to this context.
    pg.evaluate('window.hapmap.setYear(1900)')
    pg.wait_for_timeout(100)
    pg.evaluate(SETTLED)
    tour = []
    for lng, lat, z in TOUR:
        tour.append(pg.evaluate('''([c, z]) => new Promise(r => {
            var m = window.hapmap.map, t0 = performance.now();
            m.jumpTo({center: c, zoom: z});
            (function check() {
                if (m.areTilesLoaded() && m.loaded()) r(performance.now() - t0);
                else requestAnimationFrame(check);
            })();
        })''', [[lng, lat], z]))
        pg.evaluate(SETTLED)

    # The pan: three screen widths in three seconds over new ground,
    # frame by frame, then until the map settles.
    pan = pg.evaluate('''() => new Promise(r => {
        var m = window.hapmap.map;
        m.jumpTo({center: [149.17, -35.30], zoom: 15});
        var settled = (go) => (m.loaded() && m.areTilesLoaded() && !m.isMoving()) ? go() : m.once('idle', go);
        setTimeout(() => settled(() => {
            var frames = [], last = performance.now(), going = true, t0 = last;
            (function tick(t) { if (!going) return; frames.push(t - last); last = t; requestAnimationFrame(tick); })(last);
            m.once('moveend', () => {
                going = false;
                settled(() => r({frames: frames.slice(1), settle: performance.now() - t0}));
            });
            m.panBy([-3 * 1400, 0], {duration: 3000, easing: t => t});
        }), 100);
    })''')
    by_host, count = {}, {}
    for u, n in done:
        g = host_group(u)
        by_host[g] = by_host.get(g, 0) + n
        count[g] = count.get(g, 0) + 1
    heap = pg.evaluate('performance.memory ? performance.memory.usedJSHeapSize : null')
    ctx.close()
    f = sorted(pan['frames'])
    return {
        'load_ms': load, 'bytes_at_load': bytes_load,
        'tour_ms': tour, 'tour_total_ms': sum(tour),
        'pan_frames': len(f), 'pan_median_ms': statistics.median(f),
        'pan_p95_ms': f[int(len(f) * 0.95)], 'pan_slow_frames': sum(1 for x in f if x > 33.4),
        'pan_settle_ms': pan['settle'],
        'bytes': by_host, 'requests': count, 'bytes_total': sum(by_host.values()), 'heap': heap,
    }

results = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/chromium')
    for name, url in TARGETS:  # warm the edge caches, discard
        run(b, url)
    for i in range(TRIALS):
        for name, url in (TARGETS if i % 2 == 0 else TARGETS[::-1]):
            r = run(b, url)
            results.setdefault(name, []).append(r)
            print(name, i, round(r['load_ms']), round(r['tour_total_ms']),
                  round(r['pan_median_ms'], 1), r['pan_slow_frames'], r['bytes_total'] // 1024, 'KiB',
                  {k: v // 1024 for k, v in r['bytes'].items()}, flush=True)
    b.close()
json.dump(results, open(OUT, 'w'), indent=1)
