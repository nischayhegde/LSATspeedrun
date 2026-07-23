// Shared color system for the vector art overhaul.

export type SkinTone = { base: string; shade: string; blush: string }
export type HairTone = { base: string; shade: string; shine: string }

export const skinTones: SkinTone[] = [
  { base: '#e8b28a', shade: '#d09a6f', blush: '#e2896f' },
  { base: '#c98a5e', shade: '#b07248', blush: '#c76b52' },
  { base: '#f2c9a2', shade: '#e0b184', blush: '#ef9c86' },
  { base: '#9c6b4c', shade: '#835538', blush: '#a05f47' },
  { base: '#b57a52', shade: '#9e6440', blush: '#b26049' },
  { base: '#7a5138', shade: '#654028', blush: '#8a5a44' },
  { base: '#f7d7b3', shade: '#e6bf93', blush: '#f0a48d' },
]

export const hairTones: HairTone[] = [
  { base: '#3b2a20', shade: '#241811', shine: '#5d4432' },
  { base: '#6b4226', shade: '#4a2c18', shine: '#8f5c38' },
  { base: '#1f2732', shade: '#131922', shine: '#3a4656' },
  { base: '#8a5a2e', shade: '#6a421f', shine: '#b07d46' },
  { base: '#2c2130', shade: '#1b141f', shine: '#4b3a52' },
  { base: '#c9a15e', shade: '#a37c41', shine: '#e6c584' },
  { base: '#8e939b', shade: '#6d727b', shine: '#b9bec6' },
]

export const eyeTones = ['#4a3524', '#2f4a5e', '#3d5940', '#54402c', '#39566b', '#503a28', '#2e3d52']

export type Outfit = {
  suit: string
  shade: string
  trouser: string
  shirt: string
  tie: string
  vest?: string
  accent?: string
  pinstripe?: boolean
}

// Hero outfit per headquarters tier 0–14: worn tweed → celestial tailoring.
export const tierOutfits: Outfit[] = [
  { suit: '#7d6650', shade: '#645040', trouser: '#4e4034', shirt: '#f1ead9', tie: '#8d5947' },
  { suit: '#5b6b7c', shade: '#475565', trouser: '#333d49', shirt: '#f4f0e4', tie: '#a06a3f' },
  { suit: '#3d5c54', shade: '#2e4a43', trouser: '#26362f', shirt: '#f6f2e6', tie: '#b98a3e' },
  { suit: '#2c4a68', shade: '#1f3852', trouser: '#1a2a3c', shirt: '#f7f4ea', tie: '#c0903e', vest: '#3c5d7d' },
  { suit: '#232f47', shade: '#182338', trouser: '#131c2c', shirt: '#f8f5ec', tie: '#c89b4b', vest: '#33415e', pinstripe: true },
  { suit: '#402c4e', shade: '#30203c', trouser: '#221631', shirt: '#f6f1e8', tie: '#d0aa58', vest: '#54406b' },
  { suit: '#1c2b3f', shade: '#131f30', trouser: '#0e1826', shirt: '#f8f5ec', tie: '#d8b45e', vest: '#2b3c55', pinstripe: true },
  { suit: '#25415c', shade: '#1a3248', trouser: '#132639', shirt: '#f8f5ec', tie: '#7fb4c9', vest: '#365474' },
  { suit: '#101b2c', shade: '#0a1220', trouser: '#070d17', shirt: '#f9f6ee', tie: '#e0bd68', vest: '#1e2c42', pinstripe: true },
  { suit: '#3c2f57', shade: '#2d2244', trouser: '#1f1731', shirt: '#f7f2ea', tie: '#e6c67a', vest: '#4f3f70' },
  { suit: '#1f4247', shade: '#153338', trouser: '#0f2529', shirt: '#f6f3ea', tie: '#8fd8c8', vest: '#2c565c' },
  { suit: '#123c50', shade: '#0c2e3f', trouser: '#08222f', shirt: '#f6f4ec', tie: '#79cde6', vest: '#1d4e64' },
  { suit: '#2a3160', shade: '#1f254c', trouser: '#161b3a', shirt: '#f7f5f0', tie: '#6fe3ff', vest: '#394174', accent: '#6fe3ff' },
  { suit: '#3a3350', shade: '#2c273e', trouser: '#201c2f', shirt: '#f8f6f1', tie: '#cfd6e6', vest: '#4c4466', accent: '#cfd6e6' },
  { suit: '#151d3d', shade: '#0e1430', trouser: '#0a0f24', shirt: '#f9f7f0', tie: '#ffe9a6', vest: '#232c50', accent: '#ffe9a6' },
]

// Staff and secondary-cast tailoring (variant 1–6 cycles through these).
export const staffOutfits: Outfit[] = [
  { suit: '#7c4460', shade: '#63344c', trouser: '#422434', shirt: '#f5f0e4', tie: '#c99a4e' },
  { suit: '#33586c', shade: '#264557', trouser: '#1b3341', shirt: '#f4f1e6', tie: '#b06a44' },
  { suit: '#5b4675', shade: '#48365e', trouser: '#332646', shirt: '#f6f2e8', tie: '#c9a054' },
  { suit: '#2d5049', shade: '#213e38', trouser: '#182e29', shirt: '#f4f0e5', tie: '#ba8443' },
  { suit: '#75513a', shade: '#5e402c', trouser: '#453022', shirt: '#f5f1e6', tie: '#8f4f3d' },
  { suit: '#5e3844', shade: '#4a2b35', trouser: '#352028', shirt: '#f6f1e7', tie: '#c89b4b' },
  { suit: '#40567c', shade: '#324564', trouser: '#243349', shirt: '#f5f2e9', tie: '#d1ab5c' },
]

export function outfitFor(variant: number, tier: number): Outfit {
  if (variant === 0) return tierOutfits[Math.max(0, Math.min(tierOutfits.length - 1, tier))]
  return staffOutfits[(variant - 1) % staffOutfits.length]
}

export function skinFor(variant: number): SkinTone {
  return skinTones[((variant % skinTones.length) + skinTones.length) % skinTones.length]
}

export function hairFor(variant: number): HairTone {
  return hairTones[((variant % hairTones.length) + hairTones.length) % hairTones.length]
}

export function eyeFor(variant: number): string {
  return eyeTones[((variant % eyeTones.length) + eyeTones.length) % eyeTones.length]
}
