import type { RtlsAnalysisConfig, RtlsAnalysisResult, RtlsScanDataset } from '../types'
import { decodeTokenKey } from './parseRtlsScanWorkbook'

const STAGE_ORDER = [
  'Decon',
  'Assembly',
  'Sterilize',
  'Transport',
  'Storage',
  'Case',
  'Other',
]

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

const round2 = (value: number) => Number(value.toFixed(2))
const toPercent = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)

const quantile = (sortedValues: number[], percentile: number) => {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * percentile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

const normalize = (value: string) => value.trim().toLowerCase()

const includesAny = (value: string, needles: string[]) => needles.some((needle) => value.includes(needle))

const classifyStage = (location: string, substate: string, workflowRule: string, state: string) => {
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

const isOffPathTransition = (from: string, to: string) => {
  if (from === to || from === 'Other' || to === 'Other') return false
  return !EXPECTED_STAGE_EDGES.has(`${from}->${to}`)
}

const incrementCount = (map: Map<string, number>, key: string) => {
  map.set(key, (map.get(key) ?? 0) + 1)
}

type ScannerType = 'ilocs' | 'human' | 'unknown'

export const analyzeRtlsDataset = (
  dataset: RtlsScanDataset,
  config: RtlsAnalysisConfig,
): RtlsAnalysisResult => {
  const { rows, sharedLookup, rawValueLookup } = dataset
  const keyword = normalize(config.ilocsKeyword || 'ilocs')
  const beforeHours = Math.max(0, config.humanBeforeHours)
  const afterHours = Math.max(0, config.humanAfterHours)

  const rowCount = rows.invKeys.length
  const sorted = (() => {
    for (let i = 1; i < rowCount; i += 1) {
      if (rows.timestampSerials[i] < rows.timestampSerials[i - 1]) {
        return false
      }
    }
    return true
  })()

  const orderedIndices = sorted
    ? null
    : Array.from({ length: rowCount }, (_, index) => index).sort(
        (left, right) => rows.timestampSerials[left] - rows.timestampSerials[right],
      )

  const scannerTypeCache = new Map<string, ScannerType>()
  const stageCache = new Map<string, string>()

  const lastIlocsLocationByInv = new Map<number, number>()
  const lastHumanLocationByInv = new Map<number, number>()
  const lastIlocsStageByInv = new Map<number, string>()

  const groupedEvents = new Map<string, { ilocs: number[]; human: number[] }>()
  const stageCounts = new Map<string, number>()
  const transitionCounts = new Map<string, number>()
  const offPathTransitionCounts = new Map<string, number>()

  let ilocsRoomChanges = 0
  let humanRoomChanges = 0

  const getScannerType = (aliasUserKey: number, userKey: number) => {
    const cacheKey = `${aliasUserKey}|${userKey}`
    const cached = scannerTypeCache.get(cacheKey)
    if (cached) return cached

    const alias = normalize(decodeTokenKey(aliasUserKey, sharedLookup, rawValueLookup))
    const user = normalize(decodeTokenKey(userKey, sharedLookup, rawValueLookup))
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

  const getStage = (locationKey: number, substateKey: number, workflowKey: number, stateKey: number) => {
    const cacheKey = `${locationKey}|${substateKey}|${workflowKey}|${stateKey}`
    const cached = stageCache.get(cacheKey)
    if (cached) return cached

    const location = decodeTokenKey(locationKey, sharedLookup, rawValueLookup)
    const substate = decodeTokenKey(substateKey, sharedLookup, rawValueLookup)
    const workflowRule = decodeTokenKey(workflowKey, sharedLookup, rawValueLookup)
    const state = decodeTokenKey(stateKey, sharedLookup, rawValueLookup)
    const stage = classifyStage(location, substate, workflowRule, state)
    stageCache.set(cacheKey, stage)
    return stage
  }

  const rowAt = (position: number) => (orderedIndices ? orderedIndices[position] : position)

  for (let position = 0; position < rowCount; position += 1) {
    const rowIndex = rowAt(position)
    const scannerType = getScannerType(rows.aliasUserKeys[rowIndex], rows.userKeys[rowIndex])
    if (scannerType === 'unknown') continue

    const invKey = rows.invKeys[rowIndex]
    const locationKey = rows.locationKeys[rowIndex]
    const timestampSerial = rows.timestampSerials[rowIndex]
    const eventKey = `${invKey}|${locationKey}`

    const group = groupedEvents.get(eventKey) ?? { ilocs: [], human: [] }
    groupedEvents.set(eventKey, group)

    if (scannerType === 'ilocs') {
      const lastLocation = lastIlocsLocationByInv.get(invKey)
      if (lastLocation === locationKey) continue
      lastIlocsLocationByInv.set(invKey, locationKey)
      group.ilocs.push(timestampSerial)
      ilocsRoomChanges += 1

      const stage = getStage(
        locationKey,
        rows.substateKeys[rowIndex],
        rows.workflowKeys[rowIndex],
        rows.stateKeys[rowIndex],
      )
      incrementCount(stageCounts, stage)
      const previousStage = lastIlocsStageByInv.get(invKey)
      if (previousStage && previousStage !== stage) {
        const transitionKey = `${previousStage}|${stage}`
        incrementCount(transitionCounts, transitionKey)
        if (isOffPathTransition(previousStage, stage)) {
          incrementCount(offPathTransitionCounts, transitionKey)
        }
      }
      lastIlocsStageByInv.set(invKey, stage)
      continue
    }

    const lastLocation = lastHumanLocationByInv.get(invKey)
    if (lastLocation === locationKey) continue
    lastHumanLocationByInv.set(invKey, locationKey)
    group.human.push(timestampSerial)
    humanRoomChanges += 1
  }

  let matchedRoomChanges = 0
  let unmatchedIlocsRoomChanges = 0
  let unmatchedHumanRoomChanges = 0
  const lagValues: number[] = []

  groupedEvents.forEach((group) => {
    let ilocsCursor = 0
    let humanCursor = 0

    while (ilocsCursor < group.ilocs.length && humanCursor < group.human.length) {
      const ilocsTime = group.ilocs[ilocsCursor]
      const humanTime = group.human[humanCursor]
      const lagHours = (humanTime - ilocsTime) * 24

      if (lagHours < -beforeHours) {
        unmatchedHumanRoomChanges += 1
        humanCursor += 1
        continue
      }

      if (lagHours > afterHours) {
        unmatchedIlocsRoomChanges += 1
        ilocsCursor += 1
        continue
      }

      matchedRoomChanges += 1
      lagValues.push(lagHours)
      ilocsCursor += 1
      humanCursor += 1
    }

    unmatchedIlocsRoomChanges += group.ilocs.length - ilocsCursor
    unmatchedHumanRoomChanges += group.human.length - humanCursor
  })

  const sortedLags = [...lagValues].sort((left, right) => left - right)
  const meanLag =
    sortedLags.length === 0
      ? 0
      : sortedLags.reduce((accumulator, next) => accumulator + next, 0) / sortedLags.length

  const lagBuckets = [
    { label: 'Human Before ilocs', count: 0 },
    { label: '0-15 Minutes', count: 0 },
    { label: '15-60 Minutes', count: 0 },
    { label: '1-4 Hours', count: 0 },
    { label: '4-8 Hours', count: 0 },
    { label: '8+ Hours', count: 0 },
  ]

  sortedLags.forEach((lagHours) => {
    if (lagHours < 0) {
      lagBuckets[0].count += 1
      return
    }
    if (lagHours < 0.25) {
      lagBuckets[1].count += 1
      return
    }
    if (lagHours < 1) {
      lagBuckets[2].count += 1
      return
    }
    if (lagHours < 4) {
      lagBuckets[3].count += 1
      return
    }
    if (lagHours < 8) {
      lagBuckets[4].count += 1
      return
    }
    lagBuckets[5].count += 1
  })

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

  return {
    parsedRows: dataset.parsedRows,
    ilocsRoomChanges,
    humanRoomChanges,
    matchedRoomChanges,
    unmatchedIlocsRoomChanges,
    unmatchedHumanRoomChanges,
    ilocsMatchRate: round2(toPercent(matchedRoomChanges, ilocsRoomChanges)),
    humanCoverageRate: round2(toPercent(matchedRoomChanges, humanRoomChanges)),
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
  }
}
