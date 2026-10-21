// Decodes COG blocks for src/cog.js, off the main thread.
//
// WebP blocks, and JPEG blocks the browser can read as they are (grey, or
// YCbCr), go through the browser's own image decoder and come back as RGBA.
// Anything else (DEFLATE, LZW, an RGB JPEG) goes through geotiff.js's
// decoders and comes back as the block's own interleaved samples.

import { getDecoder } from 'geotiff';

const WEBP = 50001;
const JPEG = 7;
const YCBCR = 6;

self.onmessage = async (e) => {
    const { id, compression, params, buffer } = e.data;
    try {
        let out;
        let rgba = false;
        if (compression === WEBP || (compression === JPEG && (params.samplesPerPixel === 1 || params.photometric === YCBCR))) {
            out = await native(compression, params, buffer);
            rgba = true;
        } else {
            out = await (await getDecoder(compression, params)).decode(buffer);
        }
        self.postMessage({ id, out, rgba }, [out]);
    } catch (err) {
        self.postMessage({ id, error: String((err && err.message) || err) });
    }
};

async function native(compression, params, buffer) {
    let bytes = new Uint8Array(buffer);
    if (compression === JPEG && params.JPEGTables) {
        // A JPEG-in-TIFF block leaves its tables in the TIFF header; put them
        // back: the tables without their end marker, then the block without
        // its start marker.
        const tables = params.JPEGTables;
        const whole = new Uint8Array(tables.length - 2 + bytes.length - 2);
        whole.set(tables.subarray(0, tables.length - 2), 0);
        whole.set(bytes.subarray(2), tables.length - 2);
        bytes = whole;
    }
    const type = compression === WEBP ? 'image/webp' : 'image/jpeg';
    const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer;
}
