import { Unzip, UnzipInflate } from 'fflate'
import type { FilterOption, ParseProgress, ProcessingLocationDataset } from '../types'

type EntryHandler = {
  onChunk: (chunk: Uint8Array, final: boolean) => void
}

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

const INVENTORY_TARGET_COLS = new Set(['B', 'F', 'J', 'K', 'L', 'M', 'Z', 'AK', 'AL'])
const LOADS_TARGET_COLS = new Set(['A', 'E'])

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
): EntryHandler => {
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
    onChunk: (chunk, final) => {
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
): EntryHandler => {
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
    onChunk: (chunk, final) => {
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

const runZipPass = async (file: File, handlers: Map<string, EntryHandler>) => {
  return new Promise<void>((resolve, reject) => {
    const unzip = new Unzip((entry) => {
      const handler = handlers.get(entry.name)
      if (!handler) {
        entry.terminate()
        return
      }

      entry.ondata = (err, data, final) => {
        if (err) {
          reject(err)
          return
        }
        try {
          handler.onChunk(data, final)
        } catch (parseError) {
          reject(parseError as Error)
        }
      }
      entry.start()
    })

    unzip.register(UnzipInflate)

    const reader = file.stream().getReader()
    let settled = false

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
      reader.cancel().catch(() => {})
    }

    const pump = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read()
          unzip.push(value ?? new Uint8Array(0), done)
          if (done) break
        }
        if (!settled) {
          settled = true
          resolve()
        }
      } catch (error) {
        fail(error)
      }
    }

    pump().catch(fail)
  })
}

const tokenFromCell = (cell: ParsedCell | undefined) => {
  if (!cell) return null
  const value = cell.value.trim()
  if (!value) return null
  if (cell.type === 's') return `s:${value}`
  return `v:${value}`
}

const internToken = (token: string, map: Map<string, number>, list: string[]) => {
  const existing = map.get(token)
  if (existing !== undefined) return existing
  const next = list.length
  list.push(token)
  map.set(token, next)
  return next
}

const parseExcelSerial = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number.parseFloat(trimmed)
  if (Number.isFinite(numeric) && numeric > 20_000) return numeric

  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) return null
  return parsed / DAY_MS + 25569
}

const parseDayOfWeek = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null

  const numeric = Number.parseInt(trimmed, 10)
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 7) return numeric

  const normalized = trimmed.slice(0, 3).toLowerCase()
  const textMap: Record<string, number> = {
    sun: 1,
    mon: 2,
    tue: 3,
    wed: 4,
    thu: 5,
    fri: 6,
    sat: 7,
  }
  return textMap[normalized] ?? null
}

const excelSerialToDate = (serial: number) => {
  return new Date((serial - 25569) * DAY_MS)
}

const deriveDayFromSerial = (serial: number) => {
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return null
  const jsDay = date.getDay()
  return jsDay + 1
}

const parseNoGo = (value: string) => {
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y'
}

const sharedIndexFromToken = (token: string) => {
  if (!token.startsWith('s:')) return null
  const parsed = Number.parseInt(token.slice(2), 10)
  return Number.isFinite(parsed) ? parsed : null
}

const decodeTokenLabel = (token: string, sharedLookup: Map<number, string>) => {
  if (!token.startsWith('s:')) {
    return token.slice(2)
  }
  const index = sharedIndexFromToken(token)
  if (index === null) return ''
  return sharedLookup.get(index) ?? ''
}

const normalizeLabel = (value: string, fallback: string) => {
  const trimmed = value.trim()
  return trimmed || fallback
}

const buildCanonicalOptions = (
  tokens: string[],
  sharedLookup: Map<number, string>,
  fallbackLabel: string,
) => {
  const labelToId = new Map<string, number>()
  const canonical: FilterOption[] = []
  const remap = new Uint32Array(tokens.length)

  tokens.forEach((token, tokenId) => {
    const label = normalizeLabel(decodeTokenLabel(token, sharedLookup), fallbackLabel)
    const key = label.toLowerCase()
    const existing = labelToId.get(key)
    if (existing !== undefined) {
      remap[tokenId] = existing
      return
    }

    const canonicalId = canonical.length
    canonical.push({ id: canonicalId, label })
    labelToId.set(key, canonicalId)
    remap[tokenId] = canonicalId
  })

  const sorted = [...canonical].sort((a, b) => a.label.localeCompare(b.label))
  return { options: sorted, remap }
}

const decodeTokenValues = (
  tokens: string[],
  sharedLookup: Map<number, string>,
  fallbackLabel: string,
) => {
  return tokens.map((token) => normalizeLabel(decodeTokenLabel(token, sharedLookup), fallbackLabel))
}

const createXmlCollector = (onComplete: (xml: string) => void): EntryHandler => {
  const decoder = new TextDecoder('utf-8')
  let xml = ''

  return {
    onChunk: (chunk, final) => {
      if (chunk.length === 0) {
        xml += decoder.decode(chunk, { stream: !final })
      } else {
        for (let offset = 0; offset < chunk.length; offset += DECODE_SLICE_BYTES) {
          const end = Math.min(offset + DECODE_SLICE_BYTES, chunk.length)
          const isLastSlice = final && end === chunk.length
          xml += decoder.decode(chunk.subarray(offset, end), { stream: !isLastSlice })
        }
      }
      if (final) {
        onComplete(xml)
      }
    },
  }
}

const normalizeEntryPath = (target: string) => {
  const clean = target.trim().replace(/\\/g, '/')
  if (!clean) return null
  if (clean.startsWith('/')) return clean.slice(1)
  if (clean.startsWith('xl/')) return clean
  return `xl/${clean}`
}

const resolveSheetEntries = async (file: File) => {
  let workbookXml = ''
  let relsXml = ''

  await runZipPass(
    file,
    new Map<string, EntryHandler>([
      [WORKBOOK_ENTRY, createXmlCollector((xml) => (workbookXml = xml))],
      [WORKBOOK_RELS_ENTRY, createXmlCollector((xml) => (relsXml = xml))],
    ]),
  )

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

  const byName = (needle: string) =>
    sheets.find((sheet) => sheet.name.toLowerCase().includes(needle))?.entry ?? null

  let inventoryEntry = byName('inventory')
  let loadsEntry = byName('load')

  if (!inventoryEntry && sheets.length >= 2) {
    inventoryEntry = sheets[0].entry
  }
  if (!loadsEntry && sheets.length >= 2) {
    loadsEntry = sheets[1].entry
  }

  return { inventoryEntry, loadsEntry }
}

const isOffsiteFacility = (label: string) => {
  const normalized = label.trim().toLowerCase()
  if (!normalized) return false
  const compressed = normalized.replace(/[^a-z0-9]+/g, '')
  return compressed.includes('offsite')
}

export const parseProcessingLocationWorkbook = async (
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ProcessingLocationDataset> => {
  const entries = await resolveSheetEntries(file)
  if (!entries.inventoryEntry || !entries.loadsEntry) {
    throw new Error(
      'Workbook format not recognized. Expected Inventory and Loads worksheets with required columns.',
    )
  }

  const loadTokenToId = new Map<string, number>()
  const loadTokens: string[] = []

  const facilityTokenToId = new Map<string, number>()
  const facilityTokens: string[] = []

  const specialtyTokenToId = new Map<string, number>()
  const specialtyTokens: string[] = []

  const itemTypeTokenToId = new Map<string, number>()
  const itemTypeTokens: string[] = []

  const ownerTokenToId = new Map<string, number>()
  const ownerTokens: string[] = []

  const setNameTokenToId = new Map<string, number>()
  const setNameTokens: string[] = []

  const loadToFacilityId = new Map<number, number>()

  const inventoryLoadIds: number[] = []
  const inventoryDateSerials: number[] = []
  const inventoryDayOfWeek: number[] = []
  const inventoryOwnerIds: number[] = []
  const inventorySpecialtyIds: number[] = []
  const inventoryItemTypeIds: number[] = []
  const inventoryNoGoFlags: number[] = []
  const inventorySetNameIds: number[] = []

  let parsedInventoryRows = 0
  let parsedLoadRows = 0

  const inventoryParser = createWorksheetRowParser(INVENTORY_TARGET_COLS, (rowNumber, cells) => {
    if (rowNumber === 1) return
    parsedInventoryRows += 1

    if (parsedInventoryRows % 25_000 === 0) {
      onProgress?.({
        phase: 'sheets',
        message: `Reading Inventory rows (${parsedInventoryRows.toLocaleString()})`,
        inventoryRowsParsed: parsedInventoryRows,
        loadRowsParsed: parsedLoadRows,
      })
    }

    const loadToken = tokenFromCell(cells.B)
    if (!loadToken) return

    const dateSerial = parseExcelSerial(cells.AK?.value ?? '')
    if (dateSerial === null) return

    let dayOfWeek = parseDayOfWeek(cells.AL?.value ?? '')
    if (dayOfWeek === null) {
      dayOfWeek = deriveDayFromSerial(dateSerial)
    }
    if (dayOfWeek === null) return

    const specialtyToken = tokenFromCell(cells.J) ?? 'v:Unspecified'
    const itemTypeToken = tokenFromCell(cells.K) ?? 'v:Unspecified'
    const ownerToken = tokenFromCell(cells.F) ?? 'v:Unknown Owner'
    const setNameToken = tokenFromCell(cells.M) ?? tokenFromCell(cells.L) ?? 'v:Unnamed Set'
    const noGoFlag = parseNoGo(cells.Z?.value ?? '') ? 1 : 0

    const loadId = internToken(loadToken, loadTokenToId, loadTokens)
    const ownerId = internToken(ownerToken, ownerTokenToId, ownerTokens)
    const specialtyId = internToken(specialtyToken, specialtyTokenToId, specialtyTokens)
    const itemTypeId = internToken(itemTypeToken, itemTypeTokenToId, itemTypeTokens)
    const setNameId = internToken(setNameToken, setNameTokenToId, setNameTokens)

    inventoryLoadIds.push(loadId)
    inventoryDateSerials.push(dateSerial)
    inventoryDayOfWeek.push(dayOfWeek)
    inventoryOwnerIds.push(ownerId)
    inventorySpecialtyIds.push(specialtyId)
    inventoryItemTypeIds.push(itemTypeId)
    inventoryNoGoFlags.push(noGoFlag)
    inventorySetNameIds.push(setNameId)
  })

  const loadsParser = createWorksheetRowParser(LOADS_TARGET_COLS, (rowNumber, cells) => {
    if (rowNumber === 1) return
    parsedLoadRows += 1

    if (parsedLoadRows % 10_000 === 0) {
      onProgress?.({
        phase: 'sheets',
        message: `Reading Loads rows (${parsedLoadRows.toLocaleString()})`,
        inventoryRowsParsed: parsedInventoryRows,
        loadRowsParsed: parsedLoadRows,
      })
    }

    const loadToken = tokenFromCell(cells.A)
    const facilityToken = tokenFromCell(cells.E)
    if (!loadToken || !facilityToken) return

    const loadId = internToken(loadToken, loadTokenToId, loadTokens)
    const facilityId = internToken(facilityToken, facilityTokenToId, facilityTokens)
    loadToFacilityId.set(loadId, facilityId)
  })

  onProgress?.({
    phase: 'sheets',
    message: 'Reading Inventory and Loads sheets...',
    inventoryRowsParsed: 0,
    loadRowsParsed: 0,
  })

  await runZipPass(
    file,
    new Map<string, EntryHandler>([
      [entries.inventoryEntry, inventoryParser],
      [entries.loadsEntry, loadsParser],
    ]),
  )

  if (parsedInventoryRows === 0 || parsedLoadRows === 0) {
    throw new Error(
      'Workbook format not recognized. Expected Inventory and Loads worksheets with required columns.',
    )
  }

  onProgress?.({
    phase: 'joining',
    message: 'Joining Inventory rows to Loads by Sterilizer Load ID...',
    inventoryRowsParsed: parsedInventoryRows,
    loadRowsParsed: parsedLoadRows,
  })

  const matchedDateSerials: number[] = []
  const matchedDayOfWeek: number[] = []
  const matchedOwnerIds: number[] = []
  const matchedSpecialtyIds: number[] = []
  const matchedItemTypeIds: number[] = []
  const matchedNoGoFlags: number[] = []
  const matchedFacilityIds: number[] = []
  const matchedLoadIds: number[] = []
  const matchedSetNameIds: number[] = []
  let unmatchedRows = 0

  for (let i = 0; i < inventoryLoadIds.length; i += 1) {
    const loadId = inventoryLoadIds[i]
    const facilityId = loadToFacilityId.get(loadId)
    if (facilityId === undefined) {
      unmatchedRows += 1
      continue
    }

    matchedDateSerials.push(inventoryDateSerials[i])
    matchedDayOfWeek.push(inventoryDayOfWeek[i])
    matchedOwnerIds.push(inventoryOwnerIds[i])
    matchedSpecialtyIds.push(inventorySpecialtyIds[i])
    matchedItemTypeIds.push(inventoryItemTypeIds[i])
    matchedNoGoFlags.push(inventoryNoGoFlags[i])
    matchedFacilityIds.push(facilityId)
    matchedLoadIds.push(loadId)
    matchedSetNameIds.push(inventorySetNameIds[i])
  }

  const neededSharedIndices = new Set<number>()
  ;[
    ownerTokens,
    specialtyTokens,
    itemTypeTokens,
    facilityTokens,
    setNameTokens,
    loadTokens,
  ].forEach((tokens) => {
    tokens.forEach((token) => {
      const index = sharedIndexFromToken(token)
      if (index !== null) {
        neededSharedIndices.add(index)
      }
    })
  })

  const sharedLookup = new Map<number, string>()
  if (neededSharedIndices.size > 0) {
    onProgress?.({
      phase: 'shared-strings',
      message: 'Decoding text labels...',
      inventoryRowsParsed: parsedInventoryRows,
      loadRowsParsed: parsedLoadRows,
    })

    await runZipPass(
      file,
      new Map<string, EntryHandler>([
        [SHARED_STRINGS_ENTRY, createSharedStringsParser(neededSharedIndices, sharedLookup)],
      ]),
    )
  }

  const { options: ownerOptions, remap: ownerRemap } = buildCanonicalOptions(
    ownerTokens,
    sharedLookup,
    'Unknown Owner',
  )
  const { options: specialtyOptions, remap: specialtyRemap } = buildCanonicalOptions(
    specialtyTokens,
    sharedLookup,
    'Unspecified',
  )
  const { options: itemTypeOptions, remap: itemTypeRemap } = buildCanonicalOptions(
    itemTypeTokens,
    sharedLookup,
    'Unspecified',
  )

  const facilityLabels = decodeTokenValues(facilityTokens, sharedLookup, 'Unknown')
  const loadValues = decodeTokenValues(loadTokens, sharedLookup, 'Unknown Load')
  const setNames = decodeTokenValues(setNameTokens, sharedLookup, 'Unnamed Set')
  const facilityOffsiteFlags = facilityLabels.map((label) => (isOffsiteFacility(label) ? 1 : 0))

  let minDateSerial = Number.POSITIVE_INFINITY
  let maxDateSerial = Number.NEGATIVE_INFINITY

  const offsiteFlags: number[] = new Array(matchedFacilityIds.length)
  for (let i = 0; i < matchedFacilityIds.length; i += 1) {
    const facilityId = matchedFacilityIds[i]
    offsiteFlags[i] = facilityOffsiteFlags[facilityId] ?? 0

    matchedOwnerIds[i] = ownerRemap[matchedOwnerIds[i]]
    matchedSpecialtyIds[i] = specialtyRemap[matchedSpecialtyIds[i]]
    matchedItemTypeIds[i] = itemTypeRemap[matchedItemTypeIds[i]]

    const dateSerial = matchedDateSerials[i]
    if (dateSerial < minDateSerial) minDateSerial = dateSerial
    if (dateSerial > maxDateSerial) maxDateSerial = dateSerial
  }

  onProgress?.({
    phase: 'complete',
    message: 'Workbook parsing complete.',
    inventoryRowsParsed: parsedInventoryRows,
    loadRowsParsed: parsedLoadRows,
  })

  return {
    rows: {
      dateSerials: Float64Array.from(matchedDateSerials),
      dayOfWeek: Uint8Array.from(matchedDayOfWeek),
      ownerIds: Uint32Array.from(matchedOwnerIds),
      specialtyIds: Uint32Array.from(matchedSpecialtyIds),
      itemTypeIds: Uint32Array.from(matchedItemTypeIds),
      facilityIds: Uint32Array.from(matchedFacilityIds),
      loadIds: Uint32Array.from(matchedLoadIds),
      setNameIds: Uint32Array.from(matchedSetNameIds),
      noGoFlags: Uint8Array.from(matchedNoGoFlags),
      offsiteFlags: Uint8Array.from(offsiteFlags),
    },
    owners: ownerOptions,
    specialties: specialtyOptions,
    itemTypes: itemTypeOptions,
    facilities: facilityLabels,
    loadValues,
    setNames,
    minDateSerial: Number.isFinite(minDateSerial) ? minDateSerial : null,
    maxDateSerial: Number.isFinite(maxDateSerial) ? maxDateSerial : null,
    parsedInventoryRows,
    parsedLoadRows,
    matchedRows: matchedDateSerials.length,
    unmatchedRows,
    caseRouting: null,
  }
}
