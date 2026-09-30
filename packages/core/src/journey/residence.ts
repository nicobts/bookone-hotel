/**
 * Where a guest lives, as pre-arrival records it (ADR-045).
 *
 * ISTAT counts guests by residence: the country for foreign residents, the
 * province for Italian ones. The keys are the ones the daily return already
 * reads (`compliance/istat.ts`, `compliance/webtur.ts`).
 *
 * A value that is not a two-letter code is dropped rather than stored: the
 * return then falls back to citizenship and counts the guest as such, which is
 * honest. A stored guess would be counted as a residence and be wrong silently.
 * The province is kept only for Italy; abroad it means nothing to ISTAT.
 */
export function residenceFields(
  country?: string | null,
  province?: string | null,
): { residenceCountry?: string; residenceProvince?: string } {
  const residenceCountry = code(country)
  if (!residenceCountry) return {}
  const residenceProvince = residenceCountry === 'IT' ? code(province) : undefined
  return residenceProvince ? { residenceCountry, residenceProvince } : { residenceCountry }
}

function code(value?: string | null): string | undefined {
  const trimmed = value?.trim().toUpperCase()
  return trimmed && /^[A-Z]{2}$/.test(trimmed) ? trimmed : undefined
}
