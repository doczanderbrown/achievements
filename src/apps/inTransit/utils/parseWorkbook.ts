import * as XLSX from 'xlsx';

import { computeAgeMs, getAgeBucket, HOUR_MS, isValidDate, parseDate } from './age';
import type { InventoryItem, SheetType } from '../types';

const stringValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return String(value).trim();
};

const parseOwningTower = (desc: string): string => {
  const match = desc.match(/\b([A-Z]{2,4})\s*-\s*\d{1,4}\b/);
  return match ? match[1] : 'Unknown';
};

type CaseCartMeta = {
  caseCartName?: string;
  caseCartLocation?: string;
  caseCartFacility?: string;
  dispatchDestination?: string | null;
};

const assignTransportCarts = (items: InventoryItem[]): InventoryItem[] => {
  let cartIndex = 101;
  const groups = new Map<string, InventoryItem[]>();

  items.forEach((item) => {
    if (item.sheetType !== 'transit' || item.caseCartName) return;
    const destination = item.toLocation?.trim() || 'Unknown';
    const list = groups.get(destination) ?? [];
    list.push(item);
    groups.set(destination, list);
  });

  groups.forEach((groupItems) => {
    const buckets = new Map<string, InventoryItem[]>();
    groupItems.forEach((item) => {
      let bucketKey = 'unknown';
      if (isValidDate(item.lastScanAt)) {
        const hourKey = Math.floor(item.lastScanAt.getTime() / HOUR_MS);
        bucketKey = `hour:${hourKey}`;
      }
      const list = buckets.get(bucketKey) ?? [];
      list.push(item);
      buckets.set(bucketKey, list);
    });

    buckets.forEach((bucketItems) => {
      bucketItems.sort((a, b) => {
        const timeA = isValidDate(a.lastScanAt) ? a.lastScanAt.getTime() : 0;
        const timeB = isValidDate(b.lastScanAt) ? b.lastScanAt.getTime() : 0;
        return timeA - timeB;
      });

      for (let i = 0; i < bucketItems.length; i += 10) {
        const cartName = `Transport Cart ${cartIndex}`;
        cartIndex += 1;
        bucketItems.slice(i, i + 10).forEach((item) => {
          item.transportCartName = cartName;
        });
      }
    });
  });

  return items;
};

const extractDispatchDestination = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const dispatchIndex = lower.indexOf('dispatch to');
  const sentIndex = lower.indexOf('sent to');
  let startIndex = -1;
  let phraseLength = 0;
  if (dispatchIndex >= 0 && (sentIndex === -1 || dispatchIndex < sentIndex)) {
    startIndex = dispatchIndex;
    phraseLength = 'dispatch to'.length;
  } else if (sentIndex >= 0) {
    startIndex = sentIndex;
    phraseLength = 'sent to'.length;
  }
  if (startIndex === -1) return null;
  const raw = trimmed.slice(startIndex + phraseLength).trim();
  const cleaned = raw.replace(/^[-:)\s]+/, '').replace(/\)+$/, '').trim();
  return cleaned || null;
};

const normalizeRow = (
  row: Record<string, unknown>,
  sheetType: SheetType,
  caseCartMeta?: CaseCartMeta,
): InventoryItem => {
  const invID = stringValue(row.invID);
  const desc = stringValue(row.Desc);
  const lastScanFacility = stringValue(row.LastScanFacility);
  const lastScanAgoRaw = stringValue(row.LastScanAgo);
  const lastScanAt = parseDate(row.LastScanAt);
  const lastScanLoc = stringValue(row.LastScanLoc);
  const lastScanBy = stringValue(row.LastScanBy);
  const owningTower = parseOwningTower(desc);
  const ageMs = computeAgeMs(lastScanAt);
  const ageBucket = getAgeBucket(ageMs);
  const caseCartName = caseCartMeta?.caseCartName;
  const caseCartLocation = caseCartMeta?.caseCartLocation;
  const caseCartFacility = caseCartMeta?.caseCartFacility;
  const dispatchDestination = caseCartMeta?.dispatchDestination ?? null;

  const base: InventoryItem = {
    sheetType,
    invID,
    desc,
    owningTower,
    lastScanFacility,
    lastScanLoc,
    lastScanBy,
    lastScanAt,
    lastScanAgoRaw,
    ageMs,
    ageBucket,
    caseCartName,
    caseCartLocation,
    caseCartFacility,
    dispatchDestination: dispatchDestination ?? undefined,
  };

  if (sheetType === 'transit') {
    return {
      ...base,
      fromFacility: lastScanFacility,
      toLocation: dispatchDestination || lastScanLoc,
    };
  }

  return {
    ...base,
    currentStorageLocation: lastScanLoc,
  };
};

const filterEmptyRows = (row: InventoryItem): boolean => {
  return Boolean(row.invID || row.desc || row.lastScanLoc || row.lastScanFacility);
};

export const parseWorkbook = async (file: File): Promise<InventoryItem[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });

  const transitSheet = workbook.Sheets.InvsInTransit;
  const awaySheet = workbook.Sheets.InvsAway;
  const caseCartsSheet = workbook.Sheets['Case Carts'];
  const caseCartItemsSheet = workbook.Sheets['Case Cart Items'];

  if (!transitSheet || !awaySheet) {
    throw new Error('Workbook must include both "InvsInTransit" and "InvsAway" sheets.');
  }

  const transitRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(transitSheet, {
    defval: '',
    raw: true,
  });
  const awayRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(awaySheet, {
    defval: '',
    raw: true,
  });

  const caseCartRows = caseCartsSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(caseCartsSheet, { defval: '', raw: true })
    : [];
  const caseCartItemRows = caseCartItemsSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(caseCartItemsSheet, { defval: '', raw: true })
    : [];

  const caseCartsById = new Map<
    string,
    { caseCartName: string; caseCartLocation: string; caseCartFacility: string; scannedAt: Date | null }
  >();
  caseCartRows.forEach((row) => {
    const id = stringValue(row.CaseCartID);
    if (!id) return;
    const caseCartName = stringValue(row.CaseCartName);
    const caseCartLocation = stringValue(row.CaseCartLocation);
    const caseCartFacility = stringValue(row.FacilityName);
    const scannedAt = parseDate(row.DateTimeLocal);
    const existing = caseCartsById.get(id);
    if (!existing || (scannedAt && (!existing.scannedAt || scannedAt > existing.scannedAt))) {
      caseCartsById.set(id, { caseCartName, caseCartLocation, caseCartFacility, scannedAt });
    }
  });

  const caseCartItemByInvId = new Map<
    string,
    { caseCartID: string; caseCartName: string; scannedAt: Date | null }
  >();
  caseCartItemRows.forEach((row) => {
    const invID = stringValue(row.InvID);
    if (!invID) return;
    const caseCartID = stringValue(row.CaseCartID);
    const caseCartName = stringValue(row.CaseCartName);
    const scannedAt = parseDate(row.DateTimeLocal);
    const existing = caseCartItemByInvId.get(invID);
    if (!existing || (scannedAt && (!existing.scannedAt || scannedAt > existing.scannedAt))) {
      caseCartItemByInvId.set(invID, { caseCartID, caseCartName, scannedAt });
    }
  });

  const transitItems = transitRows
    .map((row) => {
      const invID = stringValue(row.invID);
      const cartItem = invID ? caseCartItemByInvId.get(invID) : undefined;
      const cartMeta = cartItem ? caseCartsById.get(cartItem.caseCartID) : undefined;
      const resolvedName = cartItem?.caseCartName || cartMeta?.caseCartName || '';
      const resolvedLocation = cartMeta?.caseCartLocation || '';
      const resolvedFacility = cartMeta?.caseCartFacility || '';
      const locationDispatch = resolvedLocation ? extractDispatchDestination(resolvedLocation) : null;
      const scanDispatch = extractDispatchDestination(stringValue(row.LastScanLoc));
      const dispatchDestination = locationDispatch || scanDispatch;

      return normalizeRow(row, 'transit', {
        caseCartName: resolvedName || undefined,
        caseCartLocation: resolvedLocation || undefined,
        caseCartFacility: resolvedFacility || undefined,
        dispatchDestination,
      });
    })
    .filter(filterEmptyRows);
  const awayItems = awayRows
    .map((row) => {
      const lastScanLoc = stringValue(row.LastScanLoc);
      const dispatchDestination = extractDispatchDestination(lastScanLoc);
      if (dispatchDestination) {
        return normalizeRow(row, 'transit', { dispatchDestination });
      }
      return normalizeRow(row, 'away');
    })
    .filter(filterEmptyRows);

  const transitWithTransport = assignTransportCarts(transitItems);

  return [...transitWithTransport, ...awayItems];
};
