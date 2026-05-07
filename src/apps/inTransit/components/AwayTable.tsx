import { useMemo, useState } from 'react';

import type { InventoryItem } from '../types';
import { formatDateTime, formatDuration } from '../utils/age';
import Drawer from './Drawer';
import FlowIndicator from './FlowIndicator';

type SortKey =
  | 'age'
  | 'owningTower'
  | 'invID'
  | 'desc'
  | 'lastScanFacility'
  | 'currentStorageLocation'
  | 'lastScanBy'
  | 'lastScanAt';

type AwayTableProps = {
  items: InventoryItem[];
  overdueThresholdDays: number;
};

const COLUMN_LABELS: Record<SortKey, string> = {
  age: 'Age',
  owningTower: 'Owning Tower',
  invID: 'Inv ID',
  desc: 'Description',
  lastScanFacility: 'Last Scan Facility',
  currentStorageLocation: 'Storage Location',
  lastScanBy: 'Scanned By',
  lastScanAt: 'Last Scan',
};

const AwayTable = ({ items, overdueThresholdDays }: AwayTableProps) => {
  const [sortKey, setSortKey] = useState<SortKey>('age');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const sortOptions: { label: string; key: SortKey; direction: 'asc' | 'desc' }[] = [
    { label: 'Age: youngest to oldest', key: 'age', direction: 'asc' },
    { label: 'Age: oldest to youngest', key: 'age', direction: 'desc' },
    { label: 'Owning tower A–Z', key: 'owningTower', direction: 'asc' },
    { label: 'Owning tower Z–A', key: 'owningTower', direction: 'desc' },
    { label: 'Storage location A–Z', key: 'currentStorageLocation', direction: 'asc' },
    { label: 'Storage location Z–A', key: 'currentStorageLocation', direction: 'desc' },
  ];

  const selectedSortValue = `${sortKey}:${sortDirection}`;

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1;

      const resolve = (item: InventoryItem): string | number => {
        switch (sortKey) {
          case 'age':
            return item.ageMs ?? -1;
          case 'owningTower':
            return item.owningTower;
          case 'invID':
            return item.invID;
          case 'desc':
            return item.desc;
          case 'lastScanFacility':
            return item.lastScanFacility;
          case 'currentStorageLocation':
            return item.currentStorageLocation ?? '';
          case 'lastScanBy':
            return item.lastScanBy;
          case 'lastScanAt':
            return item.lastScanAt?.getTime() ?? 0;
          default:
            return '';
        }
      };

      const valueA = resolve(a);
      const valueB = resolve(b);

      if (typeof valueA === 'number' && typeof valueB === 'number') {
        return (valueA - valueB) * direction;
      }

      return String(valueA).localeCompare(String(valueB)) * direction;
    });

    return sorted;
  }, [items, sortDirection, sortKey]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const handleSortSelect = (value: string) => {
    const [key, direction] = value.split(':') as [SortKey, 'asc' | 'desc'];
    setSortKey(key);
    setSortDirection(direction);
  };

  const sortArrow = (key: SortKey) => {
    if (key !== sortKey) return null;
    return <span aria-hidden="true">{sortDirection === 'asc' ? ' ↑' : ' ↓'}</span>;
  };

  const ariaSortFor = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (key !== sortKey) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const columns: SortKey[] = [
    'age',
    'owningTower',
    'invID',
    'desc',
    'lastScanFacility',
    'currentStorageLocation',
    'lastScanBy',
    'lastScanAt',
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">Away Inventory</div>
            <div className="mt-1 text-sm text-muted">Click a row for details</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span className="rounded-full border border-stroke bg-white px-3 py-1">
              Overdue ≥ {overdueThresholdDays}d
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="away-sort" className="sr-only">Sort by</label>
              <select
                id="away-sort"
                value={selectedSortValue}
                onChange={(event) => handleSortSelect(event.target.value)}
                className="rounded-full border border-stroke bg-white px-3 py-1 text-[11px]"
              >
                {sortOptions.map((option) => (
                  <option key={`${option.key}-${option.direction}`} value={`${option.key}:${option.direction}`}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-stroke">
          <table className="w-full text-left text-sm">
            <thead className="bg-orange-50 text-[10px] uppercase tracking-[0.3em] text-muted">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    aria-sort={ariaSortFor(col)}
                    className="px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(col)}
                      className="flex items-center whitespace-nowrap hover:text-ink"
                    >
                      {COLUMN_LABELS[col]}
                      {sortArrow(col)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td className="px-3 py-8 text-center text-sm text-muted" colSpan={columns.length}>
                    {items.length === 0
                      ? 'Upload a workbook to view away inventory.'
                      : 'No items match the current filters.'}
                  </td>
                </tr>
              ) : (
                sortedItems.map((item, index) => (
                  <tr
                    key={`${item.sheetType}-${item.invID}-${item.lastScanLoc}-${index}`}
                    className="cursor-pointer border-t border-stroke transition hover:bg-orange-50"
                    onClick={() => setSelected(item)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(item) }}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${item.invID || 'inventory item'}`}
                  >
                    <td className="px-3 py-2 font-medium">{formatDuration(item.ageMs, item.lastScanAgoRaw)}</td>
                    <td className="px-3 py-2">{item.owningTower}</td>
                    <td className="px-3 py-2">{item.invID}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2">{item.desc || '—'}</span>
                    </td>
                    <td className="px-3 py-2">{item.lastScanFacility || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="text-sm">{item.currentStorageLocation || '—'}</div>
                      <div className="mt-2">
                        <FlowIndicator
                          mode="away"
                          fromLabel={item.lastScanFacility || 'Home'}
                          toLabel={item.currentStorageLocation || 'Unknown'}
                          compact
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">{item.lastScanBy || '—'}</td>
                    <td className="px-3 py-2">{formatDateTime(item.lastScanAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Drawer
        open={Boolean(selected)}
        title={selected?.invID ? `Inventory ${selected.invID}` : 'Inventory Details'}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted">Description</div>
              <div className="mt-1 text-base font-semibold text-ink">{selected.desc || '—'}</div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Owning tower</div>
                <div className="mt-1 font-medium text-ink">{selected.owningTower}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Age</div>
                <div className="mt-1 font-medium text-ink">
                  {formatDuration(selected.ageMs, selected.lastScanAgoRaw)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Last scan facility</div>
                <div className="mt-1 font-medium text-ink">{selected.lastScanFacility || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Storage location</div>
                <div className="mt-1 font-medium text-ink">
                  {selected.currentStorageLocation || '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Scanned by</div>
                <div className="mt-1 font-medium text-ink">{selected.lastScanBy || '—'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Last scan</div>
                <div className="mt-1 font-medium text-ink">{formatDateTime(selected.lastScanAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Age bucket</div>
                <div className="mt-1 font-medium text-ink">{selected.ageBucket}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Inv ID</div>
                <div className="mt-1 font-medium text-ink">{selected.invID || '—'}</div>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
};

export default AwayTable;
