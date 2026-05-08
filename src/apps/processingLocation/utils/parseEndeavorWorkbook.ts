import { Unzip, UnzipInflate } from 'fflate'
import type { FilterOption, ParseProgress, ProcessingLocationDataset } from '../types'
import { DAY_MS } from '../../../utils/excelDate'
import {
  type ParsedCell,
  type ParsedCells,
  decodeXmlEntities,
  extractRowNumber,
  extractTargetCells,
} from '../../../utils/xmlParse'

type EntryHandler = {
  onChunk: (chunk: Uint8Array, final: boolean) => void
}

const WORKBOOK_ENTRY = 'xl/workbook.xml'
const WORKBOOK_RELS_ENTRY = 'xl/_rels/workbook.xml.rels'
const SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml'

const ENDEAVOR_TARGET_COLS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'H', 'J', 'K', 'L'])

const ROW_CLOSE = '</row>'
const SHARED_STRING_CLOSE = '</si>'
const MAX_BUFFER = 400_000
const DECODE_SLICE_BYTES = 1_000_000

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
  const jsDay = date.getDay()
  return jsDay + 1
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

const isDataSheetName = (name: string) => name === 'data' || name === 'processing data'
const isItemsSheetName = (name: string) => name === 'items details' || name === 'items detail'

const stripItemSuffix = (name: string) => name.replace(/\s*-\s*\d+\s*$/, '').trim()

const resolveEndeavorSheetEntries = async (
  file: File,
): Promise<{ dataEntry: string | null; itemsEntry: string | null }> => {
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
    const entry = normalizeEntryPath(relMatch[2])
    if (entry) relIdToEntry.set(relMatch[1], entry)
  }

  let dataEntry: string | null = null
  let itemsEntry: string | null = null

  const sheetPattern = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g
  let sheetMatch: RegExpExecArray | null = null
  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    const name = sheetMatch[1].toLowerCase()
    const entry = relIdToEntry.get(sheetMatch[2])
    if (!entry) continue
    if (isDataSheetName(name)) dataEntry = entry
    else if (isItemsSheetName(name)) itemsEntry = entry
  }

  return { dataEntry, itemsEntry }
}

export const isEndeavorWorkbook = async (file: File): Promise<boolean> => {
  let workbookXml = ''

  await runZipPass(
    file,
    new Map<string, EntryHandler>([
      [WORKBOOK_ENTRY, createXmlCollector((xml) => (workbookXml = xml))],
    ]),
  )

  const sheetPattern = /<sheet\b[^>]*\bname="([^"]+)"/g
  let sheetMatch: RegExpExecArray | null = null
  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    if (isDataSheetName(sheetMatch[1].toLowerCase())) return true
  }

  return false
}

const ITEMS_DETAILS_TARGET_COLS = new Set(['B', 'I'])

export const parseEndeavorWorkbook = async (
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ProcessingLocationDataset> => {
  const { dataEntry, itemsEntry } = await resolveEndeavorSheetEntries(file)
  if (!dataEntry) {
    throw new Error(
      'Endeavor workbook format not recognized. Expected a "Processing Data" or "data" sheet.',
    )
  }

  const facilityTokenToId = new Map<string, number>()
  const facilityTokens: string[] = []

  const loadTokenToId = new Map<string, number>()
  const loadTokens: string[] = []

  const methodTokenToId = new Map<string, number>()
  const methodTokens: string[] = []

  const deptTokenToId = new Map<string, number>()
  const deptTokens: string[] = []

  const invNameTokenToId = new Map<string, number>()
  const invNameTokens: string[] = []

  const specialtyTokenToId = new Map<string, number>()
  const specialtyTokens: string[] = []

  const rowFacilityIds: number[] = []
  const rowDateSerials: number[] = []
  const rowDayOfWeek: number[] = []
  const rowLoadIds: number[] = []
  const rowMethodIds: number[] = []
  const rowDeptIds: number[] = []
  const rowInvNameIds: number[] = []
  const rowSpecialtyIds: number[] = []
  const iussTokenArr: string[] = []

  const itemDetailNameTokens: string[] = []
  const itemDetailFacilityTokens: string[] = []

  let parsedRows = 0
  let skippedRows = 0

  const itemsParser = createWorksheetRowParser(ITEMS_DETAILS_TARGET_COLS, (rowNumber, cells) => {
    if (rowNumber === 1) return
    const nameToken = tokenFromCell(cells.I)
    const facilityToken = tokenFromCell(cells.B)
    if (!nameToken || !facilityToken) return
    itemDetailNameTokens.push(nameToken)
    itemDetailFacilityTokens.push(facilityToken)
  })

  const dataParser = createWorksheetRowParser(ENDEAVOR_TARGET_COLS, (rowNumber, cells) => {
    if (rowNumber <= 2) return

    parsedRows += 1
    if (parsedRows % 25_000 === 0) {
      onProgress?.({
        phase: 'sheets',
        message: `Reading data rows (${parsedRows.toLocaleString()})`,
        inventoryRowsParsed: parsedRows,
        loadRowsParsed: 0,
      })
    }

    const dateSerial = parseExcelSerial(cells.B?.value ?? '')
    if (dateSerial === null) {
      skippedRows += 1
      return
    }

    const dayOfWeek = deriveDayFromSerial(dateSerial)
    if (dayOfWeek === null) {
      skippedRows += 1
      return
    }

    const facilityToken = tokenFromCell(cells.C) ?? 'v:Unknown Facility'
    const sterilizerToken = tokenFromCell(cells.D) ?? 'v:Unknown'
    const loadNo = cells.E?.value?.trim() ?? 'Unknown'
    const methodToken = tokenFromCell(cells.F) ?? 'v:Unknown'
    const iussToken = tokenFromCell(cells.H) ?? 'v:false'
    const deptToken = tokenFromCell(cells.J) ?? 'v:Unspecified'
    const invNameToken = tokenFromCell(cells.K) ?? 'v:Unknown Item'
    const specialtyToken = tokenFromCell(cells.L) ?? 'v:Unspecified'

    const compoundLoadToken = sterilizerToken + '|' + loadNo

    const facilityId = internToken(facilityToken, facilityTokenToId, facilityTokens)
    const loadId = internToken(compoundLoadToken, loadTokenToId, loadTokens)
    const methodId = internToken(methodToken, methodTokenToId, methodTokens)
    const deptId = internToken(deptToken, deptTokenToId, deptTokens)
    const invNameId = internToken(invNameToken, invNameTokenToId, invNameTokens)
    const specialtyId = internToken(specialtyToken, specialtyTokenToId, specialtyTokens)

    rowFacilityIds.push(facilityId)
    rowDateSerials.push(dateSerial)
    rowDayOfWeek.push(dayOfWeek)
    rowLoadIds.push(loadId)
    rowMethodIds.push(methodId)
    rowDeptIds.push(deptId)
    rowInvNameIds.push(invNameId)
    rowSpecialtyIds.push(specialtyId)
    iussTokenArr.push(iussToken)
  })

  onProgress?.({
    phase: 'sheets',
    message: 'Reading Endeavor data sheet...',
    inventoryRowsParsed: 0,
    loadRowsParsed: 0,
  })

  const sheetHandlers = new Map<string, EntryHandler>([[dataEntry, dataParser]])
  if (itemsEntry) sheetHandlers.set(itemsEntry, itemsParser)

  await runZipPass(file, sheetHandlers)

  const neededSharedIndices = new Set<number>()
  ;[
    deptTokens,
    specialtyTokens,
    methodTokens,
    facilityTokens,
    invNameTokens,
    loadTokens,
    iussTokenArr,
    itemDetailNameTokens,
    itemDetailFacilityTokens,
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
      inventoryRowsParsed: parsedRows,
      loadRowsParsed: 0,
    })

    await runZipPass(
      file,
      new Map<string, EntryHandler>([
        [SHARED_STRINGS_ENTRY, createSharedStringsParser(neededSharedIndices, sharedLookup)],
      ]),
    )
  }

  const { options: ownerOptions, remap: ownerRemap } = buildCanonicalOptions(
    deptTokens,
    sharedLookup,
    'Unspecified',
  )
  const { options: specialtyOptions, remap: specialtyRemap } = buildCanonicalOptions(
    specialtyTokens,
    sharedLookup,
    'Unspecified',
  )
  const { options: methodOptions, remap: methodRemap } = buildCanonicalOptions(
    methodTokens,
    sharedLookup,
    'Unspecified',
  )

  const facilityLabels = decodeTokenValues(facilityTokens, sharedLookup, 'Unknown Facility')
  const decodedInvNames = decodeTokenValues(invNameTokens, sharedLookup, 'Unknown Item')

  const facilityOptions: FilterOption[] = facilityLabels
    .map((label, id) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const loadValues = loadTokens.map((compoundToken) => {
    const pipeIndex = compoundToken.lastIndexOf('|')
    if (pipeIndex === -1) return normalizeLabel(decodeTokenLabel(compoundToken, sharedLookup), 'Unknown')
    const sterilizerToken = compoundToken.slice(0, pipeIndex)
    const loadNo = compoundToken.slice(pipeIndex + 1)
    const sterilizerName = normalizeLabel(decodeTokenLabel(sterilizerToken, sharedLookup), 'Unknown')
    return `${sterilizerName} / Load ${loadNo}`
  })

  const n = rowFacilityIds.length
  const noGoFlags = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) {
    const iussToken = iussTokenArr[i]
    if (!iussToken) continue
    const decoded = iussToken.startsWith('s:')
      ? (sharedLookup.get(sharedIndexFromToken(iussToken) ?? -1) ?? '')
      : iussToken.slice(2)
    if (decoded.trim().toLowerCase() === 'true') {
      noGoFlags[i] = 1
    }
  }

  // Build cross-site lookup from Items Details
  const itemHomeMap = new Map<string, Set<string>>()
  for (let i = 0; i < itemDetailNameTokens.length; i += 1) {
    const rawName = normalizeLabel(decodeTokenLabel(itemDetailNameTokens[i], sharedLookup), '')
    const baseName = stripItemSuffix(rawName).toLowerCase()
    const facility = normalizeLabel(decodeTokenLabel(itemDetailFacilityTokens[i], sharedLookup), '')
    if (!baseName || !facility) continue
    const existing = itemHomeMap.get(baseName) ?? new Set<string>()
    existing.add(facility)
    itemHomeMap.set(baseName, existing)
  }

  // Map invName token ID → home facilities
  const setNameToHomes = new Map<number, Set<string>>()
  const itemHomeFacilities: string[] = new Array(invNameTokens.length).fill('')
  for (let tokenId = 0; tokenId < invNameTokens.length; tokenId += 1) {
    const fullName = normalizeLabel(decodeTokenLabel(invNameTokens[tokenId], sharedLookup), '')
    const baseName = stripItemSuffix(fullName).toLowerCase()
    const homes = itemHomeMap.get(baseName)
    if (homes) {
      setNameToHomes.set(tokenId, homes)
      itemHomeFacilities[tokenId] = [...homes][0] ?? ''
    }
  }

  const finalOwnerIds = new Uint32Array(n)
  const finalSpecialtyIds = new Uint32Array(n)
  const finalMethodIds = new Uint32Array(n)
  const offsiteFlags = new Uint8Array(n)

  let minDateSerial = Number.POSITIVE_INFINITY
  let maxDateSerial = Number.NEGATIVE_INFINITY

  for (let i = 0; i < n; i += 1) {
    finalOwnerIds[i] = ownerRemap[rowDeptIds[i]]
    finalSpecialtyIds[i] = specialtyRemap[rowSpecialtyIds[i]]
    finalMethodIds[i] = methodRemap[rowMethodIds[i]]

    const procFacility = facilityLabels[rowFacilityIds[i]] ?? ''
    const homes = setNameToHomes.get(rowInvNameIds[i])
    if (homes && !homes.has(procFacility)) offsiteFlags[i] = 1

    const dateSerial = rowDateSerials[i]
    if (dateSerial < minDateSerial) minDateSerial = dateSerial
    if (dateSerial > maxDateSerial) maxDateSerial = dateSerial
  }

  onProgress?.({
    phase: 'complete',
    message: 'Endeavor workbook parsing complete.',
    inventoryRowsParsed: parsedRows,
    loadRowsParsed: 0,
  })

  return {
    rows: {
      dateSerials: Float64Array.from(rowDateSerials),
      dayOfWeek: Uint8Array.from(rowDayOfWeek),
      ownerIds: finalOwnerIds,
      specialtyIds: finalSpecialtyIds,
      itemTypeIds: finalMethodIds,
      facilityIds: Uint32Array.from(rowFacilityIds),
      loadIds: Uint32Array.from(rowLoadIds),
      setNameIds: Uint32Array.from(rowInvNameIds),
      noGoFlags,
      offsiteFlags,
    },
    owners: ownerOptions,
    specialties: specialtyOptions,
    itemTypes: methodOptions,
    facilities: facilityLabels,
    loadValues,
    setNames: decodedInvNames,
    minDateSerial: Number.isFinite(minDateSerial) ? minDateSerial : null,
    maxDateSerial: Number.isFinite(maxDateSerial) ? maxDateSerial : null,
    parsedInventoryRows: parsedRows,
    parsedLoadRows: 0,
    matchedRows: n,
    unmatchedRows: skippedRows,
    caseRouting: null,
    facilityOptions,
    isEndeavorFormat: true,
    itemHomeFacilities,
  }
}
