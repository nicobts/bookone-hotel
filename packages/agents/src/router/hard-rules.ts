/**
 * Hard rules (ADR-021). Code, never prompt, and they run before any profile.
 *
 *   - emergency or safety   → emergency information, a person paged, the agent stops (T3)
 *   - money back, compensation, discount → never T1: a person decides (T2)
 *   - identity, legal status or a compliance outcome → never T1 (T2)
 *   - an intent nobody understood, twice running → a person, with the thread (T2)
 *
 * Changing this list is a stop-and-ask (Guest Desk rules). Adding a *word* to
 * one of the lists below is not: the rules are fixed, the vocabulary grows.
 *
 * ## Why phrases rather than single words
 *
 * The cost of a false positive differs by rule. An emergency hit stops the agent
 * on the thread, so the list holds phrases that mean an emergency, not words that
 * appear near one: "can I smoke on the balcony", "where is the emergency exit",
 * "is there a fire pit" and "what brand of coffee" must not trip it, so "smoke",
 * "emergency", "fire" and "brand" are not in it — "there is a fire", "gas leak"
 * and "can't breathe" are. A money hit only hands a conversation to a person, so
 * its list can be broader.
 *
 * Matching is on a normalised copy — lower case, accents stripped, punctuation
 * to spaces — so "Rückerstattung", "ruckerstattung" and "RÜCKERSTATTUNG!" are the
 * same word, as are "è" and "e".
 *
 * ## A model can widen these, never narrow them
 *
 * When a model is connected, its classification can report a rule the word
 * lists missed (a guest describing a fire without the word). It is combined
 * with `anyOf`: a keyword hit stands whatever the model says. The failure mode
 * of a model here must be "escalated when it did not need to", never "did not
 * escalate".
 */
export type HardRule = 'emergency' | 'money' | 'identity' | 'unknown_twice'

export interface HardRuleDecision {
  rule: HardRule
  tier: 'T2' | 'T3'
  /** The agent stops replying on this thread. */
  stop: boolean
}

const VOCABULARY: Record<Exclude<HardRule, 'unknown_twice'>, string[]> = {
  emergency: [
    // en
    'there is a fire',
    'on fire',
    'fire in',
    'fire alarm',
    'gas leak',
    'smell gas',
    'smell of gas',
    'ambulance',
    'this is an emergency',
    'it s an emergency',
    'its an emergency',
    'medical emergency',
    'heart attack',
    'cant breathe',
    'can t breathe',
    'cannot breathe',
    'not breathing',
    'unconscious',
    'bleeding',
    'overdose',
    'someone collapsed',
    'call the police',
    'break in',
    'being attacked',
    'carbon monoxide',
    'smoke alarm',
    // it
    'incendio',
    'al fuoco',
    'fuga di gas',
    'odore di gas',
    'ambulanza',
    'e un emergenza',
    'emergenza medica',
    'infarto',
    'non respira',
    'non riesco a respirare',
    'svenuto',
    'svenuta',
    'sanguina',
    'chiamate la polizia',
    'allarme antincendio',
    // de
    'es brennt',
    'feuer im',
    'feueralarm',
    'gasleck',
    'riecht nach gas',
    'krankenwagen',
    'es ist ein notfall',
    'medizinischer notfall',
    'notarzt',
    'herzinfarkt',
    'bekomme keine luft',
    'atmet nicht',
    'bewusstlos',
    'blutet',
    'rufen sie die polizei',
    'rauchmelder',
    // sl
    'pozar',
    'uhajanje plina',
    'vonj po plinu',
    'resilec',
    'resilce',
    'nujna medicinska pomoc',
    'srcni infarkt',
    'ne diha',
    'ne morem dihati',
    'nezavesten',
    'nezavestna',
    'krvavi',
    'poklicite policijo',
  ],
  money: [
    // en
    'refund',
    'refunded',
    'money back',
    'reimburse',
    'reimbursement',
    'compensation',
    'compensate',
    'discount',
    'chargeback',
    'charge back',
    'overcharged',
    'charged twice',
    'charged me twice',
    'double charged',
    'paid twice',
    'pay me back',
    'free night',
    'waive the',
    // it
    'rimborso',
    'rimborsare',
    'rimborsato',
    'risarcimento',
    'indennizzo',
    'sconto',
    'soldi indietro',
    'addebitato due volte',
    'pagato due volte',
    'notte gratis',
    'storno',
    // de
    'ruckerstattung',
    'erstattung',
    'erstatten',
    'geld zuruck',
    'entschadigung',
    'rabatt',
    'nachlass',
    'doppelt belastet',
    'doppelt bezahlt',
    'gutschrift',
    // sl
    'vracilo',
    'povracilo',
    'vrnite denar',
    'odskodnina',
    'popust',
    'dvakrat zaracunali',
    'dvakrat placal',
    'dvakrat placala',
  ],
  identity: [
    // en
    'is my document valid',
    'is my id valid',
    'is my passport valid',
    'document accepted',
    'am i registered',
    'registered with the police',
    'police registration',
    'verified my identity',
    'identity verified',
    'lawyer',
    'legal action',
    'sue you',
    'is it legal',
    'alloggiati',
    // it
    'documento valido',
    'documento accettato',
    'sono registrato',
    'sono registrata',
    'registrazione in questura',
    'questura',
    'identita verificata',
    'avvocato',
    'denuncia',
    'vi denuncio',
    'azioni legali',
    'e legale',
    // de
    'dokument gultig',
    'ausweis gultig',
    'pass gultig',
    'bin ich gemeldet',
    'polizeiliche meldung',
    'identitat bestatigt',
    'anwalt',
    'klage',
    'rechtliche schritte',
    'ist das legal',
    // sl
    'dokument veljaven',
    'osebna veljavna',
    'ali sem prijavljen',
    'ali sem prijavljena',
    'prijava na policiji',
    'identiteta potrjena',
    'odvetnik',
    'tozba',
    'pravni ukrepi',
  ],
}

/** Lower case, accents stripped, punctuation to single spaces, padded. */
export function normalise(text: string): string {
  const flat = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return ` ${flat} `
}

const NORMALISED: Record<keyof typeof VOCABULARY, string[]> = {
  emergency: VOCABULARY.emergency.map((phrase) => normalise(phrase)),
  money: VOCABULARY.money.map((phrase) => normalise(phrase)),
  identity: VOCABULARY.identity.map((phrase) => normalise(phrase)),
}

function mentions(text: string, rule: keyof typeof VOCABULARY): boolean {
  // Whole words and phrases only: both sides are space-padded, so "fire"
  // does not match "fireplace" and "brand" does not match "brandy".
  return NORMALISED[rule].some((phrase) => text.includes(phrase))
}

export interface HardRuleInput {
  message: string
  /** Whether the previous turn on this thread was an intent nobody understood. */
  previousUnknown: boolean
  /** Whether this turn's intent is unknown — known only after routing. */
  unknownNow?: boolean
  /** Rules a connected model reported. Can add a rule; cannot remove one. */
  modelFlags?: Partial<Record<Exclude<HardRule, 'unknown_twice'>, boolean>>
}

/**
 * The first rule that applies, most severe first, or null.
 *
 * Order matters and is fixed: an emergency outranks a refund request in the
 * same message.
 */
export function applyHardRules(input: HardRuleInput): HardRuleDecision | null {
  const text = normalise(input.message)
  const flagged = (rule: keyof typeof VOCABULARY) =>
    mentions(text, rule) || input.modelFlags?.[rule] === true

  if (flagged('emergency')) return { rule: 'emergency', tier: 'T3', stop: true }
  if (flagged('money')) return { rule: 'money', tier: 'T2', stop: false }
  if (flagged('identity')) return { rule: 'identity', tier: 'T2', stop: false }
  if (input.previousUnknown && input.unknownNow) {
    return { rule: 'unknown_twice', tier: 'T2', stop: false }
  }

  return null
}
