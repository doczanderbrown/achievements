export type RtlsParseProgress = {
  phase: 'sheets' | 'shared-strings' | 'complete'
  message: string
  rowsParsed?: number
}

export type RtlsScanDataset = {
  rows: {
    invKeys: Int32Array
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

export type RtlsAnalysisResult = {
  parsedRows: number
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
}
