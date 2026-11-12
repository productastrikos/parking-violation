/**
 * Picture → ESC/POS bytes. The notice is sent as a 1-bit raster image
 * (GS v 0), which every ESC/POS thermal printer understands — so fonts,
 * the QR code and the layout come out the same on any brand, with no
 * code-page or font differences between printers.
 *
 * The canvas is expected to be pure black-and-white already (notice.ts
 * thresholds it), at the printer's dot width: 384 dots (58 mm) or 576 (80 mm).
 */
export function canvasToEscPos(canvas: HTMLCanvasElement, { feed = 4, cut = true } = {}): Uint8Array {
  const w = canvas.width;
  const h = canvas.height;
  const rowBytes = Math.ceil(w / 8);
  const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  const BAND = 64; // rows per GS v 0 block — small blocks suit small printer buffers
  const out: number[] = [0x1b, 0x40, 0x1b, 0x61, 0x01]; // ESC @ (reset) · ESC a 1 (centre)
  for (let y0 = 0; y0 < h; y0 += BAND) {
    const rows = Math.min(BAND, h - y0);
    out.push(0x1d, 0x76, 0x30, 0x00, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8);
    for (let y = y0; y < y0 + rows; y++) {
      for (let xb = 0; xb < rowBytes; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x < w && px[(y * w + x) * 4] < 128) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }
  out.push(0x1b, 0x64, feed); // ESC d n — feed so the tear bar clears the text
  if (cut) out.push(0x1d, 0x56, 0x42, 0x00); // GS V — partial cut (ignored by printers without a cutter)
  return Uint8Array.from(out);
}
