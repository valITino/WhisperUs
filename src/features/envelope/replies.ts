// The quick answers to an opened envelope: one tap says "I am here, and it landed".
// Saved by id, so they survive a change of language.

export interface Tap {
  id: string
  emoji: string
  en: string
  de: string
}

export const TAPS: Tap[] = [
  { id: 'safe', emoji: '🤍', en: 'I am here', de: 'Ich bin da' },
  { id: 'thanks', emoji: '🙏', en: 'Thank you for telling me', de: 'Danke, dass du es mir sagst' },
  { id: 'fire', emoji: '🔥', en: 'So hot', de: 'So heiss' },
  { id: 'melt', emoji: '🥰', en: 'I melt', de: 'Ich schmelze' },
  { id: 'proud', emoji: '✨', en: 'Proud of you', de: 'Stolz auf dich' },
  { id: 'more', emoji: '👂', en: 'Tell me more', de: 'Erzähl mir mehr' },
  { id: 'again', emoji: '🔁', en: 'Again, please', de: 'Bitte nochmal' },
]

const BY_ID = new Map(TAPS.map((tap) => [tap.id, tap] as const))
export const tapById = (id: string): Tap | undefined => BY_ID.get(id)
