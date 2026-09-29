import { describe, expect, it } from 'vitest'
import { csvCell } from './csv'

describe('csvCell', () => {
  it('leaves ordinary values alone', () => {
    expect([csvCell('IT'), csvCell(12), csvCell('BO-X1')]).toEqual(['IT', '12', 'BO-X1'])
  })

  it('stops a typed value from running as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(csvCell('+39')).toBe("'+39")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('quotes the separator and line breaks', () => {
    expect(csvCell('A;B')).toBe('"A;B"')
    expect(csvCell('A\nB')).toBe('"A\nB"')
  })
})
