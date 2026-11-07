// The looks the pane and the token meter share. Amber and Firefly are one layout (a phosphor tube)
// in two palettes; 1-bit is its own drawing (draw.ts). The token meter keeps its own copy of the
// palettes: each plugin is installed on its own, so neither can import the other.

export const STYLES = [
  { value: 'amber', label: 'AMBER' },
  { value: '1bit', label: '1-BIT' },
  { value: 'firefly', label: 'FIREFLY' },
] as const
export type Style = (typeof STYLES)[number]['value']

export const toStyle = (s: unknown): Style => STYLES.find(x => x.value === s)?.value ?? 'amber'

// What a typed style name means: the labels count too ("1-bit", "Firefly").
export const parseStyle = (s: string | undefined): Style | undefined => {
  const v = s?.toLowerCase().replace(/[^a-z0-9]/g, '')
  return STYLES.find(x => x.value === v)?.value
}

export const nextStyle = (s: Style): Style => STYLES[(STYLES.findIndex(x => x.value === s) + 1) % STYLES.length]!.value

export type Palette = {
  bg: string
  card: string
  screen: string
  edge: string
  rest: string
  lab: string
  text: string
  num: string
  unit: string
  fill: string
  ptr: string
  hot: string
  idle: string
}

export const TUBE: Record<'amber' | 'firefly', Palette> = {
  // amber phosphor: one warm hue at different strengths
  amber: {
    bg: '#140d05',
    card: '#1c1308',
    screen: '#0f0903',
    edge: '#4a3212',
    rest: '#3b2a12',
    lab: '#b08035',
    text: '#f2cf94',
    num: '#ffc46b',
    unit: '#e8962a',
    fill: '#ff9d1c',
    ptr: '#ffd27a',
    hot: '#ff5b3a',
    idle: '#a8864a',
  },
  // a summer night in the grass: deep moss, acid lime light, a coral alarm
  firefly: {
    bg: '#0a110b',
    card: '#101a11',
    screen: '#060c07',
    edge: '#2b4224',
    rest: '#1f3219',
    lab: '#8fb05f',
    text: '#cfe69a',
    num: '#d9ff5c',
    unit: '#a6d838',
    fill: '#b8f23a',
    ptr: '#eaff9a',
    hot: '#ff6a48',
    idle: '#7e9a55',
  },
}

// 1-bit: ink on black. The "only ink on black" rule holds for every Svg; DIM exists for the Button and
// the terminal's text, where no dither pattern can stand in for a tone.
export const INK = '#ece8dc'
export const BLACK = '#000000'
export const DIM = '#8f8b80'

// The switcher row: its background merges with the card, the chosen look lit, the others dim, and the
// frame's top corners in the card's label tone (the scene draws the bottom two in the same).
export const chrome = (s: Style) =>
  s === '1bit'
    ? { bg: BLACK, on: INK, off: DIM, edge: INK }
    : { bg: TUBE[s].bg, on: TUBE[s].num, off: TUBE[s].lab, edge: TUBE[s].lab }

// One top corner of the pane's frame, a tiny still image at the row's end (the card under the row
// cannot draw it: the row comes first). The scene draws the bottom two.
export const corner = (side: 'left' | 'right', color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11">` +
  `<path d="${side === 'left' ? 'M10 1H1V10' : 'M1 1H10V10'}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`
