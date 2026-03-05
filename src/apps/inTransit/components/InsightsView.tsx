import { useMemo } from 'react';

import type { InventoryItem } from '../types';
import { AGE_BUCKETS, DAY_MS, formatDuration, HOUR_MS } from '../utils/age';
import { normalizeDestination } from '../utils/destination';
import ChartCard from './ChartCard';
import StatCard from './StatCard';

type InsightsViewProps = {
  transitItems: InventoryItem[];
  awayItems: InventoryItem[];
  stuckThresholdHours: number;
  onStuckThresholdChange: (next: number) => void;
  overdueThresholdDays: number;
  onOverdueThresholdChange: (next: number) => void;
};

type LaneStat = {
  lane: string;
  count: number;
  avgAgeMs: number | null;
  maxAgeMs: number | null;
};

const InsightsView = ({
  transitItems,
  awayItems,
  stuckThresholdHours,
  onStuckThresholdChange,
  overdueThresholdDays,
  onOverdueThresholdChange,
}: InsightsViewProps) => {
  const stuckThresholdMs = stuckThresholdHours * HOUR_MS;
  const overdueThresholdMs = overdueThresholdDays * DAY_MS;

  const transitStats = useMemo(() => {
    const total = transitItems.length;
    let stuck = 0;
    let oldest: number | null = null;
    const destinationCounts = new Map<string, number>();

    transitItems.forEach((item) => {
      if (item.ageMs !== null && item.ageMs >= stuckThresholdMs) {
        stuck += 1;
      }
      if (item.ageMs !== null) {
        oldest = oldest === null ? item.ageMs : Math.max(oldest, item.ageMs);
      }
      const destination = normalizeDestination(item.toLocation ?? '');
      destinationCounts.set(destination, (destinationCounts.get(destination) ?? 0) + 1);
    });

    let topDestination = 'N/A';
    let topCount = 0;
    destinationCounts.forEach((count, destination) => {
      if (count > topCount) {
        topCount = count;
        topDestination = destination;
      }
    });

    return {
      total,
      stuck,
      oldest,
      topDestination,
    };
  }, [transitItems, stuckThresholdMs]);

  const transitCountByTower = useMemo(() => {
    const counts = new Map<string, number>();
    transitItems.forEach((item) => {
      counts.set(item.owningTower, (counts.get(item.owningTower) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [transitItems]);

  const transitCountByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    transitItems.forEach((item) => {
      counts.set(item.ageBucket, (counts.get(item.ageBucket) ?? 0) + 1);
    });
    const orderedBuckets = [...AGE_BUCKETS, 'Unknown'];
    return orderedBuckets
      .filter((bucket) => counts.has(bucket))
      .map((bucket) => ({ name: bucket, value: counts.get(bucket) ?? 0 }));
  }, [transitItems]);

  const laneStats = useMemo<LaneStat[]>(() => {
    const laneMap = new Map<string, { count: number; ageSum: number; ageCount: number; maxAge: number | null }>();

    transitItems.forEach((item) => {
      const from = item.fromFacility?.trim() || 'Unknown';
      const to = normalizeDestination(item.toLocation ?? '');
      const lane = `${from} -> ${to}`;
      const current = laneMap.get(lane) ?? { count: 0, ageSum: 0, ageCount: 0, maxAge: null };
      current.count += 1;
      if (item.ageMs !== null) {
        current.ageSum += item.ageMs;
        current.ageCount += 1;
        current.maxAge = current.maxAge === null ? item.ageMs : Math.max(current.maxAge, item.ageMs);
      }
      laneMap.set(lane, current);
    });

    return Array.from(laneMap.entries())
      .map(([lane, stats]) => ({
        lane,
        count: stats.count,
        avgAgeMs: stats.ageCount > 0 ? stats.ageSum / stats.ageCount : null,
        maxAgeMs: stats.maxAge,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [transitItems]);

  const awayStats = useMemo(() => {
    const total = awayItems.length;
    let overdue = 0;
    let oldest: number | null = null;
    const storageCounts = new Map<string, number>();

    awayItems.forEach((item) => {
      if (item.ageMs !== null && item.ageMs >= overdueThresholdMs) {
        overdue += 1;
      }
      if (item.ageMs !== null) {
        oldest = oldest === null ? item.ageMs : Math.max(oldest, item.ageMs);
      }
      const location = item.currentStorageLocation?.trim() || 'Unknown';
      storageCounts.set(location, (storageCounts.get(location) ?? 0) + 1);
    });

    let topStorage = 'N/A';
    let topCount = 0;
    storageCounts.forEach((count, location) => {
      if (count > topCount) {
        topCount = count;
        topStorage = location;
      }
    });

    return {
      total,
      overdue,
      oldest,
      topStorage,
    };
  }, [awayItems, overdueThresholdMs]);

  const awayCountByTower = useMemo(() => {
    const counts = new Map<string, number>();
    awayItems.forEach((item) => {
      counts.set(item.owningTower, (counts.get(item.owningTower) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [awayItems]);

  const awayCountByBucket = useMemo(() => {
    const counts = new Map<string, number>();
    awayItems.forEach((item) => {
      counts.set(item.ageBucket, (counts.get(item.ageBucket) ?? 0) + 1);
    });
    const orderedBuckets = [...AGE_BUCKETS, 'Unknown'];
    return orderedBuckets
      .filter((bucket) => counts.has(bucket))
      .map((bucket) => ({ name: bucket, value: counts.get(bucket) ?? 0 }));
  }, [awayItems]);

  const topStorageLocations = useMemo(() => {
    const counts = new Map<string, number>();
    awayItems.forEach((item) => {
      const location = item.currentStorageLocation?.trim() || 'Unknown';
      counts.set(location, (counts.get(location) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [awayItems]);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">Insights</div>
            <div className="mt-1 font-display text-xl font-semibold text-ink">In Transit Summary</div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>Stuck threshold</span>
            <input
              type="number"
              min={1}
              className="w-20 rounded-full border border-stroke bg-white px-2 py-1 text-xs"
              value={stuckThresholdHours}
              onChange={(event) => onStuckThresholdChange(Number(event.target.value) || 1)}
            />
            <span>hours</span>
          </div>
        </div>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total In Transit" value={`${transitStats.total}`} helper="Filtered view" />
          <StatCard
            label="Stuck In Transit"
            value={`${transitStats.stuck}`}
            helper={`Threshold: ${stuckThresholdHours}h`}
          />
          <StatCard label="Oldest In Transit" value={formatDuration(transitStats.oldest)} helper="Max age" />
          <StatCard label="Top Destination" value={transitStats.topDestination} helper="Most common" />
        </section>
        <section className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <ChartCard title="Count by Owning Tower" data={transitCountByTower} />
          <ChartCard title="Count by Age Bucket" data={transitCountByBucket} />
          <div className="rounded-3xl border border-stroke bg-card/90 p-4 shadow-soft">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-muted">Top lanes</div>
                <div className="mt-1 text-sm text-muted">From facility to destination</div>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-stroke">
              <table className="w-full text-left text-sm">
                <thead className="bg-orange-50 text-[10px] uppercase tracking-[0.3em] text-muted">
                  <tr>
                    <th className="px-3 py-2">Lane</th>
                    <th className="px-3 py-2">Count</th>
                    <th className="px-3 py-2">Avg age</th>
                    <th className="px-3 py-2">Max age</th>
                  </tr>
                </thead>
                <tbody>
                  {laneStats.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-sm text-muted" colSpan={4}>
                        No lanes yet
                      </td>
                    </tr>
                  ) : (
                    laneStats.map((lane) => (
                      <tr key={lane.lane} className="border-t border-stroke">
                        <td className="px-3 py-2 font-medium text-ink">{lane.lane}</td>
                        <td className="px-3 py-2">{lane.count}</td>
                        <td className="px-3 py-2">{formatDuration(lane.avgAgeMs)}</td>
                        <td className="px-3 py-2">{formatDuration(lane.maxAgeMs)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-muted">Insights</div>
            <div className="mt-1 font-display text-xl font-semibold text-ink">Away Summary</div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span>Overdue threshold</span>
            <input
              type="number"
              min={1}
              className="w-20 rounded-full border border-stroke bg-white px-2 py-1 text-xs"
              value={overdueThresholdDays}
              onChange={(event) => onOverdueThresholdChange(Number(event.target.value) || 1)}
            />
            <span>days</span>
          </div>
        </div>
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total Away" value={`${awayStats.total}`} helper="Filtered view" />
          <StatCard
            label="Overdue Away"
            value={`${awayStats.overdue}`}
            helper={`Threshold: ${overdueThresholdDays}d`}
          />
          <StatCard label="Oldest Away" value={formatDuration(awayStats.oldest)} helper="Max age" />
          <StatCard label="Top Storage Location" value={awayStats.topStorage} helper="Most common" />
        </section>
        <section className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
          <ChartCard title="Count by Owning Tower" data={awayCountByTower} />
          <ChartCard title="Count by Age Bucket" data={awayCountByBucket} />
          <ChartCard title="Top Storage Locations" subtitle="Top 10 by count" data={topStorageLocations} />
        </section>
      </section>
    </div>
  );
};

export default InsightsView;
