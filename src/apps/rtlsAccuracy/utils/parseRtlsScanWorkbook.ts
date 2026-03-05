import {
  BlobReader,
  TextWriter,
  Writer,
  ZipReader,
  type Entry,
  type FileEntry,
} from '@zip.js/zip.js'
import type { RtlsParseProgress, RtlsScanDataset } from '../types'

type ParsedCell = {
  type: string
  value: string
}

type ParsedCells = Record<string, ParsedCell>

type SheetRef = {
  name: string
  entry: string
}

const WORKBOOK_ENTRY = 'xl/workbook.xml'
const WORKBOOK_RELS_ENTRY = 'xl/_rels/workbook.xml.rels'
const SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml'
const TARGET_COLS = new Set(['B', 'J', 'K', 'M', 'O', 'P', 'R', 'S', 'AA', 'AG', 'AH', 'AI'])
const BEACON_TARGET_COLS = new Set(['B'])

const ROW_CLOSE = '</row>'
const SHARED_STRING_CLOSE = '</si>'
const MAX_BUFFER = 400_000
const DECODE_SLICE_BYTES = 1_000_000
const DAY_MS = 24 * 60 * 60 * 1000

const decodeXmlEntities = (value: string) => {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

const extractRowNumber = (rowXml: string) => {
  const match = rowXml.match(/<row\b[^>]*\br="(\d+)"/)
  if (!match) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : null
}

const extractTargetCells = (rowXml: string, targetCols: Set<string>): ParsedCells => {
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

const createWorksheetRowParser = (
  targetCols: Set<string>,
  onRow: (rowNumber: number, cells: ParsedCells) => void,
) => {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  const consumeText = (text: string) => {
    if (!text) return
    buffer += text

    while (true) {
      const rowStart = buffer.indexOf('<row')
      if (rowStart === -1) {
        if (buffer.length > MAX_BUFFER) {
          buffer = buffer.slice(-MAX_BUFFER)
        }
        break
      }

      const rowEnd = buffer.indexOf(ROW_CLOSE, rowStart)
      if (rowEnd === -1) {
        if (rowStart > 0) {
          buffer = buffer.slice(rowStart)
        }
        if (buffer.length > MAX_BUFFER) {
          buffer = buffer.slice(-MAX_BUFFER)
        }
        break
      }

      const rowXml = buffer.slice(rowStart, rowEnd + ROW_CLOSE.length)
      buffer = buffer.slice(rowEnd + ROW_CLOSE.length)

      const rowNumber = extractRowNumber(rowXml)
      if (!rowNumber) continue
      const cells = extractTargetCells(rowXml, targetCols)
      onRow(rowNumber, cells)
    }
  }

  return {
    onChunk: (chunk: Uint8Array, final: boolean) => {
      if (chunk.length === 0) {
        consumeText(decoder.decode(chunk, { stream: !final }))
        return
      }

      for (let offset = 0; offset < chunk.length; offset += DECODE_SLICE_BYTES) {
        const end = Math.min(offset + DECODE_SLICE_BYTES, chunk.length)
        const isLastSlice = final && end === chunk.length
        consumeText(decoder.decode(chunk.subarray(offset, end), { stream: !isLastSlice }))
      }
    },
  }
}

const createSharedStringsParser = (
  neededIndices: Set<number>,
  sharedLookup: Map<number, string>,
) => {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sharedIndex = -1
  const consumeText = (text: string) => {
    if (!text) return
    buffer += text

    while (true) {
      const itemStart = buffer.indexOf('<si')
      if (itemStart === -1) {
        if (buffer.length > MAX_BUFFER) {
          buffer = buffer.slice(-MAX_BUFFER)
        }
        break
      }

      const itemEnd = buffer.indexOf(SHARED_STRING_CLOSE, itemStart)
      if (itemEnd === -1) {
        if (itemStart > 0) {
          buffer = buffer.slice(itemStart)
        }
        if (buffer.length > MAX_BUFFER) {
          buffer = buffer.slice(-MAX_BUFFER)
        }
        break
      }

      const sharedXml = buffer.slice(itemStart, itemEnd + SHARED_STRING_CLOSE.length)
      buffer = buffer.slice(itemEnd + SHARED_STRING_CLOSE.length)
      sharedIndex += 1

      if (!neededIndices.has(sharedIndex)) continue

      const textPattern = /<t[^>]*>([\s\S]*?)<\/t>/g
      let textMatch: RegExpExecArray | null = null
      const parts: string[] = []
      while ((textMatch = textPattern.exec(sharedXml)) !== null) {
        parts.push(decodeXmlEntities(textMatch[1]))
      }
      sharedLookup.set(sharedIndex, parts.join(''))
    }
  }

  return {
    onChunk: (chunk: Uint8Array, final: boolean) => {
      if (chunk.length === 0) {
        consumeText(decoder.decode(chunk, { stream: !final }))
        return
      }

      for (let offset = 0; offset < chunk.length; offset += DECODE_SLICE_BYTES) {
        const end = Math.min(offset + DECODE_SLICE_BYTES, chunk.length)
        const isLastSlice = final && end === chunk.length
        consumeText(decoder.decode(chunk.subarray(offset, end), { stream: !isLastSlice }))
      }
    },
  }
}

const toFileEntriesByPath = (entries: Entry[]) => {
  const map = new Map<string, FileEntry>()
  for (const entry of entries) {
    if (entry.directory) continue
    map.set(entry.filename, entry)
  }
  return map
}

const readXmlEntry = async (entry: FileEntry) => {
  return entry.getData(new TextWriter(), { useWebWorkers: false })
}

const streamEntry = async (
  entry: FileEntry,
  onChunk: (chunk: Uint8Array, final: boolean) => void,
) => {
  class StreamingWriter extends Writer<void> {
    private closed = false

    async writeUint8Array(array: Uint8Array) {
      onChunk(array, false)
    }

    async getData() {
      if (!this.closed) {
        this.closed = true
        onChunk(new Uint8Array(0), true)
      }
      return
    }
  }

  await entry.getData(new StreamingWriter(), { useWebWorkers: false })
}

const normalizeEntryPath = (target: string) => {
  const clean = target.trim().replace(/\\/g, '/')
  if (!clean) return null
  if (clean.startsWith('/')) return clean.slice(1)
  if (clean.startsWith('xl/')) return clean
  return `xl/${clean}`
}

const resolveSheetEntries = async (fileEntriesByPath: Map<string, FileEntry>) => {
  const workbookEntry = fileEntriesByPath.get(WORKBOOK_ENTRY)
  const relsEntry = fileEntriesByPath.get(WORKBOOK_RELS_ENTRY)
  if (!workbookEntry || !relsEntry) return null

  const workbookXml = await readXmlEntry(workbookEntry)
  const relsXml = await readXmlEntry(relsEntry)

  const relIdToEntry = new Map<string, string>()
  const relPattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g
  let relMatch: RegExpExecArray | null = null
  while ((relMatch = relPattern.exec(relsXml)) !== null) {
    const relId = relMatch[1]
    const entry = normalizeEntryPath(relMatch[2])
    if (entry) {
      relIdToEntry.set(relId, entry)
    }
  }

  const sheets: SheetRef[] = []
  const sheetPattern = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g
  let sheetMatch: RegExpExecArray | null = null
  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    const name = sheetMatch[1]
    const relId = sheetMatch[2]
    const entry = relIdToEntry.get(relId)
    if (!entry) continue
    sheets.push({ name, entry })
  }

  if (sheets.length === 0) return null

  const findByNeedles = (needles: string[]) => {
    for (const needle of needles) {
      const found = sheets.find((sheet) => sheet.name.toLowerCase().includes(needle))
      if (found) return found.entry
    }
    return null
  }

  const scanEntry =
    findByNeedles(['scan', 'analytic', 'history']) ??
    findByNeedles(['sheet1']) ??
    sheets[0].entry
  const beaconEntry = findByNeedles(['beacon'])

  return {
    scanEntry,
    beaconEntry:
      beaconEntry && beaconEntry !== scanEntry && fileEntriesByPath.has(beaconEntry)
        ? beaconEntry
        : null,
  }
}

const parseExcelSerial = (...candidates: Array<string | undefined>) => {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim()
    if (!trimmed) continue

    const numeric = Number.parseFloat(trimmed)
    if (Number.isFinite(numeric) && numeric > 20_000) return numeric

    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) {
      return parsed / DAY_MS + 25569
    }
  }
  return null
}

const normalizeName = (value: string) => value.trim().toLowerCase()

const parseTokenKey = (
  cell: ParsedCell | undefined,
  neededSharedIndices: Set<number>,
  rawValueToId: Map<string, number>,
  rawValueLookup: string[],
) => {
  if (!cell) return 0
  const value = cell.value.trim()
  if (!value) return 0

  if (cell.type === 's') {
    const index = Number.parseInt(value, 10)
    if (!Number.isFinite(index)) return 0
    neededSharedIndices.add(index)
    return index + 1
  }

  const existing = rawValueToId.get(value)
  if (existing !== undefined) return -existing

  const nextId = rawValueLookup.length + 1
  rawValueLookup.push(value)
  rawValueToId.set(value, nextId)
  return -nextId
}

export const decodeTokenKey = (
  key: number,
  sharedLookup: Map<number, string>,
  rawValueLookup: string[],
) => {
  if (key === 0) return ''
  if (key > 0) {
    return sharedLookup.get(key - 1) ?? ''
  }
  return rawValueLookup[Math.abs(key) - 1] ?? ''
}

export const parseRtlsScanWorkbook = async (
  file: File,
  onProgress?: (progress: RtlsParseProgress) => void,
): Promise<RtlsScanDataset> => {
  const zipReader = new ZipReader(new BlobReader(file), { useWebWorkers: false })

  try {
    const entries = await zipReader.getEntries()
    const fileEntriesByPath = toFileEntriesByPath(entries)
    const sheetEntries = await resolveSheetEntries(fileEntriesByPath)
    if (!sheetEntries) {
      throw new Error('Workbook format not recognized. No worksheet could be located.')
    }

    const scanSheetEntry = fileEntriesByPath.get(sheetEntries.scanEntry)
    if (!scanSheetEntry) {
      throw new Error('Workbook format not recognized. Unable to find worksheet data entry.')
    }

    const neededSharedIndices = new Set<number>()
    const rawValueLookup: string[] = []
    const rawValueToId = new Map<string, number>()

    const invKeys: number[] = []
    const invNameKeys: number[] = []
    const locationKeys: number[] = []
    const aliasUserKeys: number[] = []
    const userKeys: number[] = []
    const stateKeys: number[] = []
    const substateKeys: number[] = []
    const workflowKeys: number[] = []
    const timestampSerials: number[] = []
    const beaconInvNameKeys: number[] = []

    let parsedRows = 0

    const worksheetParser = createWorksheetRowParser(TARGET_COLS, (rowNumber, cells) => {
      if (rowNumber === 1) return
      parsedRows += 1

      if (parsedRows % 50_000 === 0) {
        onProgress?.({
          phase: 'sheets',
          message: `Reading scan rows (${parsedRows.toLocaleString()})`,
          rowsParsed: parsedRows,
        })
      }

      const invKey = parseTokenKey(cells.B, neededSharedIndices, rawValueToId, rawValueLookup)
      if (invKey === 0) return

      const locationKey =
        parseTokenKey(cells.P, neededSharedIndices, rawValueToId, rawValueLookup) ||
        parseTokenKey(cells.O, neededSharedIndices, rawValueToId, rawValueLookup) ||
        parseTokenKey(cells.K, neededSharedIndices, rawValueToId, rawValueLookup) ||
        parseTokenKey(cells.J, neededSharedIndices, rawValueToId, rawValueLookup)
      if (locationKey === 0) return

      const timestampSerial = parseExcelSerial(cells.AI?.value, cells.AH?.value, cells.AG?.value)
      if (timestampSerial === null) return

      invKeys.push(invKey)
      invNameKeys.push(
        parseTokenKey(cells.AA, neededSharedIndices, rawValueToId, rawValueLookup),
      )
      locationKeys.push(locationKey)
      aliasUserKeys.push(
        parseTokenKey(cells.R, neededSharedIndices, rawValueToId, rawValueLookup),
      )
      userKeys.push(parseTokenKey(cells.S, neededSharedIndices, rawValueToId, rawValueLookup))
      stateKeys.push(parseTokenKey(cells.J, neededSharedIndices, rawValueToId, rawValueLookup))
      substateKeys.push(parseTokenKey(cells.K, neededSharedIndices, rawValueToId, rawValueLookup))
      workflowKeys.push(parseTokenKey(cells.M, neededSharedIndices, rawValueToId, rawValueLookup))
      timestampSerials.push(timestampSerial)
    })

    onProgress?.({ phase: 'sheets', message: 'Reading worksheet rows...', rowsParsed: 0 })
    await streamEntry(scanSheetEntry, worksheetParser.onChunk)

    if (sheetEntries.beaconEntry) {
      const beaconSheetEntry = fileEntriesByPath.get(sheetEntries.beaconEntry)
      if (beaconSheetEntry) {
        onProgress?.({
          phase: 'sheets',
          message: 'Reading beaconed assets sheet...',
          rowsParsed: parsedRows,
        })
        const beaconParser = createWorksheetRowParser(BEACON_TARGET_COLS, (rowNumber, cells) => {
          if (rowNumber === 1) return
          const invNameKey = parseTokenKey(
            cells.B,
            neededSharedIndices,
            rawValueToId,
            rawValueLookup,
          )
          if (invNameKey !== 0) {
            beaconInvNameKeys.push(invNameKey)
          }
        })
        await streamEntry(beaconSheetEntry, beaconParser.onChunk)
      }
    }

    if (parsedRows === 0 || invKeys.length === 0) {
      throw new Error('No scan rows were parsed. Please verify this is a scan-history export.')
    }

    const sharedLookup = new Map<number, string>()
    if (neededSharedIndices.size > 0) {
      const sharedStringsEntry = fileEntriesByPath.get(SHARED_STRINGS_ENTRY)
      if (!sharedStringsEntry) {
        throw new Error('Workbook is missing shared strings data (xl/sharedStrings.xml).')
      }

      onProgress?.({
        phase: 'shared-strings',
        message: 'Decoding text labels...',
        rowsParsed: parsedRows,
      })

      const sharedStringsParser = createSharedStringsParser(neededSharedIndices, sharedLookup)
      await streamEntry(sharedStringsEntry, sharedStringsParser.onChunk)
    }

    const beaconedNameSet = new Set<string>()
    for (const invNameKey of beaconInvNameKeys) {
      const normalized = normalizeName(decodeTokenKey(invNameKey, sharedLookup, rawValueLookup))
      if (normalized) {
        beaconedNameSet.add(normalized)
      }
    }

    const rawParsedRows = invKeys.length
    const beaconFilterApplied = beaconedNameSet.size > 0
    let excludedNonBeaconRows = 0

    const filteredInvKeys: number[] = []
    const filteredInvNameKeys: number[] = []
    const filteredLocationKeys: number[] = []
    const filteredAliasUserKeys: number[] = []
    const filteredUserKeys: number[] = []
    const filteredStateKeys: number[] = []
    const filteredSubstateKeys: number[] = []
    const filteredWorkflowKeys: number[] = []
    const filteredTimestampSerials: number[] = []
    const excludedInvNameCounts = new Map<string, number>()

    for (let index = 0; index < invKeys.length; index += 1) {
      if (beaconFilterApplied) {
        const normalizedInvName = normalizeName(
          decodeTokenKey(invNameKeys[index], sharedLookup, rawValueLookup),
        )
        if (!normalizedInvName || !beaconedNameSet.has(normalizedInvName)) {
          excludedNonBeaconRows += 1
          const rawInvName = decodeTokenKey(invNameKeys[index], sharedLookup, rawValueLookup).trim()
          const invNameLabel = rawInvName || '(Blank Inv Name)'
          excludedInvNameCounts.set(invNameLabel, (excludedInvNameCounts.get(invNameLabel) ?? 0) + 1)
          continue
        }
      }

      filteredInvKeys.push(invKeys[index])
      filteredInvNameKeys.push(invNameKeys[index])
      filteredLocationKeys.push(locationKeys[index])
      filteredAliasUserKeys.push(aliasUserKeys[index])
      filteredUserKeys.push(userKeys[index])
      filteredStateKeys.push(stateKeys[index])
      filteredSubstateKeys.push(substateKeys[index])
      filteredWorkflowKeys.push(workflowKeys[index])
      filteredTimestampSerials.push(timestampSerials[index])
    }

    onProgress?.({
      phase: 'complete',
      message: 'Workbook parse complete.',
      rowsParsed: parsedRows,
    })

    const excludedInvNameSummaries = Array.from(excludedInvNameCounts.entries())
      .map(([invName, count]) => ({ invName, count }))
      .sort((left, right) => right.count - left.count)

    return {
      rows: {
        invKeys: Int32Array.from(filteredInvKeys),
        invNameKeys: Int32Array.from(filteredInvNameKeys),
        locationKeys: Int32Array.from(filteredLocationKeys),
        aliasUserKeys: Int32Array.from(filteredAliasUserKeys),
        userKeys: Int32Array.from(filteredUserKeys),
        stateKeys: Int32Array.from(filteredStateKeys),
        substateKeys: Int32Array.from(filteredSubstateKeys),
        workflowKeys: Int32Array.from(filteredWorkflowKeys),
        timestampSerials: Float64Array.from(filteredTimestampSerials),
      },
      sharedLookup,
      rawValueLookup,
      parsedRows: filteredInvKeys.length,
      rawParsedRows,
      beaconFilterApplied,
      beaconedAssetsCount: beaconedNameSet.size,
      excludedNonBeaconRows,
      excludedInvNameSummaries,
    }
  } finally {
    await zipReader.close()
  }
}
