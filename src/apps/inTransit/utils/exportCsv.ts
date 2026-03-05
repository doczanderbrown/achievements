import * as XLSX from 'xlsx';

type Column<T> = {
  key: string;
  label: string;
  accessor: (row: T) => string | number | null | undefined;
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const exportToCsv = <T,>(filename: string, rows: T[], columns: Column<T>[]) => {
  const data = rows.map((row) => {
    const record: Record<string, string | number> = {};
    columns.forEach((column) => {
      const value = column.accessor(row);
      record[column.label] = value === null || value === undefined ? '' : value;
    });
    return record;
  });

  const sheet = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });

  downloadBlob(blob, filename);
};
