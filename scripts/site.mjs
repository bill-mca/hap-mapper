// /site.json, made from layers.yaml: the catalog items to leave out, the
// present-day imagery, and the dark backdrop under every year. The build
// writes it into dist/; `npx vite` serves it fresh on every request.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

export function siteJson(root) {
    const spec = YAML.parse(readFileSync(join(root, 'layers.yaml'), 'utf8'));
    if (!spec.base) throw new Error('layers.yaml: no base layer');
    if (!spec.backdrop) throw new Error('layers.yaml: no backdrop');
    return {
        built: new Date().toISOString(),
        exclude: spec.exclude || [],
        base: spec.base,
        backdrop: spec.backdrop,
    };
}
