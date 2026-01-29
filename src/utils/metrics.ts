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
    label: 'Missing Instruments Rate',
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
    helper: 'lower is better',
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
  productivityPercentile: number
  qualityPercentile: number
  versatilityPercentile: number
}

export type UserRecord = {
  id: string
  name: string
  techLabel: string
  hoursWorked: number
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
  badges: string[]
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
  const lower = lowerBound(sortedValues, value)
  const upper = upperBound(sortedValues, value)
  const p = ((lower + 0.5 * (upper - lower)) / sortedValues.length) * 100
  const oriented = higherBetter ? p : 100 - p
  return Math.max(0, Math.min(100, oriented))
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
]

const growthTemplates = [
  'The data suggests {{metric}} is your biggest opportunity — tightening this up would level you up fast.',
  'One small improvement in {{metric}} could unlock your next archetype.',
]

const metricToPillar = (key: MetricKey) => {
  if (['deconScans', 'sinkInst', 'sinkTrays'].includes(key)) return 'Decontamination'
  if (['assembledTrays', 'assembledPacks', 'assembledInst'].includes(key)) return 'Assembly'
  if (['sterilizerLoads', 'itemsSterilized', 'deliverScans'].includes(key)) return 'Sterilization'
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
    'User ID': String(row['User ID'] ?? ''),
    'User Name': String(row['User Name'] ?? ''),
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
  const baseUsers = rows.map((row, index) => {
    // Normalizing productivity has trade-offs; we use CHRONOS timekeeping hours plus
    // Activity Time (Mins) to capture work done outside the system.
    // If hours are missing, productivity falls back to total-volume percentiles.
    const timekeepingHours = toNumber(row['Hours Worked'])
    const activityTimeMins = toNumber(row['Activity Time (Mins)'])
    const hoursWorked = timekeepingHours + activityTimeMins / 60

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
      techLabel: `Tech #${index + 1}`,
      hoursWorked,
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

  const pillarRatesByUser = baseUsers.map((user) =>
    buildPillarRates(user.pillarTotals, user.hoursWorked),
  )
  const sortedPillarRateValues = buildSortedValues(pillarRatesByUser, PILLAR_KEYS)

  const usersWithPercentiles = baseUsers.map((user, index) => {
    const percentiles = buildPercentiles(user.metrics, sortedMetricValues, METRIC_HIGHER_BETTER)
    const pillarPercentiles = buildPercentiles(user.pillarTotals, sortedPillarValues, PILLAR_HIGHER_BETTER)
    const pillarRatePercentiles = buildPercentiles(
      pillarRatesByUser[index],
      sortedPillarRateValues,
      PILLAR_HIGHER_BETTER,
    )

    const pillarsAboveMedian: Record<PillarKey, boolean> = {
      decon: user.pillarTotals.decon >= pillarMedians.decon,
      assembly: user.pillarTotals.assembly >= pillarMedians.assembly,
      sterilize: user.pillarTotals.sterilize >= pillarMedians.sterilize,
    }

    const pillarCount =
      (pillarsAboveMedian.decon ? 1 : 0) +
      (pillarsAboveMedian.assembly ? 1 : 0) +
      (pillarsAboveMedian.sterilize ? 1 : 0)

    const productivity = hoursWorkedAvailable
      ? (pillarRatePercentiles.decon +
          pillarRatePercentiles.assembly +
          pillarRatePercentiles.sterilize) /
        3
      : (pillarPercentiles.decon + pillarPercentiles.assembly + pillarPercentiles.sterilize) / 3

    const quality = percentiles.defectRate * 0.7 + percentiles.assemblyMissingInst * 0.3

    const versatility = (pillarCount / 3) * 100

    return {
      ...user,
      percentiles,
      pillarPercentiles,
      pillarsAboveMedian,
      scores: {
        productivity,
        quality,
        versatility,
        productivityPercentile: 0,
        qualityPercentile: 0,
        versatilityPercentile: 0,
      },
    }
  })

  type ScoreKey = 'productivity' | 'quality' | 'versatility'
  const scoreKeys: ScoreKey[] = ['productivity', 'quality', 'versatility']

  const scoreSorted = scoreKeys.reduce((acc, key) => {
    acc[key] = [...usersWithPercentiles.map((user) => user.scores[key])].sort((a, b) => a - b)
    return acc
  }, {} as Record<ScoreKey, number[]>)

  const usersWithScores = usersWithPercentiles.map((user) => {
    const scorePercentiles = {
      productivityPercentile: percentileFromSorted(
        user.scores.productivity,
        scoreSorted.productivity,
        true,
      ),
      qualityPercentile: percentileFromSorted(user.scores.quality, scoreSorted.quality, true),
      versatilityPercentile: percentileFromSorted(
        user.scores.versatility,
        scoreSorted.versatility,
        true,
      ),
    }

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

    const eligibleStrengths: StrengthCategory[] = []
    if (user.percentiles.defectRate >= 90) eligibleStrengths.push('quality')
    if (user.percentiles.assembledInst >= 90) eligibleStrengths.push('speed')
    if (user.pillarPercentiles.decon >= 90) eligibleStrengths.push('decon')
    if (user.pillarPercentiles.sterilize >= 90) eligibleStrengths.push('sterilize')
    if (pillarCount >= 2) eligibleStrengths.push('multi')

    const badges = eligibleStrengths.map((category) =>
      pickBySeed(STRENGTH_TITLES[category], `${userSeed}-${category}-strength`),
    )

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
