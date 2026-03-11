#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_WORKBOOK_PATH =
  '/Users/alexbrown/Library/CloudStorage/GoogleDrive-alexbrown@ascendcohealth.com/My Drive/USE THIS ONE ILOC TEST (1).xlsx'
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'public/data/rtls-accuracy-dataset.json')

const DEFAULT_CONFIG = {
  ilocsKeyword: 'ilocs',
  humanBeforeHours: 4,
  humanAfterHours: 8,
}

const WORKBOOK_ENTRY = 'xl/workbook.xml'
const WORKBOOK_RELS_ENTRY = 'xl/_rels/workbook.xml.rels'
const SHARED_STRINGS_ENTRY = 'xl/sharedStrings.xml'

const TARGET_COLS = new Set(['B', 'J', 'K', 'M', 'O', 'P', 'R', 'S', 'AA', 'AG', 'AH', 'AI'])
const BEACON_TARGET_COLS = new Set(['B'])

const ROW_TAG_OPEN = '<row '
const ROW_TAG_CLOSE = '</row>'
const SHARED_STRING_OPEN = '<si>'
const SHARED_STRING_CLOSE = '</si>'

const XML_ENTITY_REPLACEMENTS = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
}

const LAG_BUCKET_LABELS = [
  'Human Before ilocs',
  '0-15 Minutes',
  '15-60 Minutes',
  '1-4 Hours',
  '4-8 Hours',
  '8+ Hours',
]

const STAGE_ORDER = ['Decon', 'Assembly', 'Sterilize', 'Transport', 'Storage', 'Case', 'Other']

const EXPECTED_STAGE_EDGES = new Set([
  'Assembly->Sterilize',
  'Sterilize->Transport',
  'Transport->Storage',
  'Storage->Case',
  'Case->Decon',
  'Decon->Assembly',
  'Storage->Decon',
  'Storage->Assembly',
  'Storage->Sterilize',
])

const log = (...messages) => {
  const now = new Date().toISOString()
  console.log(`[${now}]`, ...messages)
}

const decodeXmlEntities = (value) => {
  if (!value) return ''
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (entity) => XML_ENTITY_REPLACEMENTS[entity] ?? entity)
}

const normalizeEntryPath = (target) => {
  const clean = String(target ?? '').trim().replace(/\\/g, '/')
  if (!clean) return null
  if (clean.startsWith('/')) return clean.slice(1)
  if (clean.startsWith('xl/')) return clean
  return `xl/${clean}`
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

    child.on('error', (error) => reject(error))

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

const readEntryText = async (filePath, innerPath) => {
  let text = ''
  await runUnzipStream(filePath, innerPath, (chunk) => {
    text += chunk.toString('utf8')
    return true
  })
  return text
}

const resolveSheetEntries = async (workbookPath) => {
  const workbookXml = await readEntryText(workbookPath, WORKBOOK_ENTRY)
  const relsXml = await readEntryText(workbookPath, WORKBOOK_RELS_ENTRY)

  const relIdToEntry = new Map()
  const relPattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g
  let relMatch
  while ((relMatch = relPattern.exec(relsXml)) !== null) {
    const relId = relMatch[1]
    const entry = normalizeEntryPath(relMatch[2])
    if (relId && entry) {
      relIdToEntry.set(relId, entry)
    }
  }

  const sheets = []
  const sheetPattern = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g
  let sheetMatch
  while ((sheetMatch = sheetPattern.exec(workbookXml)) !== null) {
    const name = sheetMatch[1] ?? ''
    const relId = sheetMatch[2] ?? ''
    const entry = relIdToEntry.get(relId)
    if (!entry) continue
    sheets.push({ name, entry })
  }

  if (sheets.length === 0) {
    throw new Error('Workbook format not recognized. No worksheet could be located.')
  }

  const findByNeedles = (needles) => {
    for (const needle of needles) {
      const found = sheets.find((sheet) => sheet.name.toLowerCase().includes(needle))
      if (found) return found
    }
    return null
  }

  const scanSheet = findByNeedles(['scan', 'analytic', 'history']) ?? findByNeedles(['sheet1']) ?? sheets[0]
  const beaconSheetCandidate = findByNeedles(['beacon'])
  const beaconSheet =
    beaconSheetCandidate && beaconSheetCandidate.entry !== scanSheet.entry ? beaconSheetCandidate : null

  return {
    scanSheet,
    beaconSheet,
  }
}

const parseExcelSerial = (...candidates) => {
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim()
    if (!text) continue

    const numeric = Number.parseFloat(text)
    if (Number.isFinite(numeric) && numeric > 20_000) return numeric

    const parsed = Date.parse(text)
    if (!Number.isNaN(parsed)) {
      return parsed / (24 * 60 * 60 * 1000) + 25569
    }
  }
  return null
}

const normalize = (value) => String(value ?? '').trim().toLowerCase()

const parseRowCells = (rowXml, targetCols) => {
  const cells = {}
  const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g
  let match

  while ((match = cellPattern.exec(rowXml)) !== null) {
    const attributes = match[1] ?? ''
    const body = match[2] ?? ''
    const refMatch = attributes.match(/\br="([A-Z]+)\d+"/)
    if (!refMatch) continue

    const column = refMatch[1]
    if (!targetCols.has(column)) continue

    const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? ''
    let value = ''

    if (type === 'inlineStr') {
      const textPattern = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g
      const parts = []
      let textMatch
      while ((textMatch = textPattern.exec(body)) !== null) {
        parts.push(decodeXmlEntities(textMatch[1] ?? ''))
      }
      value = parts.join('')
    } else {
      value = decodeXmlEntities(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '')
    }

    cells[column] = { type, value }
  }

  return cells
}

const streamRows = async (workbookPath, sheetEntry, targetCols, onRow) => {
  let buffer = ''
  await runUnzipStream(workbookPath, sheetEntry, (chunk) => {
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

      const rowNumber = Number.parseInt(rowXml.match(/<row\b[^>]*\br="(\d+)"/)?.[1] ?? '', 10)
      if (!Number.isFinite(rowNumber)) continue
      const cells = parseRowCells(rowXml, targetCols)
      onRow(rowNumber, cells)
    }

    return true
  })
}

const parseTokenKey = (cell, neededSharedIndices, rawValueToId, rawValueLookup) => {
  if (!cell) return 0
  const value = String(cell.value ?? '').trim()
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

const decodeTokenKey = (key, sharedLookup, rawValueLookup) => {
  if (key === 0) return ''
  if (key > 0) return sharedLookup.get(key - 1) ?? ''
  return rawValueLookup[Math.abs(key) - 1] ?? ''
}

const streamSharedStrings = async (workbookPath, neededIndices) => {
  const resolved = new Map()
  if (neededIndices.size === 0) return resolved

  const maxNeeded = Math.max(...neededIndices)
  let buffer = ''
  let index = 0

  await runUnzipStream(
    workbookPath,
    SHARED_STRINGS_ENTRY,
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
          const parts = []
          const textPattern = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g
          let textMatch
          while ((textMatch = textPattern.exec(body)) !== null) {
            parts.push(decodeXmlEntities(textMatch[1] ?? ''))
          }
          const decoded = parts.length > 0 ? parts.join('') : decodeXmlEntities(body.replace(/<[^>]+>/g, ''))
          resolved.set(index, decoded)
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

const parseWorkbookToDataset = async (workbookPath, scanSheetEntry, beaconSheetEntry) => {
  const neededSharedIndices = new Set()
  const rawValueLookup = []
  const rawValueToId = new Map()

  const invKeys = []
  const invNameKeys = []
  const locationKeys = []
  const aliasUserKeys = []
  const userKeys = []
  const stateKeys = []
  const substateKeys = []
  const workflowKeys = []
  const timestampSerials = []
  const beaconInvNameKeys = []

  let parsedRows = 0

  log(`Streaming scan sheet: ${scanSheetEntry}`)
  await streamRows(workbookPath, scanSheetEntry, TARGET_COLS, (rowNumber, cells) => {
    if (rowNumber === 1) return
    parsedRows += 1
    if (parsedRows % 100_000 === 0) {
      log(`Scan rows parsed: ${parsedRows.toLocaleString()}`)
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
    invNameKeys.push(parseTokenKey(cells.AA, neededSharedIndices, rawValueToId, rawValueLookup))
    locationKeys.push(locationKey)
    aliasUserKeys.push(parseTokenKey(cells.R, neededSharedIndices, rawValueToId, rawValueLookup))
    userKeys.push(parseTokenKey(cells.S, neededSharedIndices, rawValueToId, rawValueLookup))
    stateKeys.push(parseTokenKey(cells.J, neededSharedIndices, rawValueToId, rawValueLookup))
    substateKeys.push(parseTokenKey(cells.K, neededSharedIndices, rawValueToId, rawValueLookup))
    workflowKeys.push(parseTokenKey(cells.M, neededSharedIndices, rawValueToId, rawValueLookup))
    timestampSerials.push(timestampSerial)
  })

  if (beaconSheetEntry) {
    log(`Streaming beacon sheet: ${beaconSheetEntry}`)
    await streamRows(workbookPath, beaconSheetEntry, BEACON_TARGET_COLS, (rowNumber, cells) => {
      if (rowNumber === 1) return
      const invNameKey = parseTokenKey(cells.B, neededSharedIndices, rawValueToId, rawValueLookup)
      if (invNameKey !== 0) {
        beaconInvNameKeys.push(invNameKey)
      }
    })
  }

  if (parsedRows === 0 || invKeys.length === 0) {
    throw new Error('No scan rows were parsed. Verify workbook structure and source sheet.')
  }

  log(
    `Rows parsed=${parsedRows.toLocaleString()} usable after required fields=${invKeys.length.toLocaleString()} shared token refs=${neededSharedIndices.size.toLocaleString()}`,
  )

  log('Decoding shared strings...')
  const sharedLookup = await streamSharedStrings(workbookPath, neededSharedIndices)
  log(`Decoded shared strings: ${sharedLookup.size.toLocaleString()}`)

  const normalizeName = (value) => String(value ?? '').trim().toLowerCase()
  const beaconedNameByNormalized = new Map()
  for (const invNameKey of beaconInvNameKeys) {
    const rawInvName = decodeTokenKey(invNameKey, sharedLookup, rawValueLookup).trim()
    const normalized = normalizeName(rawInvName)
    if (!normalized) continue
    if (beaconedNameByNormalized.has(normalized)) continue
    beaconedNameByNormalized.set(normalized, rawInvName)
  }
  const beaconedNameSet = new Set(beaconedNameByNormalized.keys())
  const beaconedInvNames = Array.from(beaconedNameByNormalized.values()).sort((left, right) =>
    left.localeCompare(right),
  )

  const rawParsedRows = invKeys.length
  const beaconFilterApplied = beaconedNameSet.size > 0
  let excludedNonBeaconRows = 0

  const filteredInvKeys = []
  const filteredInvNameKeys = []
  const filteredLocationKeys = []
  const filteredAliasUserKeys = []
  const filteredUserKeys = []
  const filteredStateKeys = []
  const filteredSubstateKeys = []
  const filteredWorkflowKeys = []
  const filteredTimestampSerials = []
  const excludedInvNameCounts = new Map()

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

  const excludedInvNameSummaries = Array.from(excludedInvNameCounts.entries())
    .map(([invName, count]) => ({ invName, count }))
    .sort((left, right) => right.count - left.count)

  return {
    rows: {
      invKeys: filteredInvKeys,
      invNameKeys: filteredInvNameKeys,
      locationKeys: filteredLocationKeys,
      aliasUserKeys: filteredAliasUserKeys,
      userKeys: filteredUserKeys,
      stateKeys: filteredStateKeys,
      substateKeys: filteredSubstateKeys,
      workflowKeys: filteredWorkflowKeys,
      timestampSerials: filteredTimestampSerials,
    },
    sharedLookup,
    rawValueLookup,
    parsedRows: filteredInvKeys.length,
    rawParsedRows,
    beaconFilterApplied,
    beaconedAssetsCount: beaconedNameSet.size,
    beaconedInvNames,
    excludedNonBeaconRows,
    excludedInvNameSummaries,
  }
}

const includesAny = (value, needles) => needles.some((needle) => value.includes(needle))

const classifyStage = (location, substate, workflowRule, state) => {
  const text = normalize(`${location} ${substate} ${workflowRule} ${state}`)
  if (!text) return 'Other'

  if (
    includesAny(text, [
      'decon',
      'sink',
      'washer',
      'hld',
      'medivator',
      'ultrasonic',
      'soak',
      'cleaning',
      'washing',
    ])
  ) {
    return 'Decon'
  }

  if (
    includesAny(text, [
      'assembly',
      'prep',
      'pack',
      'inspection',
      'instrument check',
      'counting',
      'set up',
      'set-up',
    ])
  ) {
    return 'Assembly'
  }

  if (
    includesAny(text, [
      'steril',
      'autoclave',
      'vpro',
      'steam',
      'eto',
      'low temp',
      'waiting for sterilizer',
      'waiting after sterilizer',
    ])
  ) {
    return 'Sterilize'
  }

  if (
    includesAny(text, [
      'transport',
      'dispatch',
      'courier',
      'truck',
      'delivery',
      'pickup',
      'pick up',
      'case cart',
      'in transit',
    ])
  ) {
    return 'Transport'
  }

  if (
    includesAny(text, [
      'storage',
      'core',
      'shelf',
      'rack',
      'staging',
      'holding',
      'ready shelf',
    ])
  ) {
    return 'Storage'
  }

  if (
    includesAny(text, [
      'or ',
      'operating room',
      'room ',
      'procedure',
      'case',
      'clinic',
      'endo',
      'bronchoscopy',
      'main or',
    ])
  ) {
    return 'Case'
  }

  return 'Other'
}

const isOffPathTransition = (from, to) => {
  if (from === to || from === 'Other' || to === 'Other') return false
  return !EXPECTED_STAGE_EDGES.has(`${from}->${to}`)
}

const incrementCount = (map, key) => {
  map.set(key, (map.get(key) ?? 0) + 1)
}

const pushToMapList = (map, key, value) => {
  const list = map.get(key)
  if (list) {
    list.push(value)
    return
  }
  map.set(key, [value])
}

const mapListToRecord = (map) => {
  const record = {}
  map.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const quantile = (sortedValues, percentile) => {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * percentile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

const lagBucketLabel = (lagHours) => {
  if (lagHours < 0) return LAG_BUCKET_LABELS[0]
  if (lagHours < 0.25) return LAG_BUCKET_LABELS[1]
  if (lagHours < 1) return LAG_BUCKET_LABELS[2]
  if (lagHours < 4) return LAG_BUCKET_LABELS[3]
  if (lagHours < 8) return LAG_BUCKET_LABELS[4]
  return LAG_BUCKET_LABELS[5]
}

const round2 = (value) => Number(value.toFixed(2))
const toPercent = (value, total) => (total > 0 ? (value / total) * 100 : 0)

const analyzeDataset = (dataset, config) => {
  const { rows, sharedLookup, rawValueLookup } = dataset
  const keyword = normalize(config.ilocsKeyword || 'ilocs')
  const beforeHours = Math.max(0, config.humanBeforeHours)
  const afterHours = Math.max(0, config.humanAfterHours)

  const rowCount = rows.invKeys.length
  let sorted = true
  for (let i = 1; i < rowCount; i += 1) {
    if (rows.timestampSerials[i] < rows.timestampSerials[i - 1]) {
      sorted = false
      break
    }
  }

  const orderedIndices = sorted
    ? null
    : Array.from({ length: rowCount }, (_, index) => index).sort(
        (left, right) => rows.timestampSerials[left] - rows.timestampSerials[right],
      )

  const decodeCache = new Map()
  const decodeValue = (key) => {
    const cached = decodeCache.get(key)
    if (cached !== undefined) return cached
    const decoded = decodeTokenKey(key, sharedLookup, rawValueLookup)
    decodeCache.set(key, decoded)
    return decoded
  }

  const scannerTypeCache = new Map()
  const stageCache = new Map()

  const lastIlocsLocationByInv = new Map()
  const lastHumanLocationByInv = new Map()
  const lastIlocsEventByInv = new Map()

  const groupedEvents = new Map()
  const stageCounts = new Map()
  const stageEventsMap = new Map()
  const transitionCounts = new Map()
  const transitionEventsMap = new Map()
  const offPathTransitionCounts = new Map()
  const offPathTransitionEventsMap = new Map()

  const ilocsEvents = []
  const humanEvents = []
  const beaconedNameByNormalized = new Map()
  const beaconScanCounts = new Map()

  for (const beaconedInvName of dataset.beaconedInvNames) {
    const normalizedName = normalize(beaconedInvName)
    if (!normalizedName || beaconedNameByNormalized.has(normalizedName)) continue
    beaconedNameByNormalized.set(normalizedName, beaconedInvName)
    beaconScanCounts.set(normalizedName, { total: 0, human: 0, ilocs: 0 })
  }

  const getScannerType = (aliasUserKey, userKey) => {
    const cacheKey = `${aliasUserKey}|${userKey}`
    const cached = scannerTypeCache.get(cacheKey)
    if (cached) return cached

    const alias = normalize(decodeValue(aliasUserKey))
    const user = normalize(decodeValue(userKey))
    const joined = `${alias} ${user}`.trim()

    if (!joined) {
      scannerTypeCache.set(cacheKey, 'unknown')
      return 'unknown'
    }

    if (keyword && joined.includes(keyword)) {
      scannerTypeCache.set(cacheKey, 'ilocs')
      return 'ilocs'
    }

    scannerTypeCache.set(cacheKey, 'human')
    return 'human'
  }

  const getStage = (locationKey, substateKey, workflowKey, stateKey) => {
    const cacheKey = `${locationKey}|${substateKey}|${workflowKey}|${stateKey}`
    const cached = stageCache.get(cacheKey)
    if (cached) return cached

    const location = decodeValue(locationKey)
    const substate = decodeValue(substateKey)
    const workflowRule = decodeValue(workflowKey)
    const state = decodeValue(stateKey)
    const stage = classifyStage(location, substate, workflowRule, state)
    stageCache.set(cacheKey, stage)
    return stage
  }

  const buildEventDetail = (rowIndex, scannerType) => {
    const invId = decodeValue(rows.invKeys[rowIndex]).trim() || `Inv-${rows.invKeys[rowIndex]}`
    const invName = decodeValue(rows.invNameKeys[rowIndex]).trim() || 'Unknown Inv'
    const location = decodeValue(rows.locationKeys[rowIndex]).trim() || 'Unknown Location'
    const state = decodeValue(rows.stateKeys[rowIndex]).trim()
    const substate = decodeValue(rows.substateKeys[rowIndex]).trim()
    const workflowRule = decodeValue(rows.workflowKeys[rowIndex]).trim()
    const aliasUser = decodeValue(rows.aliasUserKeys[rowIndex]).trim()
    const userName = decodeValue(rows.userKeys[rowIndex]).trim()
    const stage = getStage(
      rows.locationKeys[rowIndex],
      rows.substateKeys[rowIndex],
      rows.workflowKeys[rowIndex],
      rows.stateKeys[rowIndex],
    )

    return {
      invId,
      invName,
      scannerType,
      location,
      stage,
      state,
      substate,
      workflowRule,
      aliasUser,
      userName,
      timestampSerial: rows.timestampSerials[rowIndex],
    }
  }

  const rowAt = (position) => (orderedIndices ? orderedIndices[position] : position)

  for (let position = 0; position < rowCount; position += 1) {
    const rowIndex = rowAt(position)
    const scannerType = getScannerType(rows.aliasUserKeys[rowIndex], rows.userKeys[rowIndex])
    const normalizedInvName = normalize(decodeValue(rows.invNameKeys[rowIndex]))
    const beaconCounts = beaconScanCounts.get(normalizedInvName)
    if (beaconCounts) {
      beaconCounts.total += 1
      if (scannerType === 'human') beaconCounts.human += 1
      if (scannerType === 'ilocs') beaconCounts.ilocs += 1
    }
    if (scannerType === 'unknown') continue

    const invKey = rows.invKeys[rowIndex]
    const locationKey = rows.locationKeys[rowIndex]
    const groupKey = `${invKey}|${locationKey}`
    const group = groupedEvents.get(groupKey) ?? { ilocs: [], human: [] }
    groupedEvents.set(groupKey, group)

    if (scannerType === 'ilocs') {
      const lastLocation = lastIlocsLocationByInv.get(invKey)
      if (lastLocation === locationKey) continue

      const event = buildEventDetail(rowIndex, 'ilocs')
      lastIlocsLocationByInv.set(invKey, locationKey)
      group.ilocs.push(event)
      ilocsEvents.push(event)

      incrementCount(stageCounts, event.stage)
      pushToMapList(stageEventsMap, event.stage, event)

      const previousEvent = lastIlocsEventByInv.get(invKey)
      if (previousEvent && previousEvent.stage !== event.stage) {
        const transitionKey = `${previousEvent.stage}|${event.stage}`
        const offPath = isOffPathTransition(previousEvent.stage, event.stage)
        incrementCount(transitionCounts, transitionKey)

        const transitionDetail = {
          invId: event.invId,
          invName: event.invName,
          fromStage: previousEvent.stage,
          toStage: event.stage,
          fromLocation: previousEvent.location,
          toLocation: event.location,
          fromTimestampSerial: previousEvent.timestampSerial,
          toTimestampSerial: event.timestampSerial,
          offPath,
        }
        pushToMapList(transitionEventsMap, transitionKey, transitionDetail)

        if (offPath) {
          incrementCount(offPathTransitionCounts, transitionKey)
          pushToMapList(offPathTransitionEventsMap, transitionKey, transitionDetail)
        }
      }

      lastIlocsEventByInv.set(invKey, event)
      continue
    }

    const lastLocation = lastHumanLocationByInv.get(invKey)
    if (lastLocation === locationKey) continue

    const event = buildEventDetail(rowIndex, 'human')
    lastHumanLocationByInv.set(invKey, locationKey)
    group.human.push(event)
    humanEvents.push(event)
  }

  const matchedEvents = []
  const unmatchedIlocsEvents = []
  const unmatchedHumanEvents = []
  const lagValues = []
  const lagBucketMatchesMap = new Map()

  groupedEvents.forEach((group) => {
    let ilocsCursor = 0
    let humanCursor = 0

    while (ilocsCursor < group.ilocs.length && humanCursor < group.human.length) {
      const ilocsEvent = group.ilocs[ilocsCursor]
      const humanEvent = group.human[humanCursor]
      const lagHours = (humanEvent.timestampSerial - ilocsEvent.timestampSerial) * 24

      if (lagHours < -beforeHours) {
        unmatchedHumanEvents.push(humanEvent)
        humanCursor += 1
        continue
      }

      if (lagHours > afterHours) {
        unmatchedIlocsEvents.push(ilocsEvent)
        ilocsCursor += 1
        continue
      }

      const matchDetail = {
        invId: ilocsEvent.invId,
        invName: ilocsEvent.invName,
        location: ilocsEvent.location,
        stage: ilocsEvent.stage,
        ilocsAliasUser: ilocsEvent.aliasUser,
        humanAliasUser: humanEvent.aliasUser,
        ilocsTimestampSerial: ilocsEvent.timestampSerial,
        humanTimestampSerial: humanEvent.timestampSerial,
        lagHours,
      }

      matchedEvents.push(matchDetail)
      lagValues.push(lagHours)
      pushToMapList(lagBucketMatchesMap, lagBucketLabel(lagHours), matchDetail)

      ilocsCursor += 1
      humanCursor += 1
    }

    for (; ilocsCursor < group.ilocs.length; ilocsCursor += 1) {
      unmatchedIlocsEvents.push(group.ilocs[ilocsCursor])
    }
    for (; humanCursor < group.human.length; humanCursor += 1) {
      unmatchedHumanEvents.push(group.human[humanCursor])
    }
  })

  const sortedLags = [...lagValues].sort((left, right) => left - right)
  const meanLag =
    sortedLags.length === 0
      ? 0
      : sortedLags.reduce((accumulator, next) => accumulator + next, 0) / sortedLags.length

  const lagBuckets = LAG_BUCKET_LABELS.map((label) => ({
    label,
    count: lagBucketMatchesMap.get(label)?.length ?? 0,
  }))

  const stageSummaries = STAGE_ORDER.map((stage) => ({
    stage,
    count: stageCounts.get(stage) ?? 0,
  })).sort((left, right) => right.count - left.count)

  const offPathSet = new Set(offPathTransitionCounts.keys())
  const transitionSummaries = Array.from(transitionCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('|')
      return {
        from: from || 'Other',
        to: to || 'Other',
        count,
        offPath: offPathSet.has(key),
      }
    })
    .sort((left, right) => right.count - left.count)

  const offPathTransitions = Array.from(offPathTransitionCounts.entries())
    .map(([key, count]) => {
      const [from, to] = key.split('|')
      return {
        from: from || 'Other',
        to: to || 'Other',
        count,
        offPath: true,
      }
    })
    .sort((left, right) => right.count - left.count)

  const beaconedNeverIlocsAssets = Array.from(beaconScanCounts.entries())
    .filter(([, counts]) => counts.ilocs === 0)
    .map(([normalizedName, counts]) => ({
      invName: beaconedNameByNormalized.get(normalizedName) ?? normalizedName,
      totalScans: counts.total,
      humanScans: counts.human,
    }))
    .sort((left, right) => {
      if (right.totalScans !== left.totalScans) return right.totalScans - left.totalScans
      if (right.humanScans !== left.humanScans) return right.humanScans - left.humanScans
      return left.invName.localeCompare(right.invName)
    })

  return {
    parsedRows: dataset.parsedRows,
    rawParsedRows: dataset.rawParsedRows,
    beaconFilterApplied: dataset.beaconFilterApplied,
    beaconedAssetsCount: dataset.beaconedAssetsCount,
    beaconedNeverIlocsCount: beaconedNeverIlocsAssets.length,
    excludedNonBeaconRows: dataset.excludedNonBeaconRows,
    excludedInvNameSummaries: dataset.excludedInvNameSummaries,
    ilocsRoomChanges: ilocsEvents.length,
    humanRoomChanges: humanEvents.length,
    matchedRoomChanges: matchedEvents.length,
    unmatchedIlocsRoomChanges: unmatchedIlocsEvents.length,
    unmatchedHumanRoomChanges: unmatchedHumanEvents.length,
    ilocsMatchRate: round2(toPercent(matchedEvents.length, ilocsEvents.length)),
    humanCoverageRate: round2(toPercent(matchedEvents.length, humanEvents.length)),
    lagHours: {
      mean: round2(meanLag),
      median: round2(quantile(sortedLags, 0.5)),
      p90: round2(quantile(sortedLags, 0.9)),
      min: round2(sortedLags[0] ?? 0),
      max: round2(sortedLags[sortedLags.length - 1] ?? 0),
    },
    lagBuckets,
    stageSummaries,
    transitionSummaries,
    offPathTransitions,
    drilldowns: {
      ilocsEvents,
      humanEvents,
      matchedEvents,
      unmatchedIlocsEvents,
      unmatchedHumanEvents,
      lagBucketMatches: mapListToRecord(lagBucketMatchesMap),
      stageEvents: mapListToRecord(stageEventsMap),
      transitionEvents: mapListToRecord(transitionEventsMap),
      offPathTransitionEvents: mapListToRecord(offPathTransitionEventsMap),
      excludedInvNames: dataset.excludedInvNameSummaries,
      beaconedNeverIlocsAssets,
    },
  }
}

const buildDataset = async (workbookPath, outputPath, config) => {
  const { scanSheet, beaconSheet } = await resolveSheetEntries(workbookPath)
  log(`Scan sheet resolved: ${scanSheet.name} (${scanSheet.entry})`)
  log(`Beacon sheet resolved: ${beaconSheet ? `${beaconSheet.name} (${beaconSheet.entry})` : 'none'}`)

  const dataset = await parseWorkbookToDataset(
    workbookPath,
    scanSheet.entry,
    beaconSheet ? beaconSheet.entry : null,
  )
  log(
    `Filtered rows=${dataset.parsedRows.toLocaleString()} raw rows=${dataset.rawParsedRows.toLocaleString()} beacon filter=${dataset.beaconFilterApplied}`,
  )

  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      sourceWorkbook: path.basename(workbookPath),
      scanSheet: scanSheet.name,
      beaconSheet: beaconSheet ? beaconSheet.name : null,
      parsedRows: dataset.parsedRows,
      rawParsedRows: dataset.rawParsedRows,
      beaconFilterApplied: dataset.beaconFilterApplied,
      beaconedAssetsCount: dataset.beaconedAssetsCount,
      excludedNonBeaconRows: dataset.excludedNonBeaconRows,
    },
    config,
    dataset: {
      rows: dataset.rows,
      sharedLookupEntries: Array.from(dataset.sharedLookup.entries()),
      rawValueLookup: dataset.rawValueLookup,
      parsedRows: dataset.parsedRows,
      rawParsedRows: dataset.rawParsedRows,
      beaconFilterApplied: dataset.beaconFilterApplied,
      beaconedAssetsCount: dataset.beaconedAssetsCount,
      beaconedInvNames: dataset.beaconedInvNames,
      excludedNonBeaconRows: dataset.excludedNonBeaconRows,
      excludedInvNameSummaries: dataset.excludedInvNameSummaries,
    },
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(payload))
  log(`Wrote RTLS dataset to ${outputPath}`)
}

const workbookPath = process.argv[2] ?? DEFAULT_WORKBOOK_PATH
const outputPath = process.argv[3] ?? DEFAULT_OUTPUT_PATH

buildDataset(workbookPath, outputPath, DEFAULT_CONFIG).catch((error) => {
  console.error(error)
  process.exit(1)
})
