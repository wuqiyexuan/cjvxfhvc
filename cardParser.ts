import { CardEntry } from '../types';
import { extractPngTextAsync, processImageFile } from './pngParser';

function extractCardTags(data: any): string[] {
  const candidates = [
    data?.data?.tags,
    data?.tags,
    data?.data?.extensions?.tags,
    data?.extensions?.tags,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return Array.from(new Set(value.map((t) => String(t).trim()).filter(Boolean)));
    if (typeof value === 'string') return Array.from(new Set(value.split(/[,，、]/).map((t) => t.trim()).filter(Boolean)));
  }
  return [];
}

export async function parseCardFile(file: File): Promise<CardEntry> {
  const ext = file.name.toLowerCase().split('.').pop();
  const id = 'card_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

  if (ext === 'png' || ext === 'webp') {
    const buf = await file.arrayBuffer();
    const textChunks = await extractPngTextAsync(buf);

    let cardData: any = null;
    let version = 'unknown';
    let author = '';

    if (textChunks['ccv3']) {
      try {
        // CCv3 PNG 规范要求 ccv3 tEXt 的值为“JSON -> UTF-8 -> Base64”。
        // 为兼容部分工具导出的原始 JSON / URL-safe Base64，这里按多种形式依次尝试。
        const rawCcv3 = String(textChunks['ccv3'] || '').trim();
        const candidates: string[] = [rawCcv3];
        const normalizedBase64 = rawCcv3.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        if (normalizedBase64) {
          const padded = normalizedBase64 + '='.repeat((4 - (normalizedBase64.length % 4)) % 4);
          try {
            const decoded = atob(padded);
            const bytes = new Uint8Array(decoded.length);
            for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
            candidates.push(new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '').trim());
          } catch {
            // 不是 Base64，继续尝试原始 JSON。
          }
        }

        let parsed: any = null;
        for (const candidate of candidates) {
          if (!candidate) continue;
          try {
            const value = JSON.parse(candidate);
            if (value && typeof value === 'object') {
              parsed = value;
              break;
            }
          } catch {
            // continue
          }
        }

        if (!parsed || typeof parsed !== 'object') throw new Error('ccv3 JSON 解码失败');
        const spec = parsed.spec || parsed.data?.spec;
        const specVersion = parsed.spec_version || parsed.data?.spec_version;
        if (spec && spec !== 'chara_card_v3' && spec !== 'chara_card_v2') {
          console.warn('未知角色卡 spec，仍尝试导入:', spec, specVersion);
        }
        cardData = parsed.data || parsed;
        version = 'v3';
        author = parsed.data?.creator || parsed.data?.extensions?.author || parsed.creator || parsed.author || '';
      } catch (e) {
        console.warn('CCv3 parse failed', e);
      }
    }

    if (!cardData && textChunks['chara']) {
      try {
        const decoded = atob(textChunks['chara']);
        const bytes = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
        const jsonStr = new TextDecoder('utf-8').decode(bytes);
        cardData = JSON.parse(jsonStr);
        version = 'v2';
        author = cardData.author || cardData.creator || '';
      } catch (e) {
        console.warn('Chara V2 parse failed', e);
      }
    }

    if (!cardData) {
      throw new Error('无法识别的 PNG 角色卡格式 (未包含 chara 或 ccv3 数据)');
    }

    // 角色卡封面保持上传文件的原始像素尺寸与比例，不做缩放、裁剪或拉伸。
    // 角色卡数量较大时，不能把每张原始 PNG 都以 Base64 常驻 React/IndexedDB；
    // 预览只保存轻量缩略图，原始文件由导入层单独存入 IndexedDB。
    const originalCover = await processImageFile(file, 360, 540);

    const recognizedName = cardData?.name || cardData?.char_name || cardData?.data?.name || file.name.replace(/\.[^/.]+$/, '');

    return {
      id,
      name: recognizedName,
      fileName: file.name,
      fileType: ext,
      version,
      author: author || '',
      authorManual: false,
      group: '默认',
      tags: extractCardTags(cardData),
      rawData: cardData,
      coverImage: originalCover,
      extraCovers: [],
      activeCoverIndex: 0,
      screenshots: { authorsNote: [], authorsNoteDescription: '', favoriteScenes: [] },
      edited: false,
      editHistory: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } else if (ext === 'json') {
    const text = await file.text();
    let cardData: any;
    try {
      cardData = JSON.parse(text);
    } catch (e) {
      throw new Error('无效的 JSON 文件格式');
    }

    let version = 'json';
    let name = cardData.name || file.name.replace(/\.json$/, '');
    let author = '';

    if (cardData.data) {
      version = 'v3';
      const d = cardData.data;
      name = d.name || name;
      author = d.extensions?.author || d.author || cardData.author || '';
    } else if (cardData.char_name || cardData.name) {
      version = cardData.spec === 'chara_card_v2' ? 'v2' : cardData.spec || 'v2';
      name = cardData.char_name || cardData.name || name;
      author = cardData.author || cardData.creator || '';
    }

    return {
      id,
      name,
      fileName: file.name,
      fileType: 'json',
      version,
      author: author || '',
      authorManual: false,
      group: '默认',
      tags: extractCardTags(cardData),
      rawData: cardData,
      coverImage: null,
      extraCovers: [],
      activeCoverIndex: 0,
      screenshots: { authorsNote: [], authorsNoteDescription: '', favoriteScenes: [] },
      edited: false,
      editHistory: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  throw new Error('不支持的文件格式: ' + ext);
}
