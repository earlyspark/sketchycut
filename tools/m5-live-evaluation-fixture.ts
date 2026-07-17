import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

export const M5_LIVE_EVALUATION_CASE_ID = "m5-rigid-structure-and-bilateral-motif" as const;
export const M5_LIVE_EVALUATION_BRIEF =
  "Make a rigid desktop container. Use the reference's rectilinear body as structural inspiration and its paired-dot rhythm as a sparse bilateral filled engraving. The body must remain rigid; the dots are decorative only." as const;

const WIDTH = 160;
const HEIGHT = 120;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])));
  return Buffer.concat([length, typeBytes, payload, checksum]);
}

function setPixel(
  pixels: Uint8Array,
  x: number,
  y: number,
  color: readonly [number, number, number],
): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const offset = (y * WIDTH + x) * 3;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function fillRectangle(
  pixels: Uint8Array,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: readonly [number, number, number],
): void {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) setPixel(pixels, x, y, color);
  }
}

function fillCircle(
  pixels: Uint8Array,
  centerX: number,
  centerY: number,
  radius: number,
  color: readonly [number, number, number],
): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(pixels, x, y, color);
      }
    }
  }
}

function syntheticPng(): Buffer {
  const white = [246, 243, 234] as const;
  const navy = [19, 42, 53] as const;
  const orange = [235, 111, 43] as const;
  const pixels = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let offset = 0; offset < pixels.length; offset += 3) {
    pixels.set(white, offset);
  }
  fillRectangle(pixels, 25, 34, 134, 100, navy);
  fillRectangle(pixels, 31, 40, 128, 94, white);
  fillRectangle(pixels, 41, 24, 118, 38, navy);
  fillRectangle(pixels, 47, 28, 112, 38, white);
  for (const y of [54, 72, 88]) {
    fillCircle(pixels, 48, y, 4, orange);
    fillCircle(pixels, 112, y, 4, orange);
  }
  const raw = Buffer.alloc((WIDTH * 3 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 3 + 1);
    raw[rowOffset] = 0;
    raw.set(pixels.subarray(y * WIDTH * 3, (y + 1) * WIDTH * 3), rowOffset + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export function createM5LiveEvaluationReference() {
  const bytes = syntheticPng();
  return {
    descriptor: {
      referenceId: "reference-1",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mediaType: "image/png" as const,
      width: WIDTH,
      height: HEIGHT
    },
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`
  };
}
