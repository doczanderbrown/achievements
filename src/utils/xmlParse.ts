export type ParsedCell = {
  type: string
  value: string
}

export type ParsedCells = Record<string, ParsedCell>

export const decodeXmlEntities = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

export const extractRowNumber = (rowXml: string): number | null => {
  const match = rowXml.match(/<row\b[^>]*\br="(\d+)"/)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

export const extractTargetCells = (rowXml: string, targetCols: Set<string>): ParsedCells => {
  const cells: ParsedCells = {}
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
  let match: RegExpExecArray | null = null

  while ((match = cellPattern.exec(rowXml)) !== null) {
    const attributes = match[1]
    const body = match[2]

    const refMatch = attributes.match(/\br="([A-Z]+)\d+"/)
    if (!refMatch) continue

    const column = refMatch[1]
    if (!targetCols.has(column)) continue

    const typeMatch = attributes.match(/\bt="([^"]+)"/)
    const type = typeMatch ? typeMatch[1] : ''

    let value = ''
    if (type === 'inlineStr') {
      const textPattern = /<t[^>]*>([\s\S]*?)<\/t>/g
      let textMatch: RegExpExecArray | null = null
      const parts: string[] = []
      while ((textMatch = textPattern.exec(body)) !== null) {
        parts.push(decodeXmlEntities(textMatch[1]))
      }
      value = parts.join('')
    } else {
      const valueMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)
      value = valueMatch ? decodeXmlEntities(valueMatch[1]) : ''
    }

    cells[column] = { type, value }
  }

  return cells
}
