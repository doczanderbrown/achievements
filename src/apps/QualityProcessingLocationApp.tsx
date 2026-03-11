import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type QualityProcessingLocationAppProps = {
  onBack?: () => void
}

type QualityDataset = {
  meta: {
    generatedAt: string
    sourceWorkbooks: {
      quality: string
      inventory: string
    }
    qualityRows: number
    qualityOrRows: number
    qualityUsableRows: number
    qualitySkippedMissingDate: number
    qualitySkippedMissingInv: number
    inventoryRowsScanned: number
    inventoryRowsUsable: number
    inventoryMatchedInvKeys: number
    inventoryAggregateGroups: number
    matchedRows: number
    unmatchedRows: number
  }
  minReportedSerial: number | null
  maxReportedSerial: number | null
  lookups: {
    processingFacilities: string[]
    eventFacilities: string[]
    recordedBys: string[]
    qSubTypes: string[]
    qLevels: string[]
    invNames: string[]
    specialties: string[]
    itemTypes: string[]
    hsysTags: string[]
    months: string[]
  }
  rows: {
    reportedSerials: number[]
    processingFacilityIds: number[]
    eventFacilityIds: number[]
    recordedByIds: number[]
    qSubTypeIds: number[]
    qLevelIds: number[]
    invNameIds: number[]
    specialtyIds: number[]
    itemTypeIds: number[]
    hsysTagIds: number[]
    matchedFlags: number[]
  }
  inventoryAggregates: {
    monthIds: number[]
    processingFacilityIds: number[]
    specialtyIds: number[]
    itemTypeIds: number[]
    hsysTagIds: number[]
    counts: number[]
  }
}

type FilterOption = {
  id: number
  label: string
}

type SummaryRow = {
  id: number
  label: string
  count: number
  share: number
}

type DrilldownSubtypeRow = {
  qSubType: string
  count: number
  share: number
  topQLevel: string
  topReportingFacility: string
  topInvName: string
}

type DrilldownEventRow = {
  reportedSerial: number
  reportingFacility: string
  invName: string
  qSubType: string
  qLevel: string
  specialty: string
  itemType: string
  hsysTag: string
  recordedBy: string
  matched: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const EXCEL_OFFSET = 25569
const TOP_TREND_LOCATIONS = 4
const DRILLDOWN_PAGE_SIZE = 25
const PROCESSING_COLORS = ['#f59e0b', '#2563eb', '#10b981', '#0ea5e9', '#6366f1']
const RATE_COLOR = '#38bdf8'
const TRAYS_COLOR = '#9ccc65'
const EVENTS_COLOR = '#f28c28'
const SET_ITEM_TOKENS = ['set', 'tray']
const EASTERN_TIME_ZONE = 'America/New_York'
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const excelSerialToDate = (serial: number) => new Date((serial - EXCEL_OFFSET) * DAY_MS)
const excelSerialToEasternDisplayDate = (serial: number) => {
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return null

  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  return new Date(Date.UTC(year, month, day, 12))
}

const excelSerialToInputDate = (serial: number | null) => {
  if (serial === null || !Number.isFinite(serial)) return ''
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const parseInputDateParts = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null

  const parseTriplet = (left: string, middle: string, right: string) => {
    const year = Number.parseInt(left, 10)
    const month = Number.parseInt(middle, 10)
    const day = Number.parseInt(right, 10)
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
    return { year, month, day }
  }

  if (trimmed.includes('-')) {
    const [first, second, third] = trimmed.split('-')
    if (first && second && third) {
      if (first.length === 4) return parseTriplet(first, second, third)
      if (third.length === 4) return parseTriplet(third, first, second)
    }
  }

  if (trimmed.includes('/')) {
    const [first, second, third] = trimmed.split('/')
    if (first && second && third) {
      if (third.length === 4) return parseTriplet(third, first, second)
      if (first.length === 4) return parseTriplet(first, second, third)
    }
  }

  return null
}

const inputDateToExcelSerial = (value: string, endOfDay = false) => {
  if (!value) return null
  const parsed = parseInputDateParts(value)
  if (!parsed) return null

  const utc = Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS + EXCEL_OFFSET
  return endOfDay ? utc + 0.999999 : utc
}

const formatDate = (serial: number | null) => {
  if (serial === null || !Number.isFinite(serial)) return '—'
  const date = excelSerialToEasternDisplayDate(serial)
  if (!date) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: EASTERN_TIME_ZONE,
  })
}

const formatEasternTimestamp = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: 'short',
  })
}

const formatMonth = (monthKey: string) => {
  const [yearRaw, monthRaw] = monthKey.split('-')
  const year = Number.parseInt(yearRaw ?? '', 10)
  const month = Number.parseInt(monthRaw ?? '', 10)
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey
  const label = MONTH_LABELS[month - 1]
  if (!label) return monthKey
  return `${label} ${year}`
}

const formatNumber = (value: number) => value.toLocaleString('en-US')
const formatPercent = (value: number) => `${value.toFixed(1)}%`

const toMonthKey = (serial: number) => {
  const date = excelSerialToDate(serial)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

const isSetLikeItemType = (label: string) => {
  const normalized = label.trim().toLowerCase()
  return SET_ITEM_TOKENS.some((token) => normalized.includes(token))
}

const getTopLabelFromCounts = (counts: Map<number, number>, labels: string[]) => {
  let topId = -1
  let topCount = -1
  counts.forEach((count, id) => {
    if (count > topCount) {
      topCount = count
      topId = id
    }
  })
  return topId >= 0 ? labels[topId] ?? 'Unknown' : '—'
}

const FilterChecklist = ({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: FilterOption[]
  selected: number[]
  onChange: (next: number[]) => void
}) => {
  const selectedSet = useMemo(() => new Set(selected), [selected])

  const toggle = (id: number) => {
    if (selectedSet.has(id)) {
      onChange(selected.filter((value) => value !== id))
      return
    }
    onChange([...selected, id])
  }

  return (
    <article className="rounded-2xl border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        <p className="text-xs text-muted">{selected.length === 0 ? 'All selected' : `${selected.length} selected`}</p>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => onChange(options.map((option) => option.id))}
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
        >
          Check all
        </button>
      </div>

      <div className="mt-3 max-h-44 space-y-2 overflow-auto pr-1">
        {options.map((option) => {
          const checked = selectedSet.has(option.id)
          return (
            <label key={option.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option.id)}
                className="h-4 w-4 rounded border-brand/40 text-brand"
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>
    </article>
  )
}

const StatCard = ({ label, value, help }: { label: string; value: string; help: string }) => (
  <article className="rounded-2xl border border-ink/10 bg-white/90 p-4 shadow-sm">
    <p className="text-xs uppercase tracking-[0.14em] text-muted">{label}</p>
    <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    <p className="mt-1 text-xs text-muted">{help}</p>
  </article>
)

const toFilterOptions = (labels: string[]): FilterOption[] =>
  labels.map((label, id) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label))

const QualityProcessingLocationApp = ({ onBack }: QualityProcessingLocationAppProps) => {
  const [dataset, setDataset] = useState<QualityDataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [selectedProcessingFacilities, setSelectedProcessingFacilities] = useState<number[]>([])
  const [selectedEventFacilities, setSelectedEventFacilities] = useState<number[]>([])
  const [selectedSpecialties, setSelectedSpecialties] = useState<number[]>([])
  const [selectedItemTypes, setSelectedItemTypes] = useState<number[]>([])
  const [selectedHsysTags, setSelectedHsysTags] = useState<number[]>([])
  const [selectedQSubTypes, setSelectedQSubTypes] = useState<number[]>([])
  const [selectedQLevels, setSelectedQLevels] = useState<number[]>([])
  const [selectedRecordedBys, setSelectedRecordedBys] = useState<number[]>([])
  const [drilldownProcessingId, setDrilldownProcessingId] = useState<number | null>(null)
  const [drilldownPage, setDrilldownPage] = useState(1)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const datasetUrl = `${import.meta.env.BASE_URL}data/quality-by-processing-location.json`
        const response = await fetch(datasetUrl)
        if (!response.ok) {
          throw new Error(
            `Failed to load quality dataset (${response.status}) from ${datasetUrl}.`,
          )
        }

        const bodyText = await response.text()
        if (bodyText.trim().startsWith('<')) {
          throw new Error(
            `Quality dataset URL returned HTML instead of JSON (${datasetUrl}). This usually means a base-path mismatch in deployment.`,
          )
        }

        const parsed = JSON.parse(bodyText) as QualityDataset
        if (cancelled) return
        setDataset(parsed)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load quality dataset.')
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!dataset) return
    if (dateFrom || dateTo) return

    const minSerial = dataset.minReportedSerial
    const maxSerial = dataset.maxReportedSerial
    if (maxSerial === null || minSerial === null) return

    const defaultFrom = Math.max(minSerial, maxSerial - 180)
    setDateFrom(excelSerialToInputDate(defaultFrom))
    setDateTo(excelSerialToInputDate(maxSerial))
  }, [dataset, dateFrom, dateTo])

  const dateRange = useMemo(() => {
    if (!dataset) return null
    const minSerial = dataset.minReportedSerial ?? 0
    const maxSerial = dataset.maxReportedSerial ?? 0
    const fromSerial = inputDateToExcelSerial(dateFrom) ?? minSerial
    const toSerial = inputDateToExcelSerial(dateTo, true) ?? maxSerial
    return {
      fromSerial: Math.min(fromSerial, toSerial),
      toSerial: Math.max(fromSerial, toSerial),
    }
  }, [dataset, dateFrom, dateTo])

  const filterSets = useMemo(
    () => ({
      processing: new Set(selectedProcessingFacilities),
      eventFacility: new Set(selectedEventFacilities),
      specialty: new Set(selectedSpecialties),
      itemType: new Set(selectedItemTypes),
      hsysTag: new Set(selectedHsysTags),
      qSubType: new Set(selectedQSubTypes),
      qLevel: new Set(selectedQLevels),
      recordedBy: new Set(selectedRecordedBys),
    }),
    [
      selectedEventFacilities,
      selectedHsysTags,
      selectedItemTypes,
      selectedProcessingFacilities,
      selectedQLevels,
      selectedQSubTypes,
      selectedRecordedBys,
      selectedSpecialties,
    ],
  )

  const filteredIndices = useMemo(() => {
    if (!dataset || !dateRange) return []

    const { rows } = dataset
    const filtered: number[] = []
    const rowCount = rows.reportedSerials.length

    for (let index = 0; index < rowCount; index += 1) {
      const reportedSerial = rows.reportedSerials[index]
      if (reportedSerial < dateRange.fromSerial || reportedSerial > dateRange.toSerial) continue

      const processingId = rows.processingFacilityIds[index]
      if (selectedProcessingFacilities.length > 0 && !filterSets.processing.has(processingId)) continue

      const eventFacilityId = rows.eventFacilityIds[index]
      if (selectedEventFacilities.length > 0 && !filterSets.eventFacility.has(eventFacilityId)) continue

      const specialtyId = rows.specialtyIds[index]
      if (selectedSpecialties.length > 0 && !filterSets.specialty.has(specialtyId)) continue

      const itemTypeId = rows.itemTypeIds[index]
      if (selectedItemTypes.length > 0 && !filterSets.itemType.has(itemTypeId)) continue

      const hsysTagId = rows.hsysTagIds[index]
      if (selectedHsysTags.length > 0 && !filterSets.hsysTag.has(hsysTagId)) continue

      const qSubTypeId = rows.qSubTypeIds[index]
      if (selectedQSubTypes.length > 0 && !filterSets.qSubType.has(qSubTypeId)) continue

      const qLevelId = rows.qLevelIds[index]
      if (selectedQLevels.length > 0 && !filterSets.qLevel.has(qLevelId)) continue

      const recordedById = rows.recordedByIds[index]
      if (selectedRecordedBys.length > 0 && !filterSets.recordedBy.has(recordedById)) continue

      filtered.push(index)
    }

    return filtered
  }, [
    dataset,
    dateRange,
    filterSets,
    selectedEventFacilities.length,
    selectedHsysTags.length,
    selectedItemTypes.length,
    selectedProcessingFacilities.length,
    selectedQLevels.length,
    selectedQSubTypes.length,
    selectedRecordedBys.length,
    selectedSpecialties.length,
  ])

  const setLikeItemTypeIds = useMemo(() => {
    if (!dataset) return new Set<number>()
    const next = new Set<number>()
    dataset.lookups.itemTypes.forEach((label, id) => {
      if (isSetLikeItemType(label)) {
        next.add(id)
      }
    })
    return next
  }, [dataset])

  const sharedFilteredEventIndices = useMemo(() => {
    if (!dataset || !dateRange) return []

    const { rows } = dataset
    const filtered: number[] = []
    const rowCount = rows.reportedSerials.length

    for (let index = 0; index < rowCount; index += 1) {
      const reportedSerial = rows.reportedSerials[index]
      if (reportedSerial < dateRange.fromSerial || reportedSerial > dateRange.toSerial) continue
      if (rows.matchedFlags[index] !== 1) continue

      const processingId = rows.processingFacilityIds[index]
      if (selectedProcessingFacilities.length > 0 && !filterSets.processing.has(processingId)) continue

      const specialtyId = rows.specialtyIds[index]
      if (selectedSpecialties.length > 0 && !filterSets.specialty.has(specialtyId)) continue

      const itemTypeId = rows.itemTypeIds[index]
      if (!setLikeItemTypeIds.has(itemTypeId)) continue
      if (selectedItemTypes.length > 0 && !filterSets.itemType.has(itemTypeId)) continue

      const hsysTagId = rows.hsysTagIds[index]
      if (selectedHsysTags.length > 0 && !filterSets.hsysTag.has(hsysTagId)) continue

      filtered.push(index)
    }

    return filtered
  }, [
    dataset,
    dateRange,
    filterSets,
    selectedHsysTags.length,
    selectedItemTypes.length,
    selectedProcessingFacilities.length,
    selectedSpecialties.length,
    setLikeItemTypeIds,
  ])

  const withoutEventByMonth = useMemo(() => {
    if (!dataset || !dateRange) return []
    const { rows, lookups, inventoryAggregates } = dataset
    const fromMonth = toMonthKey(dateRange.fromSerial)
    const toMonth = toMonthKey(dateRange.toSerial)

    const traysByMonth = new Map<string, number>()
    for (let index = 0; index < inventoryAggregates.counts.length; index += 1) {
      const monthKey = lookups.months[inventoryAggregates.monthIds[index]]
      if (!monthKey) continue
      if (monthKey < fromMonth || monthKey > toMonth) continue

      const processingId = inventoryAggregates.processingFacilityIds[index]
      if (selectedProcessingFacilities.length > 0 && !filterSets.processing.has(processingId)) continue

      const specialtyId = inventoryAggregates.specialtyIds[index]
      if (selectedSpecialties.length > 0 && !filterSets.specialty.has(specialtyId)) continue

      const itemTypeId = inventoryAggregates.itemTypeIds[index]
      if (!setLikeItemTypeIds.has(itemTypeId)) continue
      if (selectedItemTypes.length > 0 && !filterSets.itemType.has(itemTypeId)) continue

      const hsysTagId = inventoryAggregates.hsysTagIds[index]
      if (selectedHsysTags.length > 0 && !filterSets.hsysTag.has(hsysTagId)) continue

      traysByMonth.set(monthKey, (traysByMonth.get(monthKey) ?? 0) + inventoryAggregates.counts[index])
    }

    const eventsByMonth = new Map<string, number>()
    sharedFilteredEventIndices.forEach((index) => {
      const monthKey = toMonthKey(rows.reportedSerials[index])
      if (monthKey < fromMonth || monthKey > toMonth) return
      eventsByMonth.set(monthKey, (eventsByMonth.get(monthKey) ?? 0) + 1)
    })

    const allMonths = new Set<string>([...traysByMonth.keys(), ...eventsByMonth.keys()])

    return Array.from(allMonths)
      .sort((left, right) => left.localeCompare(right))
      .map((monthKey) => {
        const traysProcessed = traysByMonth.get(monthKey) ?? 0
        const events = eventsByMonth.get(monthKey) ?? 0
        const setsWithoutEvents = Math.max(0, traysProcessed - events)
        const rateWithoutEvents = traysProcessed > 0 ? (setsWithoutEvents / traysProcessed) * 100 : 0
        return {
          monthKey,
          monthLabel: formatMonth(monthKey),
          traysProcessed,
          events,
          setsWithoutEvents,
          rateWithoutEvents,
        }
      })
  }, [
    dataset,
    dateRange,
    filterSets,
    selectedHsysTags.length,
    selectedItemTypes.length,
    selectedProcessingFacilities.length,
    selectedSpecialties.length,
    setLikeItemTypeIds,
    sharedFilteredEventIndices,
  ])

  const summary = useMemo(() => {
    if (!dataset) return null

    const { rows, lookups } = dataset
    const total = filteredIndices.length
    let matched = 0
    const counts = new Map<number, number>()

    filteredIndices.forEach((index) => {
      const processingId = rows.processingFacilityIds[index]
      counts.set(processingId, (counts.get(processingId) ?? 0) + 1)
      if (rows.matchedFlags[index] === 1) matched += 1
    })

    const byProcessing: SummaryRow[] = Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        label: lookups.processingFacilities[id] ?? 'Unknown',
        count,
        share: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((left, right) => right.count - left.count)

    const topLocation = byProcessing[0] ?? null

    return {
      total,
      matched,
      unmatched: Math.max(0, total - matched),
      matchRate: total > 0 ? (matched / total) * 100 : 0,
      byProcessing,
      topLocation,
    }
  }, [dataset, filteredIndices])

  useEffect(() => {
    if (!summary || summary.byProcessing.length === 0) {
      if (drilldownProcessingId !== null) {
        setDrilldownProcessingId(null)
      }
      return
    }

    const exists = summary.byProcessing.some((entry) => entry.id === drilldownProcessingId)
    if (!exists) {
      setDrilldownProcessingId(summary.byProcessing[0].id)
    }
  }, [summary, drilldownProcessingId])

  useEffect(() => {
    setDrilldownPage(1)
  }, [drilldownProcessingId, filteredIndices.length])

  const monthlyTrend = useMemo(() => {
    if (!dataset || !summary) return []
    const { rows } = dataset
    const topLocationIds = summary.byProcessing.slice(0, TOP_TREND_LOCATIONS).map((entry) => entry.id)
    const topLocationSet = new Set(topLocationIds)
    const monthMap = new Map<string, Map<number, number>>()

    filteredIndices.forEach((index) => {
      const monthKey = toMonthKey(rows.reportedSerials[index])
      const processingId = rows.processingFacilityIds[index]
      const bucketId = topLocationSet.has(processingId) ? processingId : -1
      const monthCounts = monthMap.get(monthKey)
      if (monthCounts) {
        monthCounts.set(bucketId, (monthCounts.get(bucketId) ?? 0) + 1)
      } else {
        monthMap.set(monthKey, new Map([[bucketId, 1]]))
      }
    })

    return Array.from(monthMap.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([monthKey, counts]) => {
        const row: Record<string, number | string> = {
          monthKey,
          monthLabel: formatMonth(monthKey),
        }
        topLocationIds.forEach((id) => {
          row[`loc-${id}`] = counts.get(id) ?? 0
        })
        row.other = counts.get(-1) ?? 0
        return row
      })
  }, [dataset, filteredIndices, summary])

  const drilldown = useMemo(() => {
    if (!dataset || drilldownProcessingId === null) return null
    const { rows, lookups } = dataset
    const processingLabel = lookups.processingFacilities[drilldownProcessingId] ?? 'Unknown'
    const selectedIndices = filteredIndices.filter(
      (index) => rows.processingFacilityIds[index] === drilldownProcessingId,
    )

    const subtypeMap = new Map<
      number,
      {
        count: number
        qLevelCounts: Map<number, number>
        reportingFacilityCounts: Map<number, number>
        invNameCounts: Map<number, number>
      }
    >()
    const eventRows: DrilldownEventRow[] = []

    selectedIndices.forEach((index) => {
      const qSubTypeId = rows.qSubTypeIds[index]
      const qLevelId = rows.qLevelIds[index]
      const reportingFacilityId = rows.eventFacilityIds[index]
      const invNameId = rows.invNameIds[index]

      const subtypeBucket = subtypeMap.get(qSubTypeId)
      if (subtypeBucket) {
        subtypeBucket.count += 1
        subtypeBucket.qLevelCounts.set(qLevelId, (subtypeBucket.qLevelCounts.get(qLevelId) ?? 0) + 1)
        subtypeBucket.reportingFacilityCounts.set(
          reportingFacilityId,
          (subtypeBucket.reportingFacilityCounts.get(reportingFacilityId) ?? 0) + 1,
        )
        subtypeBucket.invNameCounts.set(
          invNameId,
          (subtypeBucket.invNameCounts.get(invNameId) ?? 0) + 1,
        )
      } else {
        subtypeMap.set(qSubTypeId, {
          count: 1,
          qLevelCounts: new Map([[qLevelId, 1]]),
          reportingFacilityCounts: new Map([[reportingFacilityId, 1]]),
          invNameCounts: new Map([[invNameId, 1]]),
        })
      }

      eventRows.push({
        reportedSerial: rows.reportedSerials[index],
        reportingFacility: lookups.eventFacilities[reportingFacilityId] ?? 'Unknown',
        invName: lookups.invNames[invNameId] ?? 'Unknown',
        qSubType: lookups.qSubTypes[qSubTypeId] ?? 'Unknown',
        qLevel: lookups.qLevels[qLevelId] ?? 'Unknown',
        specialty: lookups.specialties[rows.specialtyIds[index]] ?? 'Unknown',
        itemType: lookups.itemTypes[rows.itemTypeIds[index]] ?? 'Unknown',
        hsysTag: lookups.hsysTags[rows.hsysTagIds[index]] ?? 'Unknown',
        recordedBy: lookups.recordedBys[rows.recordedByIds[index]] ?? 'Unknown',
        matched: rows.matchedFlags[index] === 1,
      })
    })

    eventRows.sort((left, right) => right.reportedSerial - left.reportedSerial)

    const subtypeRows: DrilldownSubtypeRow[] = Array.from(subtypeMap.entries())
      .map(([qSubTypeId, bucket]) => ({
        qSubType: lookups.qSubTypes[qSubTypeId] ?? 'Unknown',
        count: bucket.count,
        share: selectedIndices.length > 0 ? (bucket.count / selectedIndices.length) * 100 : 0,
        topQLevel: getTopLabelFromCounts(bucket.qLevelCounts, lookups.qLevels),
        topReportingFacility: getTopLabelFromCounts(
          bucket.reportingFacilityCounts,
          lookups.eventFacilities,
        ),
        topInvName: getTopLabelFromCounts(bucket.invNameCounts, lookups.invNames),
      }))
      .sort((left, right) => right.count - left.count)

    return {
      processingLabel,
      eventCount: selectedIndices.length,
      subtypeRows,
      eventRows,
    }
  }, [dataset, drilldownProcessingId, filteredIndices])

  const drilldownTotalPages = useMemo(() => {
    if (!drilldown) return 1
    return Math.max(1, Math.ceil(drilldown.eventRows.length / DRILLDOWN_PAGE_SIZE))
  }, [drilldown])

  useEffect(() => {
    if (drilldownPage > drilldownTotalPages) {
      setDrilldownPage(drilldownTotalPages)
    }
  }, [drilldownPage, drilldownTotalPages])

  const drilldownPageRows = useMemo(() => {
    if (!drilldown) return []
    const page = Math.max(1, Math.min(drilldownPage, drilldownTotalPages))
    const start = (page - 1) * DRILLDOWN_PAGE_SIZE
    return drilldown.eventRows.slice(start, start + DRILLDOWN_PAGE_SIZE)
  }, [drilldown, drilldownPage, drilldownTotalPages])

  const processingOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.processingFacilities) : []),
    [dataset],
  )
  const eventFacilityOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.eventFacilities) : []),
    [dataset],
  )
  const specialtyOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.specialties) : []),
    [dataset],
  )
  const itemTypeOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.itemTypes) : []),
    [dataset],
  )
  const hsysTagOptions = useMemo(() => (dataset ? toFilterOptions(dataset.lookups.hsysTags) : []), [dataset])
  const qSubTypeOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.qSubTypes) : []),
    [dataset],
  )
  const qLevelOptions = useMemo(() => (dataset ? toFilterOptions(dataset.lookups.qLevels) : []), [dataset])
  const recordedByOptions = useMemo(
    () => (dataset ? toFilterOptions(dataset.lookups.recordedBys) : []),
    [dataset],
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fff6eb] via-[#f4f6fb] to-[#e8f1ff] px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-muted">Quality Analytics</p>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink">
                Quality by Processing Location
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted">
                OR quality events are linked to the most recent processing record for the same inventory item where the
                processing completion timestamp is on or before the event report timestamp.
              </p>
            </div>
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="rounded-full border border-brand/40 bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
              >
                Back to app suite
              </button>
            ) : null}
          </div>

          {dataset ? (
            <p className="mt-4 text-xs text-muted">
              Source: {dataset.meta.sourceWorkbooks.quality} + {dataset.meta.sourceWorkbooks.inventory} | Date coverage:{' '}
              {formatDate(dataset.minReportedSerial)} to {formatDate(dataset.maxReportedSerial)} | Data refreshed:{' '}
              {formatEasternTimestamp(dataset.meta.generatedAt)}
            </p>
          ) : null}
        </header>

        {loading ? (
          <section className="rounded-3xl border border-ink/10 bg-white/90 p-8 text-sm text-muted shadow-sm">
            Loading quality dataset...
          </section>
        ) : null}

        {!loading && error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-8 text-sm text-red-700 shadow-sm">
            {error}
          </section>
        ) : null}

        {!loading && !error && dataset && summary ? (
          <div className="grid gap-6 xl:grid-cols-[370px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <article className="rounded-2xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                <h2 className="text-sm font-semibold text-ink">Date Range</h2>
                <div className="mt-3 grid gap-3">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
                    From
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(event) => setDateFrom(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
                    />
                  </label>
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
                    To
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(event) => setDateTo(event.target.value)}
                      className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
                    />
                  </label>
                </div>
              </article>

              <FilterChecklist
                label="Processing Location"
                options={processingOptions}
                selected={selectedProcessingFacilities}
                onChange={setSelectedProcessingFacilities}
              />
              <FilterChecklist
                label="Event Facility"
                options={eventFacilityOptions}
                selected={selectedEventFacilities}
                onChange={setSelectedEventFacilities}
              />
              <FilterChecklist
                label="Specialty"
                options={specialtyOptions}
                selected={selectedSpecialties}
                onChange={setSelectedSpecialties}
              />
              <FilterChecklist
                label="Item Type"
                options={itemTypeOptions}
                selected={selectedItemTypes}
                onChange={setSelectedItemTypes}
              />
              <FilterChecklist
                label="Hsys Tag"
                options={hsysTagOptions}
                selected={selectedHsysTags}
                onChange={setSelectedHsysTags}
              />
              <FilterChecklist
                label="Q Subtype"
                options={qSubTypeOptions}
                selected={selectedQSubTypes}
                onChange={setSelectedQSubTypes}
              />
              <FilterChecklist
                label="Q Level"
                options={qLevelOptions}
                selected={selectedQLevels}
                onChange={setSelectedQLevels}
              />
              <FilterChecklist
                label="Recorded By"
                options={recordedByOptions}
                selected={selectedRecordedBys}
                onChange={setSelectedRecordedBys}
              />
            </aside>

            <section className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="OR Events"
                  value={formatNumber(summary.total)}
                  help="Events after current filters."
                />
                <StatCard
                  label="Matched to Processing"
                  value={formatPercent(summary.matchRate)}
                  help={`${formatNumber(summary.matched)} of ${formatNumber(summary.total)} matched.`}
                />
                <StatCard
                  label="Unmatched Events"
                  value={formatNumber(summary.unmatched)}
                  help="No prior processing record found for same InvName."
                />
                <StatCard
                  label="Top Processing Location"
                  value={summary.topLocation ? summary.topLocation.label : '—'}
                  help={
                    summary.topLocation
                      ? `${formatNumber(summary.topLocation.count)} events (${formatPercent(summary.topLocation.share)})`
                      : 'No events in current filter range.'
                  }
                />
              </div>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Sets Processed Without OR Events</h2>
                <p className="mt-1 text-sm text-muted">
                  Monthly view of set-like items (Set/Vendor Set/etc): trays processed, OR events, and percent without
                  events.
                </p>
                {withoutEventByMonth.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">No processed-set volume found for the current shared filters.</p>
                ) : (
                  <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="h-[360px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={withoutEventByMonth}
                          margin={{ top: 12, right: 12, bottom: 12, left: 12 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.32)" />
                          <XAxis dataKey="monthLabel" />
                          <YAxis
                            yAxisId="percent"
                            orientation="left"
                            domain={[0, 100]}
                            tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                          />
                          <YAxis
                            yAxisId="count"
                            orientation="right"
                            tickFormatter={(value) => formatNumber(Number(value))}
                          />
                          <Tooltip
                            formatter={(value, name) => {
                              if (name === 'Rate Without Events') {
                                return formatPercent(Number(value))
                              }
                              return formatNumber(Number(value))
                            }}
                          />
                          <Legend />
                          <Bar
                            yAxisId="count"
                            dataKey="traysProcessed"
                            name="Trays Processed"
                            fill={TRAYS_COLOR}
                            opacity={0.9}
                          />
                          <Bar yAxisId="count" dataKey="events" name="Events" fill={EVENTS_COLOR} />
                          <Line
                            yAxisId="percent"
                            type="monotone"
                            dataKey="rateWithoutEvents"
                            name="Rate Without Events"
                            stroke={RATE_COLOR}
                            strokeWidth={2}
                            dot={false}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="max-h-[360px] overflow-auto rounded-2xl border border-ink/10 bg-white">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="sticky top-0 bg-white">
                          <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-[0.12em] text-muted">
                            <th className="px-3 py-2 font-semibold">Month</th>
                            <th className="px-3 py-2 font-semibold">Rate</th>
                            <th className="px-3 py-2 font-semibold">Trays</th>
                            <th className="px-3 py-2 font-semibold">Events</th>
                            <th className="px-3 py-2 font-semibold">Without Events</th>
                          </tr>
                        </thead>
                        <tbody>
                          {withoutEventByMonth.map((row) => (
                            <tr key={row.monthKey} className="border-b border-ink/10">
                              <td className="px-3 py-2 text-ink">{row.monthLabel}</td>
                              <td className="px-3 py-2 text-ink">{formatPercent(row.rateWithoutEvents)}</td>
                              <td className="px-3 py-2 text-ink">{formatNumber(row.traysProcessed)}</td>
                              <td className="px-3 py-2 text-ink">{formatNumber(row.events)}</td>
                              <td className="px-3 py-2 text-ink">{formatNumber(row.setsWithoutEvents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Quality Events by Processing Location</h2>
                <p className="mt-1 text-sm text-muted">
                  Event counts grouped by where inventory was last processed before the report timestamp.
                </p>
                <div className="mt-4 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={summary.byProcessing}
                      layout="vertical"
                      margin={{ top: 10, right: 24, bottom: 0, left: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.32)" />
                      <XAxis type="number" tickFormatter={(value) => formatNumber(Number(value ?? 0))} />
                      <YAxis type="category" width={180} dataKey="label" />
                      <Tooltip
                        formatter={(value) => formatNumber(Number(value ?? 0))}
                        labelFormatter={(label) => `Processing: ${label}`}
                      />
                      <Bar dataKey="count" name="Events" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Monthly Trend by Processing Location</h2>
                <p className="mt-1 text-sm text-muted">
                  Top {TOP_TREND_LOCATIONS} processing locations are shown separately; remaining locations are grouped as
                  Other.
                </p>
                <div className="mt-4 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend} margin={{ top: 10, right: 24, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.32)" />
                      <XAxis dataKey="monthLabel" />
                      <YAxis />
                      <Tooltip formatter={(value) => formatNumber(Number(value ?? 0))} />
                      <Legend />
                      {summary.byProcessing.slice(0, TOP_TREND_LOCATIONS).map((entry, index) => (
                        <Bar
                          key={entry.id}
                          dataKey={`loc-${entry.id}`}
                          stackId="month"
                          name={entry.label}
                          fill={PROCESSING_COLORS[index % PROCESSING_COLORS.length]}
                        />
                      ))}
                      <Bar dataKey="other" stackId="month" name="Other Locations" fill="#94a3b8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>

              <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-ink">Processing Location Summary</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-[0.12em] text-muted">
                        <th className="px-3 py-2 font-semibold">Processing Location</th>
                        <th className="px-3 py-2 font-semibold">Events</th>
                        <th className="px-3 py-2 font-semibold">Share</th>
                        <th className="px-3 py-2 font-semibold">Drilldown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byProcessing.map((entry) => (
                        <tr
                          key={entry.id}
                          className={`border-b border-ink/10 ${
                            drilldownProcessingId === entry.id ? 'bg-brand/5' : ''
                          }`}
                        >
                          <td className="px-3 py-2 text-ink">{entry.label}</td>
                          <td className="px-3 py-2 text-ink">{formatNumber(entry.count)}</td>
                          <td className="px-3 py-2 text-ink">{formatPercent(entry.share)}</td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setDrilldownProcessingId(entry.id)}
                              className="rounded-full border border-brand/40 bg-white px-3 py-1 text-xs font-semibold text-ink hover:bg-brand/10"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              {drilldown ? (
                <article className="rounded-3xl border border-ink/10 bg-white/90 p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-ink">
                        Drilldown: {drilldown.processingLabel}
                      </h2>
                      <p className="mt-1 text-sm text-muted">
                        {formatNumber(drilldown.eventCount)} events in current filters.
                      </p>
                    </div>
                    <label className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                      Processing Location
                      <select
                        value={drilldownProcessingId ?? ''}
                        onChange={(event) => {
                          const next = Number.parseInt(event.target.value, 10)
                          setDrilldownProcessingId(Number.isFinite(next) ? next : null)
                        }}
                        className="mt-1 block min-w-64 rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
                      >
                        {summary.byProcessing.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 overflow-x-auto">
                    <h3 className="mb-2 text-sm font-semibold text-ink">Issue Mix (Q Subtype)</h3>
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-[0.12em] text-muted">
                          <th className="px-3 py-2 font-semibold">Q Subtype</th>
                          <th className="px-3 py-2 font-semibold">Events</th>
                          <th className="px-3 py-2 font-semibold">Share</th>
                          <th className="px-3 py-2 font-semibold">Top Q Level</th>
                          <th className="px-3 py-2 font-semibold">Top Reporting Facility</th>
                          <th className="px-3 py-2 font-semibold">Top Inv Name</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldown.subtypeRows.map((row) => (
                          <tr key={row.qSubType} className="border-b border-ink/10">
                            <td className="px-3 py-2 text-ink">{row.qSubType}</td>
                            <td className="px-3 py-2 text-ink">{formatNumber(row.count)}</td>
                            <td className="px-3 py-2 text-ink">{formatPercent(row.share)}</td>
                            <td className="px-3 py-2 text-ink">{row.topQLevel}</td>
                            <td className="px-3 py-2 text-ink">{row.topReportingFacility}</td>
                            <td className="px-3 py-2 text-ink">{row.topInvName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-6 overflow-x-auto">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-ink">Event-Level Detail</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDrilldownPage((page) => Math.max(1, page - 1))}
                          disabled={drilldownPage <= 1}
                          className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <span className="text-xs text-muted">
                          Page {Math.min(drilldownPage, drilldownTotalPages)} of {drilldownTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDrilldownPage((page) => Math.min(drilldownTotalPages, page + 1))}
                          disabled={drilldownPage >= drilldownTotalPages}
                          className="rounded-full border border-ink/20 bg-white px-3 py-1 text-xs font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                    <table className="min-w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-[0.12em] text-muted">
                          <th className="px-3 py-2 font-semibold">Reported Date</th>
                          <th className="px-3 py-2 font-semibold">Reporting Facility</th>
                          <th className="px-3 py-2 font-semibold">Inv Name</th>
                          <th className="px-3 py-2 font-semibold">Q Subtype</th>
                          <th className="px-3 py-2 font-semibold">Q Level</th>
                          <th className="px-3 py-2 font-semibold">Specialty</th>
                          <th className="px-3 py-2 font-semibold">Item Type</th>
                          <th className="px-3 py-2 font-semibold">Hsys Tag</th>
                          <th className="px-3 py-2 font-semibold">Recorded By</th>
                          <th className="px-3 py-2 font-semibold">Matched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drilldownPageRows.map((row, index) => (
                          <tr key={`${row.reportedSerial}-${index}`} className="border-b border-ink/10">
                            <td className="px-3 py-2 text-ink">{formatDate(row.reportedSerial)}</td>
                            <td className="px-3 py-2 text-ink">{row.reportingFacility}</td>
                            <td className="px-3 py-2 text-ink">{row.invName}</td>
                            <td className="px-3 py-2 text-ink">{row.qSubType}</td>
                            <td className="px-3 py-2 text-ink">{row.qLevel}</td>
                            <td className="px-3 py-2 text-ink">{row.specialty}</td>
                            <td className="px-3 py-2 text-ink">{row.itemType}</td>
                            <td className="px-3 py-2 text-ink">{row.hsysTag}</td>
                            <td className="px-3 py-2 text-ink">{row.recordedBy}</td>
                            <td className="px-3 py-2 text-ink">{row.matched ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>
    </div>
  )
}

export default QualityProcessingLocationApp
