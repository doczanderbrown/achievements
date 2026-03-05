export const AGE_BUCKETS = [
  '<4h',
  '4-12h',
  '12-24h',
  '1-3d',
  '3-7d',
  '7-14d',
  '14-30d',
  '30-90d',
  '90d+',
] as const;

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const isValidDate = (value: Date | null): value is Date => {
  return value instanceof Date && !Number.isNaN(value.getTime());
};

export const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial dates are days since 1899-12-30
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * DAY_MS);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
};

export const computeAgeMs = (value: Date | null): number | null => {
  if (!isValidDate(value)) {
    return null;
  }
  const diff = Date.now() - value.getTime();
  return diff >= 0 ? diff : 0;
};

export const getAgeBucket = (ageMs: number | null): string => {
  if (ageMs === null) {
    return 'Unknown';
  }
  const hours = ageMs / HOUR_MS;
  const days = ageMs / DAY_MS;
  if (hours < 4) return '<4h';
  if (hours < 12) return '4-12h';
  if (hours < 24) return '12-24h';
  if (days < 3) return '1-3d';
  if (days < 7) return '3-7d';
  if (days < 14) return '7-14d';
  if (days < 30) return '14-30d';
  if (days < 90) return '30-90d';
  return '90d+';
};

export const formatDuration = (ageMs: number | null, fallback?: string): string => {
  if (ageMs === null) {
    return fallback && fallback.trim().length > 0 ? fallback : 'Unknown';
  }
  const totalMinutes = Math.floor(ageMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes - days * 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

export const formatDateTime = (value: Date | null): string => {
  if (!isValidDate(value)) {
    return 'N/A';
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
};
