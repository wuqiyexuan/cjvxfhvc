import { get, set, del } from 'idb-keyval';
import { AppData, CardEntry } from '../types';

export const STORAGE_KEY = 'tavern_vault_data_v1';
export const THEME_KEY = 'tavern_vault_theme';
export const SIDEBAR_KEY = 'tavern_vault_sidebar';

const defaultAppData: AppData = {
  cards: [],
  groups: ['默认'],
  phoneLinks: [],
  themes: [],
  themeCategories: ['默认'],
  beautifications: [],
  beautificationCategories: ['默认'],
  presets: [],
  presetCategories: ['默认'],
  plugins: [],
  pluginCategories: ['默认'],
  normalCards: [],
  normalCardCategories: ['默认'],
  chatMemes: [],
  chatMemeCategories: ['默认'],
  userPersonas: [],
  userPersonaCategories: ['默认'],
  imageGenEntries: [],
  imageGenCategories: ['默认'],
};

// In-memory cache for fast synchronous access.
let cachedAppData: AppData | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);

// 大数据版本的关键优化：不再每次保存都把整个 AppData（可能包含大量图片/字体）
// 一次性 structured-clone 到 IndexedDB。每个顶层数据集合独立存储，只保存发生变化的集合。
const DATA_FIELDS: (keyof AppData)[] = [
  'cards', 'groups', 'phoneLinks', 'themes', 'themeCategories',
  'beautifications', 'beautificationCategories', 'presets', 'presetCategories',
  'plugins', 'pluginCategories', 'normalCards', 'normalCardCategories',
  'apis', 'apiCategories', 'fonts', 'fontCategories', 'extraStories',
  'extraStoryCategories', 'stickerPacks', 'stickerCategories', 'worldBooks',
  'worldBookCategories', 'chatMemes', 'chatMemeCategories', 'userPersonas',
  'userPersonaCategories', 'imageGenEntries', 'imageGenCategories',
];
const fieldKey = (field: keyof AppData) => `${STORAGE_KEY}::${String(field)}`;
const SPLIT_MARKER_KEY = `${STORAGE_KEY}::__split_v1`;
const SPLIT_LOCAL_MARKER_KEY = `${STORAGE_KEY}::__split_local_v1`;
const CARD_INDEX_KEY = `${STORAGE_KEY}::__card_index_v1`;
const CARD_KEY = (id: string) => `${STORAGE_KEY}::card::${id}`;
// 原始角色卡封面单独存储，避免数百张 PNG 的 Base64 常驻 AppData。
export const CARD_SOURCE_IMAGE_KEY = (id: string) => `${STORAGE_KEY}::card_source_image::${id}`;
export async function saveCardSourceImage(id: string, blob: Blob): Promise<void> { await set(CARD_SOURCE_IMAGE_KEY(id), blob); }
export async function getCardSourceImage(id: string): Promise<Blob | undefined> { return await get<Blob>(CARD_SOURCE_IMAGE_KEY(id)); }
export async function deleteCardSourceImage(id: string): Promise<void> { await del(CARD_SOURCE_IMAGE_KEY(id)); }

const mergeDefaults = (data: any): AppData => ({
  cards: Array.isArray(data?.cards) ? data.cards : [],
  groups: Array.isArray(data?.groups) && data.groups.length ? data.groups : ['默认'],
  phoneLinks: Array.isArray(data?.phoneLinks) ? data.phoneLinks : [],
  themes: Array.isArray(data?.themes) ? data.themes : [],
  themeCategories: Array.isArray(data?.themeCategories) ? data.themeCategories : ['默认'],
  beautifications: Array.isArray(data?.beautifications) ? data.beautifications : [],
  beautificationCategories: Array.isArray(data?.beautificationCategories) ? data.beautificationCategories : ['默认'],
  presets: Array.isArray(data?.presets) ? data.presets : [],
  presetCategories: Array.isArray(data?.presetCategories) ? data.presetCategories : ['默认'],
  plugins: Array.isArray(data?.plugins) ? data.plugins : [],
  pluginCategories: Array.isArray(data?.pluginCategories) ? data.pluginCategories : ['默认'],
  normalCards: Array.isArray(data?.normalCards) ? data.normalCards : [],
  normalCardCategories: Array.isArray(data?.normalCardCategories) ? data.normalCardCategories : ['默认'],
  apis: Array.isArray(data?.apis) ? data.apis : [],
  apiCategories: Array.isArray(data?.apiCategories) ? data.apiCategories : ['默认'],
  fonts: Array.isArray(data?.fonts) ? data.fonts : [],
  fontCategories: Array.isArray(data?.fontCategories) ? data.fontCategories : ['默认'],
  extraStories: Array.isArray(data?.extraStories) ? data.extraStories : [],
  extraStoryCategories: Array.isArray(data?.extraStoryCategories) ? data.extraStoryCategories : ['默认'],
  stickerPacks: Array.isArray(data?.stickerPacks) ? data.stickerPacks : [],
  stickerCategories: Array.isArray(data?.stickerCategories) ? data.stickerCategories : ['默认'],
  worldBooks: Array.isArray(data?.worldBooks) ? data.worldBooks : [],
  worldBookCategories: Array.isArray(data?.worldBookCategories) ? data.worldBookCategories : ['默认'],
  chatMemes: Array.isArray(data?.chatMemes) ? data.chatMemes : [],
  chatMemeCategories: Array.isArray(data?.chatMemeCategories) ? data.chatMemeCategories : ['默认'],
  userPersonas: Array.isArray(data?.userPersonas) ? data.userPersonas : [],
  userPersonaCategories: Array.isArray(data?.userPersonaCategories) ? data.userPersonaCategories : ['默认'],
  imageGenEntries: Array.isArray(data?.imageGenEntries) ? data.imageGenEntries : [],
  imageGenCategories: Array.isArray(data?.imageGenCategories) ? data.imageGenCategories : ['默认'],
});

/** Load legacy root data and overlay any new per-field stores. */
export async function loadAppDataAsync(): Promise<AppData> {
  try {
    const splitReady = await get<boolean>(SPLIT_MARKER_KEY);
    let merged: AppData;
    if (splitReady) {
      // 非角色卡字段可以并行读取；角色卡单独按 id 分片读取，避免一次 structured-clone 整个 cards 数组。
      const nonCardFields = DATA_FIELDS.filter((field) => field !== 'cards');
      const values = await Promise.all(nonCardFields.map((field) => get<any>(fieldKey(field))));
      const partial: any = {};
      const missingFields: (keyof AppData)[] = [];
      nonCardFields.forEach((field, index) => {
        if (values[index] !== undefined) {
          partial[field] = values[index];
        } else {
          missingFields.push(field);
        }
      });

      // 永久保留旧根数据作为“只读灾备源”。上一版迁移曾可能把一个不完整的
      // 分片集合当成完整集合，因此不能只在“空数组”时恢复；即使分片里还有一部分数据，
      // 也必须把旧根里缺失的项目补回来。当前分片版本优先，这样用户在新版本里做过的修改不会被旧快照覆盖。
      // 注意：这里绝不删除 STORAGE_KEY，它是恢复历史数据的最后一道保险。
      try {
        const legacyRoot = await get<any>(STORAGE_KEY);
        if (legacyRoot && typeof legacyRoot === 'object') {
          const mergeCollection = (current: any, legacy: any, field: string) => {
            if (!Array.isArray(legacy)) return current;
            if (!Array.isArray(current)) return legacy;
            if (legacy.length === 0) return current;
            if (current.length === 0) return legacy;
            const looksLikeCategory = field.endsWith('Categories') || field === 'groups';
            if (looksLikeCategory) return Array.from(new Set([...legacy, ...current].filter(Boolean)));
            const getIdentity = (item: any) => {
              if (item && typeof item === 'object') {
                if (item.id != null) return `id:${String(item.id)}`;
                if (item.key != null) return `key:${String(item.key)}`;
                if (item.uuid != null) return `uuid:${String(item.uuid)}`;
                if (item.name != null) return `name:${String(item.name)}`;
                if (item.title != null) return `title:${String(item.title)}`;
                if (item.fileName != null) return `file:${String(item.fileName)}`;
              }
              return `value:${JSON.stringify(item)}`;
            };
            const result = [...legacy];
            const index = new Map(result.map((item, i) => [getIdentity(item), i]));
            for (const item of current) {
              const key = getIdentity(item);
              const existing = index.get(key);
              if (existing == null) { index.set(key, result.length); result.push(item); }
              else result[existing] = item; // 当前分片版本优先
            }
            return result;
          };
          for (const field of nonCardFields) {
            if (legacyRoot[field] === undefined) continue;
            partial[field] = mergeCollection(partial[field], legacyRoot[field], String(field));
          }
        }
      } catch (recoveryErr) {
        console.warn('Legacy data recovery read failed', recoveryErr);
      }

      let cardIds = await get<string[]>(CARD_INDEX_KEY);
      if (!Array.isArray(cardIds)) {
        // 从旧的 cards 分片一次性迁移到“每张卡一个 IDB record”，只发生一次。
        const legacyCards = await get<CardEntry[]>(fieldKey('cards'));
        const cards = Array.isArray(legacyCards) ? legacyCards : [];
        cardIds = cards.map((card) => card.id);
        for (let i = 0; i < cards.length; i += 8) {
          const batch = cards.slice(i, i + 8);
          for (const card of batch) await set(CARD_KEY(card.id), card);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await set(CARD_INDEX_KEY, cardIds);
        // 不删除旧 cards 快照：保留它用于灾备恢复。
      }

      const loadedCards: CardEntry[] = [];
      for (let i = 0; i < cardIds.length; i += 8) {
        const batchIds = cardIds.slice(i, i + 8);
        const batch = await Promise.all(batchIds.map((id) => get<CardEntry>(CARD_KEY(id))));
        for (const card of batch) if (card) loadedCards.push(card);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      partial.cards = loadedCards;
      merged = mergeDefaults(partial);
      try { localStorage.setItem(SPLIT_LOCAL_MARKER_KEY, '1'); } catch {}
    } else {
      // 首次从旧版本迁移时读取一次旧根数据，随后立刻拆分保存；之后启动不再读取巨型根对象。
      const root = await get<AppData>(STORAGE_KEY);
      merged = mergeDefaults(root || {});
      for (const field of DATA_FIELDS) {
        if (field === 'cards') {
          const cards = merged.cards || [];
          const ids = cards.map((card) => card.id);
          for (let i = 0; i < cards.length; i += 8) {
            for (const card of cards.slice(i, i + 8)) await set(CARD_KEY(card.id), card);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          await set(CARD_INDEX_KEY, ids);
        } else {
          await set(fieldKey(field), (merged as any)[field]);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await set(SPLIT_MARKER_KEY, true);
      try { localStorage.setItem(SPLIT_LOCAL_MARKER_KEY, '1'); } catch {}
    }
    cachedAppData = merged;
    return merged;
  } catch (err) {
    console.warn('IndexedDB load fallback to LocalStorage', err);
  }
  const fallback = loadAppDataFromLocalStorage();
  cachedAppData = fallback;
  return fallback;
}

export function loadAppData(): AppData {
  if (cachedAppData) return cachedAppData;
  // 永远不要在 React 首屏同步解析旧的巨型 localStorage。真实数据由 loadAppDataAsync
  // 在 IndexedDB 中分批 hydration；这样打开页面时不会因为上百张含 base64 图片的角色卡而卡住。
  return mergeDefaults({});
}

function loadAppDataFromLocalStorage(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return mergeDefaults({});
    return mergeDefaults(JSON.parse(raw));
  } catch (e) {
    console.error('Failed to load app data from localStorage', e);
    return mergeDefaults({});
  }
}

/**
 * Persist only changed top-level collections. This prevents large cards/fonts/stickers
 * from being cloned again when an unrelated setting is saved.
 */
export function saveAppData(data: AppData): Promise<boolean> {
  const previous = cachedAppData;
  cachedAppData = data;
  const changed = DATA_FIELDS.filter((field) => !previous || (previous as any)[field] !== (data as any)[field]);
  if (changed.length === 0) return Promise.resolve(true);

  // Serialize writes so rapid consecutive confirms cannot race each other.
  const writeBatch = async () => {
    try {
      for (const field of changed) {
        if (field === 'cards') {
          const nextCards = Array.isArray(data.cards) ? data.cards : [];
          const prevCards = Array.isArray(previous?.cards) ? previous!.cards : [];
          const prevMap = new Map(prevCards.map((card) => [card.id, card]));
          const nextIds = nextCards.map((card) => card.id);
          for (let i = 0; i < nextCards.length; i += 8) {
            const batch = nextCards.slice(i, i + 8);
            for (const card of batch) {
              if (prevMap.get(card.id) !== card) await set(CARD_KEY(card.id), card);
              prevMap.delete(card.id);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          for (const staleId of prevMap.keys()) await del(CARD_KEY(staleId));
          await set(CARD_INDEX_KEY, nextIds);
          // 保留旧的整数组存储作为灾备快照，不删除。
        } else {
          await set(fieldKey(field), (data as any)[field]);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await set(SPLIT_MARKER_KEY, true);
      try { localStorage.setItem(SPLIT_LOCAL_MARKER_KEY, '1'); } catch {}
      return true;
    } catch (err) {
      console.error('IndexedDB save error:', err);
      return false;
    }
  };
  saveQueue = saveQueue.then(writeBatch, writeBatch);
  return saveQueue;
}

/**
 * Image file quality compression to WebP Base64 to prevent storage bloating
 */
export async function processImageFile(file: File, maxWidth = 400, maxHeight = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Scale proportionally
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Convert to webp with 0.8 quality
        const compressedBase64 = canvas.toDataURL('image/webp', 0.8);
        resolve(compressedBase64);
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function getCardDisplayName(card: CardEntry): string {
  if (card.editHistory?.name) return card.editHistory.name;
  if (card.name) return card.name;
  const rd = card.rawData;
  if (rd?.data?.name) return rd.data.name;
  if (rd?.name) return rd.name;
  if (rd?.char_name) return rd.char_name;
  return '未命名角色';
}

export function getCardCreator(card: CardEntry): string {
  if (card.editHistory?.author) return card.editHistory.author;
  if (card.author) return card.author;
  const rd = card.rawData;
  if (rd?.data?.creator) return rd.data.creator;
  if (rd?.creator) return rd.creator;
  if (rd?.data?.extensions?.author) return rd.data.extensions.author;
  return '未知作者';
}

export function getCardDescription(card: CardEntry): string {
  if (card.editHistory?.description !== undefined) return card.editHistory.description;
  const rd = card.rawData;
  if (rd?.data?.description) return rd.data.description;
  if (rd?.description) return rd.description;
  return '';
}

export function getCardPersonality(card: CardEntry): string {
  if (card.editHistory?.personality !== undefined) return card.editHistory.personality;
  const rd = card.rawData;
  if (rd?.data?.personality) return rd.data.personality;
  if (rd?.personality) return rd.personality;
  return '';
}

export function getCardGreeting(card: CardEntry): string {
  if (card.editHistory?.first_mes !== undefined) return card.editHistory.first_mes;
  if (card.editHistory?.greeting !== undefined) return card.editHistory.greeting;
  const rd = card.rawData;
  if (rd?.data?.first_mes) return rd.data.first_mes;
  if (rd?.first_mes) return rd.first_mes;
  if (rd?.greeting) return rd.greeting;
  return '';
}

export function getCardAlternateGreetings(card: CardEntry): string[] {
  // 角色卡来源不一，少数卡片的 alternate_greetings 可能不是标准数组。
  // 详情页“开场白”会对它执行 length / reduce / map，因此这里统一做容错，
  // 避免点击开场白标签后因为异常数据直接导致 React 渲染崩溃。
  const normalize = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item == null) return '';
      try {
        return String(item);
      } catch {
        return '';
      }
    });
  };

  if (card.editHistory?.alternate_greetings !== undefined) {
    return normalize(card.editHistory.alternate_greetings);
  }
  const rd = card.rawData;
  if (rd?.data?.alternate_greetings !== undefined) return normalize(rd.data.alternate_greetings);
  if (rd?.alternate_greetings !== undefined) return normalize(rd.alternate_greetings);
  return [];
}

export function getCardWorldBook(card: CardEntry): any {
  const normalize = (value: any) => {
    if (!value || typeof value !== 'object') return null;
    const wb = { ...value };
    const rawEntries = wb.entries;
    if (Array.isArray(rawEntries)) {
      wb.entries = rawEntries.map((entry: any) => entry && typeof entry === 'object' ? entry : { content: String(entry ?? '') });
    } else if (rawEntries && typeof rawEntries === 'object') {
      wb.entries = Object.values(rawEntries);
    } else {
      wb.entries = [];
    }
    return wb;
  };
  if (card.editHistory?.character_book) return normalize(card.editHistory.character_book);
  const rd = card.rawData;
  if (rd?.data?.character_book) return normalize(rd.data.character_book);
  if (rd?.character_book) return normalize(rd.character_book);
  if (rd?.extensions?.character_book) return normalize(rd.extensions.character_book);
  if (rd?.data?.extensions?.character_book) return normalize(rd.data.extensions.character_book);
  return null;
}

export function getCardRegex(card: CardEntry | null): any[] {
  if (!card) return [];
  if (card.editHistory?.regex_scripts && Array.isArray(card.editHistory.regex_scripts)) {
    return card.editHistory.regex_scripts;
  }
  const rd = card.rawData;
  if (!rd) return [];
  if (Array.isArray(rd.data?.extensions?.regex_scripts)) return rd.data.extensions.regex_scripts;
  if (Array.isArray(rd.extensions?.regex_scripts)) return rd.extensions.regex_scripts;
  if (Array.isArray(rd.data?.extensions?.regex)) return rd.data.extensions.regex;
  if (Array.isArray(rd.extensions?.regex)) return rd.extensions.regex;
  if (Array.isArray(rd.data?.regex_scripts)) return rd.data.regex_scripts;
  if (Array.isArray(rd.regex_scripts)) return rd.regex_scripts;
  if (Array.isArray(rd.data?.regexes)) return rd.data.regexes;
  if (Array.isArray(rd.regexes)) return rd.regexes;
  if (Array.isArray(rd.data?.user_regexes)) return rd.data.user_regexes;
  if (Array.isArray(rd.user_regexes)) return rd.user_regexes;
  if (Array.isArray(rd.data?.character_book?.extensions?.regex_scripts)) return rd.data.character_book.extensions.regex_scripts;
  if (Array.isArray(rd.character_book?.extensions?.regex_scripts)) return rd.character_book.extensions.regex_scripts;
  if (rd.findRegex || rd.find_regex || rd.pattern || rd.data?.findRegex || rd.data?.find_regex) {
    return [rd.data || rd];
  }
  return [];
}

export function getCardTags(card: CardEntry): string[] {
  if (card.editHistory?.tags !== undefined && Array.isArray(card.editHistory.tags)) return card.editHistory.tags;
  if (Array.isArray((card as any).tags)) return (card as any).tags;
  const rd = card.rawData;
  if (Array.isArray(rd?.data?.tags)) return rd.data.tags;
  if (Array.isArray(rd?.tags)) return rd.tags;
  if (typeof rd?.data?.tags === 'string') return rd.data.tags.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean);
  if (typeof rd?.tags === 'string') return rd.tags.split(/[,，、]/).map((t: string) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Returns merged card data by combining rawData and editHistory
 */
export function getCurrentCardData(card: CardEntry): any {
  const data = JSON.parse(JSON.stringify(card.rawData));
  if (!card.edited || !card.editHistory) return data;
  const eh = card.editHistory;

  if (eh.name !== undefined) {
    if (data.data) data.data.name = eh.name; else data.name = eh.name;
  }
  if (eh.description !== undefined) {
    if (data.data) data.data.description = eh.description; else data.description = eh.description;
  }
  if (eh.personality !== undefined) {
    if (data.data) data.data.personality = eh.personality; else data.personality = eh.personality;
  }
  if (eh.scenario !== undefined) {
    if (data.data) data.data.scenario = eh.scenario; else data.scenario = eh.scenario;
  }
  if (eh.system_prompt !== undefined) {
    if (data.data) data.data.system_prompt = eh.system_prompt; else data.system_prompt = eh.system_prompt;
  }
  if (eh.first_mes !== undefined) {
    if (data.data) data.data.first_mes = eh.first_mes; else data.first_mes = eh.first_mes;
  }
  if (eh.alternate_greetings !== undefined) {
    if (data.data) data.data.alternate_greetings = eh.alternate_greetings; else data.alternate_greetings = eh.alternate_greetings;
  }
  if (eh.character_book !== undefined) {
    if (data.data) data.data.character_book = eh.character_book; else data.character_book = eh.character_book;
  }
  if (eh.regex_scripts !== undefined) {
    const target = data.data || data;
    if (!target.extensions) target.extensions = {};
    target.extensions.regex_scripts = eh.regex_scripts;
  }
  if (eh.author !== undefined) {
    if (data.data) {
      if (!data.data.extensions) data.data.extensions = {};
      data.data.extensions.author = eh.author;
    } else {
      data.author = eh.author;
    }
  }
  if (eh.tags !== undefined) {
    if (data.data) data.data.tags = eh.tags; else data.tags = eh.tags;
  }

  return data;
}
