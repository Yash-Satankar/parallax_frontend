import { Fragment, type ReactNode } from 'react'

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'rule' }

export function MarkdownText({ children, fadeTail = 0 }: { children: string; fadeTail?: number }) {
  const blocks = parseBlocks(children)
  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        const fade = index === blocks.length - 1 ? fadeTail : 0
        if (block.type === 'heading') {
          return (
            <div key={index} className="pt-1 text-[12px] font-semibold tracking-wide text-cream">
              {inline(block.text, fade)}
            </div>
          )
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag
              key={index}
              className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, itemIndex === block.items.length - 1 ? fade : 0)}</li>
              ))}
            </Tag>
          )
        }
        if (block.type === 'table') {
          return (
            <div key={index} className="overflow-x-auto rounded-md border border-line/70">
              <table className="w-full min-w-[420px] border-collapse text-left text-[11px] leading-relaxed">
                <thead className="bg-wash-strong text-cream">
                  <tr>
                    {block.headers.map((header, cellIndex) => (
                      <th key={cellIndex} className="border-b border-line px-2.5 py-2 font-semibold">
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="align-top even:bg-wash/40">
                      {block.headers.map((_, cellIndex) => (
                        <td key={cellIndex} className="border-b border-line/60 px-2.5 py-2 text-mute">
                          {inline(row[cellIndex] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.type === 'rule') {
          return <hr key={index} className="border-0 border-t border-line-strong" />
        }
        return <p key={index}>{inline(block.text, fade)}</p>
      })}
    </div>
  )
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join(' ').trim()
    if (text) blocks.push({ type: 'paragraph', text })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) {
      flushParagraph()
      continue
    }
    if (isHorizontalRule(line)) {
      flushParagraph()
      blocks.push({ type: 'rule' })
      continue
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1].trim())) {
      flushParagraph()
      const headers = splitTableRow(line)
      const rows: string[][] = []
      i += 2
      for (; i < lines.length; i++) {
        const candidate = lines[i].trim()
        if (!isTableRow(candidate) || isTableDivider(candidate)) {
          i--
          break
        }
        rows.push(splitTableRow(candidate))
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line)
    if (bullet || numbered) {
      flushParagraph()
      const ordered = !!numbered
      const items: string[] = []
      for (; i < lines.length; i++) {
        const candidate = lines[i].trim()
        const match = ordered ? /^\d+[.)]\s+(.+)$/.exec(candidate) : /^[-*]\s+(.+)$/.exec(candidate)
        if (!match) {
          i--
          break
        }
        items.push(match[1])
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    paragraph.push(line)
  }
  flushParagraph()
  return blocks
}

function isTableRow(line: string) {
  return line.includes('|') && splitTableRow(line).length > 1
}

function splitTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isTableDivider(line: string) {
  const cells = splitTableRow(line)
  return isTableRow(line) && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isHorizontalRule(line: string) {
  return /^([-*_])(?:\s*\1){2,}\s*$/.test(line)
}

function inline(text: string, fadeTail = 0): ReactNode[] {
  if (fadeTail > 0) return fadeInline(text, fadeTail)
  return parseInline(text)
}

function fadeInline(text: string, fadeTail: number): ReactNode[] {
  const split = Math.max(0, text.length - fadeTail)
  const head = text.slice(0, split)
  const tail = text.slice(split)
  if (!tail || /[`*[]/.test(tail)) return parseInline(text)
  return [
    ...parseInline(head),
    ...[...tail].map((ch, index) => (
      <span key={`fade-${split + index}`} className="stream-glyph">{ch}</span>
    )),
  ]
}

function parseInline(text: string): ReactNode[] {
  const tokenPattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[([^\]\n]+)\]\s*\(((?:https?:\/\/|mailto:)[^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<]+))/g
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</Fragment>)
    }

    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(
        <code key={`code-${match.index}`} className="rounded bg-wash-strong px-1 py-0.5 font-mono text-[0.92em] text-cream">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**')) {
      nodes.push(
        <strong key={`strong-${match.index}`} className="font-semibold text-cream">
          {inline(token.slice(2, -2))}
        </strong>,
      )
    } else if (match[2] && match[3]) {
      nodes.push(linkNode(match[2], match[3], `link-${match.index}`))
    } else if (match[4]) {
      const { href, label } = normalizeBareURL(match[4])
      nodes.push(linkNode(label, href, `url-${match.index}`))
    }
    lastIndex = tokenPattern.lastIndex
  }

  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`text-${lastIndex}`}>{text.slice(lastIndex)}</Fragment>)
  }
  return nodes
}

function linkNode(label: string, href: string, key: string): ReactNode {
  if (!isSafeURL(href)) return <Fragment key={key}>{label}</Fragment>
  return (
    <a
      key={key}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-teal underline decoration-teal/40 underline-offset-2 transition-colors hover:text-cream"
    >
      {label}
    </a>
  )
}

function normalizeBareURL(value: string): { href: string; label: string } {
  let label = value
  while (/[.,;:!?\]}]$/.test(label)) label = label.slice(0, -1)
  if (label.endsWith(')') && !label.includes('(')) label = label.slice(0, -1)
  return { href: label.startsWith('www.') ? `https://${label}` : label, label }
}

function isSafeURL(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
  } catch {
    return false
  }
}
