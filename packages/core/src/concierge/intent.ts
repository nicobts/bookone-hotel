import { tokenise } from './kb'

/**
 * Is this a question, or is it a request? (E3.2, E3.4)
 *
 * A crude, explicit, inspectable rule — and deliberately so. The distinction
 * only changes one thing: whether an escalation also leaves a `stay_tasks` row.
 * Both go to a person either way, so being wrong here is cheap in both
 * directions: a false positive is a task somebody ticks off, a false negative
 * is an escalation with no task attached, which is what every escalation was
 * before this existed.
 *
 * ## Why a word list rather than a classifier
 *
 * Because of what the alternative would cost to be right. A classifier here
 * would need the same evidence a model needs, in four languages, to make a
 * decision whose consequence is a checkbox. The word list is wrong in ways
 * anybody can read and fix; a classifier is wrong in ways that need a data set.
 *
 * When a model is connected it takes this over, and the eval set (`evals/ag-01`)
 * is what will show whether it does better. The list is the baseline it has to
 * beat, which is more useful than an untested assumption that it would.
 *
 * ## The list is about asking-for-a-thing, not about politeness
 *
 * "Could you tell me when breakfast is" is a question containing a polite
 * request form. What separates a request is the *object*: towels, a taxi, a
 * repair. So the markers are nouns, not modal verbs — which is also why this
 * survives translation better than a grammar rule would.
 */

/**
 * Things a guest asks a hotel for, in the four languages we operate in.
 *
 * Every entry is a noun somebody would have to physically do something about.
 * Adding to it is expected and safe; the tests below pin the behaviour, not the
 * vocabulary.
 */
const REQUEST_MARKERS = new Set([
  // en
  'towel',
  'towels',
  'pillow',
  'pillows',
  'blanket',
  'blankets',
  'soap',
  'shampoo',
  'taxi',
  'transfer',
  'luggage',
  'bags',
  'cot',
  'crib',
  'iron',
  'hairdryer',
  'broken',
  'leaking',
  'blocked',
  'cleaning',
  'housekeeping',
  'repair',
  'noise',
  // it
  'asciugamani',
  'asciugamano',
  'cuscino',
  'cuscini',
  'coperta',
  'coperte',
  'sapone',
  'taxi',
  'bagagli',
  'valigie',
  'culla',
  'ferro',
  'phon',
  'asciugacapelli',
  'rotto',
  'rotta',
  'perde',
  'otturato',
  'pulizia',
  'riparazione',
  'rumore',
  // de
  'handtuch',
  'handtucher',
  'handtücher',
  'kissen',
  'decke',
  'decken',
  'seife',
  'taxi',
  'gepack',
  'gepäck',
  'koffer',
  'kinderbett',
  'bugeleisen',
  'bügeleisen',
  'fon',
  'kaputt',
  'undicht',
  'verstopft',
  'reinigung',
  'reparatur',
  'larm',
  'lärm',
  // sl
  'brisaca',
  'brisača',
  'brisace',
  'brisače',
  'blazina',
  'odeja',
  'milo',
  'taksi',
  'prtljaga',
  'kovcek',
  'kovček',
  'posteljica',
  'likalnik',
  'susilnik',
  'sušilnik',
  'pokvarjen',
  'zamasen',
  'zamašen',
  'ciscenje',
  'čiščenje',
  'popravilo',
  'hrup',
])

export type GuestIntent =
  /** Wants to know something. The KB may have it. */
  | 'question'
  /** Wants something done. A person has to act, and it becomes a task. */
  | 'request'

/**
 * Classify one guest message.
 *
 * Note the order: a message that matches a request marker is a request even if
 * it is phrased as a question. "Is it possible to get more towels?" is not a
 * question about towel policy.
 */
export function classifyIntent(message: string): GuestIntent {
  const tokens = tokenise(message)

  return tokens.some((token) => REQUEST_MARKERS.has(token)) ? 'request' : 'question'
}

/** Exposed so a test can assert the list is non-trivial without importing it wholesale. */
export function requestMarkerCount(): number {
  return REQUEST_MARKERS.size
}
