export interface CardAssociation {
  cardId: string;
  note?: string;
  noteOwnerId?: string;
  isPrimary?: boolean;
  createdAt: number;
}

export interface CardEntry {
  id: string;
  name: string;
  fileName: string;
  fileType: string; // 'png' | 'json' | 'webp'
  version: string;  // 'v2' | 'v3' | 'json'
  author: string;
  authorManual: boolean;
  category?: string;
  tags?: string[];
  group?: string; // Group name
  source?: string; // 来源 (qq号/群，社区链接)
  rawData: any;
  coverImage: string | null;
  extraCovers?: string[];
  activeCoverIndex?: number;
  qrData?: any;
  associations?: CardAssociation[];
  screenshots?: {
    authorsNote: string[];
    authorsNoteDescription?: string; // 作者的话描述
    favoriteScenes: string[]; // 回忆
  };
  edited: boolean;
  editHistory?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface PhoneLink {
  id: string;
  name: string;
  url: string;
  contact?: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ThemeEntry {
  id: string;
  name: string;
  fileName: string;
  author?: string;
  category?: string;
  type?: string;
  source?: string;
  description?: string;
  coverImage?: string | null;
  jsonData?: any;
  rawJsonString?: string;
  content?: string;
  fileType?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetEntry {
  id: string;
  name: string;
  fileName: string;
  author?: string;
  category?: string;
  source?: string;
  description?: string;
  jsonData: any;
  rawJsonString?: string;
  regexScripts?: any[];
  createdAt: number;
  updatedAt: number;
}

export interface PluginEntry {
  id: string;
  type: 'plugin' | 'script'; // 'plugin' = link based, 'script' = imported json file based
  name: string;
  url?: string;
  contact?: string;
  author?: string;
  category?: string;
  source?: string;
  description?: string;
  jsonData?: any;
  fileName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NormalCardEntry {
  id: string;
  fileName: string;
  charName?: string;
  author?: string;
  category?: string;
  source?: string;
  coverImage?: string | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiKeyItem {
  id: string;
  memo?: string;
  key: string;
}

export interface ApiEntry {
  id: string;
  name: string;
  url: string;
  keys: ApiKeyItem[];
  description?: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FontEntry {
  id: string;
  name: string;
  url?: string;
  fileData?: string;
  fontFamily: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ExtraStoryEntry {
  id: string;
  title: string;
  author?: string;
  content: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StickerItem {
  id: string;
  name: string;
  url: string;
}

export interface StickerPackEntry {
  id: string;
  title: string;
  author?: string;
  category?: string;
  items: StickerItem[];
  createdAt: number;
  updatedAt: number;
}


export interface ChatMemeEntry {
  id: string;
  content: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorldBookEntry {
  id: string;
  title: string;
  author?: string;
  content: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
  /** JSON 世界书导入时保留原始结构与逐条条目；docx/txt 不使用这些字段 */
  entries?: any[];
  jsonData?: any;
  importFormat?: 'json' | 'docx' | 'txt';
}

export interface UserPersonaEntry {
  id: string;
  name: string;
  details: string;
  category?: string;
  referenceImage?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImageGenEntry {
  id: string;
  type: 'artist' | 'prompt';
  name: string;
  author?: string;
  source?: string;
  previewImage?: string | null;
  /** 多张预览图；previewImage 继续保留用于兼容旧数据 */
  previewImages?: string[];
  positivePrompt?: string;
  negativePrompt?: string;
  details?: string;
  category?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppData {
  cards: CardEntry[];
  groups: string[];
  phoneLinks?: PhoneLink[];
  themes?: ThemeEntry[];
  themeCategories?: string[];
  beautifications?: ThemeEntry[];
  beautificationCategories?: string[];
  presets?: PresetEntry[];
  presetCategories?: string[];
  plugins?: PluginEntry[];
  pluginCategories?: string[];
  normalCards?: NormalCardEntry[];
  normalCardCategories?: string[];
  apis?: ApiEntry[];
  apiCategories?: string[];
  fonts?: FontEntry[];
  fontCategories?: string[];
  extraStories?: ExtraStoryEntry[];
  extraStoryCategories?: string[];
  stickerPacks?: StickerPackEntry[];
  stickerCategories?: string[];
  worldBooks?: WorldBookEntry[];
  worldBookCategories?: string[];
  chatMemes?: ChatMemeEntry[];
  chatMemeCategories?: string[];
  userPersonas?: UserPersonaEntry[];
  userPersonaCategories?: string[];
  imageGenEntries?: ImageGenEntry[];
  imageGenCategories?: string[];
}

