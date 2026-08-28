import type { BookingSearch } from '@/lib/booking/params'

/** What steps 3 and 4 carry back to their actions. */
export interface BookingState extends BookingSearch {
  hold: string
}

/**
 * The state a step posts back with its form.
 *
 * Rendered inside the form rather than threaded through the URL, and
 * re-validated by the action regardless — these inputs are a convenience for
 * the browser, not a source of truth. A hidden field is a suggestion from a
 * stranger, and the actions treat it as one.
 */
export function StateFields({ state }: { state: BookingState }) {
  return (
    <>
      <input type="hidden" name="arrival" value={state.arrival} />
      <input type="hidden" name="departure" value={state.departure} />
      <input type="hidden" name="adults" value={state.adults} />
      <input type="hidden" name="children" value={state.children} />
      <input type="hidden" name="hold" value={state.hold} />
    </>
  )
}
