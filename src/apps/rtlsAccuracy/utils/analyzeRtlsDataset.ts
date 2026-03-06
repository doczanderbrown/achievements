import type {
  RtlsAnalysisConfig,
  RtlsAnalysisResult,
  RtlsBeaconNoIlocsAsset,
  RtlsDrilldowns,
  RtlsEventDetail,
  RtlsMatchDetail,
  RtlsScanDataset,
  RtlsTransitionDetail,
} from '../types'
import { decodeTokenKey } from './parseRtlsScanWorkbook'

const STAGE_ORDER = ['Decon', 'Assembly', 'Sterilize', 'Transport', 'Storage', 'Case', 'Other']

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

const LAG_BUCKET_LABELS = [
  'Human Before ilocs',
  '0-15 Minutes',
  '15-60 Minutes',
  '1-4 Hours',
  '4-8 Hours',
  '8+ Hours',
]

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

const includesAny = (value: string, needles: string[]) =>
  needles.some((needle) => value.includes(needle))

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

const pushToMapList = <T>(map: Map<string, T[]>, key: string, value: T) => {
  const list = map.get(key)
  if (list) {
    list.push(value)
    return
  }
  map.set(key, [value])
}

const mapListToRecord = <T>(map: Map<string, T[]>) => {
  const record: Record<string, T[]> = {}
  map.forEach((value, key) => {
    record[key] = value
  })
  return record
}

const lagBucketLabel = (lagHours: number) => {
  if (lagHours < 0) return LAG_BUCKET_LABELS[0]
  if (lagHours < 0.25) return LAG_BUCKET_LABELS[1]
  if (lagHours < 1) return LAG_BUCKET_LABELS[2]
  if (lagHours < 4) return LAG_BUCKET_LABELS[3]
  if (lagHours < 8) return LAG_BUCKET_LABELS[4]
  return LAG_BUCKET_LABELS[5]
}

type ScannerType = 'ilocs' | 'human' | 'unknown'

type GroupedEvents = {
  ilocs: RtlsEventDetail[]
  human: RtlsEventDetail[]
}

type BeaconScanCounts = {
  total: number
  human: number
  ilocs: number
}

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

  const decodeCache = new Map<number, string>()
  const decodeValue = (key: number) => {
    const cached = decodeCache.get(key)
    if (cached !== undefined) return cached
    const decoded = decodeTokenKey(key, sharedLookup, rawValueLookup)
    decodeCache.set(key, decoded)
    return decoded
  }

  const scannerTypeCache = new Map<string, ScannerType>()
  const stageCache = new Map<string, string>()

  const lastIlocsLocationByInv = new Map<number, number>()
  const lastHumanLocationByInv = new Map<number, number>()
  const lastIlocsEventByInv = new Map<number, RtlsEventDetail>()

  const groupedEvents = new Map<string, GroupedEvents>()
  const stageCounts = new Map<string, number>()
  const stageEventsMap = new Map<string, RtlsEventDetail[]>()
  const transitionCounts = new Map<string, number>()
  const transitionEventsMap = new Map<string, RtlsTransitionDetail[]>()
  const offPathTransitionCounts = new Map<string, number>()
  const offPathTransitionEventsMap = new Map<string, RtlsTransitionDetail[]>()

  const ilocsEvents: RtlsEventDetail[] = []
  const humanEvents: RtlsEventDetail[] = []
  const beaconedNameByNormalized = new Map<string, string>()
  const beaconScanCounts = new Map<string, BeaconScanCounts>()

  for (const beaconedInvName of dataset.beaconedInvNames) {
    const normalized = normalize(beaconedInvName)
    if (!normalized || beaconedNameByNormalized.has(normalized)) continue
    beaconedNameByNormalized.set(normalized, beaconedInvName)
    beaconScanCounts.set(normalized, {
      total: 0,
      human: 0,
      ilocs: 0,
    })
  }

  const getScannerType = (aliasUserKey: number, userKey: number) => {
    const cacheKey = `${aliasUserKey}|${userKey}`
    const cached = scannerTypeCache.get(cacheKey)
    if (cached) return cached

    const alias = normalize(decodeValue(aliasUserKey))
    const user = normalize(decodeValue(userKey))
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

    const location = decodeValue(locationKey)
    const substate = decodeValue(substateKey)
    const workflowRule = decodeValue(workflowKey)
    const state = decodeValue(stateKey)
    const stage = classifyStage(location, substate, workflowRule, state)
    stageCache.set(cacheKey, stage)
    return stage
  }

  const buildEventDetail = (rowIndex: number, scannerType: 'ilocs' | 'human'): RtlsEventDetail => {
    const invId = decodeValue(rows.invKeys[rowIndex]).trim() || `Inv-${rows.invKeys[rowIndex]}`
    const invName = decodeValue(rows.invNameKeys[rowIndex]).trim() || 'Unknown Inv'
    const location = decodeValue(rows.locationKeys[rowIndex]).trim() || 'Unknown Location'
    const state = decodeValue(rows.stateKeys[rowIndex]).trim()
    const substate = decodeValue(rows.substateKeys[rowIndex]).trim()
    const workflowRule = decodeValue(rows.workflowKeys[rowIndex]).trim()
    const aliasUser = decodeValue(rows.aliasUserKeys[rowIndex]).trim()
    const userName = decodeValue(rows.userKeys[rowIndex]).trim()
    const stage = getStage(
      rows.locationKeys[rowIndex],
      rows.substateKeys[rowIndex],
      rows.workflowKeys[rowIndex],
      rows.stateKeys[rowIndex],
    )

    return {
      invId,
      invName,
      scannerType,
      location,
      stage,
      state,
      substate,
      workflowRule,
      aliasUser,
      userName,
      timestampSerial: rows.timestampSerials[rowIndex],
    }
  }

  const rowAt = (position: number) => (orderedIndices ? orderedIndices[position] : position)

  for (let position = 0; position < rowCount; position += 1) {
    const rowIndex = rowAt(position)
    const scannerType = getScannerType(rows.aliasUserKeys[rowIndex], rows.userKeys[rowIndex])
    const normalizedInvName = normalize(decodeValue(rows.invNameKeys[rowIndex]))
    const beaconCounts = beaconScanCounts.get(normalizedInvName)
    if (beaconCounts) {
      beaconCounts.total += 1
      if (scannerType === 'human') beaconCounts.human += 1
      if (scannerType === 'ilocs') beaconCounts.ilocs += 1
    }
    if (scannerType === 'unknown') continue

    const invKey = rows.invKeys[rowIndex]
    const locationKey = rows.locationKeys[rowIndex]

    const groupKey = `${invKey}|${locationKey}`
    const group = groupedEvents.get(groupKey) ?? { ilocs: [], human: [] }
    groupedEvents.set(groupKey, group)

    if (scannerType === 'ilocs') {
      const lastLocation = lastIlocsLocationByInv.get(invKey)
      if (lastLocation === locationKey) continue

      const event = buildEventDetail(rowIndex, 'ilocs')
      lastIlocsLocationByInv.set(invKey, locationKey)
      group.ilocs.push(event)
      ilocsEvents.push(event)

      incrementCount(stageCounts, event.stage)
      pushToMapList(stageEventsMap, event.stage, event)

      const previousEvent = lastIlocsEventByInv.get(invKey)
      if (previousEvent && previousEvent.stage !== event.stage) {
        const transitionKey = `${previousEvent.stage}|${event.stage}`
        const offPath = isOffPathTransition(previousEvent.stage, event.stage)
        incrementCount(transitionCounts, transitionKey)

        const transitionDetail: RtlsTransitionDetail = {
          invId: event.invId,
          invName: event.invName,
          fromStage: previousEvent.stage,
          toStage: event.stage,
          fromLocation: previousEvent.location,
          toLocation: event.location,
          fromTimestampSerial: previousEvent.timestampSerial,
          toTimestampSerial: event.timestampSerial,
          offPath,
        }
        pushToMapList(transitionEventsMap, transitionKey, transitionDetail)

        if (offPath) {
          incrementCount(offPathTransitionCounts, transitionKey)
          pushToMapList(offPathTransitionEventsMap, transitionKey, transitionDetail)
        }
      }

      lastIlocsEventByInv.set(invKey, event)
      continue
    }

    const lastLocation = lastHumanLocationByInv.get(invKey)
    if (lastLocation === locationKey) continue

    const event = buildEventDetail(rowIndex, 'human')
    lastHumanLocationByInv.set(invKey, locationKey)
    group.human.push(event)
    humanEvents.push(event)
  }

  const matchedEvents: RtlsMatchDetail[] = []
  const unmatchedIlocsEvents: RtlsEventDetail[] = []
  const unmatchedHumanEvents: RtlsEventDetail[] = []
  const lagValues: number[] = []
  const lagBucketMatchesMap = new Map<string, RtlsMatchDetail[]>()

  groupedEvents.forEach((group) => {
    let ilocsCursor = 0
    let humanCursor = 0

    while (ilocsCursor < group.ilocs.length && humanCursor < group.human.length) {
      const ilocsEvent = group.ilocs[ilocsCursor]
      const humanEvent = group.human[humanCursor]
      const lagHours = (humanEvent.timestampSerial - ilocsEvent.timestampSerial) * 24

      if (lagHours < -beforeHours) {
        unmatchedHumanEvents.push(humanEvent)
        humanCursor += 1
        continue
      }

      if (lagHours > afterHours) {
        unmatchedIlocsEvents.push(ilocsEvent)
        ilocsCursor += 1
        continue
      }

      const matchDetail: RtlsMatchDetail = {
        invId: ilocsEvent.invId,
        invName: ilocsEvent.invName,
        location: ilocsEvent.location,
        stage: ilocsEvent.stage,
        ilocsAliasUser: ilocsEvent.aliasUser,
        humanAliasUser: humanEvent.aliasUser,
        ilocsTimestampSerial: ilocsEvent.timestampSerial,
        humanTimestampSerial: humanEvent.timestampSerial,
        lagHours,
      }

      matchedEvents.push(matchDetail)
      lagValues.push(lagHours)
      pushToMapList(lagBucketMatchesMap, lagBucketLabel(lagHours), matchDetail)

      ilocsCursor += 1
      humanCursor += 1
    }

    for (; ilocsCursor < group.ilocs.length; ilocsCursor += 1) {
      unmatchedIlocsEvents.push(group.ilocs[ilocsCursor])
    }
    for (; humanCursor < group.human.length; humanCursor += 1) {
      unmatchedHumanEvents.push(group.human[humanCursor])
    }
  })

  const sortedLags = [...lagValues].sort((left, right) => left - right)
  const meanLag =
    sortedLags.length === 0
      ? 0
      : sortedLags.reduce((accumulator, next) => accumulator + next, 0) / sortedLags.length

  const lagBuckets = LAG_BUCKET_LABELS.map((label) => ({
    label,
    count: lagBucketMatchesMap.get(label)?.length ?? 0,
  }))

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

  const beaconedNeverIlocsAssets: RtlsBeaconNoIlocsAsset[] = Array.from(beaconScanCounts.entries())
    .filter(([, counts]) => counts.ilocs === 0)
    .map(([normalized, counts]) => ({
      invName: beaconedNameByNormalized.get(normalized) ?? normalized,
      totalScans: counts.total,
      humanScans: counts.human,
    }))
    .sort((left, right) => {
      if (right.totalScans !== left.totalScans) return right.totalScans - left.totalScans
      if (right.humanScans !== left.humanScans) return right.humanScans - left.humanScans
      return left.invName.localeCompare(right.invName)
    })

  const drilldowns: RtlsDrilldowns = {
    ilocsEvents,
    humanEvents,
    matchedEvents,
    unmatchedIlocsEvents,
    unmatchedHumanEvents,
    lagBucketMatches: mapListToRecord(lagBucketMatchesMap),
    stageEvents: mapListToRecord(stageEventsMap),
    transitionEvents: mapListToRecord(transitionEventsMap),
    offPathTransitionEvents: mapListToRecord(offPathTransitionEventsMap),
    excludedInvNames: dataset.excludedInvNameSummaries,
    beaconedNeverIlocsAssets,
  }

  return {
    parsedRows: dataset.parsedRows,
    rawParsedRows: dataset.rawParsedRows,
    beaconFilterApplied: dataset.beaconFilterApplied,
    beaconedAssetsCount: dataset.beaconedAssetsCount,
    beaconedNeverIlocsCount: beaconedNeverIlocsAssets.length,
    excludedNonBeaconRows: dataset.excludedNonBeaconRows,
    excludedInvNameSummaries: dataset.excludedInvNameSummaries,
    ilocsRoomChanges: ilocsEvents.length,
    humanRoomChanges: humanEvents.length,
    matchedRoomChanges: matchedEvents.length,
    unmatchedIlocsRoomChanges: unmatchedIlocsEvents.length,
    unmatchedHumanRoomChanges: unmatchedHumanEvents.length,
    ilocsMatchRate: round2(toPercent(matchedEvents.length, ilocsEvents.length)),
    humanCoverageRate: round2(toPercent(matchedEvents.length, humanEvents.length)),
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
    drilldowns,
  }
}
