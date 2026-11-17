// Warm lines to go with the answer to a wish: one tap says "I heard you", whatever the
// decision is. A kind no does a couple no harm; a cold one does. Saved by id.

export interface Tap {
  id: string
  emoji: string
  en: string
  de: string
}

export const WISH_TAPS: Tap[] = [
  { id: 'glad', emoji: '🤍', en: 'I like that you asked', de: 'Schön, dass du fragst' },
  { id: 'thanks', emoji: '🙏', en: 'Thank you for telling me', de: 'Danke, dass du es mir sagst' },
  { id: 'brave', emoji: '✨', en: 'That was brave', de: 'Das war mutig' },
  { id: 'fire', emoji: '🔥', en: 'So hot', de: 'So heiss' },
  { id: 'more', emoji: '👂', en: 'Tell me more', de: 'Erzähl mir mehr' },
  { id: 'us', emoji: '🫶', en: 'Nothing changes between us', de: 'Zwischen uns ändert sich nichts' },
]

const BY_ID = new Map(WISH_TAPS.map((tap) => [tap.id, tap] as const))
export const wishTapById = (id: string): Tap | undefined => BY_ID.get(id)
