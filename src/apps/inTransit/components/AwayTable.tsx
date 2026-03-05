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

const AwayTable = ({ items, overdueThresholdDays }: AwayTableProps) => {
  const [sortKey, setSortKey] = useState<SortKey>('age');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const sortOptions: { label: string; key: SortKey; direction: 'asc' | 'desc' }[] = [
    { label: 'Age: youngest to oldest', key: 'age', direction: 'asc' },
    { label: 'Age: oldest to youngest', key: 'age', direction: 'desc' },
    { label: 'Owning tower A-Z', key: 'owningTower', direction: 'asc' },
    { label: 'Owning tower Z-A', key: 'owningTower', direction: 'desc' },
    { label: 'Storage location A-Z', key: 'currentStorageLocation', direction: 'asc' },
    { label: 'Storage location Z-A', key: 'currentStorageLocation', direction: 'desc' },
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

  const sortIndicator = (key: SortKey) => {
    if (key !== sortKey) return '';
    return sortDirection === 'asc' ? '^' : 'v';
  };

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
              <span>Sort</span>
              <select
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
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('age')}>
                  Age {sortIndicator('age')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('owningTower')}>
                  Owning tower {sortIndicator('owningTower')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('invID')}>
                  invID {sortIndicator('invID')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('desc')}>
                  Desc {sortIndicator('desc')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('lastScanFacility')}>
                  LastScanFacility {sortIndicator('lastScanFacility')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('currentStorageLocation')}>
                  CurrentStorageLocation {sortIndicator('currentStorageLocation')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('lastScanBy')}>
                  LastScanBy {sortIndicator('lastScanBy')}
                </th>
                <th className="px-3 py-2 cursor-pointer" onClick={() => handleSort('lastScanAt')}>
                  LastScanAt {sortIndicator('lastScanAt')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-muted" colSpan={8}>
                    Upload a workbook to view away inventory.
                  </td>
                </tr>
              ) : (
                sortedItems.map((item, index) => (
                  <tr
                    key={`${item.sheetType}-${item.invID}-${item.lastScanLoc}-${index}`}
                    className="cursor-pointer border-t border-stroke transition hover:bg-orange-50"
                    onClick={() => setSelected(item)}
                  >
                    <td className="px-3 py-2 font-medium">{formatDuration(item.ageMs, item.lastScanAgoRaw)}</td>
                    <td className="px-3 py-2">{item.owningTower}</td>
                    <td className="px-3 py-2">{item.invID}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-2">{item.desc || 'No description'}</span>
                    </td>
                    <td className="px-3 py-2">{item.lastScanFacility || 'Unknown'}</td>
                    <td className="px-3 py-2">
                      <div className="text-sm">{item.currentStorageLocation || 'Unknown'}</div>
                      <div className="mt-2">
                        <FlowIndicator
                          mode="away"
                          fromLabel={item.lastScanFacility || 'Home'}
                          toLabel={item.currentStorageLocation || 'Unknown'}
                          compact
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">{item.lastScanBy || 'Unknown'}</td>
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
              <div className="mt-1 text-base font-semibold text-ink">{selected.desc || 'No description'}</div>
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
                <div className="text-xs uppercase tracking-[0.2em] text-muted">LastScanFacility</div>
                <div className="mt-1 font-medium text-ink">{selected.lastScanFacility || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">CurrentStorageLocation</div>
                <div className="mt-1 font-medium text-ink">
                  {selected.currentStorageLocation || 'Unknown'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">LastScanBy</div>
                <div className="mt-1 font-medium text-ink">{selected.lastScanBy || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">LastScanAt</div>
                <div className="mt-1 font-medium text-ink">{formatDateTime(selected.lastScanAt)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">Age bucket</div>
                <div className="mt-1 font-medium text-ink">{selected.ageBucket}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted">InvID</div>
                <div className="mt-1 font-medium text-ink">{selected.invID || 'Unknown'}</div>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
};

export default AwayTable;
