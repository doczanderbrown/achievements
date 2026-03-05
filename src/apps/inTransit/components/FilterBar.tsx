import type { FilterState } from '../types';
import MultiSelect from './MultiSelect';
import Toggle from './Toggle';

type FilterBarProps = {
  filters: FilterState;
  towers: string[];
  buckets: string[];
  onChange: (next: FilterState) => void;
};

const FilterBar = ({ filters, towers, buckets, onChange }: FilterBarProps) => {
  return (
    <div className="grid gap-3 rounded-3xl border border-stroke bg-card/85 p-4 shadow-soft backdrop-blur lg:grid-cols-[1.2fr_1fr_1fr_auto_auto]">
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-[0.3em] text-muted">Search</label>
        <input
          type="text"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          placeholder="Search invID or description"
          className="rounded-full border border-stroke bg-white px-4 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </div>
      <MultiSelect
        label="Owning tower"
        options={towers}
        selected={filters.owningTowers}
        onChange={(next) => onChange({ ...filters, owningTowers: next })}
      />
      <MultiSelect
        label="Age bucket"
        options={buckets}
        selected={filters.ageBuckets}
        onChange={(next) => onChange({ ...filters, ageBuckets: next })}
      />
      <Toggle
        label="Show Unknown Owners"
        checked={filters.showUnknownOwners}
        onChange={(next) => onChange({ ...filters, showUnknownOwners: next })}
      />
      <Toggle
        label="Only Aged Items"
        checked={filters.onlyAged}
        onChange={(next) => onChange({ ...filters, onlyAged: next })}
      />
    </div>
  );
};

export default FilterBar;
