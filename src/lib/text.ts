// Words compared the way people mean them.

/** Lower case, accents removed, so "Rösti" is found by "rosti". */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}
