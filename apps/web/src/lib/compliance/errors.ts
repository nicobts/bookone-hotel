/**
 * Messages the compliance lifecycle writes to `last_error`, keyed to their
 * translations under `console.arrival.obligation.errors`. Anything not listed
 * is an authority's or a channel's own words and is shown as written.
 *
 * Shared by the arrival page and the exceptions inbox, so the same obligation
 * never reads in two languages on two screens.
 */
export const KNOWN_OBLIGATION_ERRORS: Record<string, 'notConfirmed' | 'deadlineClose'> = {
  'Nobody has confirmed the guests against their documents yet.': 'notConfirmed',
  'The deadline is close: file by hand.': 'deadlineClose',
}
