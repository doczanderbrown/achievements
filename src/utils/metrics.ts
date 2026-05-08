export type MetricKey =
  | 'deconScans'
  | 'sinkInst'
  | 'sinkTrays'
  | 'assembledTrays'
  | 'assembledPacks'
  | 'assembledInst'
  | 'workedHoursPerUnit'
  | 'assemblyMissingInst'
  | 'sterilizerLoads'
  | 'itemsSterilized'
  | 'itemsPerLoad'
  | 'deliverScans'
  | 'defectRate'

export type MetricDefinition = {
  key: MetricKey
  label: string
  higherBetter: boolean
  format: 'number' | 'rate'
  decimals?: number
  shortLabel?: string
  helper?: string
}

export const DEFAULT_METRICS: MetricDefinition[] = [
  {
    key: 'deconScans',
    label: 'Decontamination Scans',
    higherBetter: true,
    format: 'number',
    decimals: 0,
    shortLabel: 'Decontamination',
  },
  {
    key: 'sinkInst',
    label: 'Sink Instruments',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'sinkTrays',
    label: 'Sink Trays',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'assembledTrays',
    label: 'Assembled Trays',
    higherBetter: true,
    format: 'number',
    decimals: 0,
    shortLabel: 'Assembly',
  },
  {
    key: 'assembledPacks',
    label: 'Assembled Peel Packs',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'assembledInst',
    label: 'Assembled Instruments',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'workedHoursPerUnit',
    label: 'Worked Hours / Unit',
    higherBetter: false,
    format: 'number',
    decimals: 3,
    helper: 'lower is better',
  },
  {
    key: 'assemblyMissingInst',
    label: 'Missing Instr Rate',
    higherBetter: false,
    format: 'rate',
    decimals: 2,
    helper: 'lower is better',
  },
  {
    key: 'sterilizerLoads',
    label: 'Sterilizer Loads',
    higherBetter: true,
    format: 'number',
    decimals: 0,
    shortLabel: 'Sterilize',
  },
  {
    key: 'itemsSterilized',
    label: 'Items Sterilized',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'itemsPerLoad',
    label: 'Items per Load',
    higherBetter: true,
    format: 'number',
    decimals: 1,
    helper: 'items sterilized / load',
  },
  {
    key: 'deliverScans',
    label: 'Deliver Scans',
    higherBetter: true,
    format: 'number',
    decimals: 0,
  },
  {
    key: 'defectRate',
    label: 'Defect Rate',
    higherBetter: false,
    format: 'rate',
    decimals: 1,
    helper: 'event-based',
  },
]

const METRIC_KEYS: MetricKey[] = DEFAULT_METRICS.map((metric) => metric.key)
const METRIC_HIGHER_BETTER = DEFAULT_METRICS.reduce(
  (acc, metric) => {
    acc[metric.key] = metric.higherBetter
    return acc
  },
  {} as Record<MetricKey, boolean>,
)

export type RawRow = {
  'User ID': string | number
  'User Name': string
  'Hours Worked': number
  NumofEvents: number
  'Defect Rate': number
  'Decon Scans': number
  'Sink Inst': number
  'Sink Trays': number
  'Assembled Trays': number
  'Assembled Packs': number
  'Assembled Inst': number
  'Assembly Missing Inst': number
  'Sterilizer Loads': number
  'Items Sterilized': number
  'Deliver Scans': number
  'Activity Count': number
  'Activity Time (Mins)': number
  'Primary Facility'?: string
  Role?: string
  'Coaching Count'?: number
  'PTO Hours'?: number
  'Unpaid Hours'?: number
  'On-Call Hours'?: number
  'Overtime Hours'?: number
}

export type PillarKey = 'decon' | 'assembly' | 'sterilize'

export type PillarTotals = Record<PillarKey, number>

const PILLAR_KEYS: PillarKey[] = ['decon', 'assembly', 'sterilize']
const PILLAR_HIGHER_BETTER: Record<PillarKey, boolean> = {
  decon: true,
  assembly: true,
  sterilize: true,
}

export type UserScores = {
  productivity: number
  quality: number
  versatility: number
  overall: number
  overallPercentile: number
  productivityPercentile: number
  qualityPercentile: number
  versatilityPercentile: number
}

export type BadgeTier = 'bronze' | 'silver' | 'gold'

export type Badge = {
  label: string
  tier: BadgeTier
  category: string
}

export type UserRecord = {
  id: string
  name: string
  techLabel: string
  role: string
  facility: string
  hoursWorked: number
  productivityRanked: boolean
  qualityContext: {
    eventCount: number
    coachingCount: number
  }
  timekeepingContext: {
    ptoHours: number
    unpaidHours: number
    onCallHours: number
    overtimeHours: number
  }
  productivityDrivers: {
    decon: number
    assembly: number
    sterilize: number
    basis: 'rates' | 'totals' | 'excluded'
  }
  metrics: Record<MetricKey, number>
  percentiles: Record<MetricKey, number>
  pillarTotals: PillarTotals
  pillarPercentiles: PillarTotals
  scores: UserScores
  pillarsAboveMedian: Record<PillarKey, boolean>
  archetype: {
    label: string
    icon: string
    description: string
  }
  badges: Badge[]
  coachingSummary: string
  strengths: string[]
  opportunity: string
}

export type ProcessedReport = {
  users: UserRecord[]
  medians: Record<MetricKey, number>
  pillarMedians: PillarTotals
  metricDefinitions: MetricDefinition[]
}

const toNumber = (value: unknown) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, num)
}

const safeDiv = (numerator: number, denominator: number, minDenominator: number) => {
  const safe = Math.max(denominator, minDenominator)
  return numerator / safe
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

const lowerBound = (values: number[], target: number) => {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (values[mid] < target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

const upperBound = (values: number[], target: number) => {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (values[mid] <= target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

const percentileFromSorted = (value: number, sortedValues: number[], higherBetter: boolean) => {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return 100
  const lower = lowerBound(sortedValues, value)
  const upper = upperBound(sortedValues, value)
  // Tie-adjusted midpoint rank, normalized so the lowest unique value maps to 0
  // and highest unique value maps to 100 for small cohorts.
  const midpointRank = lower + 0.5 * (upper - lower)
  const p = ((midpointRank - 0.5) / (sortedValues.length - 1)) * 100
  const oriented = higherBetter ? p : 100 - p
  return Math.max(0, Math.min(100, oriented))
}

const topAnchoredPercentileFromSorted = (
  value: number,
  sortedValues: number[],
  higherBetter: boolean,
) => {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return 100
  const lower = lowerBound(sortedValues, value)
  const upper = upperBound(sortedValues, value)
  const rank = higherBetter ? upper - 1 : sortedValues.length - lower - 1
  const p = (rank / (sortedValues.length - 1)) * 100
  return Math.max(0, Math.min(100, p))
}

type SortedMap<T extends string> = Record<T, number[]>

const buildPillarTotals = (input: {
  deconScans: number
  sinkInst: number
  sinkTrays: number
  assembledInst: number
  assembledTrays: number
  assembledPacks: number
  itemsSterilized: number
  sterilizerLoads: number
  deliverScans: number
}): PillarTotals => {
  return {
    decon: input.deconScans + input.sinkInst + input.sinkTrays,
    assembly: input.assembledInst + input.assembledTrays + input.assembledPacks,
    sterilize: input.itemsSterilized + input.sterilizerLoads + input.deliverScans,
  }
}

const buildPillarRates = (totals: PillarTotals, hoursWorked: number): PillarTotals => {
  return {
    decon: safeDiv(totals.decon, hoursWorked, 0.25),
    assembly: safeDiv(totals.assembly, hoursWorked, 0.25),
    sterilize: safeDiv(totals.sterilize, hoursWorked, 0.25),
  }
}

const buildMedianMap = <T extends string>(
  items: Array<Record<T, number>>,
  keys: T[],
): Record<T, number> => {
  return keys.reduce((acc, key) => {
    acc[key] = median(items.map((item) => item[key]))
    return acc
  }, {} as Record<T, number>)
}

const buildSortedValues = <T extends string>(
  items: Array<Record<T, number>>,
  keys: T[],
): SortedMap<T> => {
  return keys.reduce((acc, key) => {
    acc[key] = items.map((item) => item[key]).sort((a, b) => a - b)
    return acc
  }, {} as SortedMap<T>)
}

const buildPercentiles = <T extends string>(
  values: Record<T, number>,
  sorted: SortedMap<T>,
  higherBetter: Record<T, boolean>,
): Record<T, number> => {
  return Object.fromEntries(
    (Object.keys(values) as T[]).map((key) => [
      key,
      percentileFromSorted(values[key], sorted[key], higherBetter[key]),
    ]),
  ) as Record<T, number>
}

const hashString = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

const pickBySeed = <T,>(items: T[], seed: string): T => {
  if (!items.length) {
    throw new Error('No items available for selection')
  }
  return items[hashString(seed) % items.length]
}

type ArchetypeOption = { label: string; description: string }

const ARCHETYPE_OPTIONS: Record<'decon' | 'assembly' | 'sterilize' | 'utility', ArchetypeOption[]> =
  {
    decon: [
      { label: 'Biohazard Bouncer', description: 'Nothing dirty gets past them. Ever.' },
      { label: 'Germ Reaper', description: 'Where bioburden goes to die.' },
      { label: 'The Rinse Cycle', description: 'Relentless, methodical, unstoppable.' },
      { label: 'Hazmat Hero', description: 'Calm under pressure, fearless around the gross stuff.' },
      { label: 'Foam & Fury', description: 'Aggressive cleaning, zero mercy.' },
    ],
    assembly: [
      { label: 'Tray Whisperer', description: "Knows when something's missing without looking." },
      { label: 'Count Sheet Assassin', description: 'Precision so clean it is suspicious.' },
      { label: 'The Lego Master', description: 'Everything fits. Every time.' },
      {
        label: 'Set Architect',
        description: 'Builds trays like countsheets matter (because they do).',
      },
    ],
    sterilize: [
      { label: 'Cycle Commander', description: 'Parameters locked. Deviations denied.' },
      { label: 'Steam General', description: 'Leads every load like a military op.' },
      { label: 'The Final Boss', description: 'Nothing leaves until it is actually sterile.' },
      { label: 'Pressure Prophet', description: 'Knows a bad cycle before the printout hits.' },
    ],
    utility: [
      { label: 'Utility Knife', description: 'Plug-and-play anywhere, anytime.' },
      { label: 'Shift Saver', description: 'Everything goes sideways, then they clock in.' },
      { label: 'The Glue', description: 'The department functions because this person exists.' },
      { label: 'Flex Tech', description: "You move them, performance doesn't drop." },
    ],
  }

type StrengthCategory = 'quality' | 'speed' | 'decon' | 'sterilize' | 'multi'

const STRENGTH_TITLES: Record<StrengthCategory, string[]> = {
  quality: [
    'Zero-Defect Menace',
    'Quality Over Everything',
    'No Rework, No Regrets',
    "The Auditor's Nightmare",
  ],
  speed: [
    'Tray Machine',
    'Assembly Speedrunner',
    'Throughput Goblin',
    'Blink and You Miss It',
  ],
  decon: [
    'Biofilm Bully',
    'Decon Demon',
    'The Pre-Clean King/Queen',
    'So Fresh, So Clean',
  ],
  sterilize: [
    'Load Perfecter',
    'Steam Certified',
    'Cold Sterile Killer',
  ],
  multi: [
    'Swiss Army Tech',
    'Triple Threat',
    'Department Backbone',
    'All-Terrain Tech',
  ],
}

const strengthTemplates = [
  "When it comes to {{pillar}}, you're operating at a level most peers don't reach.",
  'Your {{metric}} puts you in elite territory — keep doing exactly what you are doing.',
  "{{pillar}} is your superpower — the numbers don't lie.",
  'Top-tier {{metric}} is rare. You make it look routine.',
  "You lead the department in {{metric}} — that kind of consistency sets the standard.",
  "{{pillar}} performance like yours doesn't happen by accident. It's discipline.",
  "The data on {{metric}} is clear: you're one of the best in this cohort.",
  "Peers measure themselves against your {{metric}}. Keep the bar high.",
]

const growthTemplates = [
  'The data suggests {{metric}} is your biggest opportunity — tightening this up would level you up fast.',
  'One small improvement in {{metric}} could unlock your next archetype.',
  'Your {{metric}} is the one lever that would move your overall score the most right now.',
  'Focus on {{metric}} this period — small gains there have outsized impact on your ranking.',
  'Everyone has a ceiling to break. For you, that ceiling is {{metric}}.',
  'You have the foundation — sharpening {{metric}} is what separates good from great.',
  "{{metric}} is the gap between where you are and where you could be. It's closer than you think.",
  'Your peers who rank above you are mostly outperforming you on {{metric}}. That gap is closeable.',
]

const metricToPillar = (key: MetricKey) => {
  if (['deconScans', 'sinkInst', 'sinkTrays'].includes(key)) return 'Decontamination'
  if (['assembledTrays', 'assembledPacks', 'assembledInst'].includes(key)) return 'Assembly'
  if (['sterilizerLoads', 'itemsSterilized', 'itemsPerLoad', 'deliverScans'].includes(key)) return 'Sterilization'
  if (['defectRate', 'assemblyMissingInst'].includes(key)) return 'Quality'
  if (key === 'workedHoursPerUnit') return 'Efficiency'
  return 'Performance'
}

export const REQUIRED_COLUMNS: Array<keyof RawRow> = [
  'User ID',
  'User Name',
  'NumofEvents',
  'Defect Rate',
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
]

export const coerceRow = (row: Record<string, unknown>): RawRow => {
  return {
    'User ID': String(row['User ID'] ?? '').trim(),
    'User Name': String(row['User Name'] ?? '').trim(),
    'Hours Worked': toNumber(row['Hours Worked']),
    NumofEvents: toNumber(row['NumofEvents']),
    'Defect Rate': toNumber(row['Defect Rate']),
    'Decon Scans': toNumber(row['Decon Scans']),
    'Sink Inst': toNumber(row['Sink Inst']),
    'Sink Trays': toNumber(row['Sink Trays']),
    'Assembled Trays': toNumber(row['Assembled Trays']),
    'Assembled Packs': toNumber(row['Assembled Packs']),
    'Assembled Inst': toNumber(row['Assembled Inst']),
    'Assembly Missing Inst': toNumber(row['Assembly Missing Inst']),
    'Sterilizer Loads': toNumber(row['Sterilizer Loads']),
    'Items Sterilized': toNumber(row['Items Sterilized']),
    'Deliver Scans': toNumber(row['Deliver Scans']),
    'Activity Count': toNumber(row['Activity Count']),
    'Activity Time (Mins)': toNumber(row['Activity Time (Mins)']),
    'Primary Facility': String(row['Primary Facility'] ?? '').trim(),
    Role: String(row.Role ?? '').trim(),
    'Coaching Count': toNumber(row['Coaching Count']),
    'PTO Hours': toNumber(row['PTO Hours']),
    'Unpaid Hours': toNumber(row['Unpaid Hours']),
    'On-Call Hours': toNumber(row['On-Call Hours']),
    'Overtime Hours': toNumber(row['Overtime Hours']),
  }
}

type BuildReportOptions = {
  hoursWorkedAvailable?: boolean
}

export const buildReport = (
  rows: RawRow[],
  options: BuildReportOptions = {},
): ProcessedReport => {
  const hoursWorkedAvailable = options.hoursWorkedAvailable ?? true

  // Build stable tech labels sorted by user ID so the same person always gets the same Tech # label
  // regardless of their position in the spreadsheet.
  const stableSorted = [...rows].sort((a, b) => {
    const idA = String(a['User ID'] ?? '').trim()
    const idB = String(b['User ID'] ?? '').trim()
    if (idA && idB) return idA.localeCompare(idB)
    const nameA = String(a['User Name'] ?? '').trim().toLowerCase()
    const nameB = String(b['User Name'] ?? '').trim().toLowerCase()
    return nameA.localeCompare(nameB)
  })
  const stableLabelMap = new Map(
    stableSorted.map((row, i) => {
      const key = String(row['User ID'] ?? '').trim() || String(row['User Name'] ?? '').trim().toLowerCase()
      return [key, `Tech #${i + 1}`]
    }),
  )
  const getTechLabel = (row: RawRow) => {
    const idKey = String(row['User ID'] ?? '').trim()
    const nameKey = String(row['User Name'] ?? '').trim().toLowerCase()
    return stableLabelMap.get(idKey) ?? stableLabelMap.get(nameKey) ?? `Tech #?`
  }

  const baseUsers = rows.map((row, index) => {
    // Normalizing productivity has trade-offs; when available, we use timekeeping
    // Hours Worked. If hours are missing, productivity falls back to total-volume
    // percentiles.
    const timekeepingHours = toNumber(row['Hours Worked'])
    const hoursWorked = timekeepingHours

    const deconScans = toNumber(row['Decon Scans'])
    const sinkInst = toNumber(row['Sink Inst'])
    const sinkTrays = toNumber(row['Sink Trays'])

    const assembledTrays = toNumber(row['Assembled Trays'])
    const assembledPacks = toNumber(row['Assembled Packs'])
    const assembledInst = toNumber(row['Assembled Inst'])

    const sterilizerLoads = toNumber(row['Sterilizer Loads'])
    const itemsSterilized = toNumber(row['Items Sterilized'])
    const deliverScans = toNumber(row['Deliver Scans'])

    const assemblyMissingInst = toNumber(row['Assembly Missing Inst'])
    const unitsOfService = sinkInst * 0.5 + assembledInst
    const workedHoursPerUnit = safeDiv(hoursWorked, unitsOfService, 1)
    const missingInstRate = safeDiv(assemblyMissingInst, assembledInst, 1)

    const id = String(row['User ID'] ?? '')
    const name = String(row['User Name'] ?? '').trim() || `Tech ${index + 1}`
    const role = String(row.Role ?? '').trim()
    const itemsPerLoad = sterilizerLoads > 0 ? itemsSterilized / sterilizerLoads : 0

    const pillarTotals = buildPillarTotals({
      deconScans,
      sinkInst,
      sinkTrays,
      assembledInst,
      assembledTrays,
      assembledPacks,
      itemsSterilized,
      sterilizerLoads,
      deliverScans,
    })

    return {
      id,
      name,
      techLabel: getTechLabel(row),
      role,
      facility: String(row['Primary Facility'] ?? '').trim(),
      hoursWorked,
      qualityContext: {
        eventCount: toNumber(row['NumofEvents']),
        coachingCount: toNumber(row['Coaching Count']),
      },
      timekeepingContext: {
        ptoHours: toNumber(row['PTO Hours']),
        unpaidHours: toNumber(row['Unpaid Hours']),
        onCallHours: toNumber(row['On-Call Hours']),
        overtimeHours: toNumber(row['Overtime Hours']),
      },
      metrics: {
        deconScans,
        sinkInst,
        sinkTrays,
        assembledTrays,
        assembledPacks,
        assembledInst,
        workedHoursPerUnit,
        assemblyMissingInst: missingInstRate,
        sterilizerLoads,
        itemsSterilized,
        itemsPerLoad,
        deliverScans,
        defectRate: toNumber(row['Defect Rate']),
      },
      pillarTotals,
    }
  })

  const metricValues = baseUsers.map((user) => user.metrics)
  const pillarTotalsList = baseUsers.map((user) => user.pillarTotals)

  const medians = buildMedianMap(metricValues, METRIC_KEYS)
  const pillarMedians = buildMedianMap(pillarTotalsList, PILLAR_KEYS)

  const sortedMetricValues = buildSortedValues(metricValues, METRIC_KEYS)
  const sortedPillarValues = buildSortedValues(pillarTotalsList, PILLAR_KEYS)

  const zeroPillarPercentiles: PillarTotals = {
    decon: 0,
    assembly: 0,
    sterilize: 0,
  }
  const pillarRatesByUser = baseUsers.map((user) =>
    buildPillarRates(user.pillarTotals, user.hoursWorked),
  )
  const rateEligibleIndexes = hoursWorkedAvailable
    ? baseUsers
        .map((user, index) => (user.hoursWorked > 0 ? index : -1))
        .filter((index) => index >= 0)
    : []
  const rateProductivityEnabled = hoursWorkedAvailable && rateEligibleIndexes.length > 0
  const sortedPillarRateValues =
    rateProductivityEnabled
      ? buildSortedValues(
          rateEligibleIndexes.map((index) => pillarRatesByUser[index]),
          PILLAR_KEYS,
        )
      : null

  const usersWithPercentiles = baseUsers.map((user, index) => {
    const percentiles = buildPercentiles(user.metrics, sortedMetricValues, METRIC_HIGHER_BETTER)
    const pillarPercentiles = buildPercentiles(user.pillarTotals, sortedPillarValues, PILLAR_HIGHER_BETTER)
    const productivityRanked = !rateProductivityEnabled || user.hoursWorked > 0
    const pillarRatePercentiles =
      rateProductivityEnabled && productivityRanked && sortedPillarRateValues
        ? buildPercentiles(
            pillarRatesByUser[index],
            sortedPillarRateValues,
            PILLAR_HIGHER_BETTER,
          )
        : zeroPillarPercentiles

    const driverBasis: 'rates' | 'totals' | 'excluded' = rateProductivityEnabled
      ? productivityRanked
        ? 'rates'
        : 'excluded'
      : 'totals'
    const driverValues =
      driverBasis === 'rates'
        ? pillarRatePercentiles
        : driverBasis === 'totals'
          ? pillarPercentiles
          : zeroPillarPercentiles
    const driverSum = driverValues.decon + driverValues.assembly + driverValues.sterilize
    const productivityDrivers = {
      decon: driverSum ? (driverValues.decon / driverSum) * 100 : 0,
      assembly: driverSum ? (driverValues.assembly / driverSum) * 100 : 0,
      sterilize: driverSum ? (driverValues.sterilize / driverSum) * 100 : 0,
      basis: driverBasis,
    }

    const pillarsAboveMedian: Record<PillarKey, boolean> = {
      decon: user.pillarTotals.decon >= pillarMedians.decon,
      assembly: user.pillarTotals.assembly >= pillarMedians.assembly,
      sterilize: user.pillarTotals.sterilize >= pillarMedians.sterilize,
    }

    const productivity =
      driverBasis === 'rates'
        ? (pillarRatePercentiles.decon +
            pillarRatePercentiles.assembly +
            pillarRatePercentiles.sterilize) /
          3
        : driverBasis === 'totals'
          ? (pillarPercentiles.decon + pillarPercentiles.assembly + pillarPercentiles.sterilize) /
            3
          : 0

    const quality = percentiles.defectRate

    // Average of all three pillar percentiles so users who dominate multiple pillars
    // score higher than those who merely squeak above median.
    const versatility =
      (pillarPercentiles.decon + pillarPercentiles.assembly + pillarPercentiles.sterilize) / 3

    return {
      ...user,
      productivityRanked,
      percentiles,
      pillarPercentiles,
      pillarsAboveMedian,
      productivityDrivers,
      scores: {
        productivity,
        quality,
        versatility,
        overall: 0,
        overallPercentile: 0,
        productivityPercentile: 0,
        qualityPercentile: 0,
        versatilityPercentile: 0,
      },
    }
  })

  type ScoreKey = 'productivity' | 'quality' | 'versatility'
  const scoreKeys: ScoreKey[] = ['productivity', 'quality', 'versatility']

  const scoreSorted = scoreKeys.reduce((acc, key) => {
    acc[key] = [
      ...usersWithPercentiles
        .filter((user) => (key === 'productivity' ? user.productivityRanked : true))
        .map((user) => user.scores[key]),
    ].sort((a, b) => a - b)
    return acc
  }, {} as Record<ScoreKey, number[]>)

  const scorePercentilesByUser = usersWithPercentiles.map((user) => {
    const productivityPercentile = user.productivityRanked
      ? percentileFromSorted(user.scores.productivity, scoreSorted.productivity, true)
      : 0
    const qualityPercentile = percentileFromSorted(user.scores.quality, scoreSorted.quality, true)
    const versatilityPercentile = percentileFromSorted(
      user.scores.versatility,
      scoreSorted.versatility,
      true,
    )
    const overall = productivityPercentile + qualityPercentile
    return {
      productivityPercentile,
      qualityPercentile,
      versatilityPercentile,
      overall,
    }
  })
  const sortedOverallScores = [...scorePercentilesByUser.map((scores) => scores.overall)].sort(
    (a, b) => a - b,
  )

  const usersWithScores = usersWithPercentiles.map((user, index) => {
    const scorePercentiles = scorePercentilesByUser[index]
    const overallPercentile = topAnchoredPercentileFromSorted(
      scorePercentiles.overall,
      sortedOverallScores,
      true,
    )

    const contributionsTotal =
      user.pillarTotals.decon + user.pillarTotals.assembly + user.pillarTotals.sterilize
    const topContribution = Math.max(
      user.pillarTotals.decon,
      user.pillarTotals.assembly,
      user.pillarTotals.sterilize,
    )
    const topShare = contributionsTotal ? topContribution / contributionsTotal : 0

    const pillarCount =
      (user.pillarsAboveMedian.decon ? 1 : 0) +
      (user.pillarsAboveMedian.assembly ? 1 : 0) +
      (user.pillarsAboveMedian.sterilize ? 1 : 0)

    let archetypeKey: 'decon' | 'assembly' | 'sterilize' | 'utility' = 'decon'
    if (topShare < 0.4 && pillarCount >= 2) {
      archetypeKey = 'utility'
    } else if (contributionsTotal === 0) {
      const pillarPercentiles: Array<{ key: PillarKey; value: number }> = [
        { key: 'decon', value: user.pillarPercentiles.decon },
        { key: 'assembly', value: user.pillarPercentiles.assembly },
        { key: 'sterilize', value: user.pillarPercentiles.sterilize },
      ]
      pillarPercentiles.sort((a, b) => b.value - a.value)
      archetypeKey = pillarPercentiles[0].key
    } else if (topContribution === user.pillarTotals.assembly) {
      archetypeKey = 'assembly'
    } else if (topContribution === user.pillarTotals.sterilize) {
      archetypeKey = 'sterilize'
    }

    const userSeed = `${user.id || user.techLabel}-${user.name}`
    const archetypeOption = pickBySeed(
      ARCHETYPE_OPTIONS[archetypeKey],
      `${userSeed}-${archetypeKey}-archetype`,
    )
    const archetypeIconMap: Record<'decon' | 'assembly' | 'sterilize' | 'utility', string> = {
      decon: '🧽',
      assembly: '🛠️',
      sterilize: '🚢',
      utility: '🧩',
    }
    const archetype = {
      ...archetypeOption,
      icon: archetypeIconMap[archetypeKey],
    }

    type BadgeCandidate = { category: StrengthCategory; tier: BadgeTier }
    const badgeCandidates: BadgeCandidate[] = []

    const addBadge = (condition: boolean, tier: BadgeTier, category: StrengthCategory) => {
      if (condition) badgeCandidates.push({ category, tier })
    }

    // Quality badges
    addBadge(user.percentiles.defectRate >= 95, 'gold', 'quality')
    addBadge(user.percentiles.defectRate >= 90 && user.percentiles.defectRate < 95, 'silver', 'quality')
    addBadge(user.percentiles.defectRate >= 75 && user.percentiles.defectRate < 90, 'bronze', 'quality')

    // Speed/throughput badges
    addBadge(user.percentiles.assembledInst >= 95, 'gold', 'speed')
    addBadge(user.percentiles.assembledInst >= 90 && user.percentiles.assembledInst < 95, 'silver', 'speed')
    addBadge(user.percentiles.assembledInst >= 75 && user.percentiles.assembledInst < 90, 'bronze', 'speed')

    // Decon badges
    addBadge(user.pillarPercentiles.decon >= 95, 'gold', 'decon')
    addBadge(user.pillarPercentiles.decon >= 90 && user.pillarPercentiles.decon < 95, 'silver', 'decon')
    addBadge(user.pillarPercentiles.decon >= 75 && user.pillarPercentiles.decon < 90, 'bronze', 'decon')

    // Sterilize badges
    addBadge(user.pillarPercentiles.sterilize >= 95, 'gold', 'sterilize')
    addBadge(user.pillarPercentiles.sterilize >= 90 && user.pillarPercentiles.sterilize < 95, 'silver', 'sterilize')
    addBadge(user.pillarPercentiles.sterilize >= 75 && user.pillarPercentiles.sterilize < 90, 'bronze', 'sterilize')

    // Multi-pillar badges
    addBadge(pillarCount >= 3, 'gold', 'multi')
    addBadge(pillarCount === 2, 'silver', 'multi')

    const badges: Badge[] = badgeCandidates.map(({ category, tier }) => ({
      label: pickBySeed(STRENGTH_TITLES[category], `${userSeed}-${category}-strength`),
      tier,
      category,
    }))

    const [strength] = [...DEFAULT_METRICS]
      .map((metric) => ({
        key: metric.key,
        label: metric.label,
        percentile: user.percentiles[metric.key],
      }))
      .sort((a, b) => b.percentile - a.percentile)

    const opportunity = [...DEFAULT_METRICS]
      .map((metric) => ({
        key: metric.key,
        label: metric.label,
        percentile: user.percentiles[metric.key],
      }))
      .sort((a, b) => a.percentile - b.percentile)[0]

    const strengthLabel = strength?.label ?? 'this area'
    const opportunityLabel = opportunity?.label ?? 'this area'
    const strengthPillar = strength ? metricToPillar(strength.key) : 'performance'

    const strengthLine = pickBySeed(
      strengthTemplates,
      `${userSeed}-${strengthPillar}-strength-template`,
    )
      .replace('{{pillar}}', strengthPillar)
      .replace('{{metric}}', strengthLabel)

    const growthLine = pickBySeed(
      growthTemplates,
      `${userSeed}-${opportunityLabel}-growth-template`,
    ).replace('{{metric}}', opportunityLabel)

    const coachingSummary = `${strengthLine} ${growthLine}`

    return {
      ...user,
      scores: {
        ...user.scores,
        ...scorePercentiles,
        overallPercentile,
      },
      archetype,
      badges,
      strengths: strengthLabel ? [strengthLabel] : [],
      opportunity: opportunityLabel,
      coachingSummary,
    }
  })

  return {
    users: usersWithScores,
    medians,
    pillarMedians,
    metricDefinitions: DEFAULT_METRICS,
  }
}

export const formatMetricValue = (value: number, metric: MetricDefinition) => {
  if (metric.format === 'rate') {
    const display = value <= 1 ? value * 100 : value
    return `${display.toFixed(metric.decimals ?? 1)}%`
  }
  return value.toFixed(metric.decimals ?? 0)
}

export const formatDelta = (value: number, metric: MetricDefinition) => {
  if (metric.format === 'rate') {
    const display = value <= 1 ? value * 100 : value
    const sign = display > 0 ? '+' : ''
    return `${sign}${display.toFixed(metric.decimals ?? 1)}%`
  }
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(metric.decimals ?? 0)}`
}
