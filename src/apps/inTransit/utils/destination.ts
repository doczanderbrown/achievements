export const normalizeDestination = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return 'Unknown';
  const parenIndex = trimmed.indexOf('(');
  const base = parenIndex >= 0 ? trimmed.slice(0, parenIndex).trim() : trimmed;
  if (!base) return 'Unknown';
  const lowered = base.toLowerCase();

  if (lowered.includes('decon for processing')) return 'Unknown';
  if (lowered.includes('offsite') || lowered.includes('offiste')) return 'Offsite';
  if (lowered.includes('south tower') || lowered === 'st') return 'ST';
  if (lowered.includes('north tower') || lowered === 'nt') return 'NT';

  return base;
};
