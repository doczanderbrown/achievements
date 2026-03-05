import type { ChangeEvent } from 'react';

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

const Toggle = ({ label, checked, onChange }: ToggleProps) => {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.checked);
  };

  return (
    <label className="flex items-center gap-3 rounded-full border border-stroke bg-white px-4 py-2 text-sm shadow-soft">
      <span className="text-muted">{label}</span>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          className="peer sr-only"
        />
        <span className="h-5 w-9 rounded-full bg-slate-200 transition peer-checked:bg-accent"></span>
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4"></span>
      </span>
    </label>
  );
};

export default Toggle;
