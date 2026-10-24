/** Fonts the user can pick in Settings. The bundled ones are SIL Open Font License files in renderer/public/fonts. */
export interface FontChoice {
  key: string;
  label: string;
  /** CSS font-family stack */
  css: string;
  kind: 'ui' | 'mono';
}

export const FONTS: FontChoice[] = [
  { key: 'system', label: 'Segoe UI (Windows)', css: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif", kind: 'ui' },
  { key: 'inter', label: 'Inter', css: "'Inter', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'manrope', label: 'Manrope', css: "'Manrope', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'outfit', label: 'Outfit', css: "'Outfit', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'space-grotesk', label: 'Space Grotesk', css: "'Space Grotesk', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'plus-jakarta-sans', label: 'Plus Jakarta Sans', css: "'Plus Jakarta Sans', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'sora', label: 'Sora', css: "'Sora', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'dm-sans', label: 'DM Sans', css: "'DM Sans', 'Segoe UI', sans-serif", kind: 'ui' },
  { key: 'jetbrains-mono', label: 'JetBrains Mono', css: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
  { key: 'fira-code', label: 'Fira Code', css: "'Fira Code', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
  { key: 'geist-mono', label: 'Geist Mono', css: "'Geist Mono', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
  { key: 'ibm-plex-mono', label: 'IBM Plex Mono', css: "'IBM Plex Mono', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
  { key: 'source-code-pro', label: 'Source Code Pro', css: "'Source Code Pro', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
  { key: 'cascadia', label: 'Cascadia / Consolas (Windows)', css: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace", kind: 'mono' },
];

export const DEFAULT_UI_FONT = 'inter';
export const DEFAULT_EDITOR_FONT = 'jetbrains-mono';

export function fontByKey(key: string, kind: 'ui' | 'mono'): FontChoice {
  return FONTS.find((f) => f.key === key && f.kind === kind) ?? FONTS.find((f) => f.key === (kind === 'ui' ? DEFAULT_UI_FONT : DEFAULT_EDITOR_FONT))!;
}

/** glass tints for the Star theme (hex); the first is the default */
export const TINTS: { key: string; hex: string; label: string }[] = [
  { key: 'violet', hex: '#7c5cff', label: 'Violet' },
  { key: 'ocean', hex: '#2f8cff', label: 'Ocean' },
  { key: 'teal', hex: '#1fb5a3', label: 'Teal' },
  { key: 'mint', hex: '#3ddc97', label: 'Mint' },
  { key: 'amber', hex: '#f5b759', label: 'Amber' },
  { key: 'coral', hex: '#ff6b6b', label: 'Coral' },
  { key: 'rose', hex: '#f06ac2', label: 'Rose' },
  { key: 'slate', hex: '#8da2c0', label: 'Slate' },
];
export const DEFAULT_TINT = TINTS[0].hex;
export const HEX_RE = /^#[0-9a-f]{6}$/i;
