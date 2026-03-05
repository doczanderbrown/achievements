import { useMemo, useState } from 'react';

import type { InventoryItem } from '../types';
import { DAY_MS, formatDateTime, formatDuration, HOUR_MS } from '../utils/age';
import { normalizeDestination } from '../utils/destination';
import FlowIndicator from './FlowIndicator';
import TabButton from './TabButton';

type TransitBoardProps = {
  items: InventoryItem[];
  stuckThresholdHours: number;
};

type CardSort = 'ageAsc' | 'ageDesc' | 'tower' | 'desc';

type TransitTab = 'flowing' | 'stuck';

const bucketBadge = (bucket: string) => {
  switch (bucket) {
    case '<4h':
      return 'bg-emerald-100 text-emerald-700';
    case '4-12h':
      return 'bg-cyan-100 text-cyan-700';
    case '12-24h':
      return 'bg-amber-100 text-amber-700';
    case '1-3d':
      return 'bg-orange-100 text-orange-700';
    case '3-7d':
      return 'bg-rose-100 text-rose-700';
    case '7-14d':
      return 'bg-fuchsia-100 text-fuchsia-700';
    case '14-30d':
      return 'bg-purple-100 text-purple-700';
    case '30-90d':
      return 'bg-slate-200 text-slate-700';
    case '90d+':
      return 'bg-slate-300 text-slate-800';
    default:
      return 'bg-slate-100 text-slate-600';
  }
};

const TransitBoard = ({ items, stuckThresholdHours }: TransitBoardProps) => {
  const stuckThresholdMs = stuckThresholdHours * HOUR_MS;
  const [cardSort, setCardSort] = useState<CardSort>('ageAsc');
  const [viewTab, setViewTab] = useState<TransitTab>('flowing');

  const stuckItems = useMemo(
    () => items.filter((item) => item.ageMs !== null && item.ageMs >= stuckThresholdMs),
    [items, stuckThresholdMs],
  );

  const flowingItems = useMemo(
    () => items.filter((item) => !(item.ageMs !== null && item.ageMs >= stuckThresholdMs)),
    [items, stuckThresholdMs],
  );

  const boardItems = viewTab === 'stuck' ? stuckItems : flowingItems;

  const columns = useMemo(() => {
    const columnMap = new Map<string, InventoryItem[]>();
    boardItems.forEach((item) => {
      const key = normalizeDestination(item.toLocation ?? '');
      const list = columnMap.get(key) ?? [];
      list.push(item);
      columnMap.set(key, list);
    });

    const compareItems = (a: InventoryItem, b: InventoryItem) => {
      switch (cardSort) {
        case 'ageAsc': {
          const ageA = a.ageMs ?? Number.MAX_SAFE_INTEGER;
          const ageB = b.ageMs ?? Number.MAX_SAFE_INTEGER;
          return ageA - ageB;
        }
        case 'ageDesc': {
          const ageA = a.ageMs ?? -1;
          const ageB = b.ageMs ?? -1;
          return ageB - ageA;
        }
        case 'tower':
          return a.owningTower.localeCompare(b.owningTower);
        case 'desc':
          return a.desc.localeCompare(b.desc);
        default:
          return 0;
      }
    };

    return Array.from(columnMap.entries())
      .map(([key, list]) => ({
        key,
        items: list.sort(compareItems),
      }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [boardItems, cardSort]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TabButton active={viewTab === 'flowing'} onClick={() => setViewTab('flowing')}>
              Flowing ({flowingItems.length})
            </TabButton>
            <TabButton active={viewTab === 'stuck'} onClick={() => setViewTab('stuck')}>
              Stuck ({stuckItems.length})
            </TabButton>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
            <span className="rounded-full border border-stroke bg-white px-3 py-1">
              Stuck ≥ {stuckThresholdHours}h
            </span>
            <div className="flex items-center gap-2">
              <span>Sort</span>
              <select
                value={cardSort}
                onChange={(event) => setCardSort(event.target.value as CardSort)}
                className="rounded-full border border-stroke bg-white px-3 py-1 text-[11px]"
              >
                <option value="ageAsc">Age: youngest to oldest</option>
                <option value="ageDesc">Age: oldest to youngest</option>
                <option value="tower">Owning tower A-Z</option>
                <option value="desc">Description A-Z</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">In Transit Board</div>
            <div className="mt-1 text-sm text-muted">Grouped by destination</div>
          </div>
          <div className="text-xs text-muted">Sorted by selection</div>
        </div>
        {columns.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-stroke bg-slate-50 p-8 text-center text-sm text-muted">
            {viewTab === 'stuck'
              ? 'No stuck items match the current filters.'
              : 'Upload a workbook to view the transit board.'}
          </div>
        ) : (
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {columns.map((column) => (
              <div key={column.key} className="min-w-[280px] flex-1">
                <div className="flex items-center justify-between rounded-2xl border border-stroke bg-orange-50 px-3 py-2">
                  <div className="text-sm font-semibold text-ink">{column.key}</div>
                  <div className="text-xs text-muted">{column.items.length}</div>
                </div>
                <div className="mt-3 space-y-3">
                  {column.items.map((item, index) => (
                    <div
                      key={`${item.sheetType}-${item.invID}-${item.lastScanLoc}-${index}`}
                      className="card-hover rounded-2xl border border-stroke bg-white p-3 shadow-soft"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="line-clamp-2 text-sm font-semibold text-ink">
                          {item.desc || 'No description'}
                        </div>
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${bucketBadge(item.ageBucket)}`}>
                          {item.ageBucket}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="rounded-full border border-stroke px-2 py-1 text-[11px] font-semibold text-ink">
                          {item.owningTower}
                        </span>
                        <span className="text-xs text-muted">
                          {formatDuration(item.ageMs, item.lastScanAgoRaw)}
                        </span>
                      </div>
                      {item.caseCartName ? (
                        <div className="mt-2 text-[11px] text-muted">
                          On <span className="font-semibold text-ink">{item.caseCartName}</span>
                        </div>
                      ) : item.transportCartName ? (
                        <div className="mt-2 text-[11px] text-muted">
                          On <span className="font-semibold text-ink">{item.transportCartName}</span>
                        </div>
                      ) : null}
                      {item.dispatchDestination || item.caseCartFacility ? (
                        <div className="mt-1 text-[11px] text-muted">
                          {item.dispatchDestination ? (
                            <>
                              Dispatch to <span className="font-semibold text-ink">{item.dispatchDestination}</span>
                            </>
                          ) : (
                            'Dispatch target unknown'
                          )}
                          {item.caseCartFacility ? (
                            <>
                              {' '}
                              from <span className="font-semibold text-ink">{item.caseCartFacility}</span>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3">
                        <FlowIndicator
                          mode="transit"
                          fromLabel={item.fromFacility || 'Unknown'}
                          toLabel={normalizeDestination(item.toLocation ?? '')}
                        />
                      </div>
                      <div className="mt-2 text-xs text-muted">
                        {formatDateTime(item.lastScanAt)} - {item.lastScanBy || 'Unknown'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-stroke bg-card/90 p-4 text-sm text-muted shadow-soft">
        Aging rule: items age based on LastScanAt. If missing, LastScanAgo is shown for display only.
        Only aged items are those at least {DAY_MS / HOUR_MS} hours.
      </section>
    </div>
  );
};

export default TransitBoard;
