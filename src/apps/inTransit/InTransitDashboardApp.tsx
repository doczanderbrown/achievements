import { useDeferredValue, useMemo, useState } from 'react'
import AwayTable from './components/AwayTable'
import FilterBar from './components/FilterBar'
import InsightsView from './components/InsightsView'
import TabButton from './components/TabButton'
import TransitBoard from './components/TransitBoard'
import UploadControl from './components/UploadControl'
import type { FilterState, InventoryItem } from './types'
import { AGE_BUCKETS, DAY_MS, formatDateTime, formatDuration, HOUR_MS } from './utils/age'
import { exportToCsv } from './utils/exportCsv'
import { parseWorkbook } from './utils/parseWorkbook'
import './inTransit.css'

const DEFAULT_FILTERS: FilterState = {
  search: '',
  owningTowers: [],
  ageBuckets: [],
  showUnknownOwners: true,
  onlyAged: false,
}

type InTransitDashboardAppProps = {
  onBack?: () => void
}

const InTransitDashboardApp = ({ onBack }: InTransitDashboardAppProps) => {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [activeTab, setActiveTab] = useState<'insights' | 'transit' | 'away'>('transit')
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [stuckThresholdHours, setStuckThresholdHours] = useState(24)
  const [overdueThresholdDays, setOverdueThresholdDays] = useState(7)
  const [uploadState, setUploadState] = useState<{
    fileName: string | null
    isLoading: boolean
    error: string | null
  }>({ fileName: null, isLoading: false, error: null })

  const deferredSearch = useDeferredValue(filters.search)
  const normalizedSearch = deferredSearch.trim().toLowerCase()

  const transitItems = useMemo(
    () => items.filter((item) => item.sheetType === 'transit'),
    [items],
  )
  const awayItems = useMemo(
    () => items.filter((item) => item.sheetType === 'away'),
    [items],
  )

  const filterItems = (source: InventoryItem[]) => {
    return source.filter((item) => {
      if (!filters.showUnknownOwners && item.owningTower === 'Unknown') {
        return false;
      }
      if (filters.owningTowers.length > 0 && !filters.owningTowers.includes(item.owningTower)) {
        return false;
      }
      if (filters.ageBuckets.length > 0 && !filters.ageBuckets.includes(item.ageBucket)) {
        return false;
      }
      if (filters.onlyAged) {
        if (item.ageMs === null || item.ageMs < DAY_MS) {
          return false;
        }
      }
      if (normalizedSearch.length > 0) {
        const haystack = `${item.invID} ${item.desc}`.toLowerCase();
        if (!haystack.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    })
  }

  const filteredTransit = useMemo(
    () => filterItems(transitItems),
    [transitItems, filters, normalizedSearch],
  )
  const filteredAway = useMemo(() => filterItems(awayItems), [awayItems, filters, normalizedSearch])

  const availableTowers = useMemo(() => {
    const towers = new Set(items.map((item) => item.owningTower).filter(Boolean))
    const sorted = Array.from(towers).sort((a, b) => a.localeCompare(b))
    const unknownIndex = sorted.indexOf('Unknown')
    if (unknownIndex >= 0) {
      sorted.splice(unknownIndex, 1)
      sorted.push('Unknown')
    }
    return sorted
  }, [items])

  const availableBuckets = useMemo(() => {
    const bucketSet = new Set(items.map((item) => item.ageBucket))
    const buckets: string[] = []
    AGE_BUCKETS.forEach((bucket) => {
      if (bucketSet.has(bucket)) buckets.push(bucket)
    })
    if (bucketSet.has('Unknown')) buckets.push('Unknown')
    return buckets.length > 0 ? buckets : [...AGE_BUCKETS, 'Unknown']
  }, [items])

  const handleUpload = async (file: File) => {
    setUploadState({ fileName: file.name, isLoading: true, error: null })
    try {
      const parsed = await parseWorkbook(file)
      setItems(parsed)
      setUploadState({ fileName: file.name, isLoading: false, error: null })
    } catch (error) {
      setItems([])
      setUploadState({
        fileName: file.name,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to parse workbook.',
      })
    }
  }

  const handleExport = () => {
    const rows = activeTab === 'transit' ? filteredTransit : filteredAway
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const filename = `inventory-${activeTab}-${stamp}.csv`

    if (activeTab === 'transit') {
      exportToCsv(filename, rows, [
        { key: 'sheetType', label: 'SheetType', accessor: (row) => row.sheetType },
        { key: 'invID', label: 'invID', accessor: (row) => row.invID },
        { key: 'desc', label: 'Desc', accessor: (row) => row.desc },
        { key: 'owningTower', label: 'OwningTower', accessor: (row) => row.owningTower },
        { key: 'fromFacility', label: 'FromFacility', accessor: (row) => row.fromFacility ?? '' },
        { key: 'toLocation', label: 'ToLocation', accessor: (row) => row.toLocation ?? '' },
        { key: 'caseCartName', label: 'CaseCartName', accessor: (row) => row.caseCartName ?? '' },
        {
          key: 'caseCartLocation',
          label: 'CaseCartLocation',
          accessor: (row) => row.caseCartLocation ?? '',
        },
        {
          key: 'caseCartFacility',
          label: 'CaseCartFacility',
          accessor: (row) => row.caseCartFacility ?? '',
        },
        {
          key: 'dispatchDestination',
          label: 'DispatchDestination',
          accessor: (row) => row.dispatchDestination ?? '',
        },
        {
          key: 'transportCartName',
          label: 'TransportCartName',
          accessor: (row) => row.transportCartName ?? '',
        },
        { key: 'lastScanFacility', label: 'LastScanFacility', accessor: (row) => row.lastScanFacility },
        { key: 'lastScanLoc', label: 'LastScanLoc', accessor: (row) => row.lastScanLoc },
        { key: 'lastScanBy', label: 'LastScanBy', accessor: (row) => row.lastScanBy },
        {
          key: 'lastScanAt',
          label: 'LastScanAt',
          accessor: (row) => formatDateTime(row.lastScanAt),
        },
        { key: 'ageBucket', label: 'AgeBucket', accessor: (row) => row.ageBucket },
        {
          key: 'age',
          label: 'AgeDisplay',
          accessor: (row) => formatDuration(row.ageMs, row.lastScanAgoRaw),
        },
      ])
      return
    }

    exportToCsv(filename, rows, [
      { key: 'sheetType', label: 'SheetType', accessor: (row) => row.sheetType },
      { key: 'invID', label: 'invID', accessor: (row) => row.invID },
      { key: 'desc', label: 'Desc', accessor: (row) => row.desc },
      { key: 'owningTower', label: 'OwningTower', accessor: (row) => row.owningTower },
      {
        key: 'currentStorageLocation',
        label: 'CurrentStorageLocation',
        accessor: (row) => row.currentStorageLocation ?? '',
      },
      { key: 'lastScanFacility', label: 'LastScanFacility', accessor: (row) => row.lastScanFacility },
      { key: 'lastScanBy', label: 'LastScanBy', accessor: (row) => row.lastScanBy },
      {
        key: 'lastScanAt',
        label: 'LastScanAt',
        accessor: (row) => formatDateTime(row.lastScanAt),
      },
      { key: 'ageBucket', label: 'AgeBucket', accessor: (row) => row.ageBucket },
      {
        key: 'age',
        label: 'AgeDisplay',
        accessor: (row) => formatDuration(row.ageMs, row.lastScanAgoRaw),
      },
    ])
  }

  return (
    <div className="in-transit-root min-h-screen">
      <div className="mx-auto max-w-[1400px] px-6 py-8">
        <header className="space-y-6">
          {onBack ? (
            <div>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center rounded-full border border-stroke bg-white px-4 py-2 text-sm font-medium text-ink shadow-soft transition hover:shadow-lift"
              >
                Back to app suite
              </button>
            </div>
          ) : null}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-[0.35em] text-muted">
                Ascendo Analytics
              </div>
              <h1 className="mt-2 font-display text-3xl font-semibold text-ink md:text-4xl">
                Inventory In Transit / Away Board
              </h1>
              <div className="mt-2 h-1 w-12 rounded-full bg-accent"></div>
              <p className="mt-3 max-w-xl text-sm text-muted">
                Upload a workbook to visualize inventory movement and storage aging. Filters apply
                across both tabs.
              </p>
            </div>
            <UploadControl
              onUpload={handleUpload}
              fileName={uploadState.fileName}
              isLoading={uploadState.isLoading}
              error={uploadState.error}
            />
          </div>

          <FilterBar
            filters={filters}
            towers={availableTowers}
            buckets={availableBuckets}
            onChange={setFilters}
          />

          <div className="flex flex-wrap items-center gap-3">
            <TabButton active={activeTab === 'insights'} onClick={() => setActiveTab('insights')}>
              Insights
            </TabButton>
            <TabButton active={activeTab === 'transit'} onClick={() => setActiveTab('transit')}>
              In Transit
            </TabButton>
            <TabButton active={activeTab === 'away'} onClick={() => setActiveTab('away')}>
              Away (Not at Home)
            </TabButton>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <div className="rounded-full border border-stroke bg-white px-3 py-1 text-xs text-muted">
                Only aged: {filters.onlyAged ? `>= ${DAY_MS / HOUR_MS}h` : 'off'}
              </div>
              <button
                type="button"
                onClick={handleExport}
                className="rounded-full border border-stroke bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ink shadow-soft transition hover:shadow-lift"
              >
                Export filtered to CSV
              </button>
            </div>
          </div>
        </header>

        <main className="mt-8">
          {activeTab === 'insights' ? (
            <InsightsView
              transitItems={filteredTransit}
              awayItems={filteredAway}
              stuckThresholdHours={stuckThresholdHours}
              onStuckThresholdChange={setStuckThresholdHours}
              overdueThresholdDays={overdueThresholdDays}
              onOverdueThresholdChange={setOverdueThresholdDays}
            />
          ) : null}
          {activeTab === 'transit' ? (
            <TransitBoard items={filteredTransit} stuckThresholdHours={stuckThresholdHours} />
          ) : null}
          {activeTab === 'away' ? (
            <AwayTable items={filteredAway} overdueThresholdDays={overdueThresholdDays} />
          ) : null}
        </main>
      </div>
    </div>
  )
}

export default InTransitDashboardApp
