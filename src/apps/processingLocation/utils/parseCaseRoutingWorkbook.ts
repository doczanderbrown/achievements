import { Unzip, UnzipInflate } from 'fflate'
import type { CaseRoutingDataset, FilterOption, ParseProgress } from '../types'

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

const INVENTORY_TARGET_COLS = new Set(['A', 'B', 'L', 'M', 'O', 'AK'])
const LOADS_TARGET_COLS = new Set(['A', 'E'])
const CASE_ITEM_LEGACY_TARGET_COLS = new Set(['D', 'S', 'V', 'W', 'Z', 'AA', 'AY', 'AZ'])
const CASE_ITEM_INV_TARGET_COLS = new Set(['A', 'D', 'F', 'S', 'V', 'W', 'Z', 'AA'])
const CASE_SUMMARY_TARGET_COLS = new Set(['A', 'E', 'AN', 'AO'])
const SCAN_TARGET_COLS = new Set(['B', 'F', 'AK'])

const ROW_CLOSE = '</row>'
const SHARED_STRING_CLOSE = '</si>'
const MAX_BUFFER = 400_000
const DECODE_SLICE_BYTES = 1_000_000
const DAY_MS = 24 * 60 * 60 * 1000
const PRE_WINDOW_DAYS = 1
const POST_WINDOW_DAYS = 14
const POST_SCAN_WINDOW_DAYS = 30

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

      if (!neededIndices.has(sharedIndex) || sharedLookup.has(sharedIndex)) continue

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

const runZipPass = async (
  file: File,
  handlers: Map<string, EntryHandler>,
  stopWhenHandled = false,
) => {
  return new Promise<void>((resolve, reject) => {
    const pendingEntries = new Set(handlers.keys())
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
          if (final) {
            pendingEntries.delete(entry.name)
            if (stopWhenHandled && pendingEntries.size === 0) {
              if (!settled) {
                settled = true
                resolve()
              }
              reader.cancel().catch(() => {})
            }
          }
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
          if (settled) break
          unzip.push(value ?? new Uint8Array(0), done)
          if (done) break
        }
        if (!settled) {
          settled = true
          resolve()
        }
      } catch (error) {
        if (settled) return
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

const excelSerialToDate = (serial: number) => {
  return new Date((serial - 25569) * DAY_MS)
}

const deriveDayFromSerial = (serial: number) => {
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return null
  return date.getDay() + 1
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
    true,
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
  const byNameExact = (needle: string) =>
    sheets.find((sheet) => sheet.name.toLowerCase() === needle)?.entry ?? null

  let inventoryEntry = byName('inventory')
  let loadsEntry = byName('load')
  let casesEntry = byNameExact('cases') ?? byName('cases')
  let caseInvEntry = byNameExact('case inv') ?? byName('case inv') ?? byName('caseinv')
  let scanEntry = byName('scan')

  if (!inventoryEntry && sheets.length >= 2) {
    inventoryEntry = sheets[0].entry
  }
  if (!loadsEntry && sheets.length >= 2) {
    loadsEntry = sheets[1].entry
  }
  if (!casesEntry && sheets.length >= 3) {
    const fallbackCaseSheet = sheets.find((sheet) => sheet.name.toLowerCase().includes('case'))
    casesEntry = fallbackCaseSheet?.entry ?? sheets[2].entry
  }
  if (!caseInvEntry) {
    caseInvEntry = sheets.find((sheet) => sheet.name.toLowerCase().includes('case inv'))?.entry ?? null
  }
  if (!scanEntry && sheets.length >= 4) {
    scanEntry = sheets[3].entry
  }
  if (!casesEntry && !caseInvEntry && sheets.length === 1) {
    casesEntry = sheets[0].entry
  }

  return {
    inventoryEntry,
    loadsEntry,
    casesEntry,
    caseInvEntry,
    scanEntry,
  }
}

const isOffsiteFacility = (label: string) => {
  const normalized = label.trim().toLowerCase()
  if (!normalized) return false
  const compressed = normalized.replace(/[^a-z0-9]+/g, '')
  return compressed.includes('offsite')
}

const isHvnFacility = (label: string) => {
  const normalized = label.trim().toLowerCase()
  return normalized.includes('hvn')
}

const isPickedStatus = (token: string, sharedLookup: Map<number, string>) => {
  const label = decodeTokenLabel(token, sharedLookup).trim().toLowerCase()
  return label === 'picked'
}

const toItemLabelKey = (token: string, sharedLookup: Map<number, string>) => {
  return decodeTokenLabel(token, sharedLookup).trim().toLowerCase()
}

const toInvIdKey = (token: string, sharedLookup: Map<number, string>) => {
  const normalized = decodeTokenLabel(token, sharedLookup).trim().toLowerCase()
  if (!normalized) return ''
  if (/^-?\d+(\.0+)?$/.test(normalized)) {
    return normalized.replace(/\.0+$/, '')
  }
  return normalized
}

const collectSharedIndices = (tokens: string[], target: Set<number>) => {
  tokens.forEach((token) => {
    const index = sharedIndexFromToken(token)
    if (index !== null) {
      target.add(index)
    }
  })
}

const remapMatchedTokens = (
  tokenIds: number[],
  tokenTable: string[],
  sharedLookup: Map<number, string>,
  fallbackLabel: string,
) => {
  const rowTokens = tokenIds.map((tokenId) => tokenTable[tokenId] ?? `v:${fallbackLabel}`)
  const { options, remap } = buildCanonicalOptions(rowTokens, sharedLookup, fallbackLabel)
  return {
    ids: Uint32Array.from(remap),
    options,
  }
}

export const parseCaseRoutingWorkbook = async (
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<CaseRoutingDataset | null> => {
  const entries = await resolveSheetEntries(file)
  const caseItemEntry = entries.caseInvEntry ?? entries.casesEntry
  const usingCaseInvSheet = entries.caseInvEntry === caseItemEntry
  const caseSummaryEntry = entries.casesEntry && entries.casesEntry !== caseItemEntry ? entries.casesEntry : null
  if (!caseItemEntry) return null

  const inventoryInvTokenToId = new Map<string, number>()
  const inventoryInvTokens: string[] = []
  const inventoryInvNoTokenToId = new Map<string, number>()
  const inventoryInvNoTokens: string[] = []
  const loadTokenToId = new Map<string, number>()
  const loadTokens: string[] = []
  const processingFacilityTokenToId = new Map<string, number>()
  const processingFacilityTokens: string[] = []
  const scanInvTokenToId = new Map<string, number>()
  const scanInvTokens: string[] = []

  const caseInvTokenToId = new Map<string, number>()
  const caseInvTokens: string[] = []
  const caseFacilityTokenToId = new Map<string, number>()
  const caseFacilityTokens: string[] = []
  const caseItemTypeTokenToId = new Map<string, number>()
  const caseItemTypeTokens: string[] = []
  const caseCategoryTokenToId = new Map<string, number>()
  const caseCategoryTokens: string[] = []
  const itemNameTokenToId = new Map<string, number>()
  const itemNameTokens: string[] = []
  const caseStatusTokenToId = new Map<string, number>()
  const caseStatusTokens: string[] = []
  const caseScaseTokenToId = new Map<string, number>()
  const caseScaseTokens: string[] = []

  const inventoryInvIds: number[] = []
  const inventoryLoadIds: number[] = []
  const inventoryDateSerials: number[] = []
  const inventoryItemNameIds: number[] = []
  const inventoryInvNameIds: number[] = []
  const inventoryInvNoIds: number[] = []

  const loadToProcessingFacilityId = new Map<number, number>()
  const scanInvIds: number[] = []
  const scanDateSerials: number[] = []
  const scanFacilityIds: number[] = []

  const caseInvIds: number[] = []
  const caseDateSerials: number[] = []
  const caseDayOfWeek: number[] = []
  const caseFacilityIds: number[] = []
  const caseItemTypeIds: number[] = []
  const caseCategoryIds: number[] = []
  const caseItemNameIds: number[] = []
  const caseStatusIds: number[] = []
  const caseScaseIds: number[] = []
  const caseFacilityMissingFlags: number[] = []

  const caseSummaryByScaseToken = new Map<
    string,
    { dateSerial: number | null; dayOfWeek: number | null; facilityToken: string | null }
  >()

  let parsedInventoryRows = 0
  let parsedLoadRows = 0
  let parsedCaseRows = 0
  let parsedScanRows = 0

  const handlers = new Map<string, EntryHandler>()

  if (entries.inventoryEntry) {
    handlers.set(
      entries.inventoryEntry,
      createWorksheetRowParser(INVENTORY_TARGET_COLS, (rowNumber, cells) => {
        if (rowNumber === 1) return
        parsedInventoryRows += 1

        if (parsedInventoryRows % 25_000 === 0) {
          onProgress?.({
            phase: 'sheets',
            message: `Reading Inventory rows for case routing (${parsedInventoryRows.toLocaleString()})`,
            inventoryRowsParsed: parsedInventoryRows,
            loadRowsParsed: parsedLoadRows,
            caseRowsParsed: parsedCaseRows,
            scanRowsParsed: parsedScanRows,
          })
        }

        const invToken = tokenFromCell(cells.A)
        const loadToken = tokenFromCell(cells.B)
        if (!invToken || !loadToken) return

        const dateSerial = parseExcelSerial(cells.AK?.value ?? '')
        if (dateSerial === null) return

        const itemNameToken = tokenFromCell(cells.L)
        const invNameToken = tokenFromCell(cells.M)
        const invNoToken = tokenFromCell(cells.O)

        const invId = internToken(invToken, inventoryInvTokenToId, inventoryInvTokens)
        const loadId = internToken(loadToken, loadTokenToId, loadTokens)
        const itemNameId =
          itemNameToken !== null ? internToken(itemNameToken, itemNameTokenToId, itemNameTokens) : -1
        const invNameId =
          invNameToken !== null ? internToken(invNameToken, itemNameTokenToId, itemNameTokens) : -1
        const invNoId =
          invNoToken !== null
            ? internToken(invNoToken, inventoryInvNoTokenToId, inventoryInvNoTokens)
            : -1

        inventoryInvIds.push(invId)
        inventoryLoadIds.push(loadId)
        inventoryDateSerials.push(dateSerial)
        inventoryItemNameIds.push(itemNameId)
        inventoryInvNameIds.push(invNameId)
        inventoryInvNoIds.push(invNoId)
      }),
    )
  }

  if (entries.loadsEntry) {
    handlers.set(
      entries.loadsEntry,
      createWorksheetRowParser(LOADS_TARGET_COLS, (rowNumber, cells) => {
        if (rowNumber === 1) return
        parsedLoadRows += 1

        if (parsedLoadRows % 10_000 === 0) {
          onProgress?.({
            phase: 'sheets',
            message: `Reading Loads rows for case routing (${parsedLoadRows.toLocaleString()})`,
            inventoryRowsParsed: parsedInventoryRows,
            loadRowsParsed: parsedLoadRows,
            caseRowsParsed: parsedCaseRows,
            scanRowsParsed: parsedScanRows,
          })
        }

        const loadToken = tokenFromCell(cells.A)
        const facilityToken = tokenFromCell(cells.E)
        if (!loadToken || !facilityToken) return

        const loadId = internToken(loadToken, loadTokenToId, loadTokens)
        const facilityId = internToken(
          facilityToken,
          processingFacilityTokenToId,
          processingFacilityTokens,
        )
        loadToProcessingFacilityId.set(loadId, facilityId)
      }),
    )
  }

  if (entries.scanEntry) {
    handlers.set(
      entries.scanEntry,
      createWorksheetRowParser(SCAN_TARGET_COLS, (rowNumber, cells) => {
        if (rowNumber === 1) return
        parsedScanRows += 1

        if (parsedScanRows % 50_000 === 0) {
          onProgress?.({
            phase: 'sheets',
            message: `Reading Scan History rows (${parsedScanRows.toLocaleString()})`,
            inventoryRowsParsed: parsedInventoryRows,
            loadRowsParsed: parsedLoadRows,
            caseRowsParsed: parsedCaseRows,
            scanRowsParsed: parsedScanRows,
          })
        }

        const invToken = tokenFromCell(cells.B)
        const facilityToken = tokenFromCell(cells.F)
        if (!invToken || !facilityToken) return

        const scanDateSerial = parseExcelSerial(cells.AK?.value ?? '')
        if (scanDateSerial === null) return

        const invId = internToken(invToken, scanInvTokenToId, scanInvTokens)
        const facilityId = internToken(
          facilityToken,
          processingFacilityTokenToId,
          processingFacilityTokens,
        )

        scanInvIds.push(invId)
        scanDateSerials.push(scanDateSerial)
        scanFacilityIds.push(facilityId)
      }),
    )
  }

  if (caseSummaryEntry) {
    handlers.set(
      caseSummaryEntry,
      createWorksheetRowParser(CASE_SUMMARY_TARGET_COLS, (rowNumber, cells) => {
        if (rowNumber === 1) return

        const scaseToken = tokenFromCell(cells.A)
        if (!scaseToken) return

        const nextDateSerial = parseExcelSerial(cells.AN?.value ?? '')
        let nextDayOfWeek = parseDayOfWeek(cells.AO?.value ?? '')
        if (nextDayOfWeek === null && nextDateSerial !== null) {
          nextDayOfWeek = deriveDayFromSerial(nextDateSerial)
        }
        const nextFacilityToken = tokenFromCell(cells.E)

        const existing = caseSummaryByScaseToken.get(scaseToken)
        caseSummaryByScaseToken.set(scaseToken, {
          dateSerial: existing?.dateSerial ?? nextDateSerial,
          dayOfWeek: existing?.dayOfWeek ?? nextDayOfWeek,
          facilityToken: existing?.facilityToken ?? nextFacilityToken,
        })
      }),
    )
  }

  handlers.set(
    caseItemEntry,
    createWorksheetRowParser(
      usingCaseInvSheet ? CASE_ITEM_INV_TARGET_COLS : CASE_ITEM_LEGACY_TARGET_COLS,
      (rowNumber, cells) => {
        if (rowNumber === 1) return
        parsedCaseRows += 1

        if (parsedCaseRows % 25_000 === 0) {
          onProgress?.({
            phase: 'sheets',
            message: `Reading ${usingCaseInvSheet ? 'Case Inv' : 'Cases'} rows (${parsedCaseRows.toLocaleString()})`,
            inventoryRowsParsed: parsedInventoryRows,
            loadRowsParsed: parsedLoadRows,
            caseRowsParsed: parsedCaseRows,
            scanRowsParsed: parsedScanRows,
          })
        }

        const invToken = tokenFromCell(cells.Z)
        if (!invToken) return

        const dateCellValue = usingCaseInvSheet ? cells.F?.value ?? '' : cells.AY?.value ?? ''
        let dateSerial = parseExcelSerial(dateCellValue)
        let dayOfWeek = usingCaseInvSheet
          ? dateSerial !== null
            ? deriveDayFromSerial(dateSerial)
            : null
          : parseDayOfWeek(cells.AZ?.value ?? '')
        if (dayOfWeek === null && dateSerial !== null) {
          dayOfWeek = deriveDayFromSerial(dateSerial)
        }

        const scaseToken = usingCaseInvSheet ? tokenFromCell(cells.A) : null
        const summary = scaseToken ? caseSummaryByScaseToken.get(scaseToken) : undefined

        if (dateSerial === null && summary?.dateSerial !== null && summary?.dateSerial !== undefined) {
          dateSerial = summary.dateSerial
        }
        if (dayOfWeek === null && summary?.dayOfWeek !== null && summary?.dayOfWeek !== undefined) {
          dayOfWeek = summary.dayOfWeek
        }
        if (dayOfWeek === null && dateSerial !== null) {
          dayOfWeek = deriveDayFromSerial(dateSerial)
        }

        const directFacilityToken = tokenFromCell(cells.D)
        const facilityToken =
          directFacilityToken ?? summary?.facilityToken ?? 'v:Unknown Case Facility'
        const itemTypeToken = tokenFromCell(cells.W) ?? 'v:Unspecified'
        const categoryToken = tokenFromCell(cells.V) ?? 'v:Unspecified'
        const itemNameToken = tokenFromCell(cells.S) ?? 'v:Unknown Item'
        const statusToken = tokenFromCell(cells.AA) ?? 'v:'

        const invId = internToken(invToken, caseInvTokenToId, caseInvTokens)
        const facilityId = internToken(facilityToken, caseFacilityTokenToId, caseFacilityTokens)
        const itemTypeId = internToken(itemTypeToken, caseItemTypeTokenToId, caseItemTypeTokens)
        const categoryId = internToken(categoryToken, caseCategoryTokenToId, caseCategoryTokens)
        const itemNameId = internToken(itemNameToken, itemNameTokenToId, itemNameTokens)
        const statusId = internToken(statusToken, caseStatusTokenToId, caseStatusTokens)
        const scaseId =
          scaseToken !== null ? internToken(scaseToken, caseScaseTokenToId, caseScaseTokens) : -1

        caseInvIds.push(invId)
        caseDateSerials.push(dateSerial ?? Number.NaN)
        caseDayOfWeek.push(dayOfWeek ?? 0)
        caseFacilityIds.push(facilityId)
        caseItemTypeIds.push(itemTypeId)
        caseCategoryIds.push(categoryId)
        caseItemNameIds.push(itemNameId)
        caseStatusIds.push(statusId)
        caseScaseIds.push(scaseId)
        caseFacilityMissingFlags.push(directFacilityToken ? 0 : 1)
      },
    ),
  )

  onProgress?.({
    phase: 'sheets',
    message: 'Reading sheets for case routing correlation...',
    inventoryRowsParsed: 0,
    loadRowsParsed: 0,
    caseRowsParsed: 0,
    scanRowsParsed: 0,
  })

  await runZipPass(file, handlers)

  if (parsedCaseRows === 0) {
    return null
  }

  if (usingCaseInvSheet && caseSummaryByScaseToken.size > 0) {
    for (let i = 0; i < caseInvIds.length; i += 1) {
      const scaseId = caseScaseIds[i]
      if (scaseId < 0) continue
      const scaseToken = caseScaseTokens[scaseId]
      if (!scaseToken) continue
      const summary = caseSummaryByScaseToken.get(scaseToken)
      if (!summary) continue

      if (!Number.isFinite(caseDateSerials[i]) && summary.dateSerial !== null) {
        caseDateSerials[i] = summary.dateSerial
      }
      if (!(caseDayOfWeek[i] >= 1 && caseDayOfWeek[i] <= 7)) {
        if (summary.dayOfWeek !== null) {
          caseDayOfWeek[i] = summary.dayOfWeek
        } else if (Number.isFinite(caseDateSerials[i])) {
          const derived = deriveDayFromSerial(caseDateSerials[i])
          caseDayOfWeek[i] = derived ?? 0
        }
      }
      if (caseFacilityMissingFlags[i] === 1 && summary.facilityToken) {
        caseFacilityIds[i] = internToken(
          summary.facilityToken,
          caseFacilityTokenToId,
          caseFacilityTokens,
        )
      }
    }
  }

  const sharedLookup = new Map<number, string>()
  const initialSharedIndices = new Set<number>()
  collectSharedIndices(caseStatusTokens, initialSharedIndices)
  collectSharedIndices(itemNameTokens, initialSharedIndices)
  collectSharedIndices(caseInvTokens, initialSharedIndices)
  collectSharedIndices(inventoryInvTokens, initialSharedIndices)
  collectSharedIndices(scanInvTokens, initialSharedIndices)

  if (initialSharedIndices.size > 0) {
    onProgress?.({
      phase: 'shared-strings',
      message: 'Decoding case IDs, statuses, and item labels...',
      inventoryRowsParsed: parsedInventoryRows,
      loadRowsParsed: parsedLoadRows,
      caseRowsParsed: parsedCaseRows,
      scanRowsParsed: parsedScanRows,
    })

    await runZipPass(
      file,
      new Map<string, EntryHandler>([
        [SHARED_STRINGS_ENTRY, createSharedStringsParser(initialSharedIndices, sharedLookup)],
      ]),
    )
  }

  const pickedCaseFlags = new Uint8Array(caseStatusIds.length)
  let pickedCaseRows = 0
  let minCaseDateSerial = Number.POSITIVE_INFINITY
  let maxCaseDateSerial = Number.NEGATIVE_INFINITY

  for (let i = 0; i < caseStatusIds.length; i += 1) {
    const statusToken = caseStatusTokens[caseStatusIds[i]] ?? 'v:'
    if (!isPickedStatus(statusToken, sharedLookup)) continue

    const dateSerial = caseDateSerials[i]
    if (!Number.isFinite(dateSerial)) continue

    let dayOfWeek = caseDayOfWeek[i]
    if (!(dayOfWeek >= 1 && dayOfWeek <= 7)) {
      dayOfWeek = deriveDayFromSerial(dateSerial) ?? 0
      caseDayOfWeek[i] = dayOfWeek
    }
    if (!(dayOfWeek >= 1 && dayOfWeek <= 7)) continue

    pickedCaseFlags[i] = 1
    pickedCaseRows += 1

    if (dateSerial < minCaseDateSerial) minCaseDateSerial = dateSerial
    if (dateSerial > maxCaseDateSerial) maxCaseDateSerial = dateSerial
  }

  onProgress?.({
    phase: 'joining',
    message: 'Matching picked case items to processing events...',
    inventoryRowsParsed: parsedInventoryRows,
    loadRowsParsed: parsedLoadRows,
    caseRowsParsed: parsedCaseRows,
    scanRowsParsed: parsedScanRows,
  })

  const eventDateSerials: number[] = []
  const eventProcessingFacilityIds: number[] = []
  const eventsByInvKey = new Map<string, number[]>()
  const eventsByItemNameLabel = new Map<string, number[]>()
  const scanEventsByInvKey = new Map<string, number[]>()
  const invNoTokenIdByInvKey = new Map<string, number>()

  const addEventToMap = <T extends string>(
    target: Map<T, number[]>,
    key: T,
    eventIndex: number,
  ) => {
    const list = target.get(key) ?? []
    list.push(eventIndex)
    if (!target.has(key)) {
      target.set(key, list)
    }
  }

  const itemLabelKeyByTokenId = new Map<number, string>()
  const getItemLabelKeyByTokenId = (tokenId: number) => {
    const cached = itemLabelKeyByTokenId.get(tokenId)
    if (cached !== undefined) return cached
    const token = itemNameTokens[tokenId] ?? ''
    const key = toItemLabelKey(token, sharedLookup)
    itemLabelKeyByTokenId.set(tokenId, key)
    return key
  }

  const inventoryInvKeyByTokenId = new Map<number, string>()
  const getInventoryInvKeyByTokenId = (tokenId: number) => {
    const cached = inventoryInvKeyByTokenId.get(tokenId)
    if (cached !== undefined) return cached
    const token = inventoryInvTokens[tokenId] ?? ''
    const key = toInvIdKey(token, sharedLookup)
    inventoryInvKeyByTokenId.set(tokenId, key)
    return key
  }

  const caseInvKeyByTokenId = new Map<number, string>()
  const getCaseInvKeyByTokenId = (tokenId: number) => {
    const cached = caseInvKeyByTokenId.get(tokenId)
    if (cached !== undefined) return cached
    const token = caseInvTokens[tokenId] ?? ''
    const key = toInvIdKey(token, sharedLookup)
    caseInvKeyByTokenId.set(tokenId, key)
    return key
  }

  const scanInvKeyByTokenId = new Map<number, string>()
  const getScanInvKeyByTokenId = (tokenId: number) => {
    const cached = scanInvKeyByTokenId.get(tokenId)
    if (cached !== undefined) return cached
    const token = scanInvTokens[tokenId] ?? ''
    const key = toInvIdKey(token, sharedLookup)
    scanInvKeyByTokenId.set(tokenId, key)
    return key
  }

  if (parsedInventoryRows > 0 && parsedLoadRows > 0) {
    for (let i = 0; i < inventoryInvIds.length; i += 1) {
      const loadId = inventoryLoadIds[i]
      const processingFacilityId = loadToProcessingFacilityId.get(loadId)
      if (processingFacilityId === undefined) continue

      const eventIndex = eventDateSerials.length
      eventDateSerials.push(inventoryDateSerials[i])
      eventProcessingFacilityIds.push(processingFacilityId)

      const invKey = getInventoryInvKeyByTokenId(inventoryInvIds[i])
      if (invKey) {
        addEventToMap(eventsByInvKey, invKey, eventIndex)

        const invNoId = inventoryInvNoIds[i] ?? -1
        if (invNoId >= 0 && !invNoTokenIdByInvKey.has(invKey)) {
          invNoTokenIdByInvKey.set(invKey, invNoId)
        }
      }

      const itemNameId = inventoryItemNameIds[i]
      if (itemNameId >= 0) {
        const itemNameKey = getItemLabelKeyByTokenId(itemNameId)
        if (itemNameKey) {
          addEventToMap(eventsByItemNameLabel, itemNameKey, eventIndex)
        }
      }

      const invNameId = inventoryInvNameIds[i]
      if (invNameId >= 0 && invNameId !== itemNameId) {
        const invNameKey = getItemLabelKeyByTokenId(invNameId)
        if (invNameKey) {
          addEventToMap(eventsByItemNameLabel, invNameKey, eventIndex)
        }
      }
    }

    const sortByEventDate = (eventA: number, eventB: number) =>
      eventDateSerials[eventA] - eventDateSerials[eventB]
    eventsByInvKey.forEach((eventIndices) => {
      eventIndices.sort(sortByEventDate)
    })
    eventsByItemNameLabel.forEach((eventIndices) => {
      eventIndices.sort(sortByEventDate)
    })
  }

  for (let i = 0; i < scanInvIds.length; i += 1) {
    const invKey = getScanInvKeyByTokenId(scanInvIds[i])
    if (!invKey) continue
    addEventToMap(scanEventsByInvKey, invKey, i)
  }
  scanEventsByInvKey.forEach((scanIndices) => {
    scanIndices.sort((a, b) => scanDateSerials[a] - scanDateSerials[b])
  })

  const caseIndicesByInvKey = new Map<string, number[]>()
  for (let i = 0; i < caseInvIds.length; i += 1) {
    if (pickedCaseFlags[i] !== 1) continue
    const invKey = getCaseInvKeyByTokenId(caseInvIds[i])
    if (!invKey) continue
    const list = caseIndicesByInvKey.get(invKey) ?? []
    list.push(i)
    if (!caseIndicesByInvKey.has(invKey)) {
      caseIndicesByInvKey.set(invKey, list)
    }
  }

  const matchedCaseDateSerials: number[] = []
  const matchedCaseDayOfWeek: number[] = []
  const matchedCaseFacilityTokenIds: number[] = []
  const matchedCaseItemTypeTokenIds: number[] = []
  const matchedCaseCategoryTokenIds: number[] = []
  const matchedCaseItemNameTokenIds: number[] = []
  const matchedCaseInvTokenIds: number[] = []
  const matchedProcessingFacilityTokenIds: number[] = []
  const matchedCaseMatchModeIds: number[] = []

  const usedEvents = new Uint8Array(eventDateSerials.length)
  const matchCaseGroup = (
    caseIndices: number[],
    candidateEventIndices: number[] | undefined,
    matchMode: 0 | 1,
    onUnmatched: (caseIndex: number) => void,
  ) => {
    if (!candidateEventIndices || candidateEventIndices.length === 0) {
      caseIndices.forEach(onUnmatched)
      return 0
    }

    caseIndices.sort((a, b) => caseDateSerials[a] - caseDateSerials[b])

    let pointer = 0
    let matchedCount = 0
    for (const caseIndex of caseIndices) {
      const caseDate = caseDateSerials[caseIndex]

      while (pointer < candidateEventIndices.length) {
        const eventIndex = candidateEventIndices[pointer]
        const eventDate = eventDateSerials[eventIndex]
        if (usedEvents[eventIndex] === 1 || eventDate < caseDate - PRE_WINDOW_DAYS) {
          pointer += 1
          continue
        }
        break
      }

      if (pointer >= candidateEventIndices.length) {
        onUnmatched(caseIndex)
        continue
      }

      const eventIndex = candidateEventIndices[pointer]
      const eventDate = eventDateSerials[eventIndex]
      if (eventDate > caseDate + POST_WINDOW_DAYS) {
        onUnmatched(caseIndex)
        continue
      }

      usedEvents[eventIndex] = 1
      matchedCaseDateSerials.push(caseDate)
      matchedCaseDayOfWeek.push(caseDayOfWeek[caseIndex])
      matchedCaseFacilityTokenIds.push(caseFacilityIds[caseIndex])
      matchedCaseItemTypeTokenIds.push(caseItemTypeIds[caseIndex])
      matchedCaseCategoryTokenIds.push(caseCategoryIds[caseIndex])
      matchedCaseItemNameTokenIds.push(caseItemNameIds[caseIndex])
      matchedCaseInvTokenIds.push(caseInvIds[caseIndex])
      matchedProcessingFacilityTokenIds.push(eventProcessingFacilityIds[eventIndex])
      matchedCaseMatchModeIds.push(matchMode)
      pointer += 1
      matchedCount += 1
    }

    return matchedCount
  }

  const unmatchedAfterInv: number[] = []
  let exactMatchRows = 0
  caseIndicesByInvKey.forEach((caseIndices, invKey) => {
    exactMatchRows += matchCaseGroup(caseIndices, eventsByInvKey.get(invKey), 0, (caseIndex) => {
      unmatchedAfterInv.push(caseIndex)
    })
  })

  const unmatchedFinal: number[] = []
  const caseIndicesByItemName = new Map<string, number[]>()
  unmatchedAfterInv.forEach((caseIndex) => {
    const itemNameId = caseItemNameIds[caseIndex]
    const itemLabelKey = getItemLabelKeyByTokenId(itemNameId)
    if (!itemLabelKey) {
      unmatchedFinal.push(caseIndex)
      return
    }
    const list = caseIndicesByItemName.get(itemLabelKey) ?? []
    list.push(caseIndex)
    if (!caseIndicesByItemName.has(itemLabelKey)) {
      caseIndicesByItemName.set(itemLabelKey, list)
    }
  })

  let fallbackItemNameMatchRows = 0
  caseIndicesByItemName.forEach((caseIndices, itemNameLabel) => {
    fallbackItemNameMatchRows += matchCaseGroup(
      caseIndices,
      eventsByItemNameLabel.get(itemNameLabel),
      1,
      (caseIndex) => {
        unmatchedFinal.push(caseIndex)
      },
    )
  })

  const unmatchedCaseRows = unmatchedFinal.length

  const matchedCaseRows = matchedCaseDateSerials.length
  const finalProcessingFacilityTokenIds = matchedProcessingFacilityTokenIds.slice()
  let scanDestinationMatchRows = 0

  if (matchedCaseRows > 0 && scanEventsByInvKey.size > 0) {
    const sortedMatchedRowIndices = Array.from({ length: matchedCaseRows }, (_, index) => index)
    sortedMatchedRowIndices.sort((left, right) => {
      return matchedCaseDateSerials[left] - matchedCaseDateSerials[right]
    })

    const scanPointerByInvKey = new Map<string, number>()

    for (const rowIndex of sortedMatchedRowIndices) {
      const caseInvTokenId = matchedCaseInvTokenIds[rowIndex]
      const invKey = getCaseInvKeyByTokenId(caseInvTokenId)
      if (!invKey) continue

      const scanIndices = scanEventsByInvKey.get(invKey)
      if (!scanIndices || scanIndices.length === 0) continue

      let pointer = scanPointerByInvKey.get(invKey) ?? 0
      const caseDateSerial = matchedCaseDateSerials[rowIndex]

      while (pointer < scanIndices.length && scanDateSerials[scanIndices[pointer]] < caseDateSerial) {
        pointer += 1
      }

      if (pointer >= scanIndices.length) {
        scanPointerByInvKey.set(invKey, pointer)
        continue
      }

      const scanIndex = scanIndices[pointer]
      const scanDateSerial = scanDateSerials[scanIndex]
      if (scanDateSerial > caseDateSerial + POST_SCAN_WINDOW_DAYS) {
        scanPointerByInvKey.set(invKey, pointer)
        continue
      }

      finalProcessingFacilityTokenIds[rowIndex] = scanFacilityIds[scanIndex]
      scanPointerByInvKey.set(invKey, pointer + 1)
      scanDestinationMatchRows += 1
    }
  }

  const caseInvDisplayTokenToId = new Map<string, number>()
  const caseInvDisplayTokens: string[] = []
  const matchedCaseInvDisplayTokenIds = new Array<number>(matchedCaseInvTokenIds.length)
  for (let i = 0; i < matchedCaseInvTokenIds.length; i += 1) {
    const caseInvTokenId = matchedCaseInvTokenIds[i]
    let displayToken = caseInvTokens[caseInvTokenId] ?? 'v:Unknown Inv'
    const invKey = getCaseInvKeyByTokenId(caseInvTokenId)
    if (invKey) {
      const invNoTokenId = invNoTokenIdByInvKey.get(invKey)
      if (invNoTokenId !== undefined) {
        const invNoToken = inventoryInvNoTokens[invNoTokenId]
        if (invNoToken) {
          displayToken = invNoToken
        }
      }
    }

    matchedCaseInvDisplayTokenIds[i] = internToken(
      displayToken,
      caseInvDisplayTokenToId,
      caseInvDisplayTokens,
    )
  }

  if (matchedCaseRows === 0) {
    onProgress?.({
      phase: 'complete',
      message: 'No matched case-routing rows found in this workbook.',
      inventoryRowsParsed: parsedInventoryRows,
      loadRowsParsed: parsedLoadRows,
      caseRowsParsed: parsedCaseRows,
      scanRowsParsed: parsedScanRows,
    })

    return {
      rows: {
        caseDateSerials: new Float64Array(0),
        dayOfWeek: new Uint8Array(0),
        caseFacilityIds: new Uint32Array(0),
        caseInvValueIds: new Uint32Array(0),
        processingFacilityIds: new Uint32Array(0),
        caseItemTypeIds: new Uint32Array(0),
        caseCategoryIds: new Uint32Array(0),
        caseItemNameIds: new Uint32Array(0),
        routeBucketIds: new Uint8Array(0),
        matchModeIds: new Uint8Array(0),
      },
      caseFacilities: [],
      caseItemTypes: [],
      caseCategories: [],
      caseItemNames: [],
      caseInvValues: [],
      processingFacilities: [],
      parsedCaseRows,
      parsedInventoryRows,
      parsedLoadRows,
      parsedScanRows,
      pickedCaseRows,
      matchedCaseRows: 0,
      unmatchedCaseRows,
      exactMatchRows: 0,
      fallbackItemNameMatchRows: 0,
      scanDestinationMatchRows: 0,
      minCaseDateSerial: Number.isFinite(minCaseDateSerial) ? minCaseDateSerial : null,
      maxCaseDateSerial: Number.isFinite(maxCaseDateSerial) ? maxCaseDateSerial : null,
    }
  }

  const matchedSharedIndices = new Set<number>()
  collectSharedIndices(
    matchedCaseFacilityTokenIds.map((id) => caseFacilityTokens[id] ?? 'v:Unknown Case Facility'),
    matchedSharedIndices,
  )
  collectSharedIndices(
    matchedCaseItemTypeTokenIds.map((id) => caseItemTypeTokens[id] ?? 'v:Unspecified'),
    matchedSharedIndices,
  )
  collectSharedIndices(
    matchedCaseCategoryTokenIds.map((id) => caseCategoryTokens[id] ?? 'v:Unspecified'),
    matchedSharedIndices,
  )
  collectSharedIndices(
    matchedCaseItemNameTokenIds.map((id) => itemNameTokens[id] ?? 'v:Unknown Item'),
    matchedSharedIndices,
  )
  collectSharedIndices(
    matchedCaseInvDisplayTokenIds.map((id) => caseInvDisplayTokens[id] ?? 'v:Unknown Inv'),
    matchedSharedIndices,
  )
  collectSharedIndices(
    finalProcessingFacilityTokenIds.map((id) => processingFacilityTokens[id] ?? 'v:Unknown'),
    matchedSharedIndices,
  )

  if (matchedSharedIndices.size > 0) {
    onProgress?.({
      phase: 'shared-strings',
      message: 'Decoding labels for matched case-routing rows...',
      inventoryRowsParsed: parsedInventoryRows,
      loadRowsParsed: parsedLoadRows,
      caseRowsParsed: parsedCaseRows,
      scanRowsParsed: parsedScanRows,
    })

    await runZipPass(
      file,
      new Map<string, EntryHandler>([
        [SHARED_STRINGS_ENTRY, createSharedStringsParser(matchedSharedIndices, sharedLookup)],
      ]),
    )
  }

  const caseFacilityResult = remapMatchedTokens(
    matchedCaseFacilityTokenIds,
    caseFacilityTokens,
    sharedLookup,
    'Unknown Case Facility',
  )
  const caseItemTypeResult = remapMatchedTokens(
    matchedCaseItemTypeTokenIds,
    caseItemTypeTokens,
    sharedLookup,
    'Unspecified',
  )
  const caseCategoryResult = remapMatchedTokens(
    matchedCaseCategoryTokenIds,
    caseCategoryTokens,
    sharedLookup,
    'Unspecified',
  )
  const caseItemNameResult = remapMatchedTokens(
    matchedCaseItemNameTokenIds,
    itemNameTokens,
    sharedLookup,
    'Unknown Item',
  )
  const caseInvResult = remapMatchedTokens(
    matchedCaseInvDisplayTokenIds,
    caseInvDisplayTokens,
    sharedLookup,
    'Unknown Inv',
  )
  const processingFacilityResult = remapMatchedTokens(
    finalProcessingFacilityTokenIds,
    processingFacilityTokens,
    sharedLookup,
    'Unknown',
  )

  const processingFacilities = processingFacilityResult.options.map((option) => option.label)
  const routeBucketIds = new Uint8Array(matchedCaseRows)
  for (let i = 0; i < routeBucketIds.length; i += 1) {
    const processingFacilityId = processingFacilityResult.ids[i]
    const label = processingFacilities[processingFacilityId] ?? ''
    if (isOffsiteFacility(label)) {
      routeBucketIds[i] = 1
      continue
    }
    if (isHvnFacility(label)) {
      routeBucketIds[i] = 0
      continue
    }
    routeBucketIds[i] = 2
  }

  onProgress?.({
    phase: 'complete',
    message: 'Case routing correlation complete.',
    inventoryRowsParsed: parsedInventoryRows,
    loadRowsParsed: parsedLoadRows,
    caseRowsParsed: parsedCaseRows,
    scanRowsParsed: parsedScanRows,
  })

  return {
    rows: {
      caseDateSerials: Float64Array.from(matchedCaseDateSerials),
      dayOfWeek: Uint8Array.from(matchedCaseDayOfWeek),
      caseFacilityIds: caseFacilityResult.ids,
      caseInvValueIds: caseInvResult.ids,
      processingFacilityIds: processingFacilityResult.ids,
      caseItemTypeIds: caseItemTypeResult.ids,
      caseCategoryIds: caseCategoryResult.ids,
      caseItemNameIds: caseItemNameResult.ids,
      routeBucketIds,
      matchModeIds: Uint8Array.from(matchedCaseMatchModeIds),
    },
    caseFacilities: caseFacilityResult.options,
    caseItemTypes: caseItemTypeResult.options,
    caseCategories: caseCategoryResult.options,
    caseItemNames: caseItemNameResult.options.map((option) => option.label),
    caseInvValues: caseInvResult.options.map((option) => option.label),
    processingFacilities,
    parsedCaseRows,
    parsedInventoryRows,
    parsedLoadRows,
    parsedScanRows,
    pickedCaseRows,
    matchedCaseRows,
    unmatchedCaseRows,
    exactMatchRows,
    fallbackItemNameMatchRows,
    scanDestinationMatchRows,
    minCaseDateSerial: Number.isFinite(minCaseDateSerial) ? minCaseDateSerial : null,
    maxCaseDateSerial: Number.isFinite(maxCaseDateSerial) ? maxCaseDateSerial : null,
  }
}
