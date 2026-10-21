"""Make the web copies of the map's mosaics: the same pixels on the same grid,
re-encoded as WebP COGs with alpha, a tenth the size of the DEFLATE masters.

The masters, in hap-mosaics' derived/ folder, stay as they are: they are the
published Web Mercator COGs at hapmap.app/cog/, lossless, for GIS use. The web
copies go to web/<same name> in the bucket, where the Worker finds them and
the map draws them instead. A grey master becomes grey RGB, and its NoData or
alpha becomes the alpha band, because WebP holds only RGB or RGBA.

    python3 scripts/web-cogs.py list                  # what would be made
    python3 scripts/web-cogs.py make [ids...]         # make them in .cache/web-cogs/
    python3 scripts/web-cogs.py upload [ids...]       # copy what is made to web/ in R2

Which mosaics: every Web Mercator item in the published catalog with a COG
at hapmap.app/cog/, less layers.yaml's exclude list. Reads the catalog from
~/hap-mosaics/web/stac and the masters from ~/hap-mosaics/derived; writes only
under .cache/web-cogs/ and, on upload, to the bucket's web/ prefix.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HAP = Path(os.environ.get("HAP_MOSAICS", Path.home() / "hap-mosaics"))
STAC = HAP / "web" / "stac"
MASTERS = HAP / "derived"
OUT = ROOT / ".cache" / "web-cogs"
REMOTE = os.environ.get("WEB_COGS_REMOTE", "gudgenby-r2:hap-mapper-tiles/web/")
QUALITY = 85
SITE = "https://hapmap.app/cog/"


def excluded():
    """The ids in layers.yaml's exclude list, read without a YAML library."""
    ids, inside = set(), False
    for line in (ROOT / "layers.yaml").read_text().splitlines():
        if line.startswith("exclude:"):
            inside = True
        elif inside and line.strip().startswith("- "):
            ids.add(line.strip()[2:].strip())
        elif inside and line and not line.startswith(" "):
            inside = False
    return ids


def shown():
    """[(item id, COG file name)] for every mosaic the map can draw."""
    out, skip = [], excluded()
    for path in sorted(STAC.glob("*/*/*.json")):
        item = json.loads(path.read_text())
        if item.get("type") != "Feature" or item["id"] in skip:
            continue
        data = item.get("assets", {}).get("data", {})
        if item["properties"].get("proj:code") != "EPSG:3857" or not data.get("href", "").startswith(SITE):
            continue
        out.append((item["id"], data["href"][len(SITE):]))
    return out


def bands(path):
    info = json.loads(subprocess.run(["gdalinfo", "-json", str(path)], check=True,
                                     capture_output=True, text=True).stdout)
    return [b.get("colorInterpretation", "Undefined") for b in info["bands"]], \
        info["bands"][0].get("noDataValue")


def recipe(path):
    """gdal_translate band arguments that turn a master into RGBA."""
    interp, nodata = bands(path)
    if interp[:4] == ["Red", "Green", "Blue", "Alpha"]:
        b = ["-b", "1", "-b", "2", "-b", "3", "-b", "4"]
    elif interp[:3] == ["Red", "Green", "Blue"]:
        b = ["-b", "1", "-b", "2", "-b", "3", "-b", "mask"]
    elif len(interp) >= 2 and interp[1] == "Alpha":
        b = ["-b", "1", "-b", "1", "-b", "1", "-b", "2"]
    elif len(interp) == 1:
        b = ["-b", "1", "-b", "1", "-b", "1", "-b", "mask"]
    else:
        raise SystemExit(f"{path.name}: no recipe for bands {interp}")
    return b + ["-colorinterp", "red,green,blue,alpha", "-a_nodata", "none"], interp, nodata


def make(name):
    src, dst = MASTERS / name, OUT / name
    if dst.exists():
        print(f"{name}: made already")
        return
    args, interp, nodata = recipe(src)
    tmp = dst.with_suffix(".part.tif")
    print(f"{name}: {'/'.join(interp)} nodata={nodata} -> RGBA WebP q{QUALITY}", flush=True)
    subprocess.run(["gdal_translate", "-q", "-of", "COG", *args,
                    "-co", "COMPRESS=WEBP", "-co", f"QUALITY={QUALITY}",
                    "-co", f"OVERVIEW_QUALITY={QUALITY}", "-co", "BLOCKSIZE=512",
                    "-co", "NUM_THREADS=ALL_CPUS", "-co", "BIGTIFF=IF_SAFER",
                    str(src), str(tmp)], check=True)
    tmp.rename(dst)
    print(f"{name}: {src.stat().st_size / 1e6:.0f} MB -> {dst.stat().st_size / 1e6:.0f} MB", flush=True)


def main():
    cmd, ids = (sys.argv[1] if len(sys.argv) > 1 else "list"), set(sys.argv[2:])
    todo = [(i, n) for i, n in shown() if not ids or i in ids]
    OUT.mkdir(parents=True, exist_ok=True)
    if cmd == "list":
        for i, n in todo:
            src = MASTERS / n
            print(f"{i:45} {src.stat().st_size / 1e6 if src.exists() else -1:8.0f} MB  {'made' if (OUT / n).exists() else ''}")
    elif cmd == "make":
        # smallest first, so a long run has something to show early
        for i, n in sorted(todo, key=lambda t: (MASTERS / t[1]).stat().st_size):
            make(n)
    elif cmd == "upload":
        names = [n for _, n in todo if (OUT / n).exists()]
        subprocess.run(["rclone", "copy", "--s3-chunk-size=64M", "--transfers=4", "--progress",
                        str(OUT), REMOTE, *sum((["--include", n] for n in names), [])], check=True)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
