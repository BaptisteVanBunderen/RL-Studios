/**
 * Raccourcis clavier globaux, au format « accélérateur » d'Electron (ex. `Ctrl+Shift+F9`).
 * Un raccourci valide a au moins un modificateur (Ctrl, Alt, Shift) ou est une touche F1–F24.
 */

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'] as const
const NAMED_KEYS = [
  'Space',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'Enter',
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
  'End',
  'PageUp',
  'PageDown'
]
const KEY_PATTERN = new RegExp(`^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|${NAMED_KEYS.join('|')})$`)

export function isValidAccelerator(value: string): boolean {
  const parts = value.split('+')
  const key = parts.pop() ?? ''
  if (!KEY_PATTERN.test(key)) return false
  const modifiers = parts
  if (new Set(modifiers).size !== modifiers.length) return false
  if (!modifiers.every((m) => (MODIFIER_ORDER as readonly string[]).includes(m))) return false
  return modifiers.length > 0 || /^F\d+$/.test(key)
}

export interface KeyInput {
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  /** `KeyboardEvent.code`, indépendant de la disposition du clavier (ex. `KeyA`, `Digit1`, `F9`). */
  code: string
}

/** Transforme un appui de touche en accélérateur, ou `null` si ce n'est pas une touche utilisable. */
export function acceleratorFromKey(input: KeyInput): string | null {
  const code = input.code
  let key: string | null = null
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (NAMED_KEYS.includes(code)) key = code
  else if (code.startsWith('Arrow')) key = code.slice(5)
  if (!key) return null

  const modifiers = [
    input.ctrlKey && 'Ctrl',
    input.altKey && 'Alt',
    input.shiftKey && 'Shift'
  ].filter((m): m is string => typeof m === 'string')
  const accelerator = [...modifiers, key].join('+')
  return isValidAccelerator(accelerator) ? accelerator : null
}
