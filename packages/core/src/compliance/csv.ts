/**
 * One cell of a semicolon CSV that a person will open in a spreadsheet.
 *
 * Text that starts like a formula (`=`, `+`, `-`, `@`, or a tab or carriage
 * return) is prefixed with an apostrophe, so a value a guest or a receptionist
 * typed cannot run as a formula. A cell holding the separator, a quote or a
 * line break is quoted, with its quotes doubled.
 */
export function csvCell(value: string | number): string {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
