export type ParseProgress = {
  phase: 'sheets' | 'joining' | 'shared-strings' | 'complete'
  message: string
  inventoryRowsParsed?: number
  loadRowsParsed?: number
  caseRowsParsed?: number
  scanRowsParsed?: number
}

export type FilterOption = {
  id: number
  label: string
}

export type CaseRoutingDataset = {
  rows: {
    caseDateSerials: Float64Array
    dayOfWeek: Uint8Array
    caseFacilityIds: Uint32Array
    caseInvValueIds: Uint32Array
    processingFacilityIds: Uint32Array
    caseItemTypeIds: Uint32Array
    caseCategoryIds: Uint32Array
    caseItemNameIds: Uint32Array
    routeBucketIds: Uint8Array
    matchModeIds: Uint8Array
  }
  caseFacilities: FilterOption[]
  caseItemTypes: FilterOption[]
  caseCategories: FilterOption[]
  caseItemNames: string[]
  caseInvValues: string[]
  processingFacilities: string[]
  parsedCaseRows: number
  parsedInventoryRows: number
  parsedLoadRows: number
  parsedScanRows: number
  pickedCaseRows: number
  matchedCaseRows: number
  unmatchedCaseRows: number
  exactMatchRows: number
  fallbackItemNameMatchRows: number
  scanDestinationMatchRows: number
  minCaseDateSerial: number | null
  maxCaseDateSerial: number | null
}

export type ProcessingLocationDataset = {
  rows: {
    dateSerials: Float64Array
    dayOfWeek: Uint8Array
    ownerIds: Uint32Array
    specialtyIds: Uint32Array
    itemTypeIds: Uint32Array
    facilityIds: Uint32Array
    loadIds: Uint32Array
    setNameIds: Uint32Array
    noGoFlags: Uint8Array
    offsiteFlags: Uint8Array
  }
  owners: FilterOption[]
  specialties: FilterOption[]
  itemTypes: FilterOption[]
  facilities: string[]
  loadValues: string[]
  setNames: string[]
  minDateSerial: number | null
  maxDateSerial: number | null
  parsedInventoryRows: number
  parsedLoadRows: number
  matchedRows: number
  unmatchedRows: number
  caseRouting: CaseRoutingDataset | null
}
