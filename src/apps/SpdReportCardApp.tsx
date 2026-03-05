import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import ReportCard from '../components/ReportCard'
import {
  buildReport,
  coerceRow,
  DEFAULT_METRICS,
  formatMetricValue,
  REQUIRED_COLUMNS,
} from '../utils/metrics'
import type { ProcessedReport, UserRecord } from '../utils/metrics'

type SortKey = 'overall' | 'productivity' | 'quality' | 'versatility' | 'hoursWorked'
type ViewMode = 'cards' | 'leaderboard'

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

const extractReportingPeriod = (fileName: string) => {
  const base = fileName.replace(/\.[^/.]+$/, '')
  const match = base.match(/(\d{4}[./-]\d{2}[./-]\d{2})\s*-\s*(\d{4}[./-]\d{2}[./-]\d{2})/)
  if (!match) return null
  return `${formatFriendlyDate(match[1])} – ${formatFriendlyDate(match[2])}`
}

const getUserKey = (user: UserRecord) => {
  const idPart = user.id ? user.id : 'unknown'
  return `${idPart}-${user.techLabel}`
}

const EXPORT_RENDER_SCALE = 1.35
const EXPORT_YIELD_EVERY = 4
const EXPORT_JPEG_QUALITY = 0.82

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

const SpdReportCardApp = ({ onBack }: SpdReportCardAppProps) => {
  const [report, setReport] = useState<ProcessedReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [reportingPeriod, setReportingPeriod] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('productivity')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')
  const [leaderboardKey, setLeaderboardKey] = useState<string>(leaderboardOptions[0].key)
  const [anonymize, setAnonymize] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [hoursWorkedAvailable, setHoursWorkedAvailable] = useState(true)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)

  const handleFileUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setFileName(file.name)
    setReportingPeriod(extractReportingPeriod(file.name))

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: 0,
      })

      if (!rows.length) {
        setError('No data rows found in the workbook.')
        setReport(null)
        setHoursWorkedAvailable(true)
        setReportingPeriod(extractReportingPeriod(file.name))
        return
      }

      const hasHoursWorked = 'Hours Worked' in rows[0]

      const missing = REQUIRED_COLUMNS.filter((column) => !(column in rows[0]))
      if (missing.length) {
        setError(`Missing required columns: ${missing.join(', ')}`)
        setReport(null)
        setHoursWorkedAvailable(hasHoursWorked)
        setReportingPeriod(extractReportingPeriod(file.name))
        return
      }

      const coerced = rows.map((row) => coerceRow(row))
      const built = buildReport(coerced, { hoursWorkedAvailable: hasHoursWorked })
      setReport(built)
      setHoursWorkedAvailable(hasHoursWorked)
      setReportingPeriod(extractReportingPeriod(file.name))
      setSelectedIds(new Set())
    } catch {
      setError('Unable to read the spreadsheet. Please confirm it is a valid .xlsx file.')
      setReport(null)
      setHoursWorkedAvailable(true)
      setReportingPeriod(extractReportingPeriod(file.name))
      setSelectedIds(new Set())
    }
  }

  const filteredUsers = useMemo(() => {
    if (!report) return []
    const query = search.trim().toLowerCase()
    let users = [...report.users]
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
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 24
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
  const selectedUsers = useMemo(
    () => (report ? report.users.filter((user) => selectedIds.has(getUserKey(user))) : []),
    [report, selectedIds],
  )
  const productivityExcludedCount = useMemo(
    () => (report ? report.users.filter((user) => !user.productivityRanked).length : 0),
    [report],
  )

  const selectedCount = selectedUsers.length
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
    leaderboardOptions.find((option) => option.key === leaderboardKey) ?? leaderboardOptions[0]

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
                        </ul>
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                          Percentile logic
                        </div>
                        <ul className="mt-1 list-disc space-y-1 pl-4">
                          <li>
                            Percentiles are based on cohort rank and tie-adjusted midpoints.
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
                            Quality = (Defect Rate Percentile x 0.70) + (Missing Instrument Rate
                            Percentile x 0.30).
                          </li>
                          <li>
                            Versatility = (number of pillars at/above median / 3) x 100.
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
                            Card percentile display = Overall Processing Score / 2.
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
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Upload .xlsx</span>
              <input
                type="file"
                accept=".xlsx"
                onChange={(event) => handleFileUpload(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
              />
            </label>
            <div className="flex flex-1 flex-col gap-1 text-sm text-muted">
              <span>File: {fileName || 'No file selected'}</span>
              {reportingPeriod ? (
                <span>Reporting period: {reportingPeriod}</span>
              ) : null}
              <span>Users loaded: {report?.users.length ?? 0}</span>
              {report && !hoursWorkedAvailable ? (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-ink">
                  Hours Worked column not found — productivity uses total-volume percentiles instead
                  of per-hour rates.
                </span>
              ) : null}
              {report && hoursWorkedAvailable && productivityExcludedCount > 0 ? (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-ink">
                  {productivityExcludedCount}{' '}
                  {productivityExcludedCount === 1 ? 'user is' : 'users are'} excluded from
                  productivity peer ranking due to missing/zero Hours Worked.
                </span>
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
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by user name or tech label"
              className="w-64 rounded-full border border-accent/20 bg-white/90 px-4 py-2 text-sm"
            />
            {viewMode === 'cards' ? (
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="rounded-full border border-brand/20 bg-white/90 px-4 py-2 text-sm"
              >
                {sortOptions.map((option) => (
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
                {leaderboardOptions.map((option) => (
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
              Upload a spreadsheet with the required columns to generate report cards.
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
                    onClick={() => setSelectedUser(user)}
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
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-muted">
                    <th className="py-2 pr-3">Rank</th>
                    <th className="py-2 pr-3">Tech</th>
                    <th className="py-2 pr-3">Value</th>
                    <th className="py-2 pr-3">Percentile</th>
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
                        : activeLeaderboard.type === 'score'
                          ? row.value.toFixed(0)
                          : row.value.toFixed(0)
                    const percentileDisplay =
                      row.percentile !== null ? formatOrdinal(row.percentile) : '—'
                    return (
                      <tr
                        key={getUserKey(row.user)}
                        className={`border-t ${
                          hasNoHoursWorked
                            ? 'border-warning/30 bg-warning/10'
                            : 'border-ink/10'
                        }`}
                      >
                        <td className="py-2 pr-3 text-muted">{index + 1}</td>
                        <td className="py-2 pr-3 font-medium text-ink">
                          {row.name}
                          {hasNoHoursWorked ? (
                            <span className="ml-2 rounded-full border border-warning/40 bg-warning/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-warning">
                              No hours
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-ink">{valueDisplay}</td>
                        <td className="py-2 pr-3 text-muted">{percentileDisplay}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
                className="w-[520px] pb-6"
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
              className="max-h-[85vh] overflow-auto rounded-3xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
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
