import 'server-only';

import { deflateSync } from 'node:zlib';

// Deterministic, original PNGs for simulated runs. No external service, no paid call, and no real
// business imagery: the colour is derived from the address so two different candidates are two
// different files (the duplicate check sees different checksums, exactly as it would in production).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

function seedValue(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** A valid RGB PNG whose colour is stable for a given seed. */
export function simulatedPng(seed: string, width = 640, height = 420): Uint8Array {
  const value = seedValue(seed);
  const red = 40 + (value & 0x9f);
  const green = 40 + ((value >>> 8) & 0x9f);
  const blue = 40 + ((value >>> 16) & 0x9f);
  const rowLength = 1 + width * 3;
  const raw = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * rowLength;
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = offset + 1 + x * 3;
      // A soft diagonal band keeps the image readable as a placeholder without text.
      const band = ((x + y) % 120 < 60 ? 24 : 0) + ((x * 3 + y) % 17);
      raw[at] = (red + band) & 0xff;
      raw[at + 1] = (green + band) & 0xff;
      raw[at + 2] = (blue + band) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** The simulated file name for a candidate address, matching the path's last segment. */
export function simulatedFileName(url: string): string {
  try {
    const name = new URL(url).pathname.split('/').pop() ?? '';
    const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
    return cleaned || 'simulated-image.png';
  } catch {
    return 'simulated-image.png';
  }
}
