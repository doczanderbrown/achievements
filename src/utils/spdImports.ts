import * as XLSX from 'xlsx'

import type { RawRow } from './metrics'

type SeparateSpdImportArgs = {
  productivityBuffer: ArrayBuffer
  qualityBuffer: ArrayBuffer
  timecardsBuffer?: ArrayBuffer | null
  timecardsFileName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  mismatchMode?: ImportMode
}

export type ImportDiagnosticSeverity = 'info' | 'warning'
export type ImportMode = 'raw' | 'timekeepingAligned'

export type ImportPeriodRange = {
  startIso: string | null
  endIso: string | null
  label: string | null
}

export type SeparateSpdImportDiagnostics = {
  quality: {
    usersWithSignals: number
    matchedIncidentAssignments: number
    matchedAuditChecks: number
    matchedAuditFails: number
    matchedCoachingRows: number
    aliasMatches: number
    unmatchedNames: string[]
  }
  timekeeping: {
    provided: boolean
    applied: boolean
    alignmentSeverity: ImportDiagnosticSeverity | null
    alignmentNote: string | null
    workedHourColumns: string[]
    matchedUsers: number
    usersWithWorkedHours: number
    matchedById: number
    matchedByName: number
    matchedByAlias: number
    unmatchedNames: string[]
    mismatchDetected: boolean
    canAlignWindow: boolean
    analysisMode: ImportMode
    sourceWindowLabel: string | null
    timekeepingWindowLabel: string | null
    analysisWindowLabel: string | null
    qualityWindowApplied: boolean
    productivityScaleFactor: number | null
    productivityScaledDays: number | null
    productivitySourceDays: number | null
    analysisModeNote: string | null
  } | null
}

export type SeparateSpdImportResult = {
  rows: RawRow[]
  hasHoursWorked: boolean
  notes: string[]
  diagnostics: SeparateSpdImportDiagnostics
  periodRange: ImportPeriodRange
}

const PRODUCTIVITY_REQUIRED_COLUMNS = [
  'User ID',
  'User Name',
  'Decon Scans',
  'Sink Inst',
  'Sink Trays',
  'Assembled Trays',
  'Assembled Packs',
  'Assembled Inst',
  'Assembly Missing Inst',
  'Sterilizer Loads',
  'Items Sterilized',
  'Deliver Scans',
  'Activity Count',
  'Activity Time (Mins)',
] as const

const QUALITY_EVENT_SHEET_NAMES = ['OR Events', 'Post Procedure Events', 'SPD Events'] as const
const QUALITY_AUDIT_SHEET_NAME = 'Audits'
const QUALITY_COACHING_SHEET_NAME = 'Coaching Events'
const TIMEKEEPING_REQUIRED_COLUMNS = ['Employee Name'] as const
const TIMEKEEPING_WORKED_HOUR_COLUMNS = [
  'REG',
  'Education',
  'Orientation',
  'All Overtime',
  'ADL - Cont Ed',
  'Holiday-exempt',
  'GNV-PRECEPTOR',
  'GNV-CHARGE PAY',
  'CALL-BACK',
] as const
const NAME_SUFFIX_TOKENS = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
const MANUAL_NAME_ALIASES: Record<string, string> = {
  'carol g beltran cala': 'Carol Beltran',
  'kiara m carrasquillo santiag': 'Kiara Carrasquillo',
  'luis j gutierrez feut': 'Luis Gutierrez Fuet',
  'frankie l jackson': 'Frankie Jackson',
  'salvador r ninofranco': 'Salvador Ninofranco',
  'ezequiel o ramos flamenco': 'Ezekiel Ramos',
  'moses h sanchez': 'Moses Sanchez',
  'luis a vargas baez': 'Luis Vargas',
}

type ProductivitySeed = {
  userId: string
  userName: string
  row: Record<string, unknown>
}

type DetectedHeaderSheet = {
  rows: Record<string, unknown>[]
  rawRows: unknown[][]
  headerRowIndex: number
}

type NameMatch = {
  userId: string
  via: 'name' | 'alias'
}

type QualityBucket = 'decon' | 'assembly' | 'sterilize' | 'deliver'

type BucketCountMap = Record<QualityBucket, number>

type QualityUserStats = {
  incidents: BucketCountMap
  auditChecks: BucketCountMap
  auditFails: BucketCountMap
  coachingCount: number
}

type QualityImportResult = {
  statsByUserId: Map<string, QualityUserStats>
  matchedIncidentAssignments: number
  matchedAuditChecks: number
  matchedAuditFails: number
  matchedCoachingRows: number
  aliasMatches: number
  unmatchedNames: Set<string>
}

type TimekeepingContext = {
  ptoHours: number
  unpaidHours: number
  onCallHours: number
  overtimeHours: number
}

type TimekeepingImportResult = {
  applied: boolean
  alignmentSeverity: ImportDiagnosticSeverity | null
  alignmentNote: string | null
  workedHourColumns: string[]
  timekeepingRange: ImportPeriodRange
  reportRange: ImportPeriodRange
  mismatchDetected: boolean
  hoursByUserId: Map<string, number>
  contextByUserId: Map<string, TimekeepingContext>
  matchedById: number
  matchedByName: number
  matchedByAlias: number
  unmatchedNames: Set<string>
  usersWithWorkedHours: number
}

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ')
const stripDiacritics = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const normalizeName = (value: unknown) => {
  const text = stripDiacritics(normalizeWhitespace(String(value ?? '')))
  if (!text) return ''

  if (!text.includes(',')) {
    return text.toLowerCase()
  }

  const [last, remainder] = text.split(',', 2)
  return normalizeWhitespace(`${remainder} ${last}`).toLowerCase()
}

const splitNameTokens = (value: string) =>
  normalizeName(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

const buildAliasKey = (value: unknown) =>
  normalizeName(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const buildNameKeys = (value: unknown) => {
  const raw = normalizeWhitespace(String(value ?? ''))
  if (!raw) return []

  let givenTokens: string[]
  let remainderTokens: string[]

  if (raw.includes(',')) {
    const [left, right] = raw.split(',', 2)
    givenTokens = splitNameTokens(right).filter((token) => !NAME_SUFFIX_TOKENS.has(token))
    remainderTokens = splitNameTokens(left).filter((token) => !NAME_SUFFIX_TOKENS.has(token))
  } else {
    const tokens = splitNameTokens(raw).filter((token) => !NAME_SUFFIX_TOKENS.has(token))
    if (!tokens.length) return []
    givenTokens = tokens.slice(0, 1)
    remainderTokens = tokens.slice(1)
  }

  const allTokens = [...givenTokens, ...remainderTokens].filter(Boolean)
  if (!allTokens.length) return []

  const withoutInitials = allTokens.filter((token, index) => index === 0 || token.length > 1)
  const firstToken = withoutInitials[0] || allTokens[0]
  const surnameCandidates = [
    ...new Set(
      (remainderTokens.length ? remainderTokens : allTokens.slice(1)).filter(
        (token) => token.length > 1,
      ),
    ),
  ]

  const keys: string[] = []
  const pushKey = (candidate: string) => {
    if (!candidate || keys.includes(candidate)) return
    keys.push(candidate)
  }

  pushKey(allTokens.join(' '))
  pushKey(allTokens.join(''))

  if (withoutInitials.length && withoutInitials.length !== allTokens.length) {
    pushKey(withoutInitials.join(' '))
    pushKey(withoutInitials.join(''))
  }

  if (firstToken && surnameCandidates.length > 0) {
    for (const surname of surnameCandidates) {
      pushKey(`${firstToken} ${surname}`)
      pushKey(`${firstToken[0]} ${surname}`)
    }
  } else if (allTokens.length >= 2) {
    const lastToken = allTokens[allTokens.length - 1]
    pushKey(`${allTokens[0]} ${lastToken}`)
    pushKey(`${allTokens[0][0]} ${lastToken}`)
  }

  return keys
}

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, parsed)
}

const readFirstSheetRows = (buffer: ArrayBuffer) => {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

const readWorkbook = (buffer: ArrayBuffer) => XLSX.read(buffer, { type: 'array' })

const readSheetWithDetectedHeader = (
  buffer: ArrayBuffer,
  requiredColumns: readonly string[],
  maxHeaderScanRows = 6,
): DetectedHeaderSheet | null => {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : null
  if (!sheet) return null

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' })
  const headerRowIndex = rawRows.findIndex((row, index) => {
    if (!Array.isArray(row) || index >= maxHeaderScanRows) return false
    const normalizedCells = row.map((cell) => normalizeWhitespace(String(cell ?? '')))
    return requiredColumns.every((column) => normalizedCells.includes(column))
  })

  if (headerRowIndex < 0) {
    return null
  }

  const headers = (rawRows[headerRowIndex] ?? []).map((value, index) => {
    const normalized = normalizeWhitespace(String(value ?? ''))
    return normalized || `Column ${index + 1}`
  })

  const rows = rawRows
    .slice(headerRowIndex + 1)
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, Array.isArray(row) ? row[index] ?? '' : '']),
      ),
    )
    .filter((row) => Object.values(row).some((value) => String(value ?? '').trim() !== ''))

  return {
    rows,
    rawRows,
    headerRowIndex,
  }
}

const buildProductivitySeeds = (rows: Record<string, unknown>[]) => {
  const firstRow = rows[0]
  if (!firstRow) {
    throw new Error('No data rows found in the productivity workbook.')
  }

  const missing = PRODUCTIVITY_REQUIRED_COLUMNS.filter((column) => !(column in firstRow))
  if (missing.length) {
    throw new Error(`Productivity workbook is missing required columns: ${missing.join(', ')}`)
  }

  const seeds = rows
    .map((row) => ({
      userId: String(row['User ID'] ?? '').trim(),
      userName: normalizeWhitespace(String(row['User Name'] ?? '')),
      row,
    }))
    .filter((row) => row.userId && row.userName)

  if (!seeds.length) {
    throw new Error('No users were found in the productivity workbook.')
  }

  return seeds
}

const buildUserLookups = (seeds: ProductivitySeed[]) => {
  const byUserId = new Map<string, ProductivitySeed>()
  const byNameKey = new Map<string, string | null>()

  for (const seed of seeds) {
    byUserId.set(seed.userId, seed)

    for (const key of buildNameKeys(seed.userName)) {
      const existing = byNameKey.get(key)
      if (existing && existing !== seed.userId) {
        byNameKey.set(key, null)
      } else if (!existing) {
        byNameKey.set(key, seed.userId)
      }
    }
  }

  return { byUserId, byNameKey }
}

const parseDatePrefix = (value: unknown) => {
  const text = String(value ?? '').trim()
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

const isWithinPeriod = (
  value: unknown,
  periodStart?: string | null,
  periodEnd?: string | null,
) => {
  const date = parseDatePrefix(value)
  if (!date) return true
  if (periodStart && date < periodStart) return false
  if (periodEnd && date > periodEnd) return false
  return true
}

const findUserIdByNameKey = (byNameKey: Map<string, string | null>, rawName: unknown) => {
  for (const key of buildNameKeys(rawName)) {
    const value = byNameKey.get(key)
    if (typeof value === 'string') {
      return value
    }
  }

  return null
}

const matchUserByName = (byNameKey: Map<string, string | null>, rawName: unknown): NameMatch | null => {
  const directUserId = findUserIdByNameKey(byNameKey, rawName)
  if (directUserId) {
    return { userId: directUserId, via: 'name' }
  }

  const aliasName = MANUAL_NAME_ALIASES[buildAliasKey(rawName)]
  if (!aliasName) return null

  const aliasUserId = findUserIdByNameKey(byNameKey, aliasName)
  if (!aliasUserId) return null

  return { userId: aliasUserId, via: 'alias' }
}

const createZeroBucketMap = (): BucketCountMap => ({
  decon: 0,
  assembly: 0,
  sterilize: 0,
  deliver: 0,
})

const getOrCreateQualityStats = (
  statsByUserId: Map<string, QualityUserStats>,
  userId: string,
) => {
  const existing = statsByUserId.get(userId)
  if (existing) return existing

  const created: QualityUserStats = {
    incidents: createZeroBucketMap(),
    auditChecks: createZeroBucketMap(),
    auditFails: createZeroBucketMap(),
    coachingCount: 0,
  }
  statsByUserId.set(userId, created)
  return created
}

const parseAccountableEntries = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) return []

  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):\s*(.*)$/)
      if (!match) {
        return {
          roleLabel: null,
          name: normalizeWhitespace(line),
        }
      }
      return {
        roleLabel: normalizeWhitespace(match[1]),
        name: normalizeWhitespace(match[2]),
      }
    })
    .filter((entry) => entry.name)
}

const mapResponsibilityToBucket = (roleLabel: string | null) => {
  const normalized = normalizeWhitespace(String(roleLabel ?? '')).toLowerCase().replace(/\s+/g, '')
  if (!normalized) return null
  if (normalized.includes('assemble')) return 'assembly' as const
  if (
    normalized.includes('scantoor') ||
    normalized.includes('deliver') ||
    normalized.includes('delivery')
  ) {
    return 'deliver' as const
  }
  if (normalized.includes('steril')) return 'sterilize' as const
  if (normalized.includes('decon') || normalized.includes('sink')) return 'decon' as const
  return null
}

const parseFlexibleDateToken = (value: string) => {
  const trimmed = normalizeWhitespace(value)
  if (!trimmed) return null

  const isoCandidate = trimmed.replace(/[./]/g, '-')
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoCandidate)) {
    return isoCandidate
  }

  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!usMatch) return null

  const [, month, day, year] = usMatch
  const mm = month.padStart(2, '0')
  const dd = day.padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

const extractDateRangeFromText = (value: string) => {
  const rangeMatch = value.match(
    /(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\s*[-–]\s*(\d{4}[./-]\d{2}[./-]\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/,
  )
  if (!rangeMatch) return null

  const startIso = parseFlexibleDateToken(rangeMatch[1])
  const endIso = parseFlexibleDateToken(rangeMatch[2])
  if (!startIso || !endIso) return null

  return { startIso, endIso }
}

const formatFriendlyDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const describePeriod = (startIso: string, endIso: string) =>
  `${formatFriendlyDate(startIso)} – ${formatFriendlyDate(endIso)}`

const buildPeriodRange = (
  startIso?: string | null,
  endIso?: string | null,
): ImportPeriodRange => ({
  startIso: startIso ?? null,
  endIso: endIso ?? null,
  label: startIso && endIso ? describePeriod(startIso, endIso) : null,
})

const dayDiffInclusive = (startIso: string, endIso: string) => {
  const start = new Date(`${startIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const diffMs = end.getTime() - start.getTime()
  return Math.floor(diffMs / 86_400_000) + 1
}

const intersectRanges = (
  leftStartIso: string,
  leftEndIso: string,
  rightStartIso: string,
  rightEndIso: string,
) => {
  const startIso = leftStartIso > rightStartIso ? leftStartIso : rightStartIso
  const endIso = leftEndIso < rightEndIso ? leftEndIso : rightEndIso
  if (startIso > endIso) return null
  return { startIso, endIso }
}

const roundScaledValue = (value: number) => {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10000) / 10000
}

const PRODUCTIVITY_SCALABLE_COLUMNS = [
  'Decon Scans',
  'Sink Inst',
  'Sink Trays',
  'Assembled Trays',
  'Assembled Packs',
  'Assembled Inst',
  'Assembly Missing Inst',
  'Sterilizer Loads',
  'Items Sterilized',
  'Deliver Scans',
  'Activity Count',
  'Activity Time (Mins)',
] as const

const scaleProductivityRow = (row: Record<string, unknown>, factor: number) => {
  if (factor === 1) return row

  const scaledRow = { ...row }
  for (const column of PRODUCTIVITY_SCALABLE_COLUMNS) {
    scaledRow[column] = roundScaledValue(toNumber(row[column]) * factor)
  }

  return scaledRow
}

const assessTimekeepingAlignment = ({
  rawRows,
  headerRowIndex,
  fileName,
  periodStart,
  periodEnd,
}: {
  rawRows: unknown[][]
  headerRowIndex: number
  fileName?: string | null
  periodStart?: string | null
  periodEnd?: string | null
}) => {
  const metadataText = rawRows
    .slice(0, Math.max(headerRowIndex, 1))
    .flat()
    .map((value) => normalizeWhitespace(String(value ?? '')))
    .filter(Boolean)
    .join(' | ')
  const timeframeMatch = metadataText.match(/timeframe\s*:\s*([^|]+)/i)
  const timeframeLabel = timeframeMatch ? normalizeWhitespace(timeframeMatch[1]) : null
  const explicitRange =
    extractDateRangeFromText(fileName ?? '') ?? extractDateRangeFromText(metadataText)
  const timekeepingRange = buildPeriodRange(explicitRange?.startIso ?? null, explicitRange?.endIso ?? null)
  const reportRange = buildPeriodRange(periodStart, periodEnd)

  if (!periodStart || !periodEnd) {
    return {
      severity: timeframeLabel ? ('info' as const) : null,
      note: timeframeLabel
        ? `Timekeeping export timeframe: ${timeframeLabel}. Reporting period dates were unavailable, so alignment was not validated.`
        : null,
      timekeepingRange,
      reportRange,
      mismatchDetected: false,
    }
  }

  const reportLabel = describePeriod(periodStart, periodEnd)

  if (explicitRange) {
    const timekeepingLabel = describePeriod(explicitRange.startIso, explicitRange.endIso)
    if (explicitRange.startIso === periodStart && explicitRange.endIso === periodEnd) {
      return {
        severity: 'info' as const,
        note: `Timekeeping period aligned to the reporting window (${timekeepingLabel}).`,
        timekeepingRange,
        reportRange,
        mismatchDetected: false,
      }
    }

    return {
      severity: 'warning' as const,
      note: `Timekeeping export covers ${timekeepingLabel}, but the report period is ${reportLabel}. Hours were still applied as uploaded.`,
      timekeepingRange,
      reportRange,
      mismatchDetected: true,
    }
  }

  const reportDays = dayDiffInclusive(periodStart, periodEnd)
  const shortWindow = reportDays !== null && reportDays <= 21

  if (timeframeLabel && /current pay period/i.test(timeframeLabel)) {
    if (shortWindow) {
      return {
        severity: 'info' as const,
        note: `Timekeeping export is labeled "${timeframeLabel}" and was accepted for the short ${reportDays}-day report window.`,
        timekeepingRange,
        reportRange,
        mismatchDetected: false,
      }
    }

    return {
      severity: 'warning' as const,
      note: `Timekeeping export is labeled "${timeframeLabel}", but the report period spans ${reportLabel}. Hours were still applied as uploaded.`,
      timekeepingRange,
      reportRange,
      mismatchDetected: true,
    }
  }

  if (shortWindow) {
    return {
      severity: 'info' as const,
      note: 'Timekeeping period could not be verified explicitly, but the short report window was allowed.',
      timekeepingRange,
      reportRange,
      mismatchDetected: false,
    }
  }

  return {
    severity: 'warning' as const,
    note: `Timekeeping period could not be verified against the ${reportLabel} reporting window. Hours were still applied as uploaded.`,
    timekeepingRange,
    reportRange,
    mismatchDetected: false,
  }
}

const readTimekeepingRows = (
  buffer: ArrayBuffer,
  fileName?: string | null,
  periodStart?: string | null,
  periodEnd?: string | null,
) => {
  const detected = readSheetWithDetectedHeader(buffer, TIMEKEEPING_REQUIRED_COLUMNS)
  const firstRow = detected?.rows[0]
  if (!detected || !firstRow) {
    throw new Error(
      'No data rows found in the timekeeping workbook. Expected a Pay Code Totals export.',
    )
  }

  const missing = TIMEKEEPING_REQUIRED_COLUMNS.filter((column) => !(column in firstRow))
  if (missing.length) {
    throw new Error(`Timekeeping workbook is missing required columns: ${missing.join(', ')}`)
  }

  const availableWorkedHourColumns = TIMEKEEPING_WORKED_HOUR_COLUMNS.filter(
    (column) => column in firstRow,
  )
  if (!availableWorkedHourColumns.length) {
    throw new Error(
      `Timekeeping workbook is missing work-hour columns. Expected one or more of: ${TIMEKEEPING_WORKED_HOUR_COLUMNS.join(', ')}`,
    )
  }

  const alignment = assessTimekeepingAlignment({
    rawRows: detected.rawRows,
    headerRowIndex: detected.headerRowIndex,
    fileName,
    periodStart,
    periodEnd,
  })

  return {
    rows: detected.rows,
    availableWorkedHourColumns,
    alignment,
  }
}

const buildTimekeepingHours = (
  buffer: ArrayBuffer,
  byUserId: Map<string, ProductivitySeed>,
  byNameKey: Map<string, string | null>,
  fileName?: string | null,
  periodStart?: string | null,
  periodEnd?: string | null,
): TimekeepingImportResult => {
  const { rows, availableWorkedHourColumns, alignment } = readTimekeepingRows(
    buffer,
    fileName,
    periodStart,
    periodEnd,
  )

  const hoursByUserId = new Map<string, number>()
  const contextByUserId = new Map<string, TimekeepingContext>()
  const unmatchedNames = new Set<string>()
  let matchedById = 0
  let matchedByName = 0
  let matchedByAlias = 0

  for (const row of rows) {
    const employeeId = String(row['Employee ID'] ?? '').trim()
    const employeeName = normalizeWhitespace(String(row['Employee Name'] ?? ''))

    let matchedUserId: string | null = null
    if (employeeId && byUserId.has(employeeId)) {
      matchedUserId = employeeId
      matchedById += 1
    } else if (employeeName) {
      const match = matchUserByName(byNameKey, employeeName)
      if (match) {
        matchedUserId = match.userId
        if (match.via === 'alias') {
          matchedByAlias += 1
        } else {
          matchedByName += 1
        }
      }
    }

    if (!matchedUserId) {
      if (employeeName) {
        unmatchedNames.add(employeeName)
      }
      continue
    }

    const workedHours = availableWorkedHourColumns.reduce((sum, column) => sum + toNumber(row[column]), 0)

    hoursByUserId.set(matchedUserId, (hoursByUserId.get(matchedUserId) ?? 0) + workedHours)

    const context = contextByUserId.get(matchedUserId) ?? {
      ptoHours: 0,
      unpaidHours: 0,
      onCallHours: 0,
      overtimeHours: 0,
    }
    context.ptoHours += toNumber(row.PTO) + toNumber(row['PTO-SUPP'])
    context.unpaidHours += toNumber(row.UnPaid)
    context.onCallHours += toNumber(row['ON-CALL'])
    context.overtimeHours += toNumber(row['All Overtime'])
    contextByUserId.set(matchedUserId, context)
  }

  const usersWithWorkedHours = [...hoursByUserId.values()].filter((value) => value > 0).length

  return {
    applied: true,
    alignmentSeverity: alignment.severity,
    alignmentNote: alignment.note,
    workedHourColumns: availableWorkedHourColumns,
    timekeepingRange: alignment.timekeepingRange,
    reportRange: alignment.reportRange,
    mismatchDetected: alignment.mismatchDetected,
    hoursByUserId,
    contextByUserId,
    matchedById,
    matchedByName,
    matchedByAlias,
    unmatchedNames,
    usersWithWorkedHours,
  }
}

const buildQualityStats = (
  workbook: XLSX.WorkBook,
  byNameKey: Map<string, string | null>,
  periodStart?: string | null,
  periodEnd?: string | null,
): QualityImportResult => {
  const hasSupportedSheets =
    QUALITY_EVENT_SHEET_NAMES.some((sheetName) => workbook.SheetNames.includes(sheetName)) ||
    workbook.SheetNames.includes(QUALITY_AUDIT_SHEET_NAME)

  if (!hasSupportedSheets) {
    throw new Error('Quality workbook does not contain the expected event or audit sheets.')
  }

  const statsByUserId = new Map<string, QualityUserStats>()
  const unmatchedNames = new Set<string>()
  let matchedIncidentAssignments = 0
  let matchedAuditChecks = 0
  let matchedAuditFails = 0
  let matchedCoachingRows = 0
  let aliasMatches = 0

  for (const sheetName of QUALITY_EVENT_SHEET_NAMES) {
    if (!workbook.SheetNames.includes(sheetName)) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
      defval: '',
    })

    for (const row of rows) {
      const occurredValue = row.Occurred || row.Reported
      if (!isWithinPeriod(occurredValue, periodStart, periodEnd)) continue

      const matchedInRow = new Set<string>()
      for (const entry of parseAccountableEntries(row.Accountable)) {
        const bucket = mapResponsibilityToBucket(entry.roleLabel)
        if (!bucket) continue
        const match = matchUserByName(byNameKey, entry.name)
        if (!match) {
          unmatchedNames.add(entry.name)
          continue
        }
        if (match.via === 'alias') aliasMatches += 1

        const dedupeKey = `${match.userId}:${bucket}`
        if (matchedInRow.has(dedupeKey)) continue
        matchedInRow.add(dedupeKey)

        const stats = getOrCreateQualityStats(statsByUserId, match.userId)
        stats.incidents[bucket] += 1
        matchedIncidentAssignments += 1
      }
    }
  }

  if (workbook.SheetNames.includes(QUALITY_AUDIT_SHEET_NAME)) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[QUALITY_AUDIT_SHEET_NAME],
      { defval: '' },
    )

    for (const row of rows) {
      if (!isWithinPeriod(row.Audited, periodStart, periodEnd)) continue
      const status = normalizeWhitespace(String(row.Status ?? '')).toLowerCase()
      const isFail = status === 'fail' || status === 'failed'
      const matchedInRow = new Set<string>()

      for (const entry of parseAccountableEntries(row.Accountable)) {
        const bucket = mapResponsibilityToBucket(entry.roleLabel)
        if (!bucket) continue
        const match = matchUserByName(byNameKey, entry.name)
        if (!match) {
          unmatchedNames.add(entry.name)
          continue
        }
        if (match.via === 'alias') aliasMatches += 1

        const dedupeKey = `${match.userId}:${bucket}`
        if (matchedInRow.has(dedupeKey)) continue
        matchedInRow.add(dedupeKey)

        const stats = getOrCreateQualityStats(statsByUserId, match.userId)
        stats.auditChecks[bucket] += 1
        matchedAuditChecks += 1
        if (isFail) {
          stats.auditFails[bucket] += 1
          matchedAuditFails += 1
        }
      }
    }
  }

  if (workbook.SheetNames.includes(QUALITY_COACHING_SHEET_NAME)) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[QUALITY_COACHING_SHEET_NAME],
      { defval: '' },
    )

    for (const row of rows) {
      if (!isWithinPeriod(row.CoachingOccurred, periodStart, periodEnd)) continue
      const coachedUser = normalizeWhitespace(String(row.CoachedUser ?? ''))
      if (!coachedUser) continue

      const match = matchUserByName(byNameKey, coachedUser)
      if (!match) {
        unmatchedNames.add(coachedUser)
        continue
      }
      if (match.via === 'alias') aliasMatches += 1

      const stats = getOrCreateQualityStats(statsByUserId, match.userId)
      stats.coachingCount += 1
      matchedCoachingRows += 1
    }
  }

  return {
    statsByUserId,
    matchedIncidentAssignments,
    matchedAuditChecks,
    matchedAuditFails,
    matchedCoachingRows,
    aliasMatches,
    unmatchedNames,
  }
}

const buildQualityOpportunities = (row: Record<string, unknown>): BucketCountMap => ({
  decon: toNumber(row['Decon Scans']) + toNumber(row['Sink Trays']),
  assembly: toNumber(row['Assembled Trays']) + toNumber(row['Assembled Packs']),
  sterilize: toNumber(row['Sterilizer Loads']),
  deliver: toNumber(row['Deliver Scans']),
})

const clampRate = (value: number) => Math.max(0, Math.min(1, value))

const calculateDefectRate = (
  row: Record<string, unknown>,
  stats?: QualityUserStats,
) => {
  if (!stats) return 0

  const opportunities = buildQualityOpportunities(row)
  const bucketRates: Array<{ rate: number; weight: number }> = []

  for (const bucket of Object.keys(opportunities) as QualityBucket[]) {
    const incidents = stats.incidents[bucket]
    const opportunity = opportunities[bucket]
    const hasSignal = incidents > 0 || opportunity > 0
    if (!hasSignal) continue

    const incidentRate = clampRate(incidents / Math.max(opportunity, 1))
    const weight = Math.max(opportunity, incidents > 0 ? 1 : 0)
    bucketRates.push({ rate: incidentRate, weight })
  }

  if (!bucketRates.length) return 0

  const totalWeight = bucketRates.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return 0

  return bucketRates.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeight
}

const formatSampleReviewNote = (label: string, names: Set<string>, limit = 5) => {
  if (!names.size) return null
  const list = [...names].slice(0, limit)
  const suffix = names.size > limit ? ` (+${names.size - limit} more)` : ''
  return `Review unmatched ${label} names: ${list.join('; ')}${suffix}.`
}

export const buildRowsFromSeparateSpdUploads = ({
  productivityBuffer,
  qualityBuffer,
  timecardsBuffer,
  timecardsFileName,
  periodStart,
  periodEnd,
  mismatchMode = 'raw',
}: SeparateSpdImportArgs): SeparateSpdImportResult => {
  const sourcePeriodRange = buildPeriodRange(periodStart, periodEnd)
  const productivityRows = readFirstSheetRows(productivityBuffer)
  if (!productivityRows.length) {
    throw new Error('No data rows found in the productivity workbook.')
  }

  const seeds = buildProductivitySeeds(productivityRows)
  const { byUserId, byNameKey } = buildUserLookups(seeds)

  const timekeeping =
    timecardsBuffer && timecardsBuffer.byteLength > 0
      ? buildTimekeepingHours(
          timecardsBuffer,
          byUserId,
          byNameKey,
          timecardsFileName,
          periodStart,
          periodEnd,
        )
      : null

  const canAlignWindow = Boolean(
    timekeeping?.mismatchDetected &&
      timekeeping.timekeepingRange.startIso &&
      timekeeping.timekeepingRange.endIso,
  )
  const analysisMode: ImportMode =
    canAlignWindow && mismatchMode === 'timekeepingAligned' ? 'timekeepingAligned' : 'raw'
  const effectivePeriodRange =
    analysisMode === 'timekeepingAligned' && timekeeping
      ? timekeeping.timekeepingRange
      : sourcePeriodRange

  const productivitySourceDays =
    periodStart && periodEnd ? dayDiffInclusive(periodStart, periodEnd) : null
  const productivityIntersection =
    analysisMode === 'timekeepingAligned' &&
    periodStart &&
    periodEnd &&
    effectivePeriodRange.startIso &&
    effectivePeriodRange.endIso
      ? intersectRanges(
          periodStart,
          periodEnd,
          effectivePeriodRange.startIso,
          effectivePeriodRange.endIso,
        )
      : null
  const productivityScaledDays =
    analysisMode === 'timekeepingAligned' && productivitySourceDays !== null
      ? productivityIntersection
        ? dayDiffInclusive(productivityIntersection.startIso, productivityIntersection.endIso) ?? 0
        : 0
      : null
  const productivityScaleFactor =
    analysisMode === 'timekeepingAligned' &&
    productivitySourceDays !== null &&
    productivitySourceDays > 0 &&
    productivityScaledDays !== null
      ? productivityScaledDays / productivitySourceDays
      : null

  const qualityWorkbook = readWorkbook(qualityBuffer)
  const quality = buildQualityStats(
    qualityWorkbook,
    byNameKey,
    effectivePeriodRange.startIso ?? periodStart,
    effectivePeriodRange.endIso ?? periodEnd,
  )

  const rows: RawRow[] = seeds.map(({ userId, userName, row }) => {
    const effectiveRow =
      productivityScaleFactor !== null ? scaleProductivityRow(row, productivityScaleFactor) : row
    const qualityStats = quality.statsByUserId.get(userId)
    const timekeepingContext = timekeeping?.contextByUserId.get(userId)
    const auditFailCount = qualityStats
      ? Object.values(qualityStats.auditFails).reduce((sum, value) => sum + value, 0)
      : 0
    const auditCheckCount = qualityStats
      ? Object.values(qualityStats.auditChecks).reduce((sum, value) => sum + value, 0)
      : 0
    const incidentCount = qualityStats
      ? Object.values(qualityStats.incidents).reduce((sum, value) => sum + value, 0)
      : 0

    return {
      'User ID': userId,
      'User Name': userName,
      'Hours Worked': timekeeping?.hoursByUserId.get(userId) ?? 0,
      NumofEvents: incidentCount,
      'Defect Rate': calculateDefectRate(effectiveRow, qualityStats),
      'Decon Scans': toNumber(effectiveRow['Decon Scans']),
      'Sink Inst': toNumber(effectiveRow['Sink Inst']),
      'Sink Trays': toNumber(effectiveRow['Sink Trays']),
      'Assembled Trays': toNumber(effectiveRow['Assembled Trays']),
      'Assembled Packs': toNumber(effectiveRow['Assembled Packs']),
      'Assembled Inst': toNumber(effectiveRow['Assembled Inst']),
      'Assembly Missing Inst': toNumber(effectiveRow['Assembly Missing Inst']),
      'Sterilizer Loads': toNumber(effectiveRow['Sterilizer Loads']),
      'Items Sterilized': toNumber(effectiveRow['Items Sterilized']),
      'Deliver Scans': toNumber(effectiveRow['Deliver Scans']),
      'Activity Count': toNumber(effectiveRow['Activity Count']),
      'Activity Time (Mins)': toNumber(effectiveRow['Activity Time (Mins)']),
      Role: normalizeWhitespace(String(effectiveRow.Role ?? '')),
      'Audit Check Count': auditCheckCount,
      'Audit Fail Count': auditFailCount,
      'Coaching Count': qualityStats?.coachingCount ?? 0,
      'PTO Hours': timekeepingContext?.ptoHours ?? 0,
      'Unpaid Hours': timekeepingContext?.unpaidHours ?? 0,
      'On-Call Hours': timekeepingContext?.onCallHours ?? 0,
      'Overtime Hours': timekeepingContext?.overtimeHours ?? 0,
    }
  })

  const qualitySignalUsers = rows.filter(
    (row) =>
      row.NumofEvents > 0 ||
      toNumber(row['Audit Check Count']) > 0 ||
      toNumber(row['Coaching Count']) > 0,
  ).length

  const notes = [
    `Combined ${rows.length} productivity rows with quality signals for ${qualitySignalUsers} users.`,
    `Quality attribution used ${quality.matchedIncidentAssignments} accountable event assignments, ${quality.matchedAuditChecks} audit checks, and ${quality.matchedCoachingRows} coaching records.`,
  ]

  const analysisModeNote =
    timekeeping && canAlignWindow
      ? analysisMode === 'timekeepingAligned'
        ? `Timekeeping-aligned mode is active. Quality rows were filtered to ${effectivePeriodRange.label}, and productivity summary totals were scaled to that window because the summary export does not contain per-activity dates.`
        : `Raw mode is active. Analysis is using the uploaded productivity and quality windows without timekeeping alignment.`
      : null

  if (analysisModeNote) {
    notes.push(analysisModeNote)
  }

  if (
    analysisMode === 'timekeepingAligned' &&
    productivityScaleFactor !== null &&
    productivitySourceDays !== null &&
    productivityScaledDays !== null
  ) {
    notes.push(
      `Productivity summary totals were scaled to ${productivityScaledDays} of ${productivitySourceDays} source days (${(productivityScaleFactor * 100).toFixed(1)}%) to align with the timekeeping window.`,
    )
  }

  if (quality.aliasMatches > 0) {
    notes.push(`Resolved ${quality.aliasMatches} manual name aliases while mapping the quality workbook.`)
  }

  if (quality.unmatchedNames.size > 0) {
    notes.push(`Skipped ${quality.unmatchedNames.size} unmatched names from the quality workbook.`)
    const reviewNote = formatSampleReviewNote('quality', quality.unmatchedNames)
    if (reviewNote) notes.push(reviewNote)
  }

  if (timekeeping) {
    if (timekeeping.alignmentNote) {
      notes.push(timekeeping.alignmentNote)
    }

    const matchedRows =
      timekeeping.matchedById + timekeeping.matchedByName + timekeeping.matchedByAlias
    if (matchedRows > 0 && timekeeping.usersWithWorkedHours > 0) {
      notes.push(
        `Imported worked hours for ${timekeeping.usersWithWorkedHours} users from ${matchedRows} matched timekeeping rows.`,
      )
      if (timekeeping.matchedById === 0) {
        notes.push('Timekeeping rows were matched by employee name because the source user IDs differ from productivity.')
      }
      if (timekeeping.matchedByAlias > 0) {
        notes.push(
          `Resolved ${timekeeping.matchedByAlias} manual name aliases while mapping the timekeeping workbook.`,
        )
      }
    } else {
      notes.push(
        'No usable worked hours were imported from the timekeeping workbook. Productivity will use total-volume percentiles.',
      )
    }

    if (timekeeping.unmatchedNames.size > 0) {
      notes.push(
        `Skipped ${timekeeping.unmatchedNames.size} unmatched names from the timekeeping workbook.`,
      )
      const reviewNote = formatSampleReviewNote('timekeeping', timekeeping.unmatchedNames)
      if (reviewNote) notes.push(reviewNote)
    }
  } else {
    notes.push('No timecards uploaded. Productivity will use total-volume percentiles.')
  }

  const diagnostics: SeparateSpdImportDiagnostics = {
    quality: {
      usersWithSignals: qualitySignalUsers,
      matchedIncidentAssignments: quality.matchedIncidentAssignments,
      matchedAuditChecks: quality.matchedAuditChecks,
      matchedAuditFails: quality.matchedAuditFails,
      matchedCoachingRows: quality.matchedCoachingRows,
      aliasMatches: quality.aliasMatches,
      unmatchedNames: [...quality.unmatchedNames].sort((a, b) => a.localeCompare(b)),
    },
    timekeeping: timekeeping
      ? {
          provided: true,
          applied: timekeeping.applied,
          alignmentSeverity: timekeeping.alignmentSeverity,
          alignmentNote: timekeeping.alignmentNote,
          workedHourColumns: [...timekeeping.workedHourColumns],
          matchedUsers: timekeeping.hoursByUserId.size,
          usersWithWorkedHours: timekeeping.usersWithWorkedHours,
          matchedById: timekeeping.matchedById,
          matchedByName: timekeeping.matchedByName,
          matchedByAlias: timekeeping.matchedByAlias,
          unmatchedNames: [...timekeeping.unmatchedNames].sort((a, b) => a.localeCompare(b)),
          mismatchDetected: timekeeping.mismatchDetected,
          canAlignWindow,
          analysisMode,
          sourceWindowLabel: timekeeping.reportRange.label,
          timekeepingWindowLabel: timekeeping.timekeepingRange.label,
          analysisWindowLabel: effectivePeriodRange.label,
          qualityWindowApplied: analysisMode === 'timekeepingAligned',
          productivityScaleFactor,
          productivityScaledDays,
          productivitySourceDays,
          analysisModeNote,
        }
      : null,
  }

  return {
    rows,
    hasHoursWorked: timekeeping ? timekeeping.usersWithWorkedHours > 0 : false,
    notes,
    diagnostics,
    periodRange: effectivePeriodRange,
  }
}
