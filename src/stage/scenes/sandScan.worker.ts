// Worker: copies a dancer video frame out and reads where she's lit (see sandScan.ts), off the main thread.
import { SH, SW, scan } from './sandScan';

const g = new OffscreenCanvas(SW, SH).getContext('2d', { willReadFrequently: true })!;

self.onmessage = (e: MessageEvent<{ bitmap: ImageBitmap; footX: number; footW: number; lit: Int32Array; litB: Float32Array; unformed: number }>) => {
  const { bitmap, footX, footW, lit, litB, unformed } = e.data;
  g.drawImage(bitmap, 0, 0, SW, SH);
  bitmap.close();
  const r = scan(g.getImageData(0, 0, SW, SH).data, footX, footW, lit, litB, unformed);
  (self as unknown as Worker).postMessage(r, [r.lit.buffer, r.litB.buffer, r.rowSum.buffer, r.rowCnt.buffer]);
};
