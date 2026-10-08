/**
 * PNG Chunk and Card Parsing Utilities for SillyTavern Cards
 */

export async function extractPngTextAsync(arrayBuffer: ArrayBuffer): Promise<Record<string, string>> {
  const dv = new DataView(arrayBuffer);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (dv.getUint8(i) !== sig[i]) throw new Error('不是有效的 PNG 文件');
  }

  const chunks: Record<string, string> = {};
  let offset = 8;
  while (offset < dv.byteLength) {
    if (offset + 8 > dv.byteLength) break;
    const length = dv.getUint32(offset);
    const type = String.fromCharCode(
      dv.getUint8(offset + 4),
      dv.getUint8(offset + 5),
      dv.getUint8(offset + 6),
      dv.getUint8(offset + 7)
    );
    const dataStart = offset + 8;
    if (dataStart + length > dv.byteLength) break;

    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const data = new Uint8Array(arrayBuffer, dataStart, length);
      let keywordEnd = 0;
      while (keywordEnd < data.length && data[keywordEnd] !== 0) keywordEnd++;
      const keyword = new TextDecoder('utf-8').decode(data.subarray(0, keywordEnd));
      const valueBytes = data.subarray(keywordEnd + 1);
      let value = '';

      try {
        if (type === 'zTXt') {
          const compressed = valueBytes.subarray(1);
          if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate');
            const stream = new Blob([compressed]).stream().pipeThrough(ds);
            const buf = await new Response(stream).arrayBuffer();
            value = new TextDecoder('utf-8').decode(new Uint8Array(buf));
          }
        } else if (type === 'iTXt') {
          const compressionFlag = valueBytes[0];
          let idx = 2;
          while (idx < valueBytes.length && valueBytes[idx] !== 0) idx++;
          idx++;
          while (idx < valueBytes.length && valueBytes[idx] !== 0) idx++;
          idx++;
          const textData = valueBytes.subarray(idx);
          if (compressionFlag === 1 && typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate');
            const stream = new Blob([textData]).stream().pipeThrough(ds);
            const buf = await new Response(stream).arrayBuffer();
            value = new TextDecoder('utf-8').decode(new Uint8Array(buf));
          } else {
            value = new TextDecoder('utf-8').decode(textData);
          }
        } else {
          value = new TextDecoder('utf-8').decode(valueBytes);
        }
      } catch (e) {
        console.warn('Decompress error for keyword', keyword, e);
        value = '';
      }
      chunks[keyword] = value;
    }
    offset = dataStart + length + 4; // + CRC
    if (type === 'IEND') break;
  }
  return chunks;
}

export function fileToDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Robustly converts any uploaded image file (from Photo Gallery or Files)
 * into a compressed, persistent Base64 Data URL so it never disappears.
 */
export async function processImageFile(file: File, maxW = 800, maxH = 800): Promise<string> {
  // 优先使用 createImageBitmap 的 resize 解码，避免超大手机照片/PNG 先完整解码
  // 成几千甚至上万像素的 bitmap 再缩放，从而在 Android/iOS 上触发内存峰值崩溃。
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, {
        resizeWidth: maxW,
        resizeHeight: maxH,
        resizeQuality: 'high',
      });
      try {
        const ratio = Math.min(maxW / bitmap.width, maxH / bitmap.height, 1);
        const w = Math.max(1, Math.round(bitmap.width * ratio));
        const h = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        if (!blob) throw new Error('Canvas blob creation failed');
        const result = await fileToDataURL(blob as File);
        return result;
      } finally {
        bitmap.close();
      }
    }
  } catch (err) {
    console.warn('createImageBitmap resize failed, using compatibility fallback', err);
  }

  // 旧浏览器/部分 WebView 不支持 resize 解码时才使用旧方案。
  try {
    const dataUrl = await fileToDataURL(file);
    const scaled = await scaleImage(dataUrl, maxW, maxH);
    if (!scaled || scaled.startsWith('blob:')) return dataUrl;
    return scaled;
  } catch (err) {
    console.warn('Image processing fallback to raw file dataURL', err);
    return fileToDataURL(file);
  }
}

export function scaleImage(srcUrl: string, maxW = 400, maxH = 600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    // Do NOT set crossOrigin for data: or blob: URLs to prevent Safari CORS/canvas security error
    if (!srcUrl.startsWith('data:') && !srcUrl.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(srcUrl);
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const res = reader.result as string;
                resolve(res || srcUrl);
              };
              reader.onerror = () => resolve(srcUrl);
              reader.readAsDataURL(blob);
            },
            'image/jpeg',
            0.85
          );
        } else {
          resolve(srcUrl);
        }
      } catch (err) {
        console.warn('Canvas scaling error', err);
        resolve(srcUrl);
      }
    };
    img.onerror = (err) => {
      console.warn('scaleImage img error', err);
      resolve(srcUrl);
    };
    img.src = srcUrl;
  });
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function calcCrc(table: Uint32Array, bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngTextChunk(keyword: string, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const kwBytes = encoder.encode(keyword);
  const valBytes = encoder.encode(value);
  const chunkData = new Uint8Array(kwBytes.length + 1 + valBytes.length);
  chunkData.set(kwBytes, 0);
  chunkData[kwBytes.length] = 0;
  chunkData.set(valBytes, kwBytes.length + 1);

  const crc = calcCrc(makeCrcTable(), new Uint8Array([
    0x74, 0x45, 0x58, 0x74, // tEXt
    ...chunkData,
  ]));
  const out = new Uint8Array(4 + 4 + chunkData.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, chunkData.length);
  out.set([0x74, 0x45, 0x58, 0x74], 4);
  out.set(chunkData, 8);
  dv.setUint32(8 + chunkData.length, crc);
  return out;
}

/**
 * Re-embeds a SillyTavern card into an existing PNG without re-encoding the
 * image. Existing `chara` / `ccv3` metadata is removed first, then a fresh
 * V2-compatible `chara` block and (when supplied) a V3 `ccv3` block are added.
 * This mirrors SillyTavern's own writer and is much more compatible than
 * drawing the image onto a canvas and creating a brand-new PNG.
 */
export function injectTavernCardChunks(
  arrayBuffer: ArrayBuffer,
  charaValue: string,
  ccv3Value?: string,
): ArrayBuffer {
  const input = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (let i = 0; i < 8; i++) {
    if (input[i] !== signature[i]) throw new Error('无效的 PNG 文件');
  }

  const kept: Uint8Array[] = [input.slice(0, 8)];
  let offset = 8;
  let iendChunk: Uint8Array | null = null;

  while (offset + 12 <= input.length) {
    const length = dv.getUint32(offset);
    const total = 12 + length;
    if (offset + total > input.length) throw new Error('PNG chunk 长度异常');
    const typeBytes = input.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const chunk = input.slice(offset, offset + total);

    let remove = false;
    if (type === 'tEXt' || type === 'iTXt' || type === 'zTXt') {
      const data = input.subarray(offset + 8, offset + 8 + length);
      let k = 0;
      while (k < data.length && data[k] !== 0) k++;
      const keyword = new TextDecoder('utf-8').decode(data.subarray(0, k)).toLowerCase();
      remove = keyword === 'chara' || keyword === 'ccv3';
    }

    if (type === 'IEND') {
      iendChunk = chunk;
      break;
    }
    if (!remove) kept.push(chunk);
    offset += total;
  }

  if (!iendChunk) throw new Error('无效的 PNG 结构：未找到 IEND');

  // Keep both formats. V2 readers use `chara`; V3-aware readers prefer `ccv3`.
  kept.push(makePngTextChunk('chara', charaValue));
  if (ccv3Value) kept.push(makePngTextChunk('ccv3', ccv3Value));
  kept.push(iendChunk);

  let totalSize = 0;
  for (const chunk of kept) totalSize += chunk.length;
  const out = new Uint8Array(totalSize);
  let pos = 0;
  for (const chunk of kept) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out.buffer;
}

// Backward-compatible single-chunk helper retained for any older call sites.
export function injectPngTextChunk(arrayBuffer: ArrayBuffer, keyword: string, value: string): ArrayBuffer {
  return injectTavernCardChunks(arrayBuffer, keyword === 'chara' ? value : '', keyword === 'ccv3' ? value : undefined);
}

/**
 * Creates pure SillyTavern card data stripped of local app metadata
 */
export function getPureCardDataForExport(cardData: any): any {
  const clean = JSON.parse(JSON.stringify(cardData));
  
  // Remove local app metadata if present
  delete clean.screenshots;
  delete clean.group;
  delete clean.category;
  delete clean.authorManual;
  delete clean.extraCovers;
  delete clean.activeCoverIndex;
  delete clean.coverImage;
  delete clean.id;
  delete clean.createdAt;
  delete clean.updatedAt;
  
  return clean;
}
