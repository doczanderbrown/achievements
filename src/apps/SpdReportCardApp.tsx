import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ReportCard from '../components/ReportCard'
import {
  buildReport,
  coerceRow,
  DEFAULT_METRICS,
  formatMetricValue,
  REQUIRED_COLUMNS,
} from '../utils/metrics'
import {
  buildRowsFromSeparateSpdUploads,
  type ImportMode,
  type SeparateSpdImportDiagnostics,
} from '../utils/spdImports'
import type { ProcessedReport, RawRow, UserRecord } from '../utils/metrics'

type SortKey = 'overall' | 'productivity' | 'quality' | 'versatility' | 'hoursWorked'
type ViewMode = 'cards' | 'leaderboard' | 'distribution'
type CohortMode = 'production' | 'all'

type LeaderboardOption = {
  key: string
  label: string
  higherBetter: boolean
  type: 'score' | 'pillar' | 'metric'
  getValue: (user: UserRecord) => number
  getPercentile?: (user: UserRecord) => number
}

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'overall', label: 'Overall (Prod + Quality)' },
  { value: 'productivity', label: 'Productivity' },
  { value: 'quality', label: 'Quality' },
  { value: 'versatility', label: 'Versatility' },
  { value: 'hoursWorked', label: 'Hours Worked' },
]

const leaderboardOptions: LeaderboardOption[] = [
  {
    key: 'overall',
    label: 'Overall (Prod + Quality)',
    higherBetter: true,
    type: 'score',
    getValue: (user) => user.scores.overall,
    getPercentile: (user) => user.scores.overallPercentile,
  },
  {
    key: 'productivity',
    label: 'Productivity',
    higherBetter: true,
    type: 'score',
    getValue: (user) => user.scores.productivity,
    getPercentile: (user) => user.scores.productivityPercentile,
  },
  {
    key: 'quality',
    label: 'Quality',
    higherBetter: true,
    type: 'score',
    getValue: (user) => user.scores.quality,
    getPercentile: (user) => user.scores.qualityPercentile,
  },
  {
    key: 'versatility',
    label: 'Versatility',
    higherBetter: true,
    type: 'score',
    getValue: (user) => user.scores.versatility,
    getPercentile: (user) => user.scores.versatilityPercentile,
  },
  {
    key: 'pillar-decon',
    label: 'Decontamination (Total)',
    higherBetter: true,
    type: 'pillar',
    getValue: (user) => user.pillarTotals.decon,
    getPercentile: (user) => user.pillarPercentiles.decon,
  },
  {
    key: 'pillar-assembly',
    label: 'Assembly (Total)',
    higherBetter: true,
    type: 'pillar',
    getValue: (user) => user.pillarTotals.assembly,
    getPercentile: (user) => user.pillarPercentiles.assembly,
  },
  {
    key: 'pillar-sterilize',
    label: 'Sterilization (Total)',
    higherBetter: true,
    type: 'pillar',
    getValue: (user) => user.pillarTotals.sterilize,
    getPercentile: (user) => user.pillarPercentiles.sterilize,
  },
  ...DEFAULT_METRICS.map((metric) => ({
    key: `metric-${metric.key}`,
    label: metric.label,
    higherBetter: metric.higherBetter,
    type: 'metric' as const,
    getValue: (user: UserRecord) => user.metrics[metric.key],
    getPercentile: (user: UserRecord) => user.percentiles[metric.key],
  })),
]

const sanitizeFileName = (value: string) => {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .slice(0, 40)
}

const normalizeDateToken = (value: string) => value.replace(/[./]/g, '-')

const formatFriendlyDate = (value: string) => {
  const normalized = normalizeDateToken(value)
  const [year, month, day] = normalized.split('-').map(Number)
  if (!year || !month || !day) return normalized
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return normalized
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const parseIsoDateToken = (value: string) => {
  const normalized = normalizeDateToken(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const [year, month, day] = normalized.split('-').map(Number)
  if (!year || !month || !day) return null

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return normalized
}

type ReportingPeriodRange = {
  startIso: string | null
  endIso: string | null
  label: string | null
}

const extractReportingPeriodRange = (fileName: string): ReportingPeriodRange => {
  const base = fileName.replace(/\.[^/.]+$/, '')
  const match = base.match(/(\d{4}[./-]\d{2}[./-]\d{2})\s*-\s*(\d{4}[./-]\d{2}[./-]\d{2})/)
  if (!match) {
    return {
      startIso: null,
      endIso: null,
      label: null,
    }
  }

  const startIso = parseIsoDateToken(match[1])
  const endIso = parseIsoDateToken(match[2])
  if (!startIso || !endIso) {
    return {
      startIso: null,
      endIso: null,
      label: null,
    }
  }

  return {
    startIso,
    endIso,
    label: `${formatFriendlyDate(startIso)} – ${formatFriendlyDate(endIso)}`,
  }
}

const formatTrendPeriodLabel = (value: {
  periodLabel?: string | null
  periodStart?: string | null
  periodEnd?: string | null
  uploadedAt?: string | null
}) => {
  if (value.periodLabel) {
    return value.periodLabel
  }

  if (value.periodStart && value.periodEnd) {
    return `${formatFriendlyDate(value.periodStart)} – ${formatFriendlyDate(value.periodEnd)}`
  }

  if (value.uploadedAt) {
    const parsed = new Date(value.uploadedAt)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }
  }

  return 'Unknown period'
}

const getUserKey = (user: UserRecord) => {
  const idPart = user.id ? user.id : 'unknown'
  return `${idPart}-${user.techLabel}`
}

const EXPORT_RENDER_SCALE = 1.35
const EXPORT_YIELD_EVERY = 4
const EXPORT_JPEG_QUALITY = 0.82
const EXPORT_CARD_WIDTH_PX = 1100

const formatOrdinal = (value: number) => {
  const rounded = Math.round(value)
  const mod100 = rounded % 100
  if (mod100 >= 11 && mod100 <= 13) return `${rounded}th`
  switch (rounded % 10) {
    case 1:
      return `${rounded}st`
    case 2:
      return `${rounded}nd`
    case 3:
      return `${rounded}rd`
    default:
      return `${rounded}th`
  }
}

type SpdReportCardAppProps = {
  onBack?: () => void
}

type ExportKind = 'pdf' | 'png'

type ExportProgress = {
  kind: ExportKind
  phase: string
  current: number
  total: number
}

type PersistenceStatus = 'idle' | 'saving' | 'saved' | 'unavailable' | 'error'

type PersistenceState = {
  status: PersistenceStatus
  message: string
  savedAt: string | null
}

type UserTrendPoint = {
  workbookId: number
  periodStart: string | null
  periodEnd: string | null
  periodLabel: string | null
  uploadedAt: string | null
  productivityPercentile: number
  qualityPercentile: number
  overallPercentile: number
  whpu: number
  defectRate: number
  missingInstRate: number
  deconTotal: number
  assemblyTotal: number
  sterilizeTotal: number
}

type SeparateUploadFiles = {
  productivity: File | null
  quality: File | null
  timecards: File | null
}

type LoadedSource = {
  sourceKey: string
  rows: RawRow[]
  hasHoursWorked: boolean
  periodRange: ReportingPeriodRange
  persistenceFileName: string
  baseNotes: string[]
  diagnostics: SeparateSpdImportDiagnostics | null
}

type SourceRowsPayload = {
  rows: RawRow[]
  hasHoursWorked: boolean
  periodRange: ReportingPeriodRange
  notes?: string[]
  diagnostics?: SeparateSpdImportDiagnostics | null
}

type SeparateImportVariants = {
  sourceKey: string
  sourceName: string
  activeMode: ImportMode
  raw: SourceRowsPayload
  timekeepingAligned: SourceRowsPayload | null
}

type DrillSectionTone = 'default' | 'warning' | 'success'

type DrillListGroup = {
  label: string
  items: string[]
  emptyLabel?: string
}

type DrillSection = {
  key: string
  title: string
  summary: string
  tone?: DrillSectionTone
  bullets?: string[]
  groups?: DrillListGroup[]
}

const PRODUCTION_ROLES = new Set([
  'Sterile Supply Tech',
  'Staff',
  'Certified Sterile Supply Tech',
])

const sortLabels = (values: string[]) => [...values].sort((left, right) => left.localeCompare(right))

const getRawRowName = (row: RawRow) => String(row['User Name'] ?? '').trim()

const formatRowWithRole = (row: RawRow) => {
  const name = getRawRowName(row)
  const role = String(row.Role ?? '').trim()
  return role ? `${name} (${role})` : name
}

const formatRoleCountSummary = (rows: RawRow[]) => {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const role = String(row.Role ?? '').trim() || 'Unspecified'
    counts.set(role, (counts.get(role) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1]
      return left[0].localeCompare(right[0])
    })
    .map(([role, count]) => `${role}: ${count}`)
    .join(', ')
}

const SpdReportCardApp = ({ onBack }: SpdReportCardAppProps) => {
  const [report, setReport] = useState<ProcessedReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [importNotes, setImportNotes] = useState<string[]>([])
  const [reportingPeriod, setReportingPeriod] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('overall')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [leaderboardKey, setLeaderboardKey] = useState<string>(leaderboardOptions[0].key)
  const [anonymize, setAnonymize] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [hoursWorkedAvailable, setHoursWorkedAvailable] = useState(true)
  const [persistenceState, setPersistenceState] = useState<PersistenceState>({
    status: 'idle',
    message: 'Upload workbook(s) to save history for cross-device trends.',
    savedAt: null,
  })
  const [trendPoints, setTrendPoints] = useState<UserTrendPoint[]>([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendError, setTrendError] = useState<string | null>(null)
  const [cohortMode, setCohortMode] = useState<CohortMode>('production')
  const [facilityFilter, setFacilityFilter] = useState<string>('')
  const [separateUploads, setSeparateUploads] = useState<SeparateUploadFiles>({
    productivity: null,
    quality: null,
    timecards: null,
  })
  const [separateImportVariants, setSeparateImportVariants] = useState<SeparateImportVariants | null>(
    null,
  )
  const [loadedSource, setLoadedSource] = useState<LoadedSource | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)
  const persistedSourceKeyRef = useRef<string | null>(null)

  const persistWorkbookHistory = async (
    uploadedFileName: string,
    usersToPersist: UserRecord[],
    periodRange: ReportingPeriodRange,
  ) => {
    if (!usersToPersist.length) {
      return
    }

    setPersistenceState({
      status: 'saving',
      message: 'Saving workbook history to shared database...',
      savedAt: null,
    })

    try {
      const payload = {
        sourceFileName: uploadedFileName,
        periodStart: periodRange.startIso,
        periodEnd: periodRange.endIso,
        periodLabel: periodRange.label,
        users: usersToPersist.map((user) => ({
          userId: user.id,
          userName: user.name,
          techLabel: user.techLabel,
          hoursWorked: user.hoursWorked,
          productivity: user.scores.productivity,
          quality: user.scores.quality,
          versatility: user.scores.versatility,
          overall: user.scores.overall,
          productivityPercentile: user.scores.productivityPercentile,
          qualityPercentile: user.scores.qualityPercentile,
          versatilityPercentile: user.scores.versatilityPercentile,
          overallPercentile: user.scores.overallPercentile,
          deconTotal: user.pillarTotals.decon,
          assemblyTotal: user.pillarTotals.assembly,
          sterilizeTotal: user.pillarTotals.sterilize,
          whpu: user.metrics.workedHoursPerUnit,
          defectRate: user.metrics.defectRate,
          missingInstRate: user.metrics.assemblyMissingInst,
        })),
      }

      const response = await fetch('/api/spd-history/workbook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message =
          typeof data?.error === 'string'
            ? data.error
            : `History API returned ${response.status}`
        throw new Error(message)
      }

      setPersistenceState({
        status: 'saved',
        message: periodRange.label
          ? `Saved ${usersToPersist.length} users for ${periodRange.label}.`
          : `Saved ${usersToPersist.length} users.`,
        savedAt: new Date().toISOString(),
      })
    } catch (persistError) {
      const message =
        persistError instanceof Error
          ? persistError.message
          : 'Failed to save workbook history.'
      const unavailable =
        message.includes('not configured') ||
        message.includes('unavailable') ||
        message.includes('503')

      setPersistenceState({
        status: unavailable ? 'unavailable' : 'error',
        message: unavailable
          ? 'Shared history API is unavailable. Upload still loaded locally.'
          : `History save failed: ${message}`,
        savedAt: null,
      })
    }
  }

  const loadUserTrend = async (user: UserRecord) => {
    setTrendLoading(true)
    setTrendError(null)
    setTrendPoints([])

    try {
      const query = new URLSearchParams()
      if (user.id.trim()) {
        query.set('userId', user.id.trim())
      } else {
        query.set('userName', user.name.trim())
      }

      const response = await fetch(`/api/spd-history/user-trend?${query.toString()}`, {
        method: 'GET',
        cache: 'no-store',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message =
          typeof data?.error === 'string'
            ? data.error
            : `History API returned ${response.status}`
        throw new Error(message)
      }

      const data = (await response.json()) as {
        points?: Array<{
          workbookId: number
          periodStart: string | null
          periodEnd: string | null
          periodLabel: string | null
          uploadedAt: string | null
          productivityPercentile: number
          qualityPercentile: number
          overallPercentile: number
          whpu: number
          defectRate: number
          missingInstRate: number
          deconTotal?: number
          assemblyTotal?: number
          sterilizeTotal?: number
        }>
      }

      const parsedPoints: UserTrendPoint[] = Array.isArray(data.points)
        ? data.points.map((point) => ({
            workbookId: Number(point.workbookId),
            periodStart: point.periodStart ?? null,
            periodEnd: point.periodEnd ?? null,
            periodLabel: point.periodLabel ?? null,
            uploadedAt: point.uploadedAt ?? null,
            productivityPercentile: Number(point.productivityPercentile) || 0,
            qualityPercentile: Number(point.qualityPercentile) || 0,
            overallPercentile: Number(point.overallPercentile) || 0,
            whpu: Number(point.whpu) || 0,
            defectRate: Number(point.defectRate) || 0,
            missingInstRate: Number(point.missingInstRate) || 0,
            deconTotal: Number(point.deconTotal) || 0,
            assemblyTotal: Number(point.assemblyTotal) || 0,
            sterilizeTotal: Number(point.sterilizeTotal) || 0,
          }))
        : []

      setTrendPoints(parsedPoints)
    } catch (trendFetchError) {
      const message =
        trendFetchError instanceof Error
          ? trendFetchError.message
          : 'Failed to load user trends.'
      setTrendError(message)
    } finally {
      setTrendLoading(false)
    }
  }

  const resetLoadFailureState = (periodRange: ReportingPeriodRange, message: string) => {
    setSeparateImportVariants(null)
    setLoadedSource(null)
    setReport(null)
    setHoursWorkedAvailable(true)
    setReportingPeriod(periodRange.label)
    setSelectedIds(new Set())
    setImportNotes([])
    setPersistenceState({
      status: 'idle',
      message,
      savedAt: null,
    })
  }

  const loadSourceRows = (
    rows: RawRow[],
    options: {
      hasHoursWorked: boolean
      periodRange: ReportingPeriodRange
      persistenceFileName: string
      notes?: string[]
      diagnostics?: SeparateSpdImportDiagnostics | null
      sourceKey?: string
      resetCohort?: boolean
    },
  ) => {
    if (options.resetCohort !== false) {
      setCohortMode('production')
      setFacilityFilter('')
    }
    setLoadedSource({
      sourceKey: options.sourceKey ?? `${Date.now()}-${options.persistenceFileName}`,
      rows,
      hasHoursWorked: options.hasHoursWorked,
      periodRange: options.periodRange,
      persistenceFileName: options.persistenceFileName,
      baseNotes: options.notes ?? [],
      diagnostics: options.diagnostics ?? null,
    })
  }

  const activateSeparateImportMode = (mode: ImportMode) => {
    if (!separateImportVariants) return

    const nextVariant =
      mode === 'timekeepingAligned'
        ? separateImportVariants.timekeepingAligned
        : separateImportVariants.raw

    if (!nextVariant) return

    setSeparateImportVariants((current) =>
      current
        ? {
            ...current,
            activeMode: mode,
          }
        : current,
    )

    loadSourceRows(nextVariant.rows, {
      hasHoursWorked: nextVariant.hasHoursWorked,
      periodRange: nextVariant.periodRange,
      persistenceFileName: separateImportVariants.sourceName,
      notes: nextVariant.notes,
      diagnostics: nextVariant.diagnostics ?? null,
      sourceKey: separateImportVariants.sourceKey,
      resetCohort: false,
    })
  }

  const roleDataAvailable = useMemo(
    () =>
      loadedSource
        ? loadedSource.rows.some((row) => String(row.Role ?? '').trim() !== '')
        : false,
    [loadedSource],
  )

  const cohortRows = useMemo(() => {
    if (!loadedSource) return []
    if (!roleDataAvailable || cohortMode === 'all') return loadedSource.rows

    const filtered = loadedSource.rows.filter((row) => {
      const role = String(row.Role ?? '').trim()
      return !role || PRODUCTION_ROLES.has(role)
    })

    return filtered.length > 0 ? filtered : loadedSource.rows
  }, [loadedSource, roleDataAvailable, cohortMode])

  const cohortSummary = useMemo(() => {
    if (!loadedSource) return null

    const totalUsers = loadedSource.rows.length
    const visibleUsers = cohortRows.length

    if (!roleDataAvailable) {
      return {
        label: 'All roles',
        detail: 'Role values were not available in this workbook.',
        warning: false,
      }
    }

    if (cohortMode === 'production') {
      return {
        label: `Production roles only (${visibleUsers} of ${totalUsers})`,
        detail: 'Bench-tech cohort excludes managers, educators, coordinators, admin, OR, and leads by default.',
        warning: false,
      }
    }

    return {
      label: `All roles (${visibleUsers} of ${totalUsers})`,
      detail: 'Mixed-role cohorts can skew ranking comparisons.',
      warning: true,
    }
  }, [loadedSource, cohortRows.length, roleDataAvailable, cohortMode])

  useEffect(() => {
    if (!loadedSource) return

    const built = buildReport(cohortRows, { hoursWorkedAvailable: loadedSource.hasHoursWorked })

    setReport(built)
    setHoursWorkedAvailable(loadedSource.hasHoursWorked)
    setReportingPeriod(loadedSource.periodRange.label)
    setSelectedIds(new Set())
    setImportNotes([...loadedSource.baseNotes])

    if (persistedSourceKeyRef.current === loadedSource.sourceKey) return
    persistedSourceKeyRef.current = loadedSource.sourceKey
    void persistWorkbookHistory(
      loadedSource.persistenceFileName,
      built.users,
      loadedSource.periodRange,
    )
  }, [loadedSource, cohortRows, cohortSummary])

  const handleFileUpload = async (file: File | null) => {
    if (!file) return
    const periodRange = extractReportingPeriodRange(file.name)

    setSeparateImportVariants(null)
    setError(null)
    setFileName(file.name)
    setImportNotes([])
    setReportingPeriod(periodRange.label)
    setTrendError(null)
    setTrendPoints([])
    setPersistenceState({
      status: 'idle',
      message: 'Uploading workbook...',
      savedAt: null,
    })

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      })

      if (!rows.length) {
        setError('No data rows found in the workbook.')
        resetLoadFailureState(periodRange, 'Upload workbook(s) to save history for cross-device trends.')
        return
      }

      const hasHoursWorked = 'Hours Worked' in rows[0]

      const missing = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]))
      if (missing.length) {
        setError(`Missing required columns: ${missing.join(', ')}`)
        setReport(null)
        setHoursWorkedAvailable(hasHoursWorked)
        setReportingPeriod(periodRange.label)
        setSelectedIds(new Set())
        setImportNotes([])
        setPersistenceState({
          status: 'idle',
          message: 'Upload workbook(s) to save history for cross-device trends.',
          savedAt: null,
        })
        return
      }

      const coerced = rows.map((row) => coerceRow(row))
      loadSourceRows(coerced, {
        hasHoursWorked,
        periodRange,
        persistenceFileName: file.name,
        diagnostics: null,
      })
    } catch {
      setError('Unable to read the spreadsheet. Please confirm it is a valid .xlsx file.')
      resetLoadFailureState(periodRange, 'Upload workbook(s) to save history for cross-device trends.')
    }
  }

  const handleSeparateUploadChange = (key: keyof SeparateUploadFiles, file: File | null) => {
    setSeparateUploads((current) => ({
      ...current,
      [key]: file,
    }))
  }

  const handleSeparateUploadBuild = async () => {
    if (!separateUploads.productivity) {
      setError('Productivity workbook is required.')
      return
    }

    const periodRange = extractReportingPeriodRange(separateUploads.productivity.name)

    setError(null)
    setSeparateImportVariants(null)
    setFileName(
      [
        separateUploads.productivity.name,
        separateUploads.quality?.name ?? null,
        separateUploads.timecards?.name ?? null,
      ]
        .filter(Boolean)
        .join(' + '),
    )
    setImportNotes([])
    setReportingPeriod(periodRange.label)
    setTrendError(null)
    setTrendPoints([])
    setPersistenceState({
      status: 'idle',
      message: 'Combining uploaded workbooks...',
      savedAt: null,
    })

    try {
      const productivityBuffer = await separateUploads.productivity.arrayBuffer()
      const qualityBuffer = separateUploads.quality
        ? await separateUploads.quality.arrayBuffer()
        : null
      const timecardsBuffer = separateUploads.timecards
        ? await separateUploads.timecards.arrayBuffer()
        : null

      const rawImported = buildRowsFromSeparateSpdUploads({
        productivityBuffer,
        qualityBuffer,
        timecardsBuffer,
        timecardsFileName: separateUploads.timecards?.name ?? null,
        periodStart: periodRange.startIso,
        periodEnd: periodRange.endIso,
        mismatchMode: 'raw',
      })

      const sourceName = [
        'Combined import',
        separateUploads.productivity.name,
        separateUploads.quality?.name ?? null,
        separateUploads.timecards?.name ?? null,
      ]
        .filter(Boolean)
        .join(' | ')

      const sourceKey = `${Date.now()}-${sourceName}`
      const rawVariant: SourceRowsPayload = {
        rows: rawImported.rows,
        hasHoursWorked: rawImported.hasHoursWorked,
        periodRange: rawImported.periodRange,
        notes: rawImported.notes,
        diagnostics: rawImported.diagnostics,
      }

      const canAlignWindow = Boolean(rawImported.diagnostics.timekeeping?.canAlignWindow)
      if (canAlignWindow) {
        const alignedImported = buildRowsFromSeparateSpdUploads({
          productivityBuffer,
          qualityBuffer,
          timecardsBuffer,
          timecardsFileName: separateUploads.timecards?.name ?? null,
          periodStart: periodRange.startIso,
          periodEnd: periodRange.endIso,
          mismatchMode: 'timekeepingAligned',
        })

        const alignedVariant: SourceRowsPayload = {
          rows: alignedImported.rows,
          hasHoursWorked: alignedImported.hasHoursWorked,
          periodRange: alignedImported.periodRange,
          notes: alignedImported.notes,
          diagnostics: alignedImported.diagnostics,
        }

        setSeparateImportVariants({
          sourceKey,
          sourceName,
          activeMode: 'timekeepingAligned',
          raw: rawVariant,
          timekeepingAligned: alignedVariant,
        })

        loadSourceRows(alignedVariant.rows, {
          hasHoursWorked: alignedVariant.hasHoursWorked,
          periodRange: alignedVariant.periodRange,
          persistenceFileName: sourceName,
          notes: alignedVariant.notes,
          diagnostics: alignedVariant.diagnostics ?? null,
          sourceKey,
        })
        return
      }

      setSeparateImportVariants(null)
      loadSourceRows(rawVariant.rows, {
        hasHoursWorked: rawVariant.hasHoursWorked,
        periodRange: rawVariant.periodRange,
        persistenceFileName: sourceName,
        notes: rawVariant.notes,
        diagnostics: rawVariant.diagnostics ?? null,
        sourceKey,
      })
    } catch (separateImportError) {
      const message =
        separateImportError instanceof Error
          ? separateImportError.message
          : 'Unable to combine the uploaded workbooks.'
      setError(message)
      resetLoadFailureState(periodRange, 'Upload workbook(s) to save history for cross-device trends.')
    }
  }

  const availableFacilities = useMemo(() => {
    if (!report) return []
    const seen = new Set<string>()
    for (const user of report.users) {
      if (user.facility) seen.add(user.facility)
    }
    return [...seen].sort()
  }, [report])

  const filteredUsers = useMemo(() => {
    if (!report) return []
    const query = search.trim().toLowerCase()
    let users = [...report.users]
    if (facilityFilter) {
      users = users.filter((user) => user.facility === facilityFilter)
    }
    if (query) {
      users = users.filter((user) => {
        return (
          user.name.toLowerCase().includes(query) ||
          user.techLabel.toLowerCase().includes(query) ||
          user.id.toLowerCase().includes(query)
        )
      })
    }
    if (viewMode === 'cards') {
      users.sort((a, b) => {
        switch (sortKey) {
          case 'overall':
            return b.scores.overall - a.scores.overall
          case 'quality':
            return b.scores.quality - a.scores.quality
          case 'versatility':
            return b.scores.versatility - a.scores.versatility
          case 'hoursWorked':
            return b.hoursWorked - a.hoursWorked
          default:
            return b.scores.productivity - a.scores.productivity
        }
      })
    }
    return users
  }, [report, search, sortKey, viewMode])

  const getExportCardMap = () => {
    const cards = Array.from(
      exportRef.current?.querySelectorAll<HTMLElement>('[data-report-card]') ?? [],
    )
    const cardMap = new Map<string, HTMLElement>()
    cards.forEach((card) => {
      const key = card.dataset.reportCardKey
      if (key) {
        cardMap.set(key, card)
      }
    })
    return cardMap
  }

  const renderCardCanvas = (card: HTMLElement) =>
    html2canvas(card, {
      scale: EXPORT_RENDER_SCALE,
      backgroundColor: '#ffffff',
      logging: false,
    })

  const renderCardJpegBlob = async (card: HTMLElement) => {
    const canvas = await renderCardCanvas(card)
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', EXPORT_JPEG_QUALITY),
      )
      return blob
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }

  const triggerBlobDownload = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const isPdfApiAvailable = async () => {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 1500)
    try {
      const response = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      return response.ok
    } catch {
      return false
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  const exportCardsToPdfServer = async (users: UserRecord[], cardMap: Map<string, HTMLElement>) => {
    const formData = new FormData()
    formData.append('filename', 'report-cards.pdf')
    let imageCount = 0

    for (let i = 0; i < users.length; i += 1) {
      const user = users[i]
      const key = getUserKey(user)
      const card = cardMap.get(key)
      setExportProgress({
        kind: 'pdf',
        phase: 'Rendering cards',
        current: i + 1,
        total: users.length,
      })
      if (!card) continue

      const blob = await renderCardJpegBlob(card)
      if (!blob) continue
      imageCount += 1
      formData.append('cards', blob, `report-card-${imageCount}.jpg`)

      if ((i + 1) % EXPORT_YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }

    if (imageCount === 0) return false

    setExportProgress({
      kind: 'pdf',
      phase: 'Generating PDF on server',
      current: users.length,
      total: users.length,
    })

    const response = await fetch('/api/report-cards/pdf', {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      throw new Error(`PDF API returned ${response.status}`)
    }

    setExportProgress({
      kind: 'pdf',
      phase: 'Downloading PDF',
      current: users.length,
      total: users.length,
    })

    const pdfBlob = await response.blob()
    triggerBlobDownload(pdfBlob, 'report-cards.pdf')
    return true
  }

  const exportCardsToPdfClient = async (users: UserRecord[], cardMap: Map<string, HTMLElement>) => {
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 16
    const maxWidth = pageWidth - margin * 2
    const maxHeight = pageHeight - margin * 2

    let pageCount = 0

    for (let i = 0; i < users.length; i += 1) {
      const user = users[i]
      const key = getUserKey(user)
      const card = cardMap.get(key)
      setExportProgress({
        kind: 'pdf',
        phase: 'Building PDF in browser',
        current: i + 1,
        total: users.length,
      })
      if (!card) continue

      const canvas = await renderCardCanvas(card)
      try {
        const aspect = canvas.height / canvas.width
        let renderWidth = maxWidth
        let renderHeight = renderWidth * aspect
        if (renderHeight > maxHeight) {
          renderHeight = maxHeight
          renderWidth = renderHeight / aspect
        }

        if (pageCount > 0) {
          pdf.addPage()
        }

        const x = (pageWidth - renderWidth) / 2
        const y = (pageHeight - renderHeight) / 2
        pdf.addImage(canvas, 'JPEG', x, y, renderWidth, renderHeight, undefined, 'FAST')
        pageCount += 1
      } finally {
        canvas.width = 0
        canvas.height = 0
      }

      if ((i + 1) % EXPORT_YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    }

    if (pageCount > 0) {
      setExportProgress({
        kind: 'pdf',
        phase: 'Finalizing PDF',
        current: users.length,
        total: users.length,
      })
      pdf.save('report-cards.pdf')
    }
  }

  const exportCardsToPng = async (users: UserRecord[]) => {
    if (!users.length) return
    setExporting(true)
    setExportProgress({ kind: 'png', phase: 'Rendering PNGs', current: 0, total: users.length })
    try {
      const cardMap = getExportCardMap()
      for (let i = 0; i < users.length; i += 1) {
        const user = users[i]
        const key = getUserKey(user)
        const card = cardMap.get(key)
        setExportProgress({
          kind: 'png',
          phase: 'Rendering PNGs',
          current: i + 1,
          total: users.length,
        })
        if (!card) continue
        const canvas = await html2canvas(card, { scale: 2, backgroundColor: '#ffffff' })
        const link = document.createElement('a')
        const label = anonymize ? user.techLabel : user.name
        link.download = `${sanitizeFileName(label || `report-${i + 1}`)}.png`
        link.href = canvas.toDataURL('image/png')
        link.click()
      }
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const exportCardsToPdf = async (users: UserRecord[]) => {
    if (!users.length || exporting) return
    setExporting(true)
    setExportProgress({
      kind: 'pdf',
      phase: 'Checking export service',
      current: 0,
      total: users.length,
    })
    try {
      await document.fonts.ready
      const cardMap = getExportCardMap()
      const canUsePdfApi = await isPdfApiAvailable()

      if (canUsePdfApi) {
        try {
          const exportedByApi = await exportCardsToPdfServer(users, cardMap)
          if (exportedByApi) return
        } catch {
          // Fall back to browser-generated PDF when API export fails.
        }
      }

      await exportCardsToPdfClient(users, cardMap)
    } catch {
      setError('PDF export failed. Try reducing the selection or exporting PNG files.')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const users = filteredUsers
  const visibleSortOptions = useMemo(
    () =>
      hoursWorkedAvailable
        ? sortOptions
        : sortOptions.filter((option) => option.value !== 'hoursWorked'),
    [hoursWorkedAvailable],
  )
  const visibleLeaderboardOptions = useMemo(
    () =>
      hoursWorkedAvailable
        ? leaderboardOptions
        : leaderboardOptions.filter((option) => option.key !== 'metric-workedHoursPerUnit'),
    [hoursWorkedAvailable],
  )
  const selectedUsers = useMemo(
    () => (report ? report.users.filter((user) => selectedIds.has(getUserKey(user))) : []),
    [report, selectedIds],
  )
  const drillSections = useMemo<DrillSection[]>(() => {
    const sections: DrillSection[] = []

    if (loadedSource) {
      const visibleKeys = new Set(
        cohortRows.map((row) => `${String(row['User ID'] ?? '').trim()}::${getRawRowName(row)}`),
      )
      const shownRows = sortLabels(cohortRows.map(formatRowWithRole).filter(Boolean))
      const hiddenRows = sortLabels(
        loadedSource.rows
          .filter(
            (row) =>
              !visibleKeys.has(`${String(row['User ID'] ?? '').trim()}::${getRawRowName(row)}`),
          )
          .map(formatRowWithRole)
          .filter(Boolean),
      )

      sections.push({
        key: 'cohort',
        title: 'Cohort',
        summary: cohortSummary
          ? cohortSummary.label
          : `All users (${cohortRows.length} of ${loadedSource.rows.length})`,
        tone: cohortSummary?.warning ? 'warning' : 'default',
        bullets: [
          cohortSummary?.detail,
          roleDataAvailable ? `Role mix in source: ${formatRoleCountSummary(loadedSource.rows)}.` : null,
        ].filter(Boolean) as string[],
        groups: [
          {
            label: `Shown in current cohort (${shownRows.length})`,
            items: shownRows,
            emptyLabel: 'No users are currently shown in the active cohort.',
          },
          {
            label: `Not shown in current cohort (${hiddenRows.length})`,
            items: hiddenRows,
            emptyLabel: 'No users are hidden by the current cohort filter.',
          },
        ],
      })

      const qualitySignalRows = loadedSource.rows.filter((row) => {
        const incidents = Number(row.NumofEvents ?? 0)
        const coaching = Number(row['Coaching Count'] ?? 0)
        return incidents > 0 || coaching > 0
      })
      const qualityNoSignalRows = loadedSource.rows.filter((row) => !qualitySignalRows.includes(row))
      const qualityDiagnostics = loadedSource.diagnostics?.quality ?? null

      sections.push({
        key: 'quality',
        title: 'Quality',
        summary: `Signals for ${qualitySignalRows.length} of ${loadedSource.rows.length} users`,
        tone:
          qualityDiagnostics && qualityDiagnostics.unmatchedNames.length > 0
            ? 'warning'
            : qualitySignalRows.length > 0
              ? 'success'
              : 'default',
        bullets: qualityDiagnostics
          ? [
              `Event assignments matched: ${qualityDiagnostics.matchedIncidentAssignments}.`,
              `Coaching rows matched: ${qualityDiagnostics.matchedCoachingRows}.`,
              qualityDiagnostics.aliasMatches > 0
                ? `Manual quality aliases resolved: ${qualityDiagnostics.aliasMatches}.`
                : null,
            ].filter(Boolean) as string[]
          : ['No quality workbook uploaded — defect rates are 0 for all users.'],
        groups: [
          {
            label: `Users with quality signals (${qualitySignalRows.length})`,
            items: sortLabels(qualitySignalRows.map((row) => getRawRowName(row)).filter(Boolean)),
            emptyLabel: 'No users have quality signals in the loaded rows.',
          },
          {
            label: `Users with no quality signals (${qualityNoSignalRows.length})`,
            items: sortLabels(qualityNoSignalRows.map((row) => getRawRowName(row)).filter(Boolean)),
            emptyLabel: 'Every loaded user has at least one quality signal.',
          },
          {
            label: `Unmatched quality names (${qualityDiagnostics?.unmatchedNames.length ?? 0})`,
            items: qualityDiagnostics?.unmatchedNames ?? [],
            emptyLabel: 'Every quality name matched to a productivity user.',
          },
        ],
      })

      const timekeepingDiagnostics = loadedSource.diagnostics?.timekeeping ?? null
      const rowsWithWorkedHours = loadedSource.rows.filter(
        (row) => Number(row['Hours Worked'] ?? 0) > 0,
      )
      const rowsWithoutWorkedHours = loadedSource.rows.filter(
        (row) => Number(row['Hours Worked'] ?? 0) <= 0,
      )

      if (timekeepingDiagnostics) {
        const timekeepingBullets = [
          timekeepingDiagnostics.alignmentNote,
          timekeepingDiagnostics.analysisModeNote,
          timekeepingDiagnostics.workedHourColumns.length > 0
            ? `Worked-hour columns used: ${timekeepingDiagnostics.workedHourColumns.join(', ')}.`
            : null,
          timekeepingDiagnostics.timekeepingWindowLabel
            ? `Timekeeping window: ${timekeepingDiagnostics.timekeepingWindowLabel}.`
            : null,
          timekeepingDiagnostics.sourceWindowLabel
            ? `Uploaded source window: ${timekeepingDiagnostics.sourceWindowLabel}.`
            : null,
          `Matched users: ${timekeepingDiagnostics.matchedUsers}. By ID: ${timekeepingDiagnostics.matchedById}, by name: ${timekeepingDiagnostics.matchedByName}, by alias: ${timekeepingDiagnostics.matchedByAlias}.`,
          timekeepingDiagnostics.productivityScaleFactor !== null &&
          timekeepingDiagnostics.productivityScaledDays !== null &&
          timekeepingDiagnostics.productivitySourceDays !== null
            ? `Productivity scaling: ${timekeepingDiagnostics.productivityScaledDays} of ${timekeepingDiagnostics.productivitySourceDays} source days (${(timekeepingDiagnostics.productivityScaleFactor * 100).toFixed(1)}%).`
            : null,
        ].filter(Boolean) as string[]

        sections.push({
          key: 'timekeeping',
          title: 'Timekeeping',
          summary:
            timekeepingDiagnostics.analysisMode === 'timekeepingAligned' &&
            timekeepingDiagnostics.analysisWindowLabel
              ? `Aligned to ${timekeepingDiagnostics.analysisWindowLabel}`
              : timekeepingDiagnostics.usersWithWorkedHours > 0
              ? timekeepingDiagnostics.alignmentSeverity === 'warning'
                ? `Applied worked hours for ${timekeepingDiagnostics.usersWithWorkedHours} users with a timeframe warning`
                : `Applied worked hours for ${timekeepingDiagnostics.usersWithWorkedHours} users`
              : 'No worked hours were applied',
          tone:
            timekeepingDiagnostics.alignmentSeverity === 'warning'
              ? 'warning'
              : timekeepingDiagnostics.usersWithWorkedHours > 0
                ? 'success'
                : 'default',
          bullets: timekeepingBullets,
          groups: [
            {
              label: `Users with worked hours (${rowsWithWorkedHours.length})`,
              items: sortLabels(rowsWithWorkedHours.map((row) => getRawRowName(row)).filter(Boolean)),
              emptyLabel: 'No loaded users received worked hours from the timekeeping workbook.',
            },
            {
              label: `Users without worked hours (${rowsWithoutWorkedHours.length})`,
              items: sortLabels(
                rowsWithoutWorkedHours.map((row) => getRawRowName(row)).filter(Boolean),
              ),
              emptyLabel: 'Every loaded user has worked hours.',
            },
            {
              label: `Unmatched timekeeping names (${timekeepingDiagnostics.unmatchedNames.length})`,
              items: timekeepingDiagnostics.unmatchedNames,
              emptyLabel: 'Every timekeeping name matched to a productivity user.',
            },
          ],
        })
      } else {
        sections.push({
          key: 'timekeeping',
          title: 'Timekeeping',
          summary: loadedSource.hasHoursWorked
            ? `Hours available for ${rowsWithWorkedHours.length} users`
            : 'No timekeeping context was uploaded',
          tone: loadedSource.hasHoursWorked ? 'success' : 'default',
          bullets: [
            loadedSource.hasHoursWorked
              ? 'Worked hours came from the loaded workbook and were accepted as-is.'
              : 'No separate timekeeping workbook was provided for this run.',
          ],
          groups: loadedSource.hasHoursWorked
            ? [
                {
                  label: `Users with worked hours (${rowsWithWorkedHours.length})`,
                  items: sortLabels(
                    rowsWithWorkedHours.map((row) => getRawRowName(row)).filter(Boolean),
                  ),
                  emptyLabel: 'No loaded users have worked hours.',
                },
                {
                  label: `Users without worked hours (${rowsWithoutWorkedHours.length})`,
                  items: sortLabels(
                    rowsWithoutWorkedHours.map((row) => getRawRowName(row)).filter(Boolean),
                  ),
                  emptyLabel: 'Every loaded user has worked hours.',
                },
              ]
            : undefined,
        })
      }
    }

    if (report) {
      if (!hoursWorkedAvailable) {
        sections.push({
          key: 'productivity-ranking',
          title: 'Productivity Ranking',
          summary: 'Total-volume ranking only',
          tone: 'warning',
          bullets: [
            'Hours Worked was unavailable, so productivity percentiles are based on total volume instead of per-hour output.',
          ],
          groups: [
            {
              label: `Users compared in productivity ranking (${report.users.length})`,
              items: sortLabels(report.users.map((user) => user.name).filter(Boolean)),
              emptyLabel: 'No users are available for productivity comparison.',
            },
          ],
        })
      } else {
        const includedUsers = sortLabels(
          report.users
            .filter((user) => user.productivityRanked)
            .map((user) => user.name)
            .filter(Boolean),
        )
        const excludedUsers = sortLabels(
          report.users
            .filter((user) => !user.productivityRanked)
            .map((user) => user.name)
            .filter(Boolean),
        )

        sections.push({
          key: 'productivity-ranking',
          title: 'Productivity Ranking',
          summary: excludedUsers.length
            ? `Peer-ranked: ${includedUsers.length}; excluded: ${excludedUsers.length}`
            : `All ${includedUsers.length} users are in the per-hour peer set`,
          tone: excludedUsers.length ? 'warning' : 'success',
          bullets: [
            excludedUsers.length
              ? 'Users with missing or zero Hours Worked stay on report cards but are omitted from per-hour peer ranking.'
              : 'Every visible user had usable worked hours for per-hour peer comparison.',
          ],
          groups: [
            {
              label: `Included in peer ranking (${includedUsers.length})`,
              items: includedUsers,
              emptyLabel: 'No users are currently included in the productivity peer ranking.',
            },
            {
              label: `Not included in peer ranking (${excludedUsers.length})`,
              items: excludedUsers,
              emptyLabel: 'No users are excluded from the productivity peer ranking.',
            },
          ],
        })
      }
    }

    if (importNotes.length > 0) {
      sections.push({
        key: 'import-notes',
        title: 'Import Notes',
        summary: `${importNotes.length} import notes`,
        bullets: importNotes,
      })
    }

    sections.push({
      key: 'history-sync',
      title: 'History Sync',
      summary: persistenceState.savedAt
        ? `${persistenceState.message} (${new Date(persistenceState.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`
        : persistenceState.message,
      tone:
        persistenceState.status === 'saved'
          ? 'success'
          : persistenceState.status === 'error' || persistenceState.status === 'unavailable'
            ? 'warning'
            : 'default',
    })

    return sections
  }, [
    cohortRows,
    cohortSummary,
    hoursWorkedAvailable,
    importNotes,
    loadedSource,
    persistenceState.message,
    persistenceState.savedAt,
    persistenceState.status,
    report,
    roleDataAvailable,
  ])

  const selectedCount = selectedUsers.length
  const trendChartData = useMemo(
    () =>
      trendPoints.map((point, index) => ({
        index: index + 1,
        period: formatTrendPeriodLabel({
          periodLabel: point.periodLabel,
          periodStart: point.periodStart,
          periodEnd: point.periodEnd,
          uploadedAt: point.uploadedAt,
        }),
        productivity: point.productivityPercentile,
        quality: point.qualityPercentile,
        overall: point.overallPercentile,
        deconTotal: point.deconTotal,
        assemblyTotal: point.assemblyTotal,
        sterilizeTotal: point.sterilizeTotal,
      })),
    [trendPoints],
  )

  const trendHasPillarData = useMemo(
    () => trendPoints.some((p) => p.deconTotal > 0 || p.assemblyTotal > 0 || p.sterilizeTotal > 0),
    [trendPoints],
  )
  // Distribution buckets for bell curve view (overall score 0-200)
  const distributionData = useMemo(() => {
    if (!report) return []
    const bucketSize = 20
    const buckets: { label: string; count: number; rangeMin: number; rangeMax: number }[] = []
    for (let start = 0; start < 200; start += bucketSize) {
      buckets.push({ label: `${start}–${start + bucketSize}`, count: 0, rangeMin: start, rangeMax: start + bucketSize })
    }
    for (const user of report.users) {
      const idx = Math.min(Math.floor(user.scores.overall / bucketSize), buckets.length - 1)
      buckets[idx].count += 1
    }
    return buckets
  }, [report])

  const teamAnalytics = useMemo(() => {
    if (!report || !report.users.length) return null
    const users = report.users
    const n = users.length
    const productivityUsers = users.filter((u) => u.productivityRanked)

    const avgQuality = users.reduce((s, u) => s + u.scores.qualityPercentile, 0) / n
    const avgProductivity = productivityUsers.length
      ? productivityUsers.reduce((s, u) => s + u.scores.productivityPercentile, 0) /
        productivityUsers.length
      : 0
    const aboveMedianQuality = users.filter((u) => u.scores.qualityPercentile >= 50).length
    const aboveMedianProd = productivityUsers.filter((u) => u.scores.productivityPercentile >= 50).length
    const prodRanked = productivityUsers.length

    const weakestPillarCounts = { decon: 0, assembly: 0, sterilize: 0 }
    for (const u of users) {
      const min = Math.min(u.pillarPercentiles.decon, u.pillarPercentiles.assembly, u.pillarPercentiles.sterilize)
      if (u.pillarPercentiles.decon === min) weakestPillarCounts.decon += 1
      else if (u.pillarPercentiles.assembly === min) weakestPillarCounts.assembly += 1
      else weakestPillarCounts.sterilize += 1
    }
    const weakestPillar = Object.entries(weakestPillarCounts).sort((a, b) => b[1] - a[1])[0][0]
    const weakestPillarLabel = weakestPillar === 'decon' ? 'Decontamination' : weakestPillar === 'assembly' ? 'Assembly' : 'Sterilize'

    const archetypeCounts: Record<string, number> = {}
    for (const u of users) {
      archetypeCounts[u.archetype.label] = (archetypeCounts[u.archetype.label] ?? 0) + 1
    }

    return {
      n,
      avgQuality: Math.round(avgQuality),
      avgProductivity: Math.round(avgProductivity),
      aboveMedianQualityPct: Math.round((aboveMedianQuality / n) * 100),
      aboveMedianProdPct: prodRanked ? Math.round((aboveMedianProd / prodRanked) * 100) : null,
      weakestPillarLabel,
      archetypeCounts,
    }
  }, [report])

  const pdfProgressText =
    exportProgress && exportProgress.kind === 'pdf'
      ? `${exportProgress.phase}${
          exportProgress.total > 0 ? ` (${exportProgress.current}/${exportProgress.total})` : ''
        }`
      : null
  const pngProgressText =
    exportProgress && exportProgress.kind === 'png'
      ? `${exportProgress.phase}${
          exportProgress.total > 0 ? ` (${exportProgress.current}/${exportProgress.total})` : ''
        }`
      : null

  const toggleSelected = (user: UserRecord) => {
    const key = getUserKey(user)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const activeLeaderboard =
    visibleLeaderboardOptions.find((option) => option.key === leaderboardKey) ??
    visibleLeaderboardOptions[0]

  const leaderboardRows = useMemo(() => {
    if (!report) return []
    const sourceUsers =
      activeLeaderboard.key === 'productivity'
        ? users.filter((user) => user.productivityRanked)
        : users
    const rows = sourceUsers.map((user) => ({
      user,
      name: anonymize ? user.techLabel : user.name,
      value: activeLeaderboard.getValue(user),
      percentile: activeLeaderboard.getPercentile
        ? activeLeaderboard.getPercentile(user)
        : null,
    }))
    rows.sort((a, b) =>
      activeLeaderboard.higherBetter ? b.value - a.value : a.value - b.value,
    )
    return rows
  }, [report, users, anonymize, activeLeaderboard])



  const selectAllShown = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      users.forEach((user) => next.add(getUserKey(user)))
      return next
    })
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
  }

  useEffect(() => {
    if (selectedUser) return
    setTrendLoading(false)
    setTrendError(null)
    setTrendPoints([])
  }, [selectedUser])

  useEffect(() => {
    if (!report) return
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      document.documentElement.scrollTop = 0
      document.body.scrollTop = 0
    })
    return () => window.cancelAnimationFrame(frame)
  }, [report])

  useEffect(() => {
    if (!selectedUser) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedUser(null)
      }
    }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [selectedUser])

  useEffect(() => {
    if (!report || !selectedUser) return
    const selectedKey = getUserKey(selectedUser)
    if (!report.users.some((user) => getUserKey(user) === selectedKey)) {
      setSelectedUser(null)
    }
  }, [report, selectedUser])

  useEffect(() => {
    if (visibleLeaderboardOptions.some((option) => option.key === leaderboardKey)) return
    setLeaderboardKey(visibleLeaderboardOptions[0]?.key ?? leaderboardOptions[0].key)
  }, [leaderboardKey, visibleLeaderboardOptions])

  useEffect(() => {
    if (visibleSortOptions.some((option) => option.value === sortKey)) return
    setSortKey(visibleSortOptions[0]?.value ?? 'overall')
  }, [sortKey, visibleSortOptions])

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-32 left-8 h-64 w-64 rounded-full bg-brand/35 blur-3xl" />
      <div className="pointer-events-none absolute top-24 right-10 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-brand/20 blur-[120px]" />

      <main className="relative mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
        <header className="flex flex-col gap-6">
          {onBack ? (
            <div>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center rounded-full border border-ink/20 bg-white/90 px-4 py-2 text-sm font-medium text-ink shadow-sm transition hover:bg-white"
              >
                Back to app suite
              </button>
            </div>
          ) : null}
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Ascendco Analytics</p>
            <h1 className="mt-3 text-balance font-display text-4xl font-semibold text-ink">
              <span className="text-brand">Report card</span> generator
            </h1>
            {!report ? (
              <div className="mt-3 space-y-3 text-base text-muted">
                <p className="max-w-2xl">
                  Required columns:{' '}
                  {REQUIRED_COLUMNS.map((column) => {
                    const replacements: Record<string, string> = {
                      'Decon Scans': 'Decontamination Scans',
                      'Sink Inst': 'Sink Instruments',
                      'Assembled Inst': 'Assembled Instruments',
                      'Assembly Missing Inst': 'Assembly Missing Instruments',
                    }
                    return replacements[column] ?? column
                  }).join(', ')}
                  . Optional: Hours Worked (from your timekeeping system) to enable hours-based
                  standardization.
                </p>
                <div className="rounded-2xl border border-accent/20 bg-white/70 p-4 text-sm text-muted">
                  <div className="font-semibold text-ink">Updates</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    <li>
                      Separate uploads now shape `Productivity`, `Quality`, and `Timecards` into
                      the report engine behind the scenes.
                    </li>
                    <li>
                      Quality now blends accountable event hits, audit checks, audit failures, and
                      coaching records instead of relying on event counts alone.
                    </li>
                    <li>
                      Timekeeping hours now apply even when the timeframe differs. The app throws
                      a warning and keeps the uploaded hours as-is.
                    </li>
                    <li>
                      The default cohort is production roles only, and cards now show role plus
                      timekeeping and quality context.
                    </li>
                  </ul>
                </div>
                <div className="rounded-2xl border border-brand/20 bg-white/70 p-4 text-sm text-muted">
                  <div className="font-semibold text-ink">Pillars</div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">Decontamination</div>
                      <div>Decontamination Scans, Sink Instruments, Sink Trays</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-ink">Assembly</div>
                      <div>Assembled Trays, Assembled Peel Packs, Assembled Instruments</div>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-ink">Sterilize</div>
                      <div>Sterilizer Loads, Items Sterilized, Deliver Scans</div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-accent/20 bg-white/70 p-4 text-sm text-muted">
                  <details>
                    <summary className="cursor-pointer font-semibold text-ink">
                      How the engine works
                    </summary>
                    <div className="mt-2 space-y-3">
                      <p>
                        Scores are peer-relative for the uploaded reporting period. Each user is
                        compared to others in that same file, not to a fixed external benchmark.
                      </p>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Pillar totals
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Decontamination Total = Decon Scans + Sink Inst + Sink Trays
                          </li>
                          <li>
                            Assembly Total = Assembled Inst + Assembled Trays + Assembled Packs
                          </li>
                          <li>
                            Sterilization Total = Items Sterilized + Sterilizer Loads + Deliver
                            Scans
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Normalization fields
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Total Hours Worked = Hours Worked
                          </li>
                          <li>
                            Units of Service = (Sink Inst x 0.5) + Assembled Inst
                          </li>
                          <li>
                            Worked Hours per Unit = Total Hours Worked / max(Units of Service, 1)
                          </li>
                          <li>
                            Missing Instrument Rate = Assembly Missing Inst / max(Assembled Inst,
                            1)
                          </li>
                          <li>
                            Timekeeping timeframe mismatches raise a warning, but uploaded hours
                            are still applied as-is.
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Percentile logic
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Metric and pillar percentiles are based on cohort rank and
                            tie-adjusted midpoints.
                          </li>
                          <li>
                            Higher-is-better metrics rank upward; lower-is-better metrics (Defect
                            Rate, Missing Instr Rate, Worked Hours/Unit) are inverted so lower
                            values score better.
                          </li>
                          <li>
                            When Hours Worked is present, users with missing/zero hours are
                            excluded from hours-based productivity peer ranking.
                          </li>
                          <li>
                            When Role is available, the default cohort is production roles only.
                            You can still switch to an all-role view.
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Core score formulas
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Productivity (hours provided) = average percentile of Decon/Hour,
                            Assembly/Hour, Sterilize/Hour.
                          </li>
                          <li>
                            Productivity (hours missing) = average percentile of pillar totals.
                          </li>
                          <li>
                            Defect Rate blends attributable event hits with audit failure rate by
                            responsibility bucket (Decon/Sink, Assemble, Sterilize, ScanToOR).
                          </li>
                          <li>
                            Quality = (Defect Rate Percentile × 0.70) + (Missing Instrument Rate
                            Percentile × 0.30). Audit failures now feed into the Defect Rate
                            side of the score.
                          </li>
                          <li>
                            Versatility = average of all three pillar percentiles (Decon, Assembly,
                            Sterilize). A user who excels across all pillars scores higher than one
                            who merely clears the median in each.
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Overall score
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Overall Processing Score = Productivity Percentile + Quality Percentile
                            (0-200).
                          </li>
                          <li>
                            Card percentile display = top-anchored rank of Overall Processing
                            Score within the current peer cohort, so the highest overall score
                            shows 100th percentile.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="rounded-2xl border border-accent/20 bg-white/70 p-4 text-sm text-muted">
                  <details>
                    <summary className="cursor-pointer font-semibold text-ink">
                      Coach-style blurbs
                    </summary>
                    <div className="mt-2 space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        Top strength callouts
                      </div>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>
                          “When it comes to {'{{pillar}}'}, you're operating at a level most peers
                          don't reach.”
                        </li>
                        <li>
                          “Your {'{{metric}}'} puts you in elite territory — keep doing exactly what
                          you are doing.”
                        </li>
                      </ul>
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                        Growth opportunities
                      </div>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>
                          “The data suggests {'{{metric}}'} is your biggest opportunity — tightening
                          this up would level you up fast.”
                        </li>
                        <li>
                          “One small improvement in {'{{metric}}'} could unlock your next archetype.”
                        </li>
                      </ul>
                    </div>
                  </details>
                </div>
                <div className="rounded-2xl border border-brand/20 bg-white/70 p-4 text-sm text-muted">
                  <details>
                    <summary className="cursor-pointer font-semibold text-ink">
                      Strength titles (percentile-based)
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Quality / Accuracy
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Zero-Defect Menace</li>
                          <li>Quality Over Everything</li>
                          <li>No Rework, No Regrets</li>
                          <li>The Auditor's Nightmare</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Speed / Throughput
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Tray Machine</li>
                          <li>Assembly Speedrunner</li>
                          <li>Throughput Goblin</li>
                          <li>Blink and You Miss It</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Decontamination
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Biofilm Bully</li>
                          <li>Decon Demon</li>
                          <li>The Pre-Clean King/Queen</li>
                          <li>So Fresh, So Clean</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Sterilization
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Load Perfecter</li>
                          <li>Steam Certified</li>
                          <li>Cold Sterile Killer</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Multi-Pillar
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Swiss Army Tech</li>
                          <li>Triple Threat</li>
                          <li>Department Backbone</li>
                          <li>All-Terrain Tech</li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="rounded-2xl border border-accent/20 bg-white/70 p-4 text-sm text-muted">
                  <details>
                    <summary className="cursor-pointer font-semibold text-ink">Archetypes</summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Decontamination
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Biohazard Bouncer — Nothing dirty gets past them. Ever.</li>
                          <li>Germ Reaper — Where bioburden goes to die.</li>
                          <li>The Rinse Cycle — Relentless, methodical, unstoppable.</li>
                          <li>Hazmat Hero — Calm under pressure, fearless around the gross stuff.</li>
                          <li>Foam &amp; Fury — Aggressive cleaning, zero mercy.</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Assembly
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Tray Whisperer — Knows when something's missing without looking.</li>
                          <li>Count Sheet Assassin — Precision so clean it is suspicious.</li>
                          <li>The Lego Master — Everything fits. Every time.</li>
                          <li>
                            Set Architect — Builds trays like countsheets matter (because they do).
                          </li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Sterilization
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Cycle Commander — Parameters locked. Deviations denied.</li>
                          <li>Steam General — Leads every load like a military op.</li>
                          <li>The Final Boss — Nothing leaves until it is actually sterile.</li>
                          <li>Pressure Prophet — Knows a bad cycle before the printout hits.</li>
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Balanced / Utility
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>Utility Knife — Plug-and-play anywhere, anytime.</li>
                          <li>Shift Saver — Everything goes sideways, then they clock in.</li>
                          <li>The Glue — The department functions because this person exists.</li>
                          <li>Flex Tech — You move them, performance doesn't drop.</li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            ) : null}
          </div>

          <div className="glass-panel flex flex-wrap items-center gap-4 rounded-3xl border border-brand/20 p-5 shadow-md">
            <div className="flex min-w-[280px] flex-1 flex-col gap-4">
              <div className="rounded-2xl border border-brand/15 bg-white/70 p-4">
                <div className="text-sm font-semibold text-ink">1. Current Combined Workbook</div>
                <div className="mt-1 text-xs text-muted">
                  Use the legacy single-sheet workbook if you already have it.
                </div>
                <label className="mt-3 flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink">Upload combined `.xlsx`</span>
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
                    className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-accent/15 bg-white/70 p-4">
                <div className="text-sm font-semibold text-ink">Separate Uploads</div>
                <div className="mt-1 space-y-1 text-xs text-muted">
                  <p>
                    Upload `Productivity` and `Quality`. Add `Timecards` to enable hours-based
                    productivity ranking. If the timekeeping timeframe does not line up, the app
                    will warn, default to the timekeeping window, and let you switch back to the
                    raw uploaded analysis.
                  </p>
                  <p>
                    From in-app reports upload &quot;Quality Digest (Quality)&quot;, &quot;Summary
                    (Productivity New)&quot;, and &quot;Pay Code Totals&quot; from your timekeeping
                    application.
                  </p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink">2. Productivity</span>
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(event) =>
                        handleSeparateUploadChange(
                          'productivity',
                          event.target.files?.[0] ?? null,
                        )
                      }
                      className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
                    />
                    <span className="text-xs text-muted">
                      {separateUploads.productivity?.name ?? 'No file selected'}
                    </span>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink">3. Quality</span>
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(event) =>
                        handleSeparateUploadChange('quality', event.target.files?.[0] ?? null)
                      }
                      className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
                    />
                    <span className="text-xs text-muted">
                      {separateUploads.quality?.name ?? 'No file selected'}
                    </span>
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink">4. Timecards <span className="text-muted font-normal">(optional)</span></span>
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(event) =>
                        handleSeparateUploadChange('timecards', event.target.files?.[0] ?? null)
                      }
                      className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
                    />
                    <span className="text-xs text-muted">
                      {separateUploads.timecards?.name ?? 'No file selected'}
                    </span>
                  </label>
                </div>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => void handleSeparateUploadBuild()}
                    disabled={!separateUploads.productivity}
                    className="rounded-full border border-brand/40 bg-ink px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Build report from separate uploads
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-1 text-sm text-muted">
              <span>File: {fileName || 'No file selected'}</span>
              {reportingPeriod ? (
                <span>Reporting period: {reportingPeriod}</span>
              ) : null}
              <span>Source users: {loadedSource?.rows.length ?? report?.users.length ?? 0}</span>
              <span>Users loaded: {report?.users.length ?? 0}</span>
              {separateImportVariants?.timekeepingAligned ? (
                <div className="mt-2 rounded-2xl border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900">
                  <div className="font-semibold text-ink">Timekeeping mismatch detected</div>
                  <p className="mt-1">
                    Defaulting to the timekeeping window. You can switch back to the raw uploaded
                    analysis at any time.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => activateSeparateImportMode('timekeepingAligned')}
                      className={`rounded-full border px-3 py-1 font-medium ${
                        separateImportVariants.activeMode === 'timekeepingAligned'
                          ? 'border-ink bg-ink text-white'
                          : 'border-amber-300 bg-white text-amber-900'
                      }`}
                    >
                      Use timekeeping window
                    </button>
                    <button
                      type="button"
                      onClick={() => activateSeparateImportMode('raw')}
                      className={`rounded-full border px-3 py-1 font-medium ${
                        separateImportVariants.activeMode === 'raw'
                          ? 'border-ink bg-ink text-white'
                          : 'border-amber-300 bg-white text-amber-900'
                      }`}
                    >
                      Use raw uploads
                    </button>
                  </div>
                </div>
              ) : null}
              {drillSections.length > 0 ? (
                <div className="mt-2 space-y-2">
                  {drillSections.map((section) => (
                    <details
                      key={section.key}
                      className={`rounded-2xl border px-3 py-2 ${
                        section.tone === 'warning'
                          ? 'border-amber-300 bg-amber-50/80'
                          : section.tone === 'success'
                            ? 'border-emerald-300 bg-emerald-50/80'
                            : 'border-ink/10 bg-white/90'
                      }`}
                    >
                      <summary className="cursor-pointer list-none text-xs font-semibold text-ink">
                        <span className="mr-1 inline-block text-[10px] text-muted">▶</span>
                        {section.title}: {section.summary}
                      </summary>
                      {section.bullets?.length || section.groups?.length ? (
                        <div className="mt-3 space-y-3 text-xs text-muted">
                          {section.bullets?.length ? (
                            <div className="space-y-1">
                              {section.bullets.map((bullet, bulletIndex) => (
                                <p key={`${section.key}-bullet-${bulletIndex}`}>{bullet}</p>
                              ))}
                            </div>
                          ) : null}
                          {section.groups?.length ? (
                            <div className="space-y-2">
                              {section.groups.map((group) => (
                                <div
                                  key={`${section.key}-${group.label}`}
                                  className="rounded-xl border border-ink/10 bg-white/80 p-2"
                                >
                                  <div className="font-semibold text-ink">{group.label}</div>
                                  {group.items.length > 0 ? (
                                    <div className="mt-2 max-h-32 overflow-auto pr-1">
                                      <div className="flex flex-wrap gap-1">
                                        {group.items.map((item, itemIndex) => (
                                          <span
                                            key={`${section.key}-${group.label}-${itemIndex}`}
                                            className="rounded-full border border-ink/10 bg-white px-2 py-1"
                                          >
                                            {item}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mt-1">{group.emptyLabel ?? 'None'}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
            {report ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full border border-brand/40 bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => exportCardsToPdf(selectedUsers)}
                  disabled={exporting || selectedCount === 0}
                >
                  {pdfProgressText ?? (exporting ? 'Exporting...' : `${selectedCount} cards to PDF`)}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-accent/40 bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => exportCardsToPng(selectedUsers)}
                  disabled={exporting || selectedCount === 0}
                >
                  {pngProgressText ?? (exporting ? 'Exporting...' : `${selectedCount} cards to PNG`)}
                </button>
              </div>
            ) : null}
          </div>

        </header>

        <section className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-full border border-ink/10 bg-white/90 p-1 text-sm">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  viewMode === 'cards' ? 'bg-ink text-white' : 'text-muted'
                }`}
              >
                Cards
              </button>
              <button
                type="button"
                onClick={() => setViewMode('leaderboard')}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  viewMode === 'leaderboard' ? 'bg-ink text-white' : 'text-muted'
                }`}
              >
                Leaderboards
              </button>
              <button
                type="button"
                onClick={() => setViewMode('distribution')}
                className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                  viewMode === 'distribution' ? 'bg-ink text-white' : 'text-muted'
                }`}
              >
                Distribution
              </button>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by user name or tech label"
              className="w-64 rounded-full border border-accent/20 bg-white/90 px-4 py-2 text-sm"
            />
            {report && roleDataAvailable ? (
              <select
                value={cohortMode}
                onChange={(event) => setCohortMode(event.target.value as CohortMode)}
                className="rounded-full border border-brand/20 bg-white/90 px-4 py-2 text-sm"
              >
                <option value="production">Cohort: Production roles only</option>
                <option value="all">Cohort: All roles</option>
              </select>
            ) : null}
            {availableFacilities.length > 1 ? (
              <select
                value={facilityFilter}
                onChange={(event) => setFacilityFilter(event.target.value)}
                className="rounded-full border border-brand/20 bg-white/90 px-4 py-2 text-sm"
              >
                <option value="">All facilities</option>
                {availableFacilities.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            ) : null}
            {viewMode === 'cards' ? (
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="rounded-full border border-brand/20 bg-white/90 px-4 py-2 text-sm"
              >
                {visibleSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort by {option.label}
                  </option>
                ))}
              </select>
            ) : viewMode === 'leaderboard' ? (
              <select
                value={leaderboardKey}
                onChange={(event) => setLeaderboardKey(event.target.value)}
                className="rounded-full border border-brand/20 bg-white/90 px-4 py-2 text-sm"
              >
                {visibleLeaderboardOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    Leaderboard: {option.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={anonymize}
                onChange={(event) => setAnonymize(event.target.checked)}
                className="h-4 w-4 rounded border-brand/40 text-brand"
              />
              Anonymize peers
            </label>
            {report && viewMode === 'cards' ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-brand/30 bg-white px-3 py-1 text-xs font-medium text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={selectAllShown}
                  disabled={users.length === 0}
                >
                  Select all shown
                </button>
                <button
                  type="button"
                  className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-medium text-ink shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={clearSelection}
                  disabled={selectedCount === 0}
                >
                  Clear selection
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {!report ? (
          <section className="rounded-3xl border border-ink/10 bg-white/80 p-8 text-center text-muted shadow-sm">
            <h2 className="text-xl font-semibold text-ink">No data loaded yet</h2>
            <p className="mt-2 text-sm">
              Upload the current combined workbook, or upload Productivity + Quality and optionally
              Timecards. If the timekeeping timeframe does not match, the app will warn and still
              use the uploaded hours.
            </p>
          </section>
        ) : null}

        {report && viewMode === 'cards' ? (
          <section ref={gridRef} className="grid gap-6 md:grid-cols-2">
            {users.map((user) => {
              const key = getUserKey(user)
              const isSelected = selectedIds.has(key)
              return (
                <div
                  key={key}
                  data-report-card
                  data-report-card-key={key}
                  className="relative"
                >
                  <div
                    className="absolute right-2 top-2 z-10"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <label className="flex items-center gap-2 rounded-full border border-brand/30 bg-white/90 px-3 py-1 text-[11px] font-medium text-ink shadow-sm">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelected(user)}
                        className="h-3 w-3 rounded border-brand/40 text-brand"
                      />
                      Select
                    </label>
                  </div>
                  <ReportCard
                    user={user}
                    medians={report.medians}
                    pillarMedians={report.pillarMedians}
                    anonymize={anonymize}
                    hoursWorkedAvailable={hoursWorkedAvailable}
                    shortPillarLabels
                    interactive
                    onClick={() => {
                      setSelectedUser(user)
                      void loadUserTrend(user)
                    }}
                  />
                </div>
              )
            })}
          </section>
        ) : null}

        {report && viewMode === 'leaderboard' ? (
          <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Leaderboard</div>
                <h2 className="mt-2 text-xl font-semibold text-ink">
                  {activeLeaderboard.label}
                </h2>
                <p className="text-sm text-muted">
                  Ranked by {activeLeaderboard.higherBetter ? 'highest' : 'lowest'} values.
                </p>
              </div>
              <div className="text-xs text-muted">{leaderboardRows.length} results</div>
            </div>

            {/* Top-3 podium */}
            {leaderboardRows.length >= 3 ? (
              <div className="mt-5 flex items-end justify-center gap-3">
                {/* 2nd place */}
                <div className="flex flex-col items-center gap-1">
                  <div className="text-2xl">🥈</div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center shadow-sm" style={{ height: '80px' }}>
                    <div className="text-xs font-semibold text-slate-700 truncate max-w-[100px]">{leaderboardRows[1].name}</div>
                    <div className="mt-1 text-lg font-bold text-slate-800">
                      {activeLeaderboard.type === 'metric'
                        ? formatMetricValue(leaderboardRows[1].value, DEFAULT_METRICS.find((m) => `metric-${m.key}` === activeLeaderboard.key)!)
                        : leaderboardRows[1].value.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-slate-500">{leaderboardRows[1].percentile !== null ? formatOrdinal(leaderboardRows[1].percentile) : '—'}</div>
                  </div>
                </div>
                {/* 1st place */}
                <div className="flex flex-col items-center gap-1">
                  <div className="text-3xl">🥇</div>
                  <div className="rounded-2xl border border-yellow-300 bg-yellow-50 px-5 py-3 text-center shadow-md" style={{ height: '96px' }}>
                    <div className="text-xs font-semibold text-yellow-800 truncate max-w-[120px]">{leaderboardRows[0].name}</div>
                    <div className="mt-1 text-2xl font-bold text-yellow-700">
                      {activeLeaderboard.type === 'metric'
                        ? formatMetricValue(leaderboardRows[0].value, DEFAULT_METRICS.find((m) => `metric-${m.key}` === activeLeaderboard.key)!)
                        : leaderboardRows[0].value.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-yellow-600">{leaderboardRows[0].percentile !== null ? formatOrdinal(leaderboardRows[0].percentile) : '—'}</div>
                  </div>
                </div>
                {/* 3rd place */}
                <div className="flex flex-col items-center gap-1">
                  <div className="text-2xl">🥉</div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center shadow-sm" style={{ height: '68px' }}>
                    <div className="text-xs font-semibold text-amber-800 truncate max-w-[100px]">{leaderboardRows[2].name}</div>
                    <div className="mt-1 text-lg font-bold text-amber-700">
                      {activeLeaderboard.type === 'metric'
                        ? formatMetricValue(leaderboardRows[2].value, DEFAULT_METRICS.find((m) => `metric-${m.key}` === activeLeaderboard.key)!)
                        : leaderboardRows[2].value.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-amber-600">{leaderboardRows[2].percentile !== null ? formatOrdinal(leaderboardRows[2].percentile) : '—'}</div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                    <th className="py-2 pr-3">Rank</th>
                    <th className="py-2 pr-3">Tech</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2 pr-3 w-40">Percentile</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.map((row, index) => {
                    const hasNoHoursWorked = hoursWorkedAvailable && row.user.hoursWorked <= 0
                    const valueDisplay =
                      activeLeaderboard.type === 'metric'
                        ? formatMetricValue(
                            row.value,
                            DEFAULT_METRICS.find((metric) => `metric-${metric.key}` === activeLeaderboard.key)!,
                          )
                        : row.value.toFixed(0)
                    const percentileDisplay =
                      row.percentile !== null ? formatOrdinal(row.percentile) : '—'
                    const podiumClass =
                      index === 0
                        ? 'border-yellow-200 bg-yellow-50/60'
                        : index === 1
                          ? 'border-slate-200 bg-slate-50/60'
                          : index === 2
                            ? 'border-amber-200 bg-amber-50/60'
                            : hasNoHoursWorked
                              ? 'border-warning/30 bg-warning/10'
                              : 'border-ink/10'
                    return (
                      <tr key={getUserKey(row.user)} className={`border-t ${podiumClass}`}>
                        <td className="py-2 pr-3 font-semibold text-muted w-8">
                          {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                        </td>
                        <td className="py-2 pr-3 font-medium text-ink">
                          {row.name}
                          {hasNoHoursWorked ? (
                            <span className="ml-2 rounded-full border border-warning/40 bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
                              No hours
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-ink">{valueDisplay}</td>
                        <td className="py-2 pr-3">
                          {row.percentile !== null ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
                                <div
                                  className={`h-full rounded-full ${
                                    row.percentile >= 75 ? 'bg-green-500' : row.percentile >= 25 ? 'bg-blue-500' : 'bg-red-400'
                                  }`}
                                  style={{ width: `${row.percentile}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-xs text-muted">{percentileDisplay}</span>
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {report && viewMode === 'distribution' ? (
          <section className="space-y-6">
            {/* Team cohort analytics summary */}
            {teamAnalytics ? (
              <div className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Team snapshot</div>
                <h2 className="mt-2 text-xl font-semibold text-ink">Cohort analytics</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted">Avg quality percentile</div>
                    <div className={`mt-2 text-3xl font-semibold ${teamAnalytics.avgQuality >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                      {teamAnalytics.avgQuality}
                      <span className="ml-1 text-sm font-medium text-muted">/ 100</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted">Avg productivity percentile</div>
                    <div className={`mt-2 text-3xl font-semibold ${teamAnalytics.avgProductivity >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                      {teamAnalytics.avgProductivity}
                      <span className="ml-1 text-sm font-medium text-muted">/ 100</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted">Above median quality</div>
                    <div className="mt-2 text-3xl font-semibold text-ink">
                      {teamAnalytics.aboveMedianQualityPct}
                      <span className="ml-1 text-sm font-medium text-muted">% of team</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-muted">Weakest pillar across team</div>
                    <div className="mt-2 text-xl font-semibold text-ink">{teamAnalytics.weakestPillarLabel}</div>
                    <div className="text-xs text-muted">Most users rank lowest here</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Archetype breakdown</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(teamAnalytics.archetypeCounts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([label, count]) => (
                        <span key={label} className="rounded-full border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-medium text-ink">
                          {label} <span className="ml-1 text-muted">× {count}</span>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Bell curve */}
            <div className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
              <div className="text-xs uppercase tracking-[0.2em] text-muted">Score distribution</div>
              <h2 className="mt-2 text-xl font-semibold text-ink">Overall score bell curve</h2>
              <p className="mt-1 text-sm text-muted">
                Overall score = Productivity Percentile + Quality Percentile (0–200 scale).
                Reference line at 100 (median).
              </p>
              <div className="mt-5 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <RechartsTooltip
                      formatter={(value) => {
                        const n = typeof value === 'number' ? value : 0
                        return [`${n} user${n !== 1 ? 's' : ''}`, 'Count']
                      }}
                    />
                    <ReferenceLine x="80–100" stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'median ~100', position: 'top', fontSize: 10, fill: '#94a3b8' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {distributionData.map((entry) => (
                        <Cell
                          key={entry.label}
                          fill={entry.rangeMin >= 140 ? '#16a34a' : entry.rangeMax <= 60 ? '#dc2626' : '#2563eb'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" /> Low (&lt; 60)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-600" /> Mid (60–140)</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-green-600" /> High (&gt; 140)</span>
              </div>
            </div>
          </section>
        ) : null}

      </main>

      {report && selectedCount > 0 ? (
        <div
          ref={exportRef}
          className="pointer-events-none absolute -left-[10000px] top-0 opacity-0"
        >
          {selectedUsers.map((user) => {
            const key = getUserKey(user)
            return (
              <div
                key={`export-${key}`}
                data-report-card
                data-report-card-key={key}
                className="pb-6"
                style={{ width: `${EXPORT_CARD_WIDTH_PX}px` }}
              >
                <ReportCard
                  user={user}
                  medians={report.medians}
                  pillarMedians={report.pillarMedians}
                  anonymize={anonymize}
                  hoursWorkedAvailable={hoursWorkedAvailable}
                />
              </div>
            )
          })}
        </div>
      ) : null}

      {report && selectedUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6">
          <button
            type="button"
            aria-label="Close report card"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedUser(null)}
          />
          <div className="relative z-10 w-full max-w-5xl">
            <div className="mb-3 flex items-center justify-between text-white">
              <div className="text-sm uppercase tracking-[0.18em]">Full screen view</div>
              <button
                type="button"
                className="rounded-full border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium text-white"
                onClick={() => setSelectedUser(null)}
              >
                Close
              </button>
            </div>
            <div
              className="max-h-[85vh] space-y-4 overflow-auto rounded-3xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <section className="rounded-3xl border border-ink/10 bg-white/95 p-5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Historical trend
                    </div>
                    <div className="mt-1 text-lg font-semibold text-ink">
                      {anonymize ? selectedUser.techLabel : selectedUser.name}
                    </div>
                  </div>
                  <div className="text-xs text-muted">
                    {trendPoints.length} {trendPoints.length === 1 ? 'period' : 'periods'} stored
                  </div>
                </div>
                {trendLoading ? (
                  <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                    Loading trend history...
                  </div>
                ) : trendError ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Could not load history: {trendError}
                  </div>
                ) : trendChartData.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-ink/20 bg-white px-4 py-4 text-sm text-muted">
                    No persisted history found for this user yet.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendChartData} margin={{ top: 12, right: 12, bottom: 40, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis
                            dataKey="period"
                            interval={0}
                            angle={-20}
                            textAnchor="end"
                            tick={{ fontSize: 11 }}
                            height={56}
                          />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                          <RechartsTooltip />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="overall"
                            name="Overall Percentile"
                            stroke="#0f766e"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="productivity"
                            name="Productivity Percentile"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                          <Line
                            type="monotone"
                            dataKey="quality"
                            name="Quality Percentile"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={{ r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {trendHasPillarData ? (
                      <div className="mt-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Pillar volume over time</div>
                        <div className="mt-2 h-48 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={trendChartData} margin={{ top: 8, right: 12, bottom: 40, left: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis
                                dataKey="period"
                                interval={0}
                                angle={-20}
                                textAnchor="end"
                                tick={{ fontSize: 11 }}
                                height={56}
                              />
                              <YAxis tick={{ fontSize: 11 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Line type="monotone" dataKey="deconTotal" name="Decon Total" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                              <Line type="monotone" dataKey="assemblyTotal" name="Assembly Total" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} />
                              <Line type="monotone" dataKey="sterilizeTotal" name="Sterilize Total" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ) : null}

                    <div className="text-xs text-muted">
                      Trends come from persisted workbook uploads and are shared across devices/users.
                    </div>
                  </div>
                )}
              </section>
              <ReportCard
                user={selectedUser}
                medians={report.medians}
                pillarMedians={report.pillarMedians}
                anonymize={anonymize}
                hoursWorkedAvailable={hoursWorkedAvailable}
                showArchetypeDescription
                className="shadow-2xl"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SpdReportCardApp
