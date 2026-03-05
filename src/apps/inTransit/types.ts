export type SheetType = 'transit' | 'away';

export type InventoryItem = {
  sheetType: SheetType;
  invID: string;
  desc: string;
  owningTower: string;
  lastScanFacility: string;
  lastScanLoc: string;
  lastScanBy: string;
  lastScanAt: Date | null;
  lastScanAgoRaw: string;
  ageMs: number | null;
  ageBucket: string;
  caseCartName?: string;
  caseCartLocation?: string;
  caseCartFacility?: string;
  dispatchDestination?: string;
  transportCartName?: string;
  fromFacility?: string;
  toLocation?: string;
  currentStorageLocation?: string;
};

export type FilterState = {
  search: string;
  owningTowers: string[];
  ageBuckets: string[];
  showUnknownOwners: boolean;
  onlyAged: boolean;
};
