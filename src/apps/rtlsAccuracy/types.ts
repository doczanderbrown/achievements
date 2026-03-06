export type RtlsParseProgress = {
  phase: 'sheets' | 'shared-strings' | 'complete'
  message: string
  rowsParsed?: number
}

export type RtlsScanDataset = {
  rows: {
    invKeys: Int32Array
    invNameKeys: Int32Array
    locationKeys: Int32Array
    aliasUserKeys: Int32Array
    userKeys: Int32Array
    stateKeys: Int32Array
    substateKeys: Int32Array
    workflowKeys: Int32Array
    timestampSerials: Float64Array
  }
  sharedLookup: Map<number, string>
  rawValueLookup: string[]
  parsedRows: number
  rawParsedRows: number
  beaconFilterApplied: boolean
  beaconedAssetsCount: number
  beaconedInvNames: string[]
  excludedNonBeaconRows: number
  excludedInvNameSummaries: RtlsExcludedInvNameSummary[]
}

export type RtlsAnalysisConfig = {
  ilocsKeyword: string
  humanBeforeHours: number
  humanAfterHours: number
}

export type RtlsLagBucket = {
  label: string
  count: number
}

export type RtlsStageSummary = {
  stage: string
  count: number
}

export type RtlsTransitionSummary = {
  from: string
  to: string
  count: number
  offPath: boolean
}

export type RtlsExcludedInvNameSummary = {
  invName: string
  count: number
}

export type RtlsBeaconNoIlocsAsset = {
  invName: string
  totalScans: number
  humanScans: number
}

export type RtlsEventDetail = {
  invId: string
  invName: string
  scannerType: 'ilocs' | 'human'
  location: string
  stage: string
  state: string
  substate: string
  workflowRule: string
  aliasUser: string
  userName: string
  timestampSerial: number
}

export type RtlsMatchDetail = {
  invId: string
  invName: string
  location: string
  stage: string
  ilocsAliasUser: string
  humanAliasUser: string
  ilocsTimestampSerial: number
  humanTimestampSerial: number
  lagHours: number
}

export type RtlsTransitionDetail = {
  invId: string
  invName: string
  fromStage: string
  toStage: string
  fromLocation: string
  toLocation: string
  fromTimestampSerial: number
  toTimestampSerial: number
  offPath: boolean
}

export type RtlsDrilldowns = {
  ilocsEvents: RtlsEventDetail[]
  humanEvents: RtlsEventDetail[]
  matchedEvents: RtlsMatchDetail[]
  unmatchedIlocsEvents: RtlsEventDetail[]
  unmatchedHumanEvents: RtlsEventDetail[]
  lagBucketMatches: Record<string, RtlsMatchDetail[]>
  stageEvents: Record<string, RtlsEventDetail[]>
  transitionEvents: Record<string, RtlsTransitionDetail[]>
  offPathTransitionEvents: Record<string, RtlsTransitionDetail[]>
  excludedInvNames: RtlsExcludedInvNameSummary[]
  beaconedNeverIlocsAssets: RtlsBeaconNoIlocsAsset[]
}

export type RtlsAnalysisResult = {
  parsedRows: number
  rawParsedRows: number
  beaconFilterApplied: boolean
  beaconedAssetsCount: number
  beaconedNeverIlocsCount: number
  excludedNonBeaconRows: number
  excludedInvNameSummaries: RtlsExcludedInvNameSummary[]
  ilocsRoomChanges: number
  humanRoomChanges: number
  matchedRoomChanges: number
  unmatchedIlocsRoomChanges: number
  unmatchedHumanRoomChanges: number
  ilocsMatchRate: number
  humanCoverageRate: number
  lagHours: {
    mean: number
    median: number
    p90: number
    min: number
    max: number
  }
  lagBuckets: RtlsLagBucket[]
  stageSummaries: RtlsStageSummary[]
  transitionSummaries: RtlsTransitionSummary[]
  offPathTransitions: RtlsTransitionSummary[]
  drilldowns: RtlsDrilldowns
}
