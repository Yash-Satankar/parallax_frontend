const THOUGHT_TAG = /<\/?(?:thought|think)>/gi

export function stripThoughtMarkup(text: string) {
  return text.replace(THOUGHT_TAG, '').replace(/^\s+/, '')
}

export function thoughtPreview(text: string) {
  const clean = stripThoughtMarkup(text).trim()
  if (!clean) return ''
  const line = clean.split('\n').map((part) => part.trim()).find(Boolean) ?? ''
  return line.replace(/^\*+\s*/, '').replace(/\*+$/, '')
}
