export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

// Excel serial dates are days since 1899-12-30 UTC
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)

export const excelSerialToDate = (serial: number): Date =>
  new Date(EXCEL_EPOCH_MS + serial * DAY_MS)

export const dateToExcelSerial = (date: Date): number =>
  (date.getTime() - EXCEL_EPOCH_MS) / DAY_MS

export const excelSerialToInputDate = (serial: number | null): string => {
  if (serial === null) return ''
  const date = excelSerialToDate(serial)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const inputDateToExcelSerial = (value: string): number | null => {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return Date.UTC(year, month - 1, day) / DAY_MS - EXCEL_EPOCH_MS / DAY_MS
}
