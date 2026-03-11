import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type {
  RtlsAnalysisConfig,
  RtlsAnalysisResult,
  RtlsEventDetail,
  RtlsMatchDetail,
  RtlsScanDataset,
  RtlsTransitionDetail,
} from './rtlsAccuracy/types'
import { analyzeRtlsDataset } from './rtlsAccuracy/utils/analyzeRtlsDataset'

type RtlsAccuracyAppProps = {
  onBack?: () => void
}

type DrilldownColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
}

type DrilldownRow = Record<string, string | number>

type DrilldownState = {
  title: string
  subtitle?: string
  columns: DrilldownColumn[]
  rows: DrilldownRow[]
}

type AreaAccuracySummary = {
  facility: string
  location: string
  ilocsCount: number
  matchedCount: number
  accuracyRate: number
  ilocsEvents: RtlsEventDetail[]
  matchedEvents: RtlsMatchDetail[]
}

type RtlsDatasetPayload = {
  meta: {
    generatedAt: string
    sourceWorkbook: string
    scanSheet: string
    beaconSheet: string | null
    parsedRows: number
    rawParsedRows: number
    beaconFilterApplied: boolean
    beaconedAssetsCount: number
    excludedNonBeaconRows: number
  }
  config: RtlsAnalysisConfig
  dataset: {
    rows: {
      invKeys: number[]
      invNameKeys: number[]
      locationKeys: number[]
      aliasUserKeys: number[]
      userKeys: number[]
      stateKeys: number[]
      substateKeys: number[]
      workflowKeys: number[]
      timestampSerials: number[]
    }
    sharedLookupEntries: Array<[number, string]>
    rawValueLookup: string[]
    parsedRows: number
    rawParsedRows: number
    beaconFilterApplied: boolean
    beaconedAssetsCount: number
    beaconedInvNames: string[]
    excludedNonBeaconRows: number
    excludedInvNameSummaries: Array<{ invName: string; count: number }>
  }
}

const DEFAULT_CONFIG: RtlsAnalysisConfig = {
  ilocsKeyword: 'ilocs',
  humanBeforeHours: 4,
  humanAfterHours: 8,
}

const DRILLDOWN_PAGE_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000

const formatPercent = (value: number) => `${value.toFixed(1)}%`
const formatHours = (value: number) => `${value.toFixed(2)}h`
const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const deriveFacilityFromLocation = (location: string) => {
  const text = location.trim()
  if (!text) return 'Unknown Facility'

  const upper = text.toUpperCase()
  if (/\bAYERS\b/.test(upper)) return 'UF Shands Ayers Pain Clinic'
  if (/\bFSC\b/.test(upper)) return 'UF Shands FSC'
  if (/\bHVN\b/.test(upper)) return 'UF Shands HVN'
  if (/\bNORTH\s*TOWER\b|\bNT\b/.test(upper)) return 'UF Shands North Tower'
  if (/\bOFFSITE\b/.test(upper)) return 'UF Shands Offsite'
  if (/\bSOUTH\s*TOWER\b|\bST\b/.test(upper)) return 'UF Shands South Tower'
  if (/\bOSC\b/.test(upper)) return 'UF Shands OSC'
  if (/\bONH\b/.test(upper)) return 'UF Shands ONH'

  for (const separator of [' - ', ' | ', ' / ', ': ']) {
    const separatorIndex = text.indexOf(separator)
    if (separatorIndex > 0) {
      const prefix = text.slice(0, separatorIndex).trim()
      if (prefix) return prefix
    }
  }

  return text
}

const formatDateTime = (serial: number) => {
  if (!Number.isFinite(serial)) return '—'
  const date = new Date((serial - 25569) * DAY_MS)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const SummaryCard = ({
  label,
  value,
  hint,
  onClick,
}: {
  label: string
  value: string
  hint?: string
  onClick?: () => void
}) => {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-2xl border border-ink/10 bg-white/90 p-4 text-left shadow-sm transition hover:border-brand/40 hover:shadow"
      >
        <div className="text-xs uppercase tracking-[0.14em] text-muted">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
        {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
        <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
          Click to drill down
        </div>
      </button>
    )
  }

  return (
    <article className="rounded-2xl border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="text-xs uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </article>
  )
}

const eventColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Inv Name' },
  { key: 'invId', label: 'InvID' },
  { key: 'scannerType', label: 'Scanner' },
  { key: 'stage', label: 'Stage' },
  { key: 'location', label: 'Location' },
  { key: 'aliasUser', label: 'Alias User' },
  { key: 'userName', label: 'User Name' },
  { key: 'timestamp', label: 'Timestamp' },
]

const matchColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Inv Name' },
  { key: 'invId', label: 'InvID' },
  { key: 'stage', label: 'Stage' },
  { key: 'location', label: 'Location' },
  { key: 'ilocsAliasUser', label: 'ilocs User' },
  { key: 'humanAliasUser', label: 'Human User' },
  { key: 'ilocsTime', label: 'ilocs Time' },
  { key: 'humanTime', label: 'Human Time' },
  { key: 'lagHours', label: 'Lag (hrs)', align: 'right' },
]

const transitionColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Inv Name' },
  { key: 'invId', label: 'InvID' },
  { key: 'fromStage', label: 'From Stage' },
  { key: 'toStage', label: 'To Stage' },
  { key: 'fromLocation', label: 'From Location' },
  { key: 'toLocation', label: 'To Location' },
  { key: 'fromTime', label: 'From Time' },
  { key: 'toTime', label: 'To Time' },
  { key: 'pathFlag', label: 'Path Flag' },
]

const excludedColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Excluded Inv Name' },
  { key: 'count', label: 'Rows', align: 'right' },
]

const beaconNeverIlocsColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Beaconed Asset' },
  { key: 'totalScans', label: 'Total Scans', align: 'right' },
  { key: 'humanScans', label: 'Human Scans', align: 'right' },
]

const areaEventColumns: DrilldownColumn[] = [
  { key: 'invName', label: 'Inv Name' },
  { key: 'invId', label: 'InvID' },
  { key: 'facility', label: 'Facility' },
  { key: 'location', label: 'Location' },
  { key: 'stage', label: 'Stage' },
  { key: 'matchStatus', label: 'Match' },
  { key: 'aliasUser', label: 'ilocs User' },
  { key: 'timestamp', label: 'ilocs Time' },
]

const locationEventKey = (invId: string, location: string, timestampSerial: number) => {
  return `${invId}|${location}|${timestampSerial.toFixed(8)}`
}

const toAreaEventRows = (
  area: AreaAccuracySummary,
  matchedIlocsKeys: Set<string>,
): DrilldownRow[] => {
  return area.ilocsEvents
    .slice()
    .sort((left, right) => right.timestampSerial - left.timestampSerial)
    .map((event) => ({
      invName: event.invName,
      invId: event.invId,
      facility: deriveFacilityFromLocation(event.location),
      location: event.location,
      stage: event.stage,
      matchStatus: matchedIlocsKeys.has(
        locationEventKey(event.invId, event.location, event.timestampSerial),
      )
        ? 'Matched'
        : 'Unmatched',
      aliasUser: event.aliasUser || '—',
      timestamp: formatDateTime(event.timestampSerial),
    }))
}

const toEventRows = (events: RtlsEventDetail[]): DrilldownRow[] => {
  return events.map((event) => ({
    invName: event.invName,
    invId: event.invId,
    scannerType: event.scannerType,
    stage: event.stage,
    location: event.location,
    aliasUser: event.aliasUser || '—',
    userName: event.userName || '—',
    timestamp: formatDateTime(event.timestampSerial),
  }))
}

const toMatchRows = (matches: RtlsMatchDetail[]): DrilldownRow[] => {
  return matches
    .slice()
    .sort((left, right) => right.lagHours - left.lagHours)
    .map((match) => ({
      invName: match.invName,
      invId: match.invId,
      stage: match.stage,
      location: match.location,
      ilocsAliasUser: match.ilocsAliasUser || '—',
      humanAliasUser: match.humanAliasUser || '—',
      ilocsTime: formatDateTime(match.ilocsTimestampSerial),
      humanTime: formatDateTime(match.humanTimestampSerial),
      lagHours: formatHours(match.lagHours),
    }))
}

const toTransitionRows = (transitions: RtlsTransitionDetail[]): DrilldownRow[] => {
  return transitions
    .slice()
    .sort((left, right) => right.toTimestampSerial - left.toTimestampSerial)
    .map((transition) => ({
      invName: transition.invName,
      invId: transition.invId,
      fromStage: transition.fromStage,
      toStage: transition.toStage,
      fromLocation: transition.fromLocation,
      toLocation: transition.toLocation,
      fromTime: formatDateTime(transition.fromTimestampSerial),
      toTime: formatDateTime(transition.toTimestampSerial),
      pathFlag: transition.offPath ? 'Off-path' : 'Expected',
    }))
}

const hydrateDataset = (payload: RtlsDatasetPayload['dataset']): RtlsScanDataset => {
  return {
    rows: {
      invKeys: Int32Array.from(payload.rows.invKeys),
      invNameKeys: Int32Array.from(payload.rows.invNameKeys),
      locationKeys: Int32Array.from(payload.rows.locationKeys),
      aliasUserKeys: Int32Array.from(payload.rows.aliasUserKeys),
      userKeys: Int32Array.from(payload.rows.userKeys),
      stateKeys: Int32Array.from(payload.rows.stateKeys),
      substateKeys: Int32Array.from(payload.rows.substateKeys),
      workflowKeys: Int32Array.from(payload.rows.workflowKeys),
      timestampSerials: Float64Array.from(payload.rows.timestampSerials),
    },
    sharedLookup: new Map(payload.sharedLookupEntries),
    rawValueLookup: payload.rawValueLookup,
    parsedRows: payload.parsedRows,
    rawParsedRows: payload.rawParsedRows,
    beaconFilterApplied: payload.beaconFilterApplied,
    beaconedAssetsCount: payload.beaconedAssetsCount,
    beaconedInvNames: payload.beaconedInvNames,
    excludedNonBeaconRows: payload.excludedNonBeaconRows,
    excludedInvNameSummaries: payload.excludedInvNameSummaries,
  }
}

const RtlsAccuracyApp = ({ onBack }: RtlsAccuracyAppProps) => {
  const [dataset, setDataset] = useState<RtlsScanDataset | null>(null)
  const [sourceMeta, setSourceMeta] = useState<RtlsDatasetPayload['meta'] | null>(null)
  const [analysis, setAnalysis] = useState<RtlsAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<RtlsAnalysisConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null)
  const [drillSearch, setDrillSearch] = useState('')
  const [drillPage, setDrillPage] = useState(1)

  const runAnalysis = async (sourceDataset: RtlsScanDataset, nextConfig: RtlsAnalysisConfig) => {
    setBusy(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const computed = analyzeRtlsDataset(sourceDataset, nextConfig)
    setAnalysis(computed)
    setBusy(false)
  }

  useEffect(() => {
    let cancelled = false

    const loadDataset = async () => {
      setLoading(true)
      setError(null)
      setAnalysis(null)
      setDataset(null)
      setSourceMeta(null)
      setDrilldown(null)

      try {
        const datasetUrl = `${import.meta.env.BASE_URL}data/rtls-accuracy-dataset.json`
        const response = await fetch(datasetUrl)
        if (!response.ok) {
          throw new Error(`Failed to load RTLS dataset (${response.status}) from ${datasetUrl}.`)
        }

        const bodyText = await response.text()
        if (bodyText.trim().startsWith('<')) {
          throw new Error(
            `RTLS dataset URL returned HTML instead of JSON (${datasetUrl}). This usually means a base-path mismatch in deployment.`,
          )
        }

        const parsedPayload = JSON.parse(bodyText) as RtlsDatasetPayload
        if (cancelled) return

        const nextConfig = parsedPayload.config ?? DEFAULT_CONFIG
        const hydrated = hydrateDataset(parsedPayload.dataset)
        setSourceMeta(parsedPayload.meta)
        setConfig(nextConfig)
        setDataset(hydrated)
        await runAnalysis(hydrated, nextConfig)
      } catch (loadError) {
        if (cancelled) return
        setError(
          loadError instanceof Error ? loadError.message : 'Unable to load hardcoded RTLS dataset.',
        )
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadDataset()
    return () => {
      cancelled = true
    }
  }, [])

  const reanalyze = async () => {
    if (!dataset) return
    setError(null)
    await runAnalysis(dataset, config)
  }

  const openDrilldown = (next: DrilldownState) => {
    setDrilldown(next)
    setDrillSearch('')
    setDrillPage(1)
  }

  const openEventDrilldown = (title: string, subtitle: string, rows: RtlsEventDetail[]) => {
    openDrilldown({ title, subtitle, columns: eventColumns, rows: toEventRows(rows) })
  }

  const openMatchDrilldown = (title: string, subtitle: string, rows: RtlsMatchDetail[]) => {
    openDrilldown({ title, subtitle, columns: matchColumns, rows: toMatchRows(rows) })
  }

  const openTransitionDrilldown = (
    title: string,
    subtitle: string,
    rows: RtlsTransitionDetail[],
  ) => {
    openDrilldown({ title, subtitle, columns: transitionColumns, rows: toTransitionRows(rows) })
  }

  const openExcludedDrilldown = () => {
    if (!analysis) return
    const rows = analysis.drilldowns.excludedInvNames.map((entry) => ({
      invName: entry.invName,
      count: entry.count.toLocaleString(),
    }))
    openDrilldown({
      title: 'Excluded Non-Beaconed Inventory',
      subtitle: 'Rows removed because Inv Name was not found in beaconed assets sheet.',
      columns: excludedColumns,
      rows,
    })
  }

  const openBeaconNeverIlocsDrilldown = () => {
    if (!analysis) return
    const rows = analysis.drilldowns.beaconedNeverIlocsAssets.map((entry) => ({
      invName: entry.invName,
      totalScans: entry.totalScans.toLocaleString(),
      humanScans: entry.humanScans.toLocaleString(),
    }))
    openDrilldown({
      title: 'Beaconed Assets With No ilocs Scans',
      subtitle: 'Beacon-list assets where ilocs scan count is zero in the selected workbook.',
      columns: beaconNeverIlocsColumns,
      rows,
    })
  }

  const openUnmatchedDrilldown = () => {
    if (!analysis) return
    const combined: RtlsEventDetail[] = [
      ...analysis.drilldowns.unmatchedIlocsEvents,
      ...analysis.drilldowns.unmatchedHumanEvents,
    ]
    openEventDrilldown(
      'Unmatched Room Changes',
      'Combined ilocs and human room-change events that did not match inside the selected window.',
      combined,
    )
  }

  const areaAccuracySummaries = useMemo<AreaAccuracySummary[]>(() => {
    if (!analysis) return []

    const areaMap = new Map<string, AreaAccuracySummary>()
    for (const event of analysis.drilldowns.ilocsEvents) {
      const location = event.location || 'Unknown Location'
      const existing = areaMap.get(location)
      if (existing) {
        existing.ilocsEvents.push(event)
      } else {
        areaMap.set(location, {
          facility: deriveFacilityFromLocation(location),
          location,
          ilocsCount: 0,
          matchedCount: 0,
          accuracyRate: 0,
          ilocsEvents: [event],
          matchedEvents: [],
        })
      }
    }

    for (const match of analysis.drilldowns.matchedEvents) {
      const location = match.location || 'Unknown Location'
      const existing = areaMap.get(location)
      if (existing) {
        existing.matchedEvents.push(match)
      } else {
        areaMap.set(location, {
          facility: deriveFacilityFromLocation(location),
          location,
          ilocsCount: 0,
          matchedCount: 0,
          accuracyRate: 0,
          ilocsEvents: [],
          matchedEvents: [match],
        })
      }
    }

    return Array.from(areaMap.values())
      .map((area) => {
        const ilocsCount = area.ilocsEvents.length
        const matchedCount = area.matchedEvents.length
        return {
          ...area,
          ilocsCount,
          matchedCount,
          accuracyRate: ilocsCount > 0 ? (matchedCount / ilocsCount) * 100 : 0,
        }
      })
      .filter((area) => area.ilocsCount > 0)
      .sort((left, right) => {
        if (right.accuracyRate !== left.accuracyRate) return right.accuracyRate - left.accuracyRate
        if (right.ilocsCount !== left.ilocsCount) return right.ilocsCount - left.ilocsCount
        return left.location.localeCompare(right.location)
      })
  }, [analysis])

  const matchedIlocsKeySet = useMemo(() => {
    if (!analysis) return new Set<string>()
    return new Set(
      analysis.drilldowns.matchedEvents.map((match) =>
        locationEventKey(match.invId, match.location, match.ilocsTimestampSerial),
      ),
    )
  }, [analysis])

  const mostAccurateArea = areaAccuracySummaries.length > 0 ? areaAccuracySummaries[0] : null
  const leastAccurateArea =
    areaAccuracySummaries.length > 1
      ? areaAccuracySummaries[areaAccuracySummaries.length - 1]
      : areaAccuracySummaries.length === 1
        ? areaAccuracySummaries[0]
        : null

  const openAreaAccuracyDrilldown = (title: string, area: AreaAccuracySummary | null) => {
    if (!area) return
    openDrilldown({
      title,
      subtitle: `${area.facility} | ${area.location} accuracy ${formatPercent(area.accuracyRate)} (${area.matchedCount.toLocaleString()} matched of ${area.ilocsCount.toLocaleString()} ilocs room changes).`,
      columns: areaEventColumns,
      rows: toAreaEventRows(area, matchedIlocsKeySet),
    })
  }

  const drillFilteredRows = useMemo(() => {
    if (!drilldown) return []
    const query = drillSearch.trim().toLowerCase()
    if (!query) return drilldown.rows
    return drilldown.rows.filter((row) => {
      return Object.values(row).some((value) => String(value).toLowerCase().includes(query))
    })
  }, [drilldown, drillSearch])

  const drillTotalPages = Math.max(1, Math.ceil(drillFilteredRows.length / DRILLDOWN_PAGE_SIZE))
  const safeDrillPage = Math.min(drillPage, drillTotalPages)
  const drillPageRows = drillFilteredRows.slice(
    (safeDrillPage - 1) * DRILLDOWN_PAGE_SIZE,
    safeDrillPage * DRILLDOWN_PAGE_SIZE,
  )

  const exportDrilldownToExcel = () => {
    if (!drilldown) return

    const header = drilldown.columns.map((column) => column.label)
    const rows = drillFilteredRows.map((row) =>
      drilldown.columns.map((column) => String(row[column.key] ?? '')),
    )
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...rows])
    const workbook = XLSX.utils.book_new()

    const sheetName = (slugify(drilldown.title) || 'drilldown').slice(0, 31)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)

    const dateSuffix = new Date().toISOString().slice(0, 10)
    const fileName = `${slugify(drilldown.title) || 'drilldown'}-${dateSuffix}.xlsx`
    XLSX.writeFile(workbook, fileName)
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-32 right-0 h-80 w-80 rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-10 h-72 w-72 rounded-full bg-accent/15 blur-3xl" />

      <main className="relative mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-5">
            <div>
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="inline-flex items-center rounded-full border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink"
                >
                  Back to app suite
                </button>
              ) : null}
              <div className="mt-3 text-[11px] uppercase tracking-[0.35em] text-muted">
                Ascendo Analytics
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink md:text-4xl">
                RTLS Accuracy Analyzer
              </h1>
              <p className="mt-3 max-w-3xl text-sm text-muted">
                Hardcoded scan-history data is analyzed by `InvID` to compare ilocs vs human
                room-change events, match them within a configurable lag window, and inspect ilocs
                path transitions.
              </p>
              {sourceMeta ? (
                <p className="mt-2 text-xs text-muted">
                  Source workbook: {sourceMeta.sourceWorkbook} | Sheets: {sourceMeta.scanSheet}
                  {sourceMeta.beaconSheet ? ` + ${sourceMeta.beaconSheet}` : ''} | Data refreshed:{' '}
                  {new Date(sourceMeta.generatedAt).toLocaleString('en-US')}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-4">
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                ilocs keyword
              </div>
              <input
                type="text"
                value={config.ilocsKeyword}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, ilocsKeyword: event.target.value }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Human before ilocs (hrs)
              </div>
              <input
                type="number"
                min={0}
                max={72}
                step={0.25}
                value={config.humanBeforeHours}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    humanBeforeHours: Number.parseFloat(event.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Human after ilocs (hrs)
              </div>
              <input
                type="number"
                min={0}
                max={72}
                step={0.25}
                value={config.humanAfterHours}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    humanAfterHours: Number.parseFloat(event.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-ink/20 px-3 py-2 text-sm text-ink"
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={reanalyze}
                disabled={!dataset || busy}
                className="w-full rounded-xl border border-ink/20 bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Recalculate
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted">
            <span className="rounded-full border border-ink/15 px-3 py-1">
              Source: {sourceMeta?.sourceWorkbook ?? 'Loading hardcoded dataset...'}
            </span>
            <span className="rounded-full border border-ink/15 px-3 py-1">
              Rows analyzed: {analysis?.parsedRows.toLocaleString() ?? 0}
            </span>
            {sourceMeta ? (
              <span className="rounded-full border border-ink/15 px-3 py-1">
                Raw rows: {sourceMeta.rawParsedRows.toLocaleString()}
              </span>
            ) : null}
            {analysis?.beaconFilterApplied ? (
              <>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Rows before beacon filter: {analysis.rawParsedRows.toLocaleString()}
                </span>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Beaconed assets: {analysis.beaconedAssetsCount.toLocaleString()}
                </span>
                <span className="rounded-full border border-ink/15 px-3 py-1">
                  Excluded (non-beaconed): {analysis.excludedNonBeaconRows.toLocaleString()}
                </span>
              </>
            ) : null}
            {loading ? (
              <span className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-ink">
                Loading hardcoded RTLS dataset...
              </span>
            ) : null}
            {busy ? (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-ink">
                Working...
              </span>
            ) : null}
          </div>
          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </section>

        {analysis ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="ilocs Room Changes"
                value={analysis.ilocsRoomChanges.toLocaleString()}
                onClick={() =>
                  openEventDrilldown(
                    'ilocs Room Changes',
                    'All deduplicated ilocs room-change events.',
                    analysis.drilldowns.ilocsEvents,
                  )
                }
              />
              <SummaryCard
                label="Human Room Changes"
                value={analysis.humanRoomChanges.toLocaleString()}
                onClick={() =>
                  openEventDrilldown(
                    'Human Room Changes',
                    'All deduplicated human room-change events.',
                    analysis.drilldowns.humanEvents,
                  )
                }
              />
              <SummaryCard
                label="Matched Room Changes"
                value={analysis.matchedRoomChanges.toLocaleString()}
                onClick={() =>
                  openMatchDrilldown(
                    'Matched Room Changes',
                    'ilocs and human room changes paired inside configured lag window.',
                    analysis.drilldowns.matchedEvents,
                  )
                }
              />
              <SummaryCard
                label="Rows Excluded (Non-Beaconed)"
                value={analysis.excludedNonBeaconRows.toLocaleString()}
                hint={
                  analysis.beaconFilterApplied
                    ? 'Filtered using beaconed assets sheet.'
                    : 'No beacon list applied.'
                }
                onClick={openExcludedDrilldown}
              />
              <SummaryCard
                label="Beaconed Assets With No ilocs Scans"
                value={
                  analysis.beaconFilterApplied
                    ? analysis.beaconedNeverIlocsCount.toLocaleString()
                    : '—'
                }
                hint={
                  analysis.beaconFilterApplied
                    ? `${analysis.beaconedNeverIlocsCount.toLocaleString()} of ${analysis.beaconedAssetsCount.toLocaleString()} beaconed assets.`
                    : 'No beaconed assets sheet found in this workbook.'
                }
                onClick={analysis.beaconFilterApplied ? openBeaconNeverIlocsDrilldown : undefined}
              />
              <SummaryCard
                label="ilocs Match Rate"
                value={formatPercent(analysis.ilocsMatchRate)}
                hint="Based on matched / ilocs room changes."
                onClick={() =>
                  openMatchDrilldown(
                    'Match Rate Drilldown',
                    'Underlying matched event pairs used in ilocs match rate.',
                    analysis.drilldowns.matchedEvents,
                  )
                }
              />
              <SummaryCard
                label="Human Coverage Rate"
                value={formatPercent(analysis.humanCoverageRate)}
                hint="Based on matched / human room changes."
                onClick={() =>
                  openMatchDrilldown(
                    'Coverage Rate Drilldown',
                    'Underlying matched event pairs used in human coverage rate.',
                    analysis.drilldowns.matchedEvents,
                  )
                }
              />
              <SummaryCard
                label="Most Accurate Area"
                value={mostAccurateArea?.location ?? '—'}
                hint={
                  mostAccurateArea
                    ? `${mostAccurateArea.facility} | ${formatPercent(mostAccurateArea.accuracyRate)} match rate (${mostAccurateArea.matchedCount.toLocaleString()}/${mostAccurateArea.ilocsCount.toLocaleString()})`
                    : 'No ilocs area events available.'
                }
                onClick={
                  mostAccurateArea
                    ? () => openAreaAccuracyDrilldown('Most Accurate Area', mostAccurateArea)
                    : undefined
                }
              />
              <SummaryCard
                label="Least Accurate Area"
                value={leastAccurateArea?.location ?? '—'}
                hint={
                  leastAccurateArea
                    ? `${leastAccurateArea.facility} | ${formatPercent(leastAccurateArea.accuracyRate)} match rate (${leastAccurateArea.matchedCount.toLocaleString()}/${leastAccurateArea.ilocsCount.toLocaleString()})`
                    : 'No ilocs area events available.'
                }
                onClick={
                  leastAccurateArea
                    ? () => openAreaAccuracyDrilldown('Least Accurate Area', leastAccurateArea)
                    : undefined
                }
              />
              <SummaryCard
                label="Median Lag (Human - ilocs)"
                value={formatHours(analysis.lagHours.median)}
                onClick={() =>
                  openMatchDrilldown(
                    'Lag Drilldown',
                    'Matched event pairs sorted by lag hours.',
                    analysis.drilldowns.matchedEvents,
                  )
                }
              />
              <SummaryCard
                label="P90 Lag"
                value={formatHours(analysis.lagHours.p90)}
                onClick={() =>
                  openMatchDrilldown(
                    'P90 Lag Drilldown',
                    'Matched event pairs sorted by lag hours.',
                    analysis.drilldowns.matchedEvents,
                  )
                }
              />
              <SummaryCard
                label="Unmatched ilocs / Human"
                value={`${analysis.unmatchedIlocsRoomChanges.toLocaleString()} / ${analysis.unmatchedHumanRoomChanges.toLocaleString()}`}
                onClick={openUnmatchedDrilldown}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Lag Bucket Distribution</h2>
                <p className="mt-1 text-xs text-muted">
                  Click any bucket to drill to the matched event pairs.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">Bucket</th>
                        <th className="border-b border-ink/10 py-2 text-right">Matches</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.lagBuckets.map((bucket) => {
                        const drillRows = analysis.drilldowns.lagBucketMatches[bucket.label] ?? []
                        return (
                          <tr
                            key={bucket.label}
                            className="cursor-pointer hover:bg-brand/5"
                            onClick={() =>
                              openMatchDrilldown(
                                `Lag Bucket: ${bucket.label}`,
                                'Matched pairs contributing to this lag bucket.',
                                drillRows,
                              )
                            }
                          >
                            <td className="border-b border-ink/5 py-2 pr-4">{bucket.label}</td>
                            <td className="border-b border-ink/5 py-2 text-right">
                              {bucket.count.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">ilocs Stage Distribution</h2>
                <p className="mt-1 text-xs text-muted">
                  Click a stage to drill to all ilocs events classified into that stage.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">Stage</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.stageSummaries.map((stage) => {
                        const drillRows = analysis.drilldowns.stageEvents[stage.stage] ?? []
                        return (
                          <tr
                            key={stage.stage}
                            className="cursor-pointer hover:bg-brand/5"
                            onClick={() =>
                              openEventDrilldown(
                                `Stage: ${stage.stage}`,
                                'ilocs events in this stage bucket.',
                                drillRows,
                              )
                            }
                          >
                            <td className="border-b border-ink/5 py-2 pr-4">{stage.stage}</td>
                            <td className="border-b border-ink/5 py-2 text-right">
                              {stage.count.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Top ilocs Transitions</h2>
                <p className="mt-1 text-xs text-muted">
                  Click any transition row to inspect the underlying transition events.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">From</th>
                        <th className="border-b border-ink/10 py-2 pr-4">To</th>
                        <th className="border-b border-ink/10 py-2 pr-4">Path Flag</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.transitionSummaries.slice(0, 20).map((transition) => {
                        const key = `${transition.from}|${transition.to}`
                        const drillRows = analysis.drilldowns.transitionEvents[key] ?? []
                        const clickable = drillRows.length > 0
                        return (
                          <tr
                            key={key}
                            className={clickable ? 'cursor-pointer hover:bg-brand/5' : ''}
                            onClick={() =>
                              clickable
                                ? openTransitionDrilldown(
                                    `Transition: ${transition.from} -> ${transition.to}`,
                                    'ilocs stage-to-stage transition events for this lane.',
                                    drillRows,
                                  )
                                : undefined
                            }
                          >
                            <td className="border-b border-ink/5 py-2 pr-4">{transition.from}</td>
                            <td className="border-b border-ink/5 py-2 pr-4">{transition.to}</td>
                            <td className="border-b border-ink/5 py-2 pr-4">
                              {transition.offPath ? 'Off-path' : 'Expected'}
                            </td>
                            <td className="border-b border-ink/5 py-2 text-right">
                              {transition.count.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Top Off-Path Transitions</h2>
                <p className="mt-1 text-xs text-muted">
                  Click any row to drill into specific off-path transition events.
                </p>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                        <th className="border-b border-ink/10 py-2 pr-4">From</th>
                        <th className="border-b border-ink/10 py-2 pr-4">To</th>
                        <th className="border-b border-ink/10 py-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.offPathTransitions.slice(0, 20).map((transition) => {
                        const key = `${transition.from}|${transition.to}`
                        const drillRows = analysis.drilldowns.offPathTransitionEvents[key] ?? []
                        const clickable = drillRows.length > 0
                        return (
                          <tr
                            key={key}
                            className={clickable ? 'cursor-pointer hover:bg-brand/5' : ''}
                            onClick={() =>
                              clickable
                                ? openTransitionDrilldown(
                                    `Off-Path Transition: ${transition.from} -> ${transition.to}`,
                                    'Off-path ilocs transition events for this lane.',
                                    drillRows,
                                  )
                                : undefined
                            }
                          >
                            <td className="border-b border-ink/5 py-2 pr-4">{transition.from}</td>
                            <td className="border-b border-ink/5 py-2 pr-4">{transition.to}</td>
                            <td className="border-b border-ink/5 py-2 text-right">
                              {transition.count.toLocaleString()}
                            </td>
                          </tr>
                        )
                      })}
                      {analysis.offPathTransitions.length === 0 ? (
                        <tr>
                          <td className="py-3 text-sm text-muted" colSpan={3}>
                            No off-path transitions detected under current stage mapping.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>
          </>
        ) : (
          <section className="rounded-3xl border border-ink/10 bg-white/90 p-8 text-sm text-muted shadow-sm">
            {loading
              ? 'Loading hardcoded RTLS workbook dataset...'
              : 'RTLS dataset is unavailable. Refresh or verify data/rtls-accuracy-dataset.json is deployed.'}
          </section>
        )}
      </main>

      {drilldown ? (
        <div className="fixed inset-0 z-50 bg-ink/60 p-4 md:p-8" role="dialog" aria-modal="true">
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col rounded-3xl border border-ink/15 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-ink/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-ink">{drilldown.title}</h3>
                {drilldown.subtitle ? <p className="text-sm text-muted">{drilldown.subtitle}</p> : null}
              </div>
              <button
                type="button"
                className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium text-ink"
                onClick={() => setDrilldown(null)}
              >
                Close
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-5 py-3 text-sm">
              <input
                type="text"
                value={drillSearch}
                onChange={(event) => {
                  setDrillSearch(event.target.value)
                  setDrillPage(1)
                }}
                placeholder="Search this drilldown..."
                className="min-w-[280px] flex-1 rounded-xl border border-ink/20 px-3 py-2"
              />
              <span className="rounded-full border border-ink/15 px-3 py-1 text-xs text-muted">
                Rows: {drillFilteredRows.length.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={exportDrilldownToExcel}
                disabled={drillFilteredRows.length === 0}
                className="rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                Export Excel
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-4">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                    {drilldown.columns.map((column) => (
                      <th
                        key={column.key}
                        className={`border-b border-ink/10 py-2 pr-4 ${column.align === 'right' ? 'text-right' : ''}`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drillPageRows.map((row, index) => (
                    <tr key={`${safeDrillPage}-${index}`}>
                      {drilldown.columns.map((column) => (
                        <td
                          key={`${safeDrillPage}-${index}-${column.key}`}
                          className={`border-b border-ink/5 py-2 pr-4 ${column.align === 'right' ? 'text-right' : ''}`}
                        >
                          {String(row[column.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {drillPageRows.length === 0 ? (
                    <tr>
                      <td
                        className="py-4 text-sm text-muted"
                        colSpan={Math.max(1, drilldown.columns.length)}
                      >
                        No rows match the current search.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-ink/10 px-5 py-3 text-sm">
              <span className="text-muted">
                Page {safeDrillPage} of {drillTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeDrillPage <= 1}
                  onClick={() => setDrillPage(Math.max(1, safeDrillPage - 1))}
                  className="rounded-full border border-ink/20 bg-white px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safeDrillPage >= drillTotalPages}
                  onClick={() => setDrillPage(Math.min(drillTotalPages, safeDrillPage + 1))}
                  className="rounded-full border border-ink/20 bg-white px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default RtlsAccuracyApp
