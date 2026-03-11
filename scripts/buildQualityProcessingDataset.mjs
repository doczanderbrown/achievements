#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import XLSX from 'xlsx'

const DEFAULT_QUALITY_PATH = '/Users/alexbrown/Downloads/Shands view PROD PG Quality Event.xlsx'
const DEFAULT_INVENTORY_PATH =
  '/Users/alexbrown/Downloads/Shands View of PROD PG Analytic Load Inventory.xlsx'
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  'public/data/quality-by-processing-location.json',
)

const INVENTORY_SHARED_STRINGS_PATH = 'xl/sharedStrings.xml'
const INVENTORY_SHEET_PATH = 'xl/worksheets/sheet1.xml'
const QUALITY_OR_TYPE = 'event - or'
const UNMATCHED_PROCESSING_LABEL = 'Unmatched / No Prior Processing'

const XML_ENTITY_REPLACEMENTS = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
}

const ROW_TAG_OPEN = '<row '
const ROW_TAG_CLOSE = '</row>'
const SHARED_STRING_OPEN = '<si>'
const SHARED_STRING_CLOSE = '</si>'
const TEXT_NODE_RE = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g
const ROW_NUMBER_RE = /<row[^>]*\sr="(\d+)"/
const FACILITY_CELL_RE = /<c r="F\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/
const INV_CELL_RE = /<c r="M\d+"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/
const DONE_LOCAL_CELL_RE = /<c r="AH\d+"[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/
const HEADER_F_RE = /<c r="F1"[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/
const HEADER_M_RE = /<c r="M1"[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/
const HEADER_AH_RE = /<c r="AH1"[^>]*>(?:<v>([^<]*)<\/v>)?<\/c>/

const log = (...messages) => {
  const now = new Date().toISOString()
  console.log(`[${now}]`, ...messages)
}

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const normalizeLabel = (value, blankLabel = '(Blank)') => {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : blankLabel
}

const decodeXmlEntities = (value) => {
  if (!value || typeof value !== 'string') return ''
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (entity) => XML_ENTITY_REPLACEMENTS[entity] ?? entity)
}

const extractSharedStringText = (siXml) => {
  if (!siXml) return ''
  const segments = []
  TEXT_NODE_RE.lastIndex = 0

  let match
  while ((match = TEXT_NODE_RE.exec(siXml)) !== null) {
    segments.push(decodeXmlEntities(match[1]))
  }

  if (segments.length > 0) return segments.join('')
  return decodeXmlEntities(siXml.replace(/<[^>]+>/g, ''))
}

const runUnzipStream = (filePath, innerPath, onData, { allowEarlyStop = false } = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', filePath, innerPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let earlyStop = false
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const keepGoing = onData(chunk)
      if (allowEarlyStop && keepGoing === false) {
        earlyStop = true
        child.kill('SIGTERM')
      }
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (
        code === 0 ||
        (allowEarlyStop &&
          earlyStop &&
          (signal === 'SIGTERM' || code === 80 || code === 141 || code === null))
      ) {
        resolve(undefined)
        return
      }
      reject(
        new Error(
          `Failed to read ${innerPath} from ${filePath} (code=${code ?? 'null'}): ${stderr.trim()}`,
        ),
      )
    })
  })
}

const streamRows = async (filePath, onRow) => {
  let buffer = ''
  await runUnzipStream(filePath, INVENTORY_SHEET_PATH, (chunk) => {
    buffer += chunk.toString('utf8')

    while (true) {
      const rowStart = buffer.indexOf(ROW_TAG_OPEN)
      if (rowStart === -1) {
        if (buffer.length > 4096) {
          buffer = buffer.slice(-4096)
        }
        break
      }

      const rowEnd = buffer.indexOf(ROW_TAG_CLOSE, rowStart)
      if (rowEnd === -1) {
        if (rowStart > 0) {
          buffer = buffer.slice(rowStart)
        }
        break
      }

      const rowXml = buffer.slice(rowStart, rowEnd + ROW_TAG_CLOSE.length)
      buffer = buffer.slice(rowEnd + ROW_TAG_CLOSE.length)
      onRow(rowXml)
    }

    return true
  })
}

const streamSharedStrings = async (filePath, neededIndices) => {
  const resolved = new Map()
  if (neededIndices.size === 0) return resolved

  const maxNeeded = Math.max(...neededIndices)
  let buffer = ''
  let index = 0

  await runUnzipStream(
    filePath,
    INVENTORY_SHARED_STRINGS_PATH,
    (chunk) => {
      buffer += chunk.toString('utf8')

      while (true) {
        const start = buffer.indexOf(SHARED_STRING_OPEN)
        if (start === -1) {
          if (buffer.length > 4096) {
            buffer = buffer.slice(-4096)
          }
          break
        }

        const end = buffer.indexOf(SHARED_STRING_CLOSE, start)
        if (end === -1) {
          if (start > 0) {
            buffer = buffer.slice(start)
          }
          break
        }

        const body = buffer.slice(start + SHARED_STRING_OPEN.length, end)
        buffer = buffer.slice(end + SHARED_STRING_CLOSE.length)

        if (neededIndices.has(index)) {
          resolved.set(index, extractSharedStringText(body))
        }
        index += 1

        if (index > maxNeeded && resolved.size === neededIndices.size) {
          return false
        }
      }

      return true
    },
    { allowEarlyStop: true },
  )

  return resolved
}

const parseDateSerial = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value ?? '').trim()
  if (!text) return null

  const parsed = Number.parseFloat(text)
  if (Number.isFinite(parsed)) return parsed

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) return null

  return date.getTime() / (24 * 60 * 60 * 1000) + 25569
}

const parseQualityWorkbook = (qualityPath) => {
  log(`Reading quality workbook: ${qualityPath}`)
  const workbook = XLSX.readFile(qualityPath, { raw: true, dense: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error('Quality workbook does not contain any sheets.')
  const sheet = workbook.Sheets[sheetName]

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: true,
  })

  const events = []
  const qualityInvKeys = new Set()
  let orRows = 0
  let skippedMissingDate = 0
  let skippedMissingInv = 0

  rows.forEach((rawRow) => {
    const qType = normalize(rawRow.QTypeName)
    if (qType !== QUALITY_OR_TYPE) return
    orRows += 1

    const reportedSerial =
      parseDateSerial(rawRow['Reported DTS']) ??
      parseDateSerial(rawRow['Reported Date']) ??
      parseDateSerial(rawRow.DateTime_Local) ??
      parseDateSerial(rawRow['Occurred DTS']) ??
      parseDateSerial(rawRow['Occurred Date']) ??
      parseDateSerial(rawRow.Quality_Date)

    if (!Number.isFinite(reportedSerial)) {
      skippedMissingDate += 1
      return
    }

    const invName = normalizeLabel(rawRow.InvName)
    const invKey = normalize(invName)
    if (!invKey) {
      skippedMissingInv += 1
      return
    }

    qualityInvKeys.add(invKey)
    events.push({
      reportedSerial: Number(reportedSerial.toFixed(8)),
      invKey,
      eventFacility: normalizeLabel(rawRow.FacilityName),
      recordedBy: normalizeLabel(rawRow.RecordedBy),
      qSubType: normalizeLabel(rawRow.QSubTypeName),
      qLevel: normalizeLabel(rawRow.QLevelName),
      specialty: normalizeLabel(rawRow.Specialty),
      itemType: normalizeLabel(rawRow.ItemType),
      hsysTag: normalizeLabel(rawRow.HsysTag),
    })
  })

  log(
    `Quality workbook parsed. rows=${rows.length.toLocaleString()} OR rows=${orRows.toLocaleString()} usable=${events.length.toLocaleString()}`,
  )

  return {
    events,
    qualityInvKeys,
    stats: {
      totalRows: rows.length,
      orRows,
      usableOrRows: events.length,
      skippedMissingDate,
      skippedMissingInv,
    },
  }
}

const parseInventoryWorkbook = async (inventoryPath) => {
  log(`Streaming inventory workbook: ${inventoryPath}`)

  const invStringIndices = []
  const facilityStringIndices = []
  const doneSerials = []
  const invIndexSet = new Set()
  const headerIndexSet = new Set()
  let parsedRows = 0
  let rowCount = 0

  await streamRows(inventoryPath, (rowXml) => {
    const rowNumberMatch = rowXml.match(ROW_NUMBER_RE)
    if (!rowNumberMatch) return
    const rowNumber = Number.parseInt(rowNumberMatch[1], 10)
    if (!Number.isFinite(rowNumber)) return

    if (rowNumber === 1) {
      const fHeader = rowXml.match(HEADER_F_RE)?.[1]
      const mHeader = rowXml.match(HEADER_M_RE)?.[1]
      const ahHeader = rowXml.match(HEADER_AH_RE)?.[1]
      if (fHeader !== undefined) headerIndexSet.add(Number.parseInt(fHeader, 10))
      if (mHeader !== undefined) headerIndexSet.add(Number.parseInt(mHeader, 10))
      if (ahHeader !== undefined) headerIndexSet.add(Number.parseInt(ahHeader, 10))
      return
    }

    rowCount += 1

    const invMatch = rowXml.match(INV_CELL_RE)
    const facilityMatch = rowXml.match(FACILITY_CELL_RE)
    const doneLocalMatch = rowXml.match(DONE_LOCAL_CELL_RE)
    if (!invMatch || !facilityMatch || !doneLocalMatch) return

    const invCellAttributes = invMatch[1] ?? ''
    const facilityCellAttributes = facilityMatch[1] ?? ''
    if (!invCellAttributes.includes('t="s"') || !facilityCellAttributes.includes('t="s"')) return

    const invIndex = Number.parseInt(invMatch[2] ?? '', 10)
    const facilityIndex = Number.parseInt(facilityMatch[2] ?? '', 10)
    const doneSerial = Number.parseFloat(doneLocalMatch[1] ?? '')

    if (!Number.isFinite(invIndex) || !Number.isFinite(facilityIndex) || !Number.isFinite(doneSerial))
      return

    invStringIndices.push(invIndex)
    facilityStringIndices.push(facilityIndex)
    doneSerials.push(doneSerial)
    invIndexSet.add(invIndex)
    parsedRows += 1

    if (rowCount % 200000 === 0) {
      log(
        `Inventory rows scanned=${rowCount.toLocaleString()} usable=${parsedRows.toLocaleString()} unique inv indices=${invIndexSet.size.toLocaleString()}`,
      )
    }
  })

  log(
    `Inventory scan complete. rows scanned=${rowCount.toLocaleString()} usable=${parsedRows.toLocaleString()} unique inv indices=${invIndexSet.size.toLocaleString()}`,
  )

  return {
    invStringIndices,
    facilityStringIndices,
    doneSerials,
    invIndexSet,
    headerIndexSet,
    rowCount,
    parsedRows,
  }
}

const makeLookupEncoder = (blankLabel = '(Blank)') => {
  const keyToId = new Map()
  const labels = []

  const idFor = (rawValue) => {
    const label = normalizeLabel(rawValue, blankLabel)
    const key = normalize(label)
    const existing = keyToId.get(key)
    if (existing !== undefined) return existing
    const id = labels.length
    keyToId.set(key, id)
    labels.push(label)
    return id
  }

  return { idFor, labels }
}

const findLatestBeforeOrAt = (records, serial) => {
  if (!records || records.length === 0) return null
  let low = 0
  let high = records.length - 1
  let best = -1

  while (low <= high) {
    const middle = (low + high) >> 1
    const candidate = records[middle]
    if (candidate.doneSerial <= serial) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return best >= 0 ? records[best] : null
}

const buildDataset = async (qualityPath, inventoryPath, outputPath) => {
  const quality = parseQualityWorkbook(qualityPath)
  const inventoryRaw = await parseInventoryWorkbook(inventoryPath)

  const headerStrings = await streamSharedStrings(inventoryPath, inventoryRaw.headerIndexSet)
  const headerValues = [...headerStrings.values()]
  const expectedHeaders = ['FacilityName', 'InvName', 'Done_Local']
  expectedHeaders.forEach((expectedHeader) => {
    if (!headerValues.includes(expectedHeader)) {
      throw new Error(
        `Inventory workbook header validation failed. Expected header "${expectedHeader}" was not found in F/M/AH columns.`,
      )
    }
  })

  const invStrings = await streamSharedStrings(inventoryPath, inventoryRaw.invIndexSet)
  const matchedInvIndexSet = new Set()
  invStrings.forEach((invName, index) => {
    if (quality.qualityInvKeys.has(normalize(invName))) {
      matchedInvIndexSet.add(index)
    }
  })
  log(
    `Inventory inv-name decoding complete. matched inv indices=${matchedInvIndexSet.size.toLocaleString()} of ${inventoryRaw.invIndexSet.size.toLocaleString()}`,
  )

  const inventoryByInvKey = new Map()
  const neededFacilityIndexSet = new Set()

  for (let i = 0; i < inventoryRaw.invStringIndices.length; i += 1) {
    const invIndex = inventoryRaw.invStringIndices[i]
    if (!matchedInvIndexSet.has(invIndex)) continue

    const invName = invStrings.get(invIndex)
    if (!invName) continue
    const invKey = normalize(invName)
    if (!invKey) continue

    const record = {
      doneSerial: inventoryRaw.doneSerials[i],
      facilityIndex: inventoryRaw.facilityStringIndices[i],
    }
    neededFacilityIndexSet.add(record.facilityIndex)

    const bucket = inventoryByInvKey.get(invKey)
    if (bucket) {
      bucket.push(record)
    } else {
      inventoryByInvKey.set(invKey, [record])
    }
  }

  const facilityStrings = await streamSharedStrings(inventoryPath, neededFacilityIndexSet)
  inventoryByInvKey.forEach((records) => {
    records.sort((left, right) => left.doneSerial - right.doneSerial)
  })

  log(
    `Prepared inventory lookup. inv keys=${inventoryByInvKey.size.toLocaleString()} facility strings=${facilityStrings.size.toLocaleString()}`,
  )

  const processingLookup = makeLookupEncoder()
  const eventFacilityLookup = makeLookupEncoder()
  const recordedByLookup = makeLookupEncoder()
  const qSubTypeLookup = makeLookupEncoder()
  const qLevelLookup = makeLookupEncoder()
  const specialtyLookup = makeLookupEncoder()
  const itemTypeLookup = makeLookupEncoder()
  const hsysTagLookup = makeLookupEncoder()

  const reportedSerials = []
  const processingFacilityIds = []
  const eventFacilityIds = []
  const recordedByIds = []
  const qSubTypeIds = []
  const qLevelIds = []
  const specialtyIds = []
  const itemTypeIds = []
  const hsysTagIds = []
  const matchedFlags = []

  let matchedRows = 0
  let unmatchedRows = 0
  let minReportedSerial = null
  let maxReportedSerial = null

  quality.events.forEach((event) => {
    const inventoryRecords = inventoryByInvKey.get(event.invKey) ?? null
    const matchedRecord = findLatestBeforeOrAt(inventoryRecords, event.reportedSerial)
    const processingFacility = matchedRecord
      ? normalizeLabel(facilityStrings.get(matchedRecord.facilityIndex), '(Unknown Processing Facility)')
      : UNMATCHED_PROCESSING_LABEL

    if (matchedRecord) {
      matchedRows += 1
    } else {
      unmatchedRows += 1
    }

    reportedSerials.push(event.reportedSerial)
    processingFacilityIds.push(processingLookup.idFor(processingFacility))
    eventFacilityIds.push(eventFacilityLookup.idFor(event.eventFacility))
    recordedByIds.push(recordedByLookup.idFor(event.recordedBy))
    qSubTypeIds.push(qSubTypeLookup.idFor(event.qSubType))
    qLevelIds.push(qLevelLookup.idFor(event.qLevel))
    specialtyIds.push(specialtyLookup.idFor(event.specialty))
    itemTypeIds.push(itemTypeLookup.idFor(event.itemType))
    hsysTagIds.push(hsysTagLookup.idFor(event.hsysTag))
    matchedFlags.push(matchedRecord ? 1 : 0)

    if (minReportedSerial === null || event.reportedSerial < minReportedSerial) {
      minReportedSerial = event.reportedSerial
    }
    if (maxReportedSerial === null || event.reportedSerial > maxReportedSerial) {
      maxReportedSerial = event.reportedSerial
    }
  })

  const dataset = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceWorkbooks: {
        quality: path.basename(qualityPath),
        inventory: path.basename(inventoryPath),
      },
      qualityRows: quality.stats.totalRows,
      qualityOrRows: quality.stats.orRows,
      qualityUsableRows: quality.stats.usableOrRows,
      qualitySkippedMissingDate: quality.stats.skippedMissingDate,
      qualitySkippedMissingInv: quality.stats.skippedMissingInv,
      inventoryRowsScanned: inventoryRaw.rowCount,
      inventoryRowsUsable: inventoryRaw.parsedRows,
      inventoryMatchedInvKeys: inventoryByInvKey.size,
      matchedRows,
      unmatchedRows,
    },
    minReportedSerial,
    maxReportedSerial,
    lookups: {
      processingFacilities: processingLookup.labels,
      eventFacilities: eventFacilityLookup.labels,
      recordedBys: recordedByLookup.labels,
      qSubTypes: qSubTypeLookup.labels,
      qLevels: qLevelLookup.labels,
      specialties: specialtyLookup.labels,
      itemTypes: itemTypeLookup.labels,
      hsysTags: hsysTagLookup.labels,
    },
    rows: {
      reportedSerials,
      processingFacilityIds,
      eventFacilityIds,
      recordedByIds,
      qSubTypeIds,
      qLevelIds,
      specialtyIds,
      itemTypeIds,
      hsysTagIds,
      matchedFlags,
    },
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(dataset))
  log(`Wrote dataset to ${outputPath}`)
  log(
    `Final rows=${reportedSerials.length.toLocaleString()} matched=${matchedRows.toLocaleString()} unmatched=${unmatchedRows.toLocaleString()}`,
  )
}

const qualityPath = process.argv[2] ?? DEFAULT_QUALITY_PATH
const inventoryPath = process.argv[3] ?? DEFAULT_INVENTORY_PATH
const outputPath = process.argv[4] ?? DEFAULT_OUTPUT_PATH

buildDataset(qualityPath, inventoryPath, outputPath).catch((error) => {
  console.error(error)
  process.exit(1)
})
