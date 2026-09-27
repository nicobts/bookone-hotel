import { classifyIntent } from '@bookone/core/concierge'
import type { LlmProvider } from '@bookone/core/llm'
import { normalise, type HardRule } from './hard-rules'

/**
 * Which profile a guest turn belongs to (ADR-021).
 *
 * Two classifiers, one decision:
 *
 *   - **Rules**, always: phrases per profile in four languages. Crude, readable,
 *     and the baseline the model has to beat on the eval set (ADR-024).
 *   - **A model**, when one is registered: the small tier, asked to pick a
 *     profile id from a closed list — or `unknown` — and to flag the hard-rule
 *     conditions. It chooses from a list; it writes nothing.
 *
 * The model's profile wins when it names one; the rules fill in when it does
 * not, or when there is no model, or when the call fails. A model outage
 * degrades routing to the rules — it never stops the guest getting a reply.
 *
 * **Sticky.** A turn with no profile of its own ("and for two adults?") stays
 * with the thread's last profile. A turn that clearly names another profile
 * switches.
 */
export type RoutedProfile =
  | 'pre-sale'
  | 'booking-support'
  | 'payments'
  | 'pre-arrival'
  | 'general-info'
  | 'checkout'
  | 'complaints'

export interface Route {
  /** The profile, or `request` for an in-stay request for a thing (a task plus a person). */
  target: RoutedProfile | 'request'
  /** Nothing named a profile: the turn went to `general-info` by default. */
  unknown: boolean
  /** Which classifier decided. Recorded on the run so the evals can compare them. */
  source: 'model' | 'rules' | 'sticky' | 'default'
  /** Hard-rule conditions the model reported. Combined with the keyword rules, never replacing them. */
  modelFlags: Partial<Record<Exclude<HardRule, 'unknown_twice'>, boolean>>
  /** The model that classified, when one did. */
  model: string | null
}

/** Most specific first: a tie between two profiles goes to the earlier one. */
const VOCABULARY: [RoutedProfile, string[]][] = [
  [
    'complaints',
    [
      'complaint',
      'complain',
      'unacceptable',
      'disappointed',
      'terrible',
      'disgusting',
      'dirty',
      'reclamo',
      'lamentela',
      'lamentarmi',
      'inaccettabile',
      'deluso',
      'delusa',
      'sporco',
      'sporca',
      'pessimo',
      'beschwerde',
      'beschweren',
      'inakzeptabel',
      'enttauscht',
      'schmutzig',
      'dreckig',
      'pritozba',
      'pritozujem',
      'nesprejemljivo',
      'razocaran',
      'razocarana',
      'umazano',
      'umazana',
    ],
  ],
  [
    'booking-support',
    [
      'my booking',
      'my reservation',
      'change my booking',
      'change the dates',
      'change my dates',
      'modify my',
      'cancel my',
      'cancel the booking',
      'extra night',
      'add a night',
      'one more night',
      'la mia prenotazione',
      'cambiare le date',
      'modificare la prenotazione',
      'annullare la prenotazione',
      'cancellare la prenotazione',
      'disdire',
      'una notte in piu',
      'meine buchung',
      'meine reservierung',
      'buchung andern',
      'datum andern',
      'stornieren',
      'umbuchen',
      'eine nacht mehr',
      'moja rezervacija',
      'spremeniti rezervacijo',
      'spremeniti datum',
      'odpovedati',
      'preklicati rezervacijo',
      'se eno noc',
    ],
  ],
  [
    'payments',
    [
      'pay',
      'payment',
      'paid',
      'deposit',
      'credit card',
      'bank transfer',
      'payment link',
      'charge on my',
      'pagare',
      'pagamento',
      'pagato',
      'acconto',
      'caparra',
      'bonifico',
      'carta di credito',
      'addebito',
      'bezahlen',
      'zahlung',
      'bezahlt',
      'anzahlung',
      'uberweisung',
      'kreditkarte',
      'abbuchung',
      'placati',
      'placilo',
      'placal',
      'placala',
      'ara',
      'predplacilo',
      'nakazilo',
      'kreditna kartica',
    ],
  ],
  [
    'checkout',
    [
      'check out',
      'checkout',
      'late check out',
      'late checkout',
      'leave later',
      'invoice',
      'receipt',
      'leave our luggage',
      'leave my luggage',
      'store our bags',
      'store my bags',
      'ricevuta',
      'fattura',
      'check out tardivo',
      'partenza',
      'lasciare i bagagli',
      'lasciare le valigie',
      'auschecken',
      'spater auschecken',
      'abreise',
      'rechnung',
      'quittung',
      'gepack aufbewahren',
      'odjava',
      'kasnejsa odjava',
      'racun',
      'pustiti prtljago',
      'odhod',
    ],
  ],
  [
    'pre-arrival',
    [
      'check in form',
      'online check in',
      'pre arrival',
      'documents',
      'passport',
      'id card',
      'arrival time',
      'we will arrive',
      'we ll arrive',
      'arriving at',
      'arrive at',
      'arrive around',
      'check in online',
      'documenti',
      'carta d identita',
      'passaporto',
      'orario di arrivo',
      'arriveremo',
      'arrivo alle',
      'arriviamo',
      'online check in formular',
      'dokumente',
      'ausweis',
      'reisepass',
      'ankunftszeit',
      'wir kommen um',
      'ankommen',
      'dokumenti',
      'osebna izkaznica',
      'potni list',
      'cas prihoda',
      'prispeli',
      'prihod',
    ],
  ],
  [
    'pre-sale',
    [
      'availability',
      'available',
      'do you have a room',
      'free room',
      'room for',
      'how much for',
      'price for',
      'rate for',
      'book a room',
      'disponibilita',
      'camera libera',
      'quanto costa una camera',
      'prezzo per',
      'prenotare una camera',
      'verfugbar',
      'freies zimmer',
      'was kostet ein zimmer',
      'preis fur',
      'zimmer buchen',
      'prosta soba',
      'koliko stane soba',
      'cena za',
      'rezervirati sobo',
    ],
  ],
]

const NORMALISED = VOCABULARY.map(
  ([profile, phrases]) => [profile, phrases.map((phrase) => normalise(phrase))] as const,
)

export interface RouteContext {
  /** The thread belongs to a stay. Pre-sale is for guests who have none. */
  hasBooking: boolean
  /** The profile the thread's last turn used, if any (the sticky one). */
  previousProfile: string | null
  /** The guest used the "make a request" affordance. Beats any inference. */
  intentHint?: 'request' | 'question'
}

/** The rule-based classifier alone. Exported for the evals' baseline. */
export function routeByRules(message: string, context: RouteContext): Route {
  const base = { modelFlags: {}, model: null }

  if (context.intentHint === 'request') {
    return { ...base, target: 'request', unknown: false, source: 'rules' }
  }

  const text = normalise(message)
  let best: RoutedProfile | null = null
  let bestHits = 0

  for (const [profile, phrases] of NORMALISED) {
    if (profile === 'pre-sale' && context.hasBooking) continue
    const hits = phrases.filter((phrase) => text.includes(phrase)).length
    if (hits > bestHits) {
      best = profile
      bestHits = hits
    }
  }

  if (best) return { ...base, target: best, unknown: false, source: 'rules' }

  // A request for a thing — towels, a taxi, a repair — is the one behaviour
  // AG-01 had before profiles, and it stays: a task and a person.
  if (context.intentHint !== 'question' && classifyIntent(message) === 'request') {
    return { ...base, target: 'request', unknown: false, source: 'rules' }
  }

  if (isRoutable(context.previousProfile) && context.previousProfile !== 'general-info') {
    return { ...base, target: context.previousProfile, unknown: false, source: 'sticky' }
  }

  return { ...base, target: 'general-info', unknown: true, source: 'default' }
}

const ROUTABLE = new Set<string>(VOCABULARY.map(([profile]) => profile).concat('general-info'))

function isRoutable(id: string | null): id is RoutedProfile {
  return id !== null && ROUTABLE.has(id)
}

const ROUTE_TOOL = 'route'

/**
 * The full decision: the model when there is one, the rules otherwise.
 *
 * A model answer of `unknown` does not override a rule hit — the rules found
 * something the model did not name, and a false `unknown` is what the
 * "unknown twice" rule would otherwise punish.
 */
export async function route(
  message: string,
  context: RouteContext,
  llm: LlmProvider | null,
): Promise<Route> {
  const rules = routeByRules(message, context)
  if (!llm || context.intentHint === 'request') return rules

  const candidates = [...ROUTABLE].filter((id) => !(id === 'pre-sale' && context.hasBooking))

  try {
    const response = await llm.complete({
      task: 'classification',
      tier: 'small',
      maxOutputTokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: [
            'Classify one hotel guest message. You never reply to the guest.',
            `Pick the profile it belongs to, or "unknown". Profiles: ${candidates.join(', ')}.`,
            '"request" is not a profile: a request for a thing (towels, a taxi, a repair) is "unknown" unless it is a complaint.',
            'Set emergency when someone may be in danger, money when they want money back, compensation or a discount,',
            'identity when they ask whether their documents, registration or legal position is accepted or valid.',
          ].join('\n'),
        },
        { role: 'user', content: message },
      ],
      tools: [
        {
          name: ROUTE_TOOL,
          description: 'Record the classification',
          parameters: {
            type: 'object',
            properties: {
              profile: { type: 'string', enum: [...candidates, 'unknown'] },
              emergency: { type: 'boolean' },
              money: { type: 'boolean' },
              identity: { type: 'boolean' },
            },
            required: ['profile', 'emergency', 'money', 'identity'],
            additionalProperties: false,
          },
        },
      ],
    })

    const call = response.toolCalls.find((c) => c.name === ROUTE_TOOL)
    if (!call) return rules

    const flags = {
      ...(call.input.emergency === true ? { emergency: true } : {}),
      ...(call.input.money === true ? { money: true } : {}),
      ...(call.input.identity === true ? { identity: true } : {}),
    }
    const named = typeof call.input.profile === 'string' ? call.input.profile : 'unknown'

    if (isRoutable(named) && candidates.includes(named)) {
      return {
        target: named,
        unknown: false,
        source: 'model',
        modelFlags: flags,
        model: response.model,
      }
    }

    return { ...rules, modelFlags: flags, model: response.model }
  } catch {
    // Degrade to the rules. The run records `source: 'rules'`, which is how an
    // outage shows up in the evals rather than as a silent guest.
    return rules
  }
}
