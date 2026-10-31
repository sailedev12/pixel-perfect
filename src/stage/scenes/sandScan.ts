// Reading a small copy of the dancer video's frame: where her body is lit, and how brightly. The dancer's sand is
// born on those spots. This runs in a worker (sandScan.worker.ts), so copying the frame out of the video and going
// over its 69,000 pixels never costs the main thread a frame.

/** Size of the little copy of the video that gets read. */
export const SW = 320, SH = 216;

export interface ScanResult {
  /** Pixel index (row * SW + col) of each lit spot, and its brightness (0-1). */
  lit: Int32Array;
  litB: Float32Array;
  n: number;
  /** Per row: sum of the lit columns and how many there were (for her middle on each row). */
  rowSum: Float32Array;
  rowCnt: Float32Array;
  /** Her top and bottom rows, and the left and right of her shins. */
  top: number;
  bot: number;
  fMin: number;
  fMax: number;
}

const smooth = (k: number) => { k = k < 0 ? 0 : k > 1 ? 1 : k; return k * k * (3 - 2 * k); };

/**
 * Reads the RGBA pixels `d` into `lit` and `litB`. `footX` and `footW` are where her lower legs were last time
 * (columns), for leaving out the glow pooling around her feet. `unformed` (0-1) is how far she is from fully formed
 * (blowing away, or rising back out of a column of sand): then her feet are scattered sand like the rest of her, so
 * the strict rules for her feet ease off, and her feet dissolve and reform along with her body instead of on their own.
 */
export function scan(d: Uint8ClampedArray, footX: number, footW: number, lit: Int32Array, litB: Float32Array, unformed = 0): ScanResult {
  const shin = Math.floor(SH * 0.78), puddle = Math.floor(SH * 0.81), ankle = Math.floor(SH * 0.84), feet = Math.floor(SH * 0.86);
  const soles = Math.floor(SH * (0.925 + 0.035 * unformed));
  const rowSum = new Float32Array(SH), rowCnt = new Float32Array(SH), footHalf = footW * 0.5 + 1;
  const reach = 1.5 + 3 * unformed, strict = 1 - unformed;
  let n = 0, top = SH, bot = 0, fMin = SW, fMax = 0;
  // (Row by row, everything the rest of this needs per pixel worked out once.)
  for (let row = 0; row < soles; row++) {
    const legRow = row >= shin && row < ankle, low = row >= puddle, dim = row >= feet ? 0.92 / 255 : 1 / 255;
    const need0 = 72 + ((row >= feet ? 165 : 120) - 72) * strict;
    for (let col = 0, i = row * SW; col < SW; col++, i++) {
      const p = i * 4, r = d[p], g = d[p + 1], b = d[p + 2];
      const br = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (br <= 72) continue;
      // How wide her lower legs are (measured on her shins, above where the video's puddle glow starts).
      if (legRow && br > 90) { if (col < fMin) fMin = col; if (col > fMax) fMax = col; }
      // Her lower legs and feet (her glowing sneakers, whole, stepping with the dance). The video's puddle around
      // them is dimmer and spreads wider than her legs, so from where it starts down, sand fades out softly with
      // distance from her legs: right under them everything counts; further out, only brighter and brighter
      // pixels, and they fade, so there's no hard edge with leftovers peeking past it. (Nothing below her soles.)
      let fringe = 1;
      if (low) {
        const dist = Math.abs(col - footX) / footHalf;
        if (dist > reach || br < need0 + 70 * strict * smooth((dist - 0.8) / 0.6)) continue;
        fringe = 1 - strict * smooth((dist - 0.85) / 0.6);
      }
      rowSum[row] += col; rowCnt[row]++;
      lit[n] = i; litB[n] = br * dim * fringe;
      n++;
      if (br > 90) { if (row < top) top = row; if (row > bot) bot = row; }
    }
  }
  return { lit, litB, n, rowSum, rowCnt, top, bot, fMin, fMax };
}
