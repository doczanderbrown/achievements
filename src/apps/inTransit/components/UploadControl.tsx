import { useRef } from 'react';

type UploadControlProps = {
  onUpload: (file: File) => void;
  fileName?: string | null;
  isLoading?: boolean;
  error?: string | null;
};

const UploadControl = ({ onUpload, fileName, isLoading, error }: UploadControlProps) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUpload(file);
      event.target.value = '';
    }
  };

  return (
    <div className="rounded-3xl border border-stroke bg-card/80 px-4 py-3 shadow-soft backdrop-blur">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={handleChange}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isLoading}
          className="rounded-full bg-accent px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-soft transition hover:shadow-lift disabled:opacity-60"
        >
          {isLoading ? 'Parsing workbook...' : 'Upload .xlsx'}
        </button>
        <div className="flex flex-col text-xs text-muted">
          <span>{fileName ? `Loaded: ${fileName}` : 'Expected: InvsInTransit + InvsAway'}</span>
          <span>Columns: invID, Desc, LastScan* fields</span>
        </div>
      </div>
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  );
};

export default UploadControl;
