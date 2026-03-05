import { useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import type { FilterOption, ParseProgress, ProcessingLocationDataset } from './processingLocation/types'
import { parseProcessingLocationWorkbook } from './processingLocation/utils/parseProcessingLocationWorkbook'
import { parseCaseRoutingWorkbook } from './processingLocation/utils/parseCaseRoutingWorkbook'

type ProcessingLocationReportAppProps = {
  onBack?: () => void
}

type DashboardTab = 'mix' | 'no-go' | 'case-routing'
type DrilldownChart = 'mix' | 'no-go' | 'go'
type DrilldownSegment = 'onsite' | 'offsite'
type DrilldownSelection = {
  chart: DrilldownChart
  dayKey: number
  segment: DrilldownSegment
}
type CaseDrilldownChart = 'case-rate' | 'case-volume'
type CaseDrilldownSegment = 'hvn' | 'offsite' | 'other'
type CaseDrilldownSelection = {
  chart: CaseDrilldownChart
  dayKey: number
  segment: CaseDrilldownSegment
}

const DAY_MS = 24 * 60 * 60 * 1000
const DRILLDOWN_PAGE_SIZE = 100
const PERCENT_TICKS = [0, 20, 40, 60, 80, 100]
const DAY_ORDER: Array<{ key: number; label: string }> = [
  { key: 2, label: 'Mon' },
  { key: 3, label: 'Tue' },
  { key: 4, label: 'Wed' },
  { key: 5, label: 'Thu' },
  { key: 6, label: 'Fri' },
  { key: 7, label: 'Sat' },
  { key: 1, label: 'Sun' },
]
const DAY_LABEL_BY_KEY = new Map(DAY_ORDER.map((day) => [day.key, day.label]))
const CASE_ROUTE_LABEL_BY_ID = new Map<number, string>([
  [0, 'HVN On-Site'],
  [1, 'Off-Site'],
  [2, 'Other On-Site'],
])

const excelSerialToDate = (serial: number) => new Date((serial - 25569) * DAY_MS)

const dateToExcelSerial = (date: Date) => date.getTime() / DAY_MS + 25569

const excelSerialToInputDate = (serial: number | null) => {
  if (serial === null) return ''
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const inputDateToExcelSerial = (value: string) => {
  if (!value) return null
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number.parseInt(yearRaw ?? '', 10)
  const month = Number.parseInt(monthRaw ?? '', 10)
  const day = Number.parseInt(dayRaw ?? '', 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return Date.UTC(year, month - 1, day) / DAY_MS + 25569
}

const formatDate = (serial: number | null) => {
  if (serial === null) return '—'
  const date = excelSerialToDate(serial)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const toPercent = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)
const clampPercent = (value: number) => Math.max(0, Math.min(100, value))
const roundedPercent = (value: number) => Number(clampPercent(value).toFixed(4))

const buildSplitPercentages = (firstCount: number, secondCount: number) => {
  const total = firstCount + secondCount
  if (total === 0) {
    return { firstRate: 0, secondRate: 0 }
  }

  const firstRate = roundedPercent((firstCount / total) * 100)
  const secondRate = roundedPercent(100 - firstRate)
  return { firstRate, secondRate }
}

const formatPercent = (value: number, digits = 1) => `${value.toFixed(digits)}%`
const formatPercentSmart = (value: number) => {
  const clamped = clampPercent(value)
  if (clamped > 0 && clamped < 0.1) return '<0.1%'
  return formatPercent(clamped)
}
const formatTooltipPercent = (value: number | string | undefined) =>
  formatPercentSmart(Number(value ?? 0))

const getDrilldownSegmentLabel = (selection: DrilldownSelection) => {
  if (selection.chart === 'mix') {
    return selection.segment === 'offsite' ? 'Leave (Off-Site)' : 'Stay (On-Site)'
  }
  if (selection.chart === 'no-go') {
    return selection.segment === 'offsite'
      ? 'No-Go Exception (Off-Site)'
      : 'No-Go Compliant (On-Site)'
  }
  return selection.segment === 'offsite'
    ? 'Go Compliant (Off-Site)'
    : 'Go Stayed On-Site'
}

const getCaseDrilldownSegmentLabel = (selection: CaseDrilldownSelection) => {
  if (selection.segment === 'hvn') return 'HVN On-Site'
  if (selection.segment === 'offsite') return 'Off-Site'
  return 'Other On-Site'
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
    <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-muted">
          {selected.length === 0 ? 'All selected' : `${selected.length} selected`}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
          onClick={() => onChange([])}
        >
          Reset filter
        </button>
        <button
          type="button"
          className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
          onClick={() => onChange(options.map((option) => option.id))}
        >
          Check all
        </button>
      </div>
      <div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
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

const ProcessingLocationReportApp = ({ onBack }: ProcessingLocationReportAppProps) => {
  const [dataset, setDataset] = useState<ProcessingLocationDataset | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<ParseProgress | null>(null)
  const [selectedOwners, setSelectedOwners] = useState<number[]>([])
  const [selectedSpecialties, setSelectedSpecialties] = useState<number[]>([])
  const [selectedItemTypes, setSelectedItemTypes] = useState<number[]>([])
  const [selectedCaseFacilities, setSelectedCaseFacilities] = useState<number[]>([])
  const [selectedCaseItemTypes, setSelectedCaseItemTypes] = useState<number[]>([])
  const [selectedCaseCategories, setSelectedCaseCategories] = useState<number[]>([])
  const [includeOnsite, setIncludeOnsite] = useState(true)
  const [includeOffsite, setIncludeOffsite] = useState(true)
  const [includeHvnDispatch, setIncludeHvnDispatch] = useState(true)
  const [includeOffsiteDispatch, setIncludeOffsiteDispatch] = useState(true)
  const [includeOtherOnsiteDispatch, setIncludeOtherOnsiteDispatch] = useState(true)
  const [activeTab, setActiveTab] = useState<DashboardTab>('mix')
  const [drilldown, setDrilldown] = useState<DrilldownSelection | null>(null)
  const [drilldownPage, setDrilldownPage] = useState(1)
  const [caseDrilldown, setCaseDrilldown] = useState<CaseDrilldownSelection | null>(null)
  const [caseDrilldownPage, setCaseDrilldownPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exportingPdf, setExportingPdf] = useState(false)
  const dashboardExportRef = useRef<HTMLDivElement | null>(null)

  const specialtyLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset) return labels
    dataset.specialties.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const ownerLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset) return labels
    dataset.owners.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const itemTypeLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset) return labels
    dataset.itemTypes.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const caseFacilityLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset?.caseRouting) return labels
    dataset.caseRouting.caseFacilities.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const caseItemTypeLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset?.caseRouting) return labels
    dataset.caseRouting.caseItemTypes.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const caseCategoryLabelById = useMemo(() => {
    const labels = new Map<number, string>()
    if (!dataset?.caseRouting) return labels
    dataset.caseRouting.caseCategories.forEach((option) => labels.set(option.id, option.label))
    return labels
  }, [dataset])

  const dateRangeSerials = useMemo(() => {
    if (!dataset) return null
    const minSerial = dataset.minDateSerial ?? 0
    const maxSerial = dataset.maxDateSerial ?? 0
    const fromSerial = inputDateToExcelSerial(dateFrom) ?? minSerial
    const toSerial = inputDateToExcelSerial(dateTo) ?? maxSerial
    const startSerial = Math.min(fromSerial, toSerial)
    const endSerial = Math.max(fromSerial, toSerial)
    return { startSerial, endSerial }
  }, [dataset, dateFrom, dateTo])

  const handleUpload = async (file: File | null) => {
    if (!file) return
    setError(null)
    setLoading(true)
    setFileName(file.name)
    setProgress({ phase: 'sheets', message: 'Starting workbook parse...' })

    try {
      const parsed = await parseProcessingLocationWorkbook(file, (nextProgress) => {
        setProgress(nextProgress)
      })
      setProgress({
        phase: 'joining',
        message: 'Correlating case routing data (Cases -> Inventory -> Loads)...',
      })
      const caseRouting = await parseCaseRoutingWorkbook(file, (nextProgress) => {
        setProgress(nextProgress)
      })

      const combinedMinDate = [parsed.minDateSerial, caseRouting?.minCaseDateSerial ?? null].reduce<
        number | null
      >((acc, next) => {
        if (next === null) return acc
        if (acc === null) return next
        return Math.min(acc, next)
      }, null)
      const combinedMaxDate = [parsed.maxDateSerial, caseRouting?.maxCaseDateSerial ?? null].reduce<
        number | null
      >((acc, next) => {
        if (next === null) return acc
        if (acc === null) return next
        return Math.max(acc, next)
      }, null)

      const merged: ProcessingLocationDataset = {
        ...parsed,
        caseRouting,
        minDateSerial: combinedMinDate,
        maxDateSerial: combinedMaxDate,
      }

      setDataset(merged)
      setSelectedOwners([])
      setSelectedSpecialties([])
      setSelectedItemTypes([])
      setSelectedCaseFacilities([])
      setSelectedCaseItemTypes([])
      setSelectedCaseCategories([])
      setIncludeOnsite(true)
      setIncludeOffsite(true)
      setIncludeHvnDispatch(true)
      setIncludeOffsiteDispatch(true)
      setIncludeOtherOnsiteDispatch(true)
      setActiveTab(
        merged.rows.dateSerials.length > 0 ? 'mix' : merged.caseRouting ? 'case-routing' : 'mix',
      )
      setDrilldown(null)
      setDrilldownPage(1)
      setCaseDrilldown(null)
      setCaseDrilldownPage(1)
      if (merged.maxDateSerial !== null) {
        const maxDate = excelSerialToInputDate(merged.maxDateSerial)
        const sixMonthsBack = (() => {
          const maxDateObj = excelSerialToDate(merged.maxDateSerial)
          const start = new Date(maxDateObj)
          start.setMonth(start.getMonth() - 6)
          return dateToExcelSerial(start)
        })()
        setDateFrom(excelSerialToInputDate(sixMonthsBack))
        setDateTo(maxDate)
      } else {
        setDateFrom('')
        setDateTo('')
      }
    } catch (err) {
      setDataset(null)
      setDrilldown(null)
      setCaseDrilldown(null)
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to parse workbook. Please confirm it is a valid Loads and Inventory export.',
      )
    } finally {
      setLoading(false)
    }
  }

  const openDrilldown = (
    chart: DrilldownChart,
    segment: DrilldownSegment,
    index: number | undefined,
  ) => {
    if (index === undefined) return
    const day = DAY_ORDER[index]
    if (!day) return
    setCaseDrilldown(null)
    setCaseDrilldownPage(1)
    setDrilldown({ chart, segment, dayKey: day.key })
    setDrilldownPage(1)
  }

  const closeDrilldown = () => {
    setDrilldown(null)
    setDrilldownPage(1)
  }

  const openCaseDrilldown = (
    chart: CaseDrilldownChart,
    segment: CaseDrilldownSegment,
    index: number | undefined,
  ) => {
    if (index === undefined) return
    const day = DAY_ORDER[index]
    if (!day) return
    setDrilldown(null)
    setDrilldownPage(1)
    setCaseDrilldown({ chart, segment, dayKey: day.key })
    setCaseDrilldownPage(1)
  }

  const closeCaseDrilldown = () => {
    setCaseDrilldown(null)
    setCaseDrilldownPage(1)
  }

  const resetToLastSixMonths = () => {
    if (!dataset || dataset.maxDateSerial === null) return
    const maxDateObj = excelSerialToDate(dataset.maxDateSerial)
    const start = new Date(maxDateObj)
    start.setMonth(start.getMonth() - 6)
    setDateFrom(excelSerialToInputDate(dateToExcelSerial(start)))
    setDateTo(excelSerialToInputDate(dataset.maxDateSerial))
  }

  const resetToAllDates = () => {
    if (!dataset) return
    setDateFrom(excelSerialToInputDate(dataset.minDateSerial))
    setDateTo(excelSerialToInputDate(dataset.maxDateSerial))
  }

  const exportDashboardPdf = async () => {
    if (!dashboardExportRef.current || exportingPdf) return
    setExportingPdf(true)
    try {
      const canvas = await html2canvas(dashboardExportRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
      })
      const imageData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const margin = 24
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const renderWidth = pageWidth - margin * 2
      const renderHeight = (canvas.height * renderWidth) / canvas.width

      let remainingHeight = renderHeight
      let y = margin

      pdf.addImage(imageData, 'PNG', margin, y, renderWidth, renderHeight)
      remainingHeight -= pageHeight - margin * 2

      while (remainingHeight > 0) {
        pdf.addPage()
        y = margin - (renderHeight - remainingHeight)
        pdf.addImage(imageData, 'PNG', margin, y, renderWidth, renderHeight)
        remainingHeight -= pageHeight - margin * 2
      }

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      pdf.save(`processing-location-dashboard-${stamp}.pdf`)
    } finally {
      setExportingPdf(false)
    }
  }

  const analytics = useMemo(() => {
    if (!dataset || !dateRangeSerials) return null

    const specialtySet =
      selectedSpecialties.length > 0 ? new Set(selectedSpecialties) : null
    const itemTypeSet = selectedItemTypes.length > 0 ? new Set(selectedItemTypes) : null
    const ownerSet = selectedOwners.length > 0 ? new Set(selectedOwners) : null

    const dayBuckets: Record<
      number,
      {
        onsite: number
        offsite: number
        noGoOnsite: number
        noGoOffsite: number
        goOnsite: number
        goOffsite: number
      }
    > = {
      1: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      2: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      3: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      4: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      5: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      6: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
      7: { onsite: 0, offsite: 0, noGoOnsite: 0, noGoOffsite: 0, goOnsite: 0, goOffsite: 0 },
    }

    let totalRows = 0
    let totalOnsite = 0
    let totalOffsite = 0
    let noGoTotal = 0
    let noGoOnsite = 0
    let noGoOffsite = 0
    let goTotal = 0
    let goOnsite = 0
    let goOffsite = 0

    for (let i = 0; i < dataset.rows.dateSerials.length; i += 1) {
      const dateSerial = dataset.rows.dateSerials[i]
      if (dateSerial < dateRangeSerials.startSerial || dateSerial > dateRangeSerials.endSerial) {
        continue
      }

      const specialtyId = dataset.rows.specialtyIds[i]
      if (specialtySet && !specialtySet.has(specialtyId)) continue

      const itemTypeId = dataset.rows.itemTypeIds[i]
      if (itemTypeSet && !itemTypeSet.has(itemTypeId)) continue

      const ownerId = dataset.rows.ownerIds[i]
      if (ownerSet && !ownerSet.has(ownerId)) continue

      const dayOfWeek = dataset.rows.dayOfWeek[i]
      if (!dayBuckets[dayOfWeek]) continue

      const isOffsite = dataset.rows.offsiteFlags[i] === 1
      if ((isOffsite && !includeOffsite) || (!isOffsite && !includeOnsite)) continue
      const isNoGo = dataset.rows.noGoFlags[i] === 1

      totalRows += 1
      if (isOffsite) {
        totalOffsite += 1
        dayBuckets[dayOfWeek].offsite += 1
      } else {
        totalOnsite += 1
        dayBuckets[dayOfWeek].onsite += 1
      }

      if (isNoGo) {
        noGoTotal += 1
        if (isOffsite) {
          noGoOffsite += 1
          dayBuckets[dayOfWeek].noGoOffsite += 1
        } else {
          noGoOnsite += 1
          dayBuckets[dayOfWeek].noGoOnsite += 1
        }
      } else {
        goTotal += 1
        if (isOffsite) {
          goOffsite += 1
          dayBuckets[dayOfWeek].goOffsite += 1
        } else {
          goOnsite += 1
          dayBuckets[dayOfWeek].goOnsite += 1
        }
      }
    }

    const mixByDay = DAY_ORDER.map((day) => {
      const bucket = dayBuckets[day.key]
      const total = bucket.onsite + bucket.offsite
      const { firstRate: offsiteRate, secondRate: onsiteRate } = buildSplitPercentages(
        bucket.offsite,
        bucket.onsite,
      )
      return {
        day: day.label,
        total,
        onsiteCount: bucket.onsite,
        offsiteCount: bucket.offsite,
        onsiteRate,
        offsiteRate,
      }
    })

    const noGoByDay = DAY_ORDER.map((day) => {
      const bucket = dayBuckets[day.key]
      const total = bucket.noGoOnsite + bucket.noGoOffsite
      const { firstRate: expectedOnsiteRate, secondRate: offsiteRate } = buildSplitPercentages(
        bucket.noGoOnsite,
        bucket.noGoOffsite,
      )
      return {
        day: day.label,
        total,
        expectedOnsiteRate,
        offsiteRate,
      }
    })

    const goByDay = DAY_ORDER.map((day) => {
      const bucket = dayBuckets[day.key]
      const total = bucket.goOnsite + bucket.goOffsite
      const { firstRate: expectedOffsiteRate, secondRate: onsiteRate } = buildSplitPercentages(
        bucket.goOffsite,
        bucket.goOnsite,
      )
      return {
        day: day.label,
        total,
        onsiteRate,
        expectedOffsiteRate,
      }
    })

    const friday = dayBuckets[6]
    const fridayTotal = friday.onsite + friday.offsite
    const fridayOffsiteRate = toPercent(friday.offsite, fridayTotal)
    const nonFridayOnsite =
      totalOnsite - friday.onsite
    const nonFridayOffsite =
      totalOffsite - friday.offsite
    const nonFridayTotal = nonFridayOnsite + nonFridayOffsite
    const nonFridayOffsiteRate = toPercent(nonFridayOffsite, nonFridayTotal)

    const noGoComplianceRate = toPercent(noGoOnsite, noGoTotal)
    const goComplianceRate = toPercent(goOffsite, goTotal)
    const overallComplianceRate = toPercent(noGoOnsite + goOffsite, noGoTotal + goTotal)

    return {
      totalRows,
      totalOnsite,
      totalOffsite,
      mixByDay,
      noGoByDay,
      goByDay,
      fridayOffsiteRate,
      nonFridayOffsiteRate,
      noGoTotal,
      noGoOnsite,
      noGoOffsite,
      goTotal,
      goOnsite,
      goOffsite,
      noGoComplianceRate,
      goComplianceRate,
      overallComplianceRate,
      complianceBars: [
        {
          bucket: 'No-Go (Should Stay On-Site)',
          compliantRate: noGoComplianceRate,
          nonCompliantRate: 100 - noGoComplianceRate,
          total: noGoTotal,
        },
        {
          bucket: 'Go (Can Leave Off-Site)',
          compliantRate: goComplianceRate,
          nonCompliantRate: 100 - goComplianceRate,
          total: goTotal,
        },
      ],
    }
  }, [
    dataset,
    selectedOwners,
    selectedSpecialties,
    selectedItemTypes,
    includeOnsite,
    includeOffsite,
    dateRangeSerials,
  ])

  const caseRoutingAnalytics = useMemo(() => {
    if (!dataset?.caseRouting || !dateRangeSerials) return null

    const caseRouting = dataset.caseRouting
    const rows = caseRouting.rows
    const caseFacilitySet =
      selectedCaseFacilities.length > 0 ? new Set(selectedCaseFacilities) : null
    const caseItemTypeSet = selectedCaseItemTypes.length > 0 ? new Set(selectedCaseItemTypes) : null
    const caseCategorySet =
      selectedCaseCategories.length > 0 ? new Set(selectedCaseCategories) : null

    const includeRouteBucket = (bucketId: number) => {
      if (bucketId === 0) return includeHvnDispatch
      if (bucketId === 1) return includeOffsiteDispatch
      return includeOtherOnsiteDispatch
    }

    const dayBuckets: Record<number, { hvn: number; offsite: number; other: number }> = {
      1: { hvn: 0, offsite: 0, other: 0 },
      2: { hvn: 0, offsite: 0, other: 0 },
      3: { hvn: 0, offsite: 0, other: 0 },
      4: { hvn: 0, offsite: 0, other: 0 },
      5: { hvn: 0, offsite: 0, other: 0 },
      6: { hvn: 0, offsite: 0, other: 0 },
      7: { hvn: 0, offsite: 0, other: 0 },
    }

    const itemCounts = new Map<number, { hvn: number; offsite: number; other: number; total: number }>()
    const filteredRowIndices: number[] = []

    let total = 0
    let hvnCount = 0
    let offsiteCount = 0
    let otherOnsiteCount = 0
    let totalAllDates = 0
    let offsiteAllDates = 0

    for (let i = 0; i < rows.caseDateSerials.length; i += 1) {
      const caseFacilityId = rows.caseFacilityIds[i]
      if (caseFacilitySet && !caseFacilitySet.has(caseFacilityId)) continue

      const caseItemTypeId = rows.caseItemTypeIds[i]
      if (caseItemTypeSet && !caseItemTypeSet.has(caseItemTypeId)) continue

      const caseCategoryId = rows.caseCategoryIds[i]
      if (caseCategorySet && !caseCategorySet.has(caseCategoryId)) continue

      const routeBucketId = rows.routeBucketIds[i]
      if (!includeRouteBucket(routeBucketId)) continue

      totalAllDates += 1
      if (routeBucketId === 1) offsiteAllDates += 1

      const dateSerial = rows.caseDateSerials[i]
      if (dateSerial < dateRangeSerials.startSerial || dateSerial > dateRangeSerials.endSerial) {
        continue
      }

      const dayOfWeek = rows.dayOfWeek[i]
      if (!dayBuckets[dayOfWeek]) continue

      total += 1
      filteredRowIndices.push(i)

      if (routeBucketId === 0) {
        hvnCount += 1
        dayBuckets[dayOfWeek].hvn += 1
      } else if (routeBucketId === 1) {
        offsiteCount += 1
        dayBuckets[dayOfWeek].offsite += 1
      } else {
        otherOnsiteCount += 1
        dayBuckets[dayOfWeek].other += 1
      }

      const itemId = rows.caseItemNameIds[i]
      const counts = itemCounts.get(itemId) ?? { hvn: 0, offsite: 0, other: 0, total: 0 }
      if (routeBucketId === 0) counts.hvn += 1
      else if (routeBucketId === 1) counts.offsite += 1
      else counts.other += 1
      counts.total += 1
      itemCounts.set(itemId, counts)
    }

    const byDayRate = DAY_ORDER.map((day) => {
      const bucket = dayBuckets[day.key]
      const bucketTotal = bucket.hvn + bucket.offsite + bucket.other
      return {
        day: day.label,
        total: bucketTotal,
        hvnRate: roundedPercent(toPercent(bucket.hvn, bucketTotal)),
        offsiteRate: roundedPercent(toPercent(bucket.offsite, bucketTotal)),
        otherRate: roundedPercent(toPercent(bucket.other, bucketTotal)),
      }
    })

    const byDayVolume = DAY_ORDER.map((day) => {
      const bucket = dayBuckets[day.key]
      return {
        day: day.label,
        hvnCount: bucket.hvn,
        offsiteCount: bucket.offsite,
        otherCount: bucket.other,
      }
    })

    const topItems = Array.from(itemCounts.entries())
      .map(([itemId, counts]) => ({
        itemName: caseRouting.caseItemNames[itemId] ?? 'Unknown Item',
        hvnCount: counts.hvn,
        offsiteCount: counts.offsite,
        otherCount: counts.other,
        total: counts.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 25)

    const recentRows = filteredRowIndices
      .slice()
      .sort((a, b) => rows.caseDateSerials[b] - rows.caseDateSerials[a])
      .slice(0, 200)
      .map((rowIndex) => {
        const dayKey = rows.dayOfWeek[rowIndex]
        const caseFacilityId = rows.caseFacilityIds[rowIndex]
        const processingFacilityId = rows.processingFacilityIds[rowIndex]
        const itemTypeId = rows.caseItemTypeIds[rowIndex]
        const categoryId = rows.caseCategoryIds[rowIndex]
        const itemNameId = rows.caseItemNameIds[rowIndex]
        const routeBucketId = rows.routeBucketIds[rowIndex]

        return {
          date: formatDate(rows.caseDateSerials[rowIndex]),
          day: DAY_LABEL_BY_KEY.get(dayKey) ?? 'Unknown',
          caseFacility: caseFacilityLabelById.get(caseFacilityId) ?? 'Unknown Case Facility',
          processingFacility: caseRouting.processingFacilities[processingFacilityId] ?? 'Unknown',
          destination: CASE_ROUTE_LABEL_BY_ID.get(routeBucketId) ?? 'Unknown',
          itemName: caseRouting.caseItemNames[itemNameId] ?? 'Unknown Item',
          itemType: caseItemTypeLabelById.get(itemTypeId) ?? 'Unspecified',
          category: caseCategoryLabelById.get(categoryId) ?? 'Unspecified',
        }
      })

    const coverageRate = toPercent(caseRouting.matchedCaseRows, caseRouting.pickedCaseRows)

    return {
      total,
      hvnCount,
      offsiteCount,
      otherOnsiteCount,
      totalAllDates,
      offsiteAllDates,
      byDayRate,
      byDayVolume,
      topItems,
      recentRows,
      coverageRate,
      parsedCaseRows: caseRouting.parsedCaseRows,
      pickedCaseRows: caseRouting.pickedCaseRows,
      matchedCaseRows: caseRouting.matchedCaseRows,
      unmatchedCaseRows: caseRouting.unmatchedCaseRows,
    }
  }, [
    dataset,
    dateRangeSerials,
    selectedCaseFacilities,
    selectedCaseItemTypes,
    selectedCaseCategories,
    includeHvnDispatch,
    includeOffsiteDispatch,
    includeOtherOnsiteDispatch,
    caseFacilityLabelById,
    caseItemTypeLabelById,
    caseCategoryLabelById,
  ])

  const caseDrilldownResult = useMemo(() => {
    if (!dataset?.caseRouting || !caseDrilldown || !dateRangeSerials) return null

    const caseRouting = dataset.caseRouting
    const rows = caseRouting.rows
    const caseFacilitySet =
      selectedCaseFacilities.length > 0 ? new Set(selectedCaseFacilities) : null
    const caseItemTypeSet = selectedCaseItemTypes.length > 0 ? new Set(selectedCaseItemTypes) : null
    const caseCategorySet =
      selectedCaseCategories.length > 0 ? new Set(selectedCaseCategories) : null

    const segmentBucketId =
      caseDrilldown.segment === 'hvn' ? 0 : caseDrilldown.segment === 'offsite' ? 1 : 2

    const rowIndices: number[] = []
    const itemTypeCounts = new Map<string, number>()

    for (let i = 0; i < rows.caseDateSerials.length; i += 1) {
      const dateSerial = rows.caseDateSerials[i]
      if (dateSerial < dateRangeSerials.startSerial || dateSerial > dateRangeSerials.endSerial) {
        continue
      }

      const caseFacilityId = rows.caseFacilityIds[i]
      if (caseFacilitySet && !caseFacilitySet.has(caseFacilityId)) continue

      const caseItemTypeId = rows.caseItemTypeIds[i]
      if (caseItemTypeSet && !caseItemTypeSet.has(caseItemTypeId)) continue

      const caseCategoryId = rows.caseCategoryIds[i]
      if (caseCategorySet && !caseCategorySet.has(caseCategoryId)) continue

      if (rows.dayOfWeek[i] !== caseDrilldown.dayKey) continue
      if (rows.routeBucketIds[i] !== segmentBucketId) continue

      rowIndices.push(i)

      const itemTypeLabel = caseItemTypeLabelById.get(caseItemTypeId) ?? 'Unspecified'
      itemTypeCounts.set(itemTypeLabel, (itemTypeCounts.get(itemTypeLabel) ?? 0) + 1)
    }

    const itemTypeDistribution = Array.from(itemTypeCounts.entries())
      .map(([itemType, count]) => ({ itemType, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      rowIndices,
      itemTypeDistribution,
    }
  }, [
    dataset,
    caseDrilldown,
    dateRangeSerials,
    selectedCaseFacilities,
    selectedCaseItemTypes,
    selectedCaseCategories,
    caseItemTypeLabelById,
  ])

  const drilldownResult = useMemo(() => {
    if (!dataset || !drilldown || !dateRangeSerials) return null

    const specialtySet =
      selectedSpecialties.length > 0 ? new Set(selectedSpecialties) : null
    const itemTypeSet = selectedItemTypes.length > 0 ? new Set(selectedItemTypes) : null
    const ownerSet = selectedOwners.length > 0 ? new Set(selectedOwners) : null

    const rowIndices: number[] = []
    const specialtyCounts = new Map<string, number>()

    for (let i = 0; i < dataset.rows.dateSerials.length; i += 1) {
      const dateSerial = dataset.rows.dateSerials[i]
      if (dateSerial < dateRangeSerials.startSerial || dateSerial > dateRangeSerials.endSerial) {
        continue
      }

      const specialtyId = dataset.rows.specialtyIds[i]
      if (specialtySet && !specialtySet.has(specialtyId)) continue

      const itemTypeId = dataset.rows.itemTypeIds[i]
      if (itemTypeSet && !itemTypeSet.has(itemTypeId)) continue

      const ownerId = dataset.rows.ownerIds[i]
      if (ownerSet && !ownerSet.has(ownerId)) continue

      if (dataset.rows.dayOfWeek[i] !== drilldown.dayKey) continue

      const isOffsite = dataset.rows.offsiteFlags[i] === 1
      if ((isOffsite && !includeOffsite) || (!isOffsite && !includeOnsite)) continue
      const isNoGo = dataset.rows.noGoFlags[i] === 1
      const segmentMatch = drilldown.segment === 'offsite' ? isOffsite : !isOffsite
      if (!segmentMatch) continue

      if (drilldown.chart === 'no-go' && !isNoGo) continue
      if (drilldown.chart === 'go' && isNoGo) continue

      rowIndices.push(i)

      const specialtyLabel = specialtyLabelById.get(specialtyId) ?? 'Unspecified'
      specialtyCounts.set(specialtyLabel, (specialtyCounts.get(specialtyLabel) ?? 0) + 1)
    }

    const specialtyDistribution = Array.from(specialtyCounts.entries())
      .map(([specialty, count]) => ({ specialty, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    return {
      rowIndices,
      specialtyDistribution,
    }
  }, [
    dataset,
    drilldown,
    selectedOwners,
    selectedSpecialties,
    selectedItemTypes,
    includeOnsite,
    includeOffsite,
    dateRangeSerials,
    specialtyLabelById,
  ])

  const caseDrilldownCount = caseDrilldownResult?.rowIndices.length ?? 0
  const caseDrilldownTotalPages = Math.max(
    1,
    Math.ceil(caseDrilldownCount / DRILLDOWN_PAGE_SIZE),
  )
  const safeCaseDrilldownPage = Math.min(caseDrilldownPage, caseDrilldownTotalPages)

  const caseDrilldownRows = useMemo(() => {
    if (!dataset?.caseRouting || !caseDrilldownResult) return []

    const rows = dataset.caseRouting.rows
    const start = (safeCaseDrilldownPage - 1) * DRILLDOWN_PAGE_SIZE
    const end = start + DRILLDOWN_PAGE_SIZE
    const indices = caseDrilldownResult.rowIndices.slice(start, end)

    return indices.map((rowIndex) => {
      const dayKey = rows.dayOfWeek[rowIndex]
      const caseFacilityId = rows.caseFacilityIds[rowIndex]
      const caseInvValueId = rows.caseInvValueIds[rowIndex]
      const processingFacilityId = rows.processingFacilityIds[rowIndex]
      const routeBucketId = rows.routeBucketIds[rowIndex]
      const itemTypeId = rows.caseItemTypeIds[rowIndex]
      const categoryId = rows.caseCategoryIds[rowIndex]
      const itemNameId = rows.caseItemNameIds[rowIndex]

      return {
        date: formatDate(rows.caseDateSerials[rowIndex]),
        day: DAY_LABEL_BY_KEY.get(dayKey) ?? 'Unknown',
        caseFacility: caseFacilityLabelById.get(caseFacilityId) ?? 'Unknown Case Facility',
        processingFacility:
          dataset.caseRouting?.processingFacilities[processingFacilityId] ?? 'Unknown',
        destination: CASE_ROUTE_LABEL_BY_ID.get(routeBucketId) ?? 'Unknown',
        itemName: dataset.caseRouting?.caseItemNames[itemNameId] ?? 'Unknown Item',
        invNumber: dataset.caseRouting?.caseInvValues[caseInvValueId] ?? 'Unknown Inv',
        itemType: caseItemTypeLabelById.get(itemTypeId) ?? 'Unspecified',
        category: caseCategoryLabelById.get(categoryId) ?? 'Unspecified',
      }
    })
  }, [
    dataset,
    caseDrilldownResult,
    safeCaseDrilldownPage,
    caseFacilityLabelById,
    caseItemTypeLabelById,
    caseCategoryLabelById,
  ])

  const drilldownCount = drilldownResult?.rowIndices.length ?? 0
  const drilldownTotalPages = Math.max(1, Math.ceil(drilldownCount / DRILLDOWN_PAGE_SIZE))
  const safeDrilldownPage = Math.min(drilldownPage, drilldownTotalPages)

  const drilldownRows = useMemo(() => {
    if (!dataset || !drilldownResult) return []

    const start = (safeDrilldownPage - 1) * DRILLDOWN_PAGE_SIZE
    const end = start + DRILLDOWN_PAGE_SIZE
    const indices = drilldownResult.rowIndices.slice(start, end)

    return indices.map((rowIndex) => {
      const facilityId = dataset.rows.facilityIds[rowIndex]
      const loadId = dataset.rows.loadIds[rowIndex]
      const setNameId = dataset.rows.setNameIds[rowIndex]
      const specialtyId = dataset.rows.specialtyIds[rowIndex]
      const itemTypeId = dataset.rows.itemTypeIds[rowIndex]
      const ownerId = dataset.rows.ownerIds[rowIndex]
      const dayKey = dataset.rows.dayOfWeek[rowIndex]
      const isOffsite = dataset.rows.offsiteFlags[rowIndex] === 1

      return {
        setName: dataset.setNames[setNameId] ?? 'Unnamed Set',
        loadId: dataset.loadValues[loadId] ?? 'Unknown Load',
        date: formatDate(dataset.rows.dateSerials[rowIndex]),
        day: DAY_LABEL_BY_KEY.get(dayKey) ?? 'Unknown',
        location: isOffsite ? 'Off-Site' : 'On-Site',
        facility: dataset.facilities[facilityId] ?? 'Unknown',
        noGo: dataset.rows.noGoFlags[rowIndex] === 1 ? 'Yes' : 'No',
        specialty: specialtyLabelById.get(specialtyId) ?? 'Unspecified',
        itemType: itemTypeLabelById.get(itemTypeId) ?? 'Unspecified',
        owner: ownerLabelById.get(ownerId) ?? 'Unknown Owner',
      }
    })
  }, [
    dataset,
    drilldownResult,
    safeDrilldownPage,
    ownerLabelById,
    specialtyLabelById,
    itemTypeLabelById,
  ])

  const exportBucketExcel = () => {
    if (!dataset || !drilldown || !drilldownResult) return
    const rows = drilldownResult.rowIndices.map((rowIndex) => {
      const facilityId = dataset.rows.facilityIds[rowIndex]
      const loadId = dataset.rows.loadIds[rowIndex]
      const setNameId = dataset.rows.setNameIds[rowIndex]
      const specialtyId = dataset.rows.specialtyIds[rowIndex]
      const itemTypeId = dataset.rows.itemTypeIds[rowIndex]
      const ownerId = dataset.rows.ownerIds[rowIndex]
      const dayKey = dataset.rows.dayOfWeek[rowIndex]
      const isOffsite = dataset.rows.offsiteFlags[rowIndex] === 1

      return {
        SetName: dataset.setNames[setNameId] ?? 'Unnamed Set',
        LoadID: dataset.loadValues[loadId] ?? 'Unknown Load',
        Date: formatDate(dataset.rows.dateSerials[rowIndex]),
        Day: DAY_LABEL_BY_KEY.get(dayKey) ?? 'Unknown',
        Location: isOffsite ? 'Off-Site' : 'On-Site',
        Facility: dataset.facilities[facilityId] ?? 'Unknown',
        NoGo: dataset.rows.noGoFlags[rowIndex] === 1 ? 'Yes' : 'No',
        Specialty: specialtyLabelById.get(specialtyId) ?? 'Unspecified',
        ItemType: itemTypeLabelById.get(itemTypeId) ?? 'Unspecified',
        Owner: ownerLabelById.get(ownerId) ?? 'Unknown Owner',
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bucket')
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const day = (DAY_LABEL_BY_KEY.get(drilldown.dayKey) ?? 'day').toLowerCase()
    const segment = drilldown.segment === 'offsite' ? 'offsite' : 'onsite'
    XLSX.writeFile(workbook, `bucket-${drilldown.chart}-${day}-${segment}-${stamp}.xlsx`)
  }

  const exportCaseBucketExcel = () => {
    if (!dataset?.caseRouting || !caseDrilldown || !caseDrilldownResult) return

    const rows = caseDrilldownResult.rowIndices.map((rowIndex) => {
      const routeRows = dataset.caseRouting!.rows
      const dayKey = routeRows.dayOfWeek[rowIndex]
      const caseFacilityId = routeRows.caseFacilityIds[rowIndex]
      const processingFacilityId = routeRows.processingFacilityIds[rowIndex]
      const routeBucketId = routeRows.routeBucketIds[rowIndex]
      const itemTypeId = routeRows.caseItemTypeIds[rowIndex]
      const categoryId = routeRows.caseCategoryIds[rowIndex]
      const itemNameId = routeRows.caseItemNameIds[rowIndex]
      const caseInvValueId = routeRows.caseInvValueIds[rowIndex]

      return {
        Date: formatDate(routeRows.caseDateSerials[rowIndex]),
        Day: DAY_LABEL_BY_KEY.get(dayKey) ?? 'Unknown',
        CaseFacility: caseFacilityLabelById.get(caseFacilityId) ?? 'Unknown Case Facility',
        ProcessingFacility:
          dataset.caseRouting!.processingFacilities[processingFacilityId] ?? 'Unknown',
        Destination: CASE_ROUTE_LABEL_BY_ID.get(routeBucketId) ?? 'Unknown',
        Item: dataset.caseRouting!.caseItemNames[itemNameId] ?? 'Unknown Item',
        InvNumber: dataset.caseRouting!.caseInvValues[caseInvValueId] ?? 'Unknown Inv',
        ItemType: caseItemTypeLabelById.get(itemTypeId) ?? 'Unspecified',
        Category: caseCategoryLabelById.get(categoryId) ?? 'Unspecified',
      }
    })

    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CaseBucket')
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const day = (DAY_LABEL_BY_KEY.get(caseDrilldown.dayKey) ?? 'day').toLowerCase()
    const segment = caseDrilldown.segment
    XLSX.writeFile(workbook, `case-bucket-${caseDrilldown.chart}-${day}-${segment}-${stamp}.xlsx`)
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute -top-32 left-8 h-64 w-64 rounded-full bg-brand/30 blur-3xl" />
      <div className="pointer-events-none absolute top-24 right-10 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-8 left-1/3 h-80 w-80 rounded-full bg-brand/15 blur-[120px]" />

      <main ref={dashboardExportRef} className="relative mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
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

        <header className="rounded-3xl border border-brand/20 bg-white/85 p-8 shadow-sm">
          <p className="text-xs uppercase tracking-[0.28em] text-muted">Ascendco Analytics</p>
          <h1 className="mt-4 font-display text-4xl font-semibold text-ink">
            Processing Location Dashboard
          </h1>
          <p className="mt-3 max-w-3xl text-sm text-muted">
            Upload the Loads and Inventory workbook to measure where trays are processed (on-site
            vs off-site), view day-of-week rates over your selected date range, monitor No-Go
            compliance, and review case-to-processing routing in the dedicated Case Routing tab.
          </p>
        </header>

        <section className="glass-panel rounded-3xl border border-brand/20 p-5 shadow-md">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink">Upload .xlsx</span>
              <input
                type="file"
                accept=".xlsx"
                onChange={(event) => handleUpload(event.target.files?.[0] ?? null)}
                className="w-full rounded-xl border border-ink/20 bg-white px-4 py-2 text-sm"
              />
            </label>
            <div className="flex-1 text-sm text-muted">
              <div>File: {fileName || 'No file selected'}</div>
              <div>
                Window: {formatDate(dateRangeSerials?.startSerial ?? null)} to{' '}
                {formatDate(dateRangeSerials?.endSerial ?? null)}
              </div>
              <div>
                Rows parsed: {dataset?.parsedInventoryRows.toLocaleString() ?? 0} inventory /{' '}
                {dataset?.parsedLoadRows.toLocaleString() ?? 0} loads
              </div>
              <div>
                Rows matched to loads: {dataset?.matchedRows.toLocaleString() ?? 0}
                {dataset ? ` (${dataset.unmatchedRows.toLocaleString()} unmatched)` : ''}
              </div>
              <div>
                Case rows parsed: {dataset?.caseRouting?.parsedCaseRows.toLocaleString() ?? 0}
                {dataset?.caseRouting
                  ? ` (${dataset.caseRouting.matchedCaseRows.toLocaleString()} matched / ${dataset.caseRouting.unmatchedCaseRows.toLocaleString()} unmatched picked)`
                  : ''}
              </div>
              <div>
                Scan rows parsed: {dataset?.caseRouting?.parsedScanRows.toLocaleString() ?? 0}
                {dataset?.caseRouting
                  ? ` (${dataset.caseRouting.scanDestinationMatchRows.toLocaleString()} post-case destination matches)`
                  : ''}
              </div>
            </div>
          </div>
          {loading && progress ? (
            <div className="mt-4 rounded-2xl border border-accent/20 bg-white/80 px-4 py-3 text-sm text-muted">
              {progress.message}
            </div>
          ) : null}
          {dataset ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm text-muted">
                <span>From date</span>
                <input
                  type="date"
                  value={dateFrom}
                  min={excelSerialToInputDate(dataset.minDateSerial)}
                  max={excelSerialToInputDate(dataset.maxDateSerial)}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted">
                <span>To date</span>
                <input
                  type="date"
                  value={dateTo}
                  min={excelSerialToInputDate(dataset.minDateSerial)}
                  max={excelSerialToInputDate(dataset.maxDateSerial)}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-sm text-ink"
                />
              </label>
              <button
                type="button"
                onClick={resetToLastSixMonths}
                className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium text-ink"
              >
                Last 6 months
              </button>
              <button
                type="button"
                onClick={resetToAllDates}
                className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium text-ink"
              >
                All dates
              </button>
              <button
                type="button"
                onClick={exportDashboardPdf}
                disabled={exportingPdf}
                className="rounded-full border border-brand/40 bg-brand px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {exportingPdf ? 'Exporting PDF...' : 'Export Dashboard PDF'}
              </button>
            </div>
          ) : null}
        </section>

        {error ? (
          <section className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </section>
        ) : null}

        {!dataset ? (
          <section className="rounded-3xl border border-ink/10 bg-white/85 p-8 text-center text-sm text-muted shadow-sm">
            Upload a workbook to generate day-of-week leave/stay rates and the No-Go dashboard.
          </section>
        ) : (
          <>
            <section className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('mix')}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  activeTab === 'mix'
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/20 bg-white text-ink'
                }`}
              >
                Processing Mix
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('no-go')}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  activeTab === 'no-go'
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/20 bg-white text-ink'
                }`}
              >
                No-Go Dashboard
              </button>
              <button
                type="button"
                disabled={!dataset.caseRouting}
                onClick={() => setActiveTab('case-routing')}
                className={`rounded-full border px-4 py-2 text-sm font-medium ${
                  activeTab === 'case-routing'
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/20 bg-white text-ink'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                Case Routing
              </button>
            </section>

            {activeTab !== 'case-routing' ? (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FilterChecklist
                  label="Owning Facility Filter"
                  options={dataset.owners}
                  selected={selectedOwners}
                  onChange={setSelectedOwners}
                />
                <FilterChecklist
                  label="Specialty Filter"
                  options={dataset.specialties}
                  selected={selectedSpecialties}
                  onChange={setSelectedSpecialties}
                />
                <FilterChecklist
                  label="Item Type Filter"
                  options={dataset.itemTypes}
                  selected={selectedItemTypes}
                  onChange={setSelectedItemTypes}
                />
                <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-ink">Processing Location Filter</div>
                    <div className="text-xs text-muted">
                      {includeOnsite && includeOffsite
                        ? 'Both selected'
                        : includeOnsite
                          ? 'On-site only'
                          : includeOffsite
                            ? 'Off-site only'
                            : 'None selected'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={includeOnsite}
                        onChange={(event) => setIncludeOnsite(event.target.checked)}
                        className="h-4 w-4 rounded border-brand/40 text-brand"
                      />
                      On-Site
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={includeOffsite}
                        onChange={(event) => setIncludeOffsite(event.target.checked)}
                        className="h-4 w-4 rounded border-brand/40 text-brand"
                      />
                      Off-Site
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIncludeOnsite(true)
                      setIncludeOffsite(true)
                    }}
                    className="mt-3 rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
                  >
                    Reset to both
                  </button>
                </article>
              </section>
            ) : null}

            {activeTab === 'case-routing' && dataset.caseRouting ? (
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FilterChecklist
                  label="Case Facility Filter"
                  options={dataset.caseRouting.caseFacilities}
                  selected={selectedCaseFacilities}
                  onChange={setSelectedCaseFacilities}
                />
                <FilterChecklist
                  label="Case Item Type Filter"
                  options={dataset.caseRouting.caseItemTypes}
                  selected={selectedCaseItemTypes}
                  onChange={setSelectedCaseItemTypes}
                />
                <FilterChecklist
                  label="Case Category Filter"
                  options={dataset.caseRouting.caseCategories}
                  selected={selectedCaseCategories}
                  onChange={setSelectedCaseCategories}
                />
                <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-ink">Dispatch Destination Filter</div>
                    <div className="text-xs text-muted">
                      {includeHvnDispatch && includeOffsiteDispatch && includeOtherOnsiteDispatch
                        ? 'All selected'
                        : 'Custom selection'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={includeHvnDispatch}
                        onChange={(event) => setIncludeHvnDispatch(event.target.checked)}
                        className="h-4 w-4 rounded border-brand/40 text-brand"
                      />
                      HVN On-Site
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={includeOffsiteDispatch}
                        onChange={(event) => setIncludeOffsiteDispatch(event.target.checked)}
                        className="h-4 w-4 rounded border-brand/40 text-brand"
                      />
                      Off-Site
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-white px-3 py-1 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={includeOtherOnsiteDispatch}
                        onChange={(event) => setIncludeOtherOnsiteDispatch(event.target.checked)}
                        className="h-4 w-4 rounded border-brand/40 text-brand"
                      />
                      Other On-Site
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIncludeHvnDispatch(true)
                      setIncludeOffsiteDispatch(true)
                      setIncludeOtherOnsiteDispatch(true)
                    }}
                    className="mt-3 rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink"
                  >
                    Reset destinations
                  </button>
                </article>
              </section>
            ) : null}

            {activeTab !== 'case-routing' && analytics && analytics.totalRows === 0 ? (
              <section className="rounded-3xl border border-ink/10 bg-white/85 p-8 text-center text-sm text-muted shadow-sm">
                No rows match the current filter selection in the current date window.
              </section>
            ) : null}

            {analytics && analytics.totalRows > 0 && activeTab === 'mix' ? (
              <>
                <section className="grid gap-4 md:grid-cols-4">
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Trays In Window
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {analytics.totalRows.toLocaleString()}
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Leave (Off-Site) Rate
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(toPercent(analytics.totalOffsite, analytics.totalRows))}
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Stay (On-Site) Rate
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(toPercent(analytics.totalOnsite, analytics.totalRows))}
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Friday vs Other Days
                    </div>
                    <div className="mt-2 text-sm text-ink">
                      Friday leave rate: <strong>{formatPercent(analytics.fridayOffsiteRate)}</strong>
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      Other-day leave rate: {formatPercent(analytics.nonFridayOffsiteRate)}
                    </div>
                  </article>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Leave vs Stay by Day of Week (Rate)
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Aggregated across the selected date range; each day normalized to percentage.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Click any bar segment to drill into sets in that bucket.
                  </p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.mixByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis
                          domain={[0, 100]}
                          ticks={PERCENT_TICKS}
                          allowDataOverflow
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined, name: string | undefined) => [
                            formatTooltipPercent(value),
                            name === 'offsiteRate' ? 'Leave (Off-Site)' : 'Stay (On-Site)',
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="offsiteRate"
                          stackId="mix"
                          fill="rgb(var(--accent-rgb))"
                          name="Leave (Off-Site)"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('mix', 'offsite', index)}
                        />
                        <Bar
                          dataKey="onsiteRate"
                          stackId="mix"
                          fill="rgb(var(--brand-rgb))"
                          name="Stay (On-Site)"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('mix', 'onsite', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Leave vs Stay by Day of Week (Volume)
                  </div>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.mixByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar
                          dataKey="offsiteCount"
                          fill="rgb(var(--accent-rgb))"
                          name="Leave (Off-Site) Count"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('mix', 'offsite', index)}
                        />
                        <Bar
                          dataKey="onsiteCount"
                          fill="rgb(var(--brand-rgb))"
                          name="Stay (On-Site) Count"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('mix', 'onsite', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === 'case-routing' && !dataset.caseRouting ? (
              <section className="rounded-3xl border border-ink/10 bg-white/85 p-8 text-center text-sm text-muted shadow-sm">
                No `Cases` sheet was detected in this upload. Upload a workbook that includes Cases
                data plus Inventory/Loads to calculate case dispatch routing.
              </section>
            ) : null}

            {activeTab === 'case-routing' && caseRoutingAnalytics && caseRoutingAnalytics.total === 0 ? (
              <section className="rounded-3xl border border-ink/10 bg-white/85 p-8 text-center text-sm text-muted shadow-sm">
                {dataset.caseRouting &&
                (dataset.caseRouting.parsedInventoryRows === 0 ||
                  dataset.caseRouting.parsedLoadRows === 0)
                  ? 'Cases were found, but Inventory/Loads sheets were not available for correlation in this workbook.'
                  : dataset.caseRouting &&
                      dataset.caseRouting.parsedCaseRows > 0 &&
                      dataset.caseRouting.pickedCaseRows === 0
                    ? 'Cases sheet appears to be summary-level (missing item-level fields like InvIDRecommended and ItemStatus=Picked), so case-to-processing routing cannot be calculated from this export.'
                  : 'No matched case-routing rows for the current date range and filter selection.'}
              </section>
            ) : null}

            {activeTab === 'case-routing' && caseRoutingAnalytics && caseRoutingAnalytics.total > 0 ? (
              <>
                <section className="grid gap-4 md:grid-cols-4">
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Matched Picked Items
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {caseRoutingAnalytics.total.toLocaleString()}
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Sent To HVN On-Site
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(toPercent(caseRoutingAnalytics.hvnCount, caseRoutingAnalytics.total))}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {caseRoutingAnalytics.hvnCount.toLocaleString()} items
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Sent To Off-Site
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercentSmart(
                        toPercent(caseRoutingAnalytics.offsiteCount, caseRoutingAnalytics.total),
                      )}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      {caseRoutingAnalytics.offsiteCount.toLocaleString()} items
                    </div>
                    {caseRoutingAnalytics.offsiteCount === 0 &&
                    caseRoutingAnalytics.offsiteAllDates > 0 ? (
                      <div className="mt-1 text-xs text-muted">
                        0 in current date window. Full-range off-site:{' '}
                        {caseRoutingAnalytics.offsiteAllDates.toLocaleString()} items.
                      </div>
                    ) : null}
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Match Coverage
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(caseRoutingAnalytics.coverageRate)}
                    </div>
                    <div className="mt-1 text-sm text-muted">
                      Picked: {caseRoutingAnalytics.pickedCaseRows.toLocaleString()} / Matched:{' '}
                      {caseRoutingAnalytics.matchedCaseRows.toLocaleString()}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Exact InvID matches: {dataset.caseRouting?.exactMatchRows.toLocaleString() ?? 0} | Fallback item-name matches: {dataset.caseRouting?.fallbackItemNameMatchRows.toLocaleString() ?? 0}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Scan-history destination matches:{' '}
                      {dataset.caseRouting?.scanDestinationMatchRows.toLocaleString() ?? 0}
                    </div>
                    {dataset.caseRouting &&
                    dataset.caseRouting.parsedScanRows > 0 &&
                    dataset.caseRouting.scanDestinationMatchRows === 0 ? (
                      <div className="mt-1 text-xs text-muted">
                        No scan rows were found after matched case dates; verify scan date coverage.
                      </div>
                    ) : null}
                  </article>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Case Dispatch by Day of Week (Rate)
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    Correlated with Inventory/Loads by InvID + time window. Unmatched picked rows
                    are excluded.
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Click any bar segment to drill into the underlying case rows.
                  </p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={caseRoutingAnalytics.byDayRate}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis
                          domain={[0, 100]}
                          ticks={PERCENT_TICKS}
                          allowDataOverflow
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined, name: string | undefined) => {
                            const label =
                              name === 'hvnRate'
                                ? 'HVN On-Site'
                                : name === 'offsiteRate'
                                  ? 'Off-Site'
                                  : 'Other On-Site'
                            return [formatTooltipPercent(value), label]
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="hvnRate"
                          stackId="case-rate"
                          fill="rgb(var(--brand-rgb))"
                          name="HVN On-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-rate', 'hvn', index)}
                        />
                        <Bar
                          dataKey="offsiteRate"
                          stackId="case-rate"
                          fill="rgb(var(--accent-rgb))"
                          name="Off-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-rate', 'offsite', index)}
                        />
                        <Bar
                          dataKey="otherRate"
                          stackId="case-rate"
                          fill="rgb(var(--success-rgb))"
                          name="Other On-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-rate', 'other', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Case Dispatch by Day of Week (Volume)
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Click any bar segment to drill into the underlying case rows.
                  </p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={caseRoutingAnalytics.byDayVolume}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar
                          dataKey="hvnCount"
                          stackId="case-volume"
                          fill="rgb(var(--brand-rgb))"
                          name="HVN On-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-volume', 'hvn', index)}
                        />
                        <Bar
                          dataKey="offsiteCount"
                          stackId="case-volume"
                          fill="rgb(var(--accent-rgb))"
                          name="Off-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-volume', 'offsite', index)}
                        />
                        <Bar
                          dataKey="otherCount"
                          stackId="case-volume"
                          fill="rgb(var(--success-rgb))"
                          name="Other On-Site"
                          cursor="pointer"
                          onClick={(_, index) => openCaseDrilldown('case-volume', 'other', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">Top Routed Items</div>
                  <p className="mt-1 text-sm text-muted">
                    Items most frequently routed from cases to processing destinations.
                  </p>
                  <div className="mt-4 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2">HVN On-Site</th>
                          <th className="px-2 py-2">Off-Site</th>
                          <th className="px-2 py-2">Other On-Site</th>
                          <th className="px-2 py-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseRoutingAnalytics.topItems.map((row) => (
                          <tr key={row.itemName} className="border-t border-ink/10">
                            <td className="px-2 py-2 text-ink">{row.itemName}</td>
                            <td className="px-2 py-2 text-ink">{row.hvnCount.toLocaleString()}</td>
                            <td className="px-2 py-2 text-ink">{row.offsiteCount.toLocaleString()}</td>
                            <td className="px-2 py-2 text-ink">{row.otherCount.toLocaleString()}</td>
                            <td className="px-2 py-2 font-medium text-ink">{row.total.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">Matched Case Routing Details</div>
                  <div className="mt-4 overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                          <th className="px-2 py-2">Date</th>
                          <th className="px-2 py-2">Day</th>
                          <th className="px-2 py-2">Case Facility</th>
                          <th className="px-2 py-2">Processing Facility</th>
                          <th className="px-2 py-2">Destination</th>
                          <th className="px-2 py-2">Item</th>
                          <th className="px-2 py-2">Item Type</th>
                          <th className="px-2 py-2">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseRoutingAnalytics.recentRows.map((row, index) => (
                          <tr key={`${row.itemName}-${row.date}-${index}`} className="border-t border-ink/10">
                            <td className="px-2 py-2 text-ink">{row.date}</td>
                            <td className="px-2 py-2 text-ink">{row.day}</td>
                            <td className="px-2 py-2 text-ink">{row.caseFacility}</td>
                            <td className="px-2 py-2 text-ink">{row.processingFacility}</td>
                            <td className="px-2 py-2 text-ink">{row.destination}</td>
                            <td className="px-2 py-2 text-ink">{row.itemName}</td>
                            <td className="px-2 py-2 text-ink">{row.itemType}</td>
                            <td className="px-2 py-2 text-ink">{row.category}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            ) : null}

            {analytics && analytics.totalRows > 0 && activeTab === 'no-go' ? (
              <>
                <section className="grid gap-4 md:grid-cols-4">
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">No-Go Rows</div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {analytics.noGoTotal.toLocaleString()}
                    </div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      No-Go Compliance
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(analytics.noGoComplianceRate)}
                    </div>
                    <div className="mt-1 text-sm text-muted">Expected: on-site</div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Go Compliance
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(analytics.goComplianceRate)}
                    </div>
                    <div className="mt-1 text-sm text-muted">Expected: off-site</div>
                  </article>
                  <article className="rounded-3xl border border-ink/10 bg-white/90 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted">
                      Combined Compliance
                    </div>
                    <div className="mt-2 text-2xl font-semibold text-ink">
                      {formatPercent(analytics.overallComplianceRate)}
                    </div>
                  </article>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    No-Go Rows by Day (Expected to Stay On-Site)
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Click any bar segment to drill into sets in that bucket.
                  </p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.noGoByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis
                          domain={[0, 100]}
                          ticks={PERCENT_TICKS}
                          allowDataOverflow
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined, name: string | undefined) => [
                            formatTooltipPercent(value),
                            name === 'expectedOnsiteRate'
                              ? 'Stayed On-Site (Compliant)'
                              : 'Left Off-Site (Exception)',
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="expectedOnsiteRate"
                          stackId="nogo"
                          fill="rgb(var(--brand-rgb))"
                          name="Stayed On-Site (Compliant)"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('no-go', 'onsite', index)}
                        />
                        <Bar
                          dataKey="offsiteRate"
                          stackId="nogo"
                          fill="rgb(var(--accent-rgb))"
                          name="Left Off-Site (Exception)"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('no-go', 'offsite', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Compliance by Rule Type
                  </div>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.complianceBars} margin={{ left: 16, right: 16 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} interval={0} />
                        <YAxis
                          domain={[0, 100]}
                          ticks={PERCENT_TICKS}
                          allowDataOverflow
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined, name: string | undefined) => [
                            formatTooltipPercent(value),
                            name === 'compliantRate' ? 'Compliant' : 'Non-Compliant',
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="compliantRate"
                          stackId="compliance"
                          fill="rgb(var(--success-rgb))"
                          name="Compliant"
                        />
                        <Bar
                          dataKey="nonCompliantRate"
                          stackId="compliance"
                          fill="rgb(239 68 68)"
                          name="Non-Compliant"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="rounded-3xl border border-ink/10 bg-white/90 p-6 shadow-sm">
                  <div className="text-sm font-semibold text-ink">
                    Go Rows by Day (Expected to Leave Off-Site)
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Click any bar segment to drill into sets in that bucket.
                  </p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.goByDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                        <XAxis dataKey="day" />
                        <YAxis
                          domain={[0, 100]}
                          ticks={PERCENT_TICKS}
                          allowDataOverflow
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip
                          formatter={(value: number | string | undefined, name: string | undefined) => [
                            formatTooltipPercent(value),
                            name === 'expectedOffsiteRate'
                              ? 'Left Off-Site (Compliant)'
                              : 'Stayed On-Site',
                          ]}
                        />
                        <Legend />
                        <Bar
                          dataKey="expectedOffsiteRate"
                          stackId="go"
                          fill="rgb(var(--accent-rgb))"
                          name="Left Off-Site (Compliant)"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('go', 'offsite', index)}
                        />
                        <Bar
                          dataKey="onsiteRate"
                          stackId="go"
                          fill="rgb(var(--brand-rgb))"
                          name="Stayed On-Site"
                          cursor="pointer"
                          onClick={(_, index) => openDrilldown('go', 'onsite', index)}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </>
            ) : null}
          </>
        )}
      </main>

      {dataset && drilldown && drilldownResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/65 p-4">
          <button
            type="button"
            aria-label="Close bucket details"
            className="absolute inset-0 cursor-default"
            onClick={closeDrilldown}
          />
          <section
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-ink/15 bg-white shadow-2xl"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-5 py-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted">Bucket Drilldown</div>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {getDrilldownSegmentLabel(drilldown)} on{' '}
                  {DAY_LABEL_BY_KEY.get(drilldown.dayKey) ?? 'Unknown'}
                </h2>
                <div className="mt-1 text-sm text-muted">
                  {drilldownCount.toLocaleString()} sets match this bucket in the filtered date
                  window.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportBucketExcel}
                  className="rounded-full border border-accent/30 bg-accent px-4 py-2 text-sm font-medium text-white"
                >
                  Download Bucket Excel
                </button>
                <button
                  type="button"
                  onClick={closeDrilldown}
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium text-ink"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="grid gap-4 border-b border-ink/10 px-5 py-4 md:grid-cols-2">
              <article className="rounded-2xl border border-ink/10 bg-white p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted">Top Specialties</div>
                <div className="mt-2 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={drilldownResult.specialtyDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                      <XAxis dataKey="specialty" tick={{ fontSize: 11 }} interval={0} angle={-20} height={56} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="rgb(var(--accent-rgb))" name="Sets" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
              <article className="rounded-2xl border border-ink/10 bg-white p-3 text-sm text-muted">
                <div className="text-xs uppercase tracking-[0.14em] text-muted">Details</div>
                <div className="mt-2">
                  Day: <span className="font-medium text-ink">{DAY_LABEL_BY_KEY.get(drilldown.dayKey) ?? 'Unknown'}</span>
                </div>
                <div className="mt-1">
                  Segment: <span className="font-medium text-ink">{getDrilldownSegmentLabel(drilldown)}</span>
                </div>
                <div className="mt-1">
                  Current page: <span className="font-medium text-ink">{safeDrilldownPage}</span> of{' '}
                  <span className="font-medium text-ink">{drilldownTotalPages}</span>
                </div>
                <div className="mt-1">
                  Page size: <span className="font-medium text-ink">{DRILLDOWN_PAGE_SIZE}</span> rows
                </div>
              </article>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 py-3 text-sm">
              <div className="text-muted">
                {drilldownCount === 0
                  ? 'Showing 0 of 0'
                  : `Showing ${(safeDrilldownPage - 1) * DRILLDOWN_PAGE_SIZE + 1} - ${Math.min(
                      safeDrilldownPage * DRILLDOWN_PAGE_SIZE,
                      drilldownCount,
                    )} of ${drilldownCount.toLocaleString()}`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-ink/20 bg-white px-3 py-1 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={safeDrilldownPage <= 1}
                  onClick={() => setDrilldownPage(Math.max(1, safeDrilldownPage - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded-full border border-ink/20 bg-white px-3 py-1 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={safeDrilldownPage >= drilldownTotalPages}
                  onClick={() => setDrilldownPage(Math.min(drilldownTotalPages, safeDrilldownPage + 1))}
                >
                  Next
                </button>
              </div>
            </div>

            <div className="overflow-auto px-5 py-4">
              {drilldownRows.length === 0 ? (
                <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center text-sm text-muted">
                  No sets found in this bucket for the current filters.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                      <th className="px-2 py-2">Set Name</th>
                      <th className="px-2 py-2">Load ID</th>
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Day</th>
                      <th className="px-2 py-2">Location</th>
                      <th className="px-2 py-2">Facility</th>
                      <th className="px-2 py-2">No-Go</th>
                      <th className="px-2 py-2">Specialty</th>
                      <th className="px-2 py-2">Item Type</th>
                      <th className="px-2 py-2">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownRows.map((row, index) => (
                      <tr key={`${row.loadId}-${index}`} className="border-t border-ink/10">
                        <td className="px-2 py-2 text-ink">{row.setName}</td>
                        <td className="px-2 py-2 font-mono text-xs text-muted">{row.loadId}</td>
                        <td className="px-2 py-2 text-ink">{row.date}</td>
                        <td className="px-2 py-2 text-ink">{row.day}</td>
                        <td className="px-2 py-2 text-ink">{row.location}</td>
                        <td className="px-2 py-2 text-ink">{row.facility}</td>
                        <td className="px-2 py-2 text-ink">{row.noGo}</td>
                        <td className="px-2 py-2 text-ink">{row.specialty}</td>
                        <td className="px-2 py-2 text-ink">{row.itemType}</td>
                        <td className="px-2 py-2 text-ink">{row.owner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {dataset?.caseRouting && caseDrilldown && caseDrilldownResult ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-ink/65 p-4">
          <button
            type="button"
            aria-label="Close case bucket details"
            className="absolute inset-0 cursor-default"
            onClick={closeCaseDrilldown}
          />
          <section
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-ink/15 bg-white shadow-2xl"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-5 py-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-muted">Case Bucket Drilldown</div>
                <h2 className="mt-1 text-lg font-semibold text-ink">
                  {getCaseDrilldownSegmentLabel(caseDrilldown)} on{' '}
                  {DAY_LABEL_BY_KEY.get(caseDrilldown.dayKey) ?? 'Unknown'}
                </h2>
                <div className="mt-1 text-sm text-muted">
                  {caseDrilldownCount.toLocaleString()} case rows match this bucket in the filtered
                  date window.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={exportCaseBucketExcel}
                  className="rounded-full border border-accent/30 bg-accent px-4 py-2 text-sm font-medium text-white"
                >
                  Download Bucket Excel
                </button>
                <button
                  type="button"
                  onClick={closeCaseDrilldown}
                  className="rounded-full border border-ink/20 bg-white px-4 py-2 text-sm font-medium text-ink"
                >
                  Close
                </button>
              </div>
            </header>

            <div className="grid gap-4 border-b border-ink/10 px-5 py-4 md:grid-cols-2">
              <article className="rounded-2xl border border-ink/10 bg-white p-3">
                <div className="text-xs uppercase tracking-[0.14em] text-muted">Top Item Types</div>
                <div className="mt-2 h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={caseDrilldownResult.itemTypeDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.25)" />
                      <XAxis
                        dataKey="itemType"
                        tick={{ fontSize: 11 }}
                        interval={0}
                        angle={-20}
                        height={56}
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="rgb(var(--accent-rgb))" name="Rows" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </article>
              <article className="rounded-2xl border border-ink/10 bg-white p-3 text-sm text-muted">
                <div className="text-xs uppercase tracking-[0.14em] text-muted">Details</div>
                <div className="mt-2">
                  Day:{' '}
                  <span className="font-medium text-ink">
                    {DAY_LABEL_BY_KEY.get(caseDrilldown.dayKey) ?? 'Unknown'}
                  </span>
                </div>
                <div className="mt-1">
                  Segment:{' '}
                  <span className="font-medium text-ink">
                    {getCaseDrilldownSegmentLabel(caseDrilldown)}
                  </span>
                </div>
                <div className="mt-1">
                  Current page: <span className="font-medium text-ink">{safeCaseDrilldownPage}</span>{' '}
                  of <span className="font-medium text-ink">{caseDrilldownTotalPages}</span>
                </div>
                <div className="mt-1">
                  Page size: <span className="font-medium text-ink">{DRILLDOWN_PAGE_SIZE}</span> rows
                </div>
              </article>
            </div>

            <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-5 py-3 text-sm">
              <div className="text-muted">
                {caseDrilldownCount === 0
                  ? 'Showing 0 of 0'
                  : `Showing ${(safeCaseDrilldownPage - 1) * DRILLDOWN_PAGE_SIZE + 1} - ${Math.min(
                      safeCaseDrilldownPage * DRILLDOWN_PAGE_SIZE,
                      caseDrilldownCount,
                    )} of ${caseDrilldownCount.toLocaleString()}`}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-full border border-ink/20 bg-white px-3 py-1 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={safeCaseDrilldownPage <= 1}
                  onClick={() => setCaseDrilldownPage(Math.max(1, safeCaseDrilldownPage - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="rounded-full border border-ink/20 bg-white px-3 py-1 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={safeCaseDrilldownPage >= caseDrilldownTotalPages}
                  onClick={() =>
                    setCaseDrilldownPage(Math.min(caseDrilldownTotalPages, safeCaseDrilldownPage + 1))
                  }
                >
                  Next
                </button>
              </div>
            </div>

            <div className="overflow-auto px-5 py-4">
              {caseDrilldownRows.length === 0 ? (
                <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center text-sm text-muted">
                  No case rows found in this bucket for the current filters.
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-[0.14em] text-muted">
                      <th className="px-2 py-2">Date</th>
                      <th className="px-2 py-2">Day</th>
                      <th className="px-2 py-2">Case Facility</th>
                      <th className="px-2 py-2">Processing Facility</th>
                      <th className="px-2 py-2">Destination</th>
                      <th className="px-2 py-2">Item</th>
                      <th className="px-2 py-2">Inv #</th>
                      <th className="px-2 py-2">Item Type</th>
                      <th className="px-2 py-2">Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {caseDrilldownRows.map((row, index) => (
                      <tr key={`${row.itemName}-${row.date}-${index}`} className="border-t border-ink/10">
                        <td className="px-2 py-2 text-ink">{row.date}</td>
                        <td className="px-2 py-2 text-ink">{row.day}</td>
                        <td className="px-2 py-2 text-ink">{row.caseFacility}</td>
                        <td className="px-2 py-2 text-ink">{row.processingFacility}</td>
                        <td className="px-2 py-2 text-ink">{row.destination}</td>
                        <td className="px-2 py-2 text-ink">{row.itemName}</td>
                        <td className="px-2 py-2 text-ink">{row.invNumber}</td>
                        <td className="px-2 py-2 text-ink">{row.itemType}</td>
                        <td className="px-2 py-2 text-ink">{row.category}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

export default ProcessingLocationReportApp
