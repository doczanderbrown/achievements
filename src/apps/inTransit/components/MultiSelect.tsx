import { useEffect, useRef, useState } from 'react';

type MultiSelectProps = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
};

const sortSelected = (values: string[], options: string[]) => {
  const optionSet = new Set(options);
  return values.filter((value) => optionSet.has(value));
};

const MultiSelect = ({ label, options, selected, onChange }: MultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((item) => item !== option));
      return;
    }
    onChange(sortSelected([...selected, option], options));
  };

  const summary = selected.length === 0 ? 'All' : `${selected.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 rounded-full border border-stroke bg-white px-4 py-2 text-sm font-medium shadow-soft transition hover:shadow-lift"
      >
        <span className="text-muted">{label}</span>
        <span className="text-ink">{summary}</span>
      </button>
      {open ? (
        <div className="absolute z-20 mt-2 w-64 rounded-3xl border border-stroke bg-card p-3 shadow-lift">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <button
              type="button"
              className="rounded-full border border-stroke px-2 py-1 transition hover:border-accent hover:text-ink"
              onClick={() => onChange([...options])}
            >
              Select all
            </button>
            <button
              type="button"
              className="rounded-full border border-stroke px-2 py-1 transition hover:border-accent hover:text-ink"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto pr-1">
            {options.length === 0 ? (
              <div className="text-sm text-muted">No options</div>
            ) : (
              options.map((option) => (
                <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggleOption(option)}
                    className="h-4 w-4 rounded border-stroke text-accent focus:ring-accent"
                  />
                  <span>{option}</span>
                </label>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MultiSelect;
