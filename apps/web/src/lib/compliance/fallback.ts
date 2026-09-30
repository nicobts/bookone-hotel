import 'server-only'
import {
  ALLOGGIATI_ADAPTER_ID,
  WEBTUR_FVG_ADAPTER_ID,
  alloggiatiManualFallback,
  webturManualFallback,
  type ManualFallback,
} from '@bookone/core/compliance'

/**
 * The manual fallback for one obligation (ADR-026): Alloggiati's file for a
 * stay, WebTur's for a day. Null when the adapter has no fallback here yet.
 * Throws `ManualFallbackUnavailable` when the record is not complete enough to
 * build the file; the caller shows the reasons.
 *
 * Shared by the download route and the obligation's screen, so the steps a
 * person reads and the file they download never come from two places.
 */
export async function buildManualFallback(
  propertyId: string,
  obligation: { adapterId: string; reservationId: string | null; periodDate: string | null },
): Promise<ManualFallback | null> {
  if (obligation.adapterId === ALLOGGIATI_ADAPTER_ID && obligation.reservationId) {
    return alloggiatiManualFallback({ propertyId, reservationId: obligation.reservationId })
  }
  if (obligation.adapterId === WEBTUR_FVG_ADAPTER_ID && obligation.periodDate) {
    return webturManualFallback(propertyId, obligation.periodDate)
  }
  return null
}
