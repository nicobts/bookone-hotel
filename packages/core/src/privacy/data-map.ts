/**
 * The data map (E8.2, PRD D6).
 *
 * One entry per table in the schema: whose personal data it holds, why we are
 * allowed to hold it, how long, and what an erasure request does to it.
 *
 * ## Why this is TypeScript and not a document
 *
 * A data map written in a document is true on the day it is written. This one
 * is read by three things — the export bundle, the erasure routine and the
 * retention sweep — and checked by a test that fails when a table exists in the
 * schema and not here. That is the only mechanism anybody has found that keeps
 * a data map true after the sprint that wrote it, and a stale data map is worse
 * than none: it is a signed statement that turns out to be wrong.
 *
 * ## What it is not
 *
 * It is not the DPA and it is not legal advice. The `basis` line on each entry
 * is the position we take and the one counsel is asked to confirm; where a
 * period is our judgement rather than a legal requirement, the entry says so.
 * PRD D6 names three periods and flags the third for counsel: documents go on
 * submission, messages at 24 months, reservations at ten years as a
 * fiscal-adjacent minimum.
 *
 * ## The subject
 *
 * `guest` and `staff` are different people with different controllers. A guest's
 * controller is the property; a staff member's is the property as employer, and
 * their account lives in `auth.users` outside tenancy (ADR-017). The erasure
 * routine here acts on guests only, and every staff-bearing entry says why it
 * is out of its reach.
 */

/** Who the personal data in a table is about. */
export type Subject = 'guest' | 'staff' | 'none'

/**
 * What kind of personal data, in the vocabulary a DPA uses rather than ours.
 *
 * `document` is called out separately from `identity` because it is the
 * category with the shortest retention and the loudest failure mode: an
 * identity document held one day longer than the filing needed it is the single
 * finding most likely to appear in an inspection of an accommodation provider.
 */
export type Category =
  'identity' | 'contact' | 'document' | 'stay' | 'financial' | 'content' | 'behavioural'

/**
 * How long we keep it.
 *
 * Only two shapes are executable by the sweep — `purge-columns` and
 * `delete-rows` — and that is deliberate. A rule the sweep cannot run is a rule
 * that has to name the thing that does run it (`job`) or say plainly that
 * nothing does (`keep`, `cascade`). There is no fifth case where the period is
 * declared and nothing enforces it, because that case is how a data map becomes
 * fiction.
 */
export type Retention =
  | {
      /** Blank named columns in place, keeping the row. */
      kind: 'purge-columns'
      afterDays: number
      /** A timestamp or date column on this table, or `departure` for the stay's end. */
      anchor: string
      /** Column → the SQL literal it becomes. */
      columns: Record<string, string>
      /** Set alongside, so "purged" and "never had one" stay distinguishable. */
      stamp?: string
      why: string
    }
  | {
      kind: 'delete-rows'
      afterDays: number
      anchor: string
      /**
       * Rows to remove first, in order, before this table's own.
       *
       * Not every child of a row goes when the row does. Three of a
       * reservation's children are `restrict` on purpose — money and a filing
       * with a public authority should not disappear because somebody deleted
       * the stay — and `external_refs` points at it by id with no foreign key
       * at all. Declaring them here is what makes the ten-year rule executable
       * instead of a statement that throws on its first non-empty run.
       *
       * The coherence test checks this list against the database's own foreign
       * keys, so a table that quietly changes from `cascade` to `restrict`
       * fails here rather than at 04:00 in a job nobody is watching.
       */
      dependents?: { table: string; via: string; where?: string }[]
      why: string
    }
  | { kind: 'job'; job: string; why: string }
  | { kind: 'cascade'; parent: string; why: string }
  | { kind: 'keep'; why: string }

/**
 * What an erasure request does.
 *
 * `keep` is a carve-out and every one of them cites the reason a supervisory
 * authority would be given. Art. 17(3) allows exactly this; what it does not
 * allow is a carve-out nobody wrote down.
 */
export type Erasure =
  | { kind: 'anonymise'; columns: Record<string, string>; why: string }
  | { kind: 'redact'; columns: Record<string, string>; why: string }
  | { kind: 'delete'; why: string }
  | { kind: 'keep'; why: string }
  | { kind: 'none' }

/**
 * How the export bundle reaches this table's rows from one guest.
 *
 * `none` means the table holds nothing about a guest and does not appear in a
 * bundle — which is itself worth declaring, because "we checked and there is
 * nothing" and "we forgot this table" look identical in an export.
 */
export type ExportPath = 'guest' | 'reservation' | 'thread' | 'none'

export interface DataMapEntry {
  table: string
  subject: Subject
  categories: Category[]
  /** The lawful basis, in one line, as we would state it to a regulator. */
  basis: string
  retention: Retention
  erasure: Erasure
  exportVia: ExportPath
}

/**
 * Days, named, because a reader should not have to divide.
 *
 * Ten years is the fiscal-adjacent floor from PRD D6 and the one period here
 * that is somebody else's number rather than ours.
 */
const DAYS = {
  thirty: 30,
  ninety: 90,
  twoYears: 730,
  tenYears: 3653,
} as const

export const DATA_MAP: DataMapEntry[] = [
  // -------------------------------------------------------------------------
  // Tenancy and identity
  // -------------------------------------------------------------------------
  {
    table: 'properties',
    subject: 'none',
    categories: [],
    basis: 'Customer record. Contract with the property (Art. 6(1)(b)).',
    retention: {
      kind: 'keep',
      why: 'The customer relationship. Deleted when a hotel leaves and asks.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
  {
    table: 'profiles',
    subject: 'staff',
    categories: ['identity', 'contact'],
    basis: 'Account record for a person who works at the property (Art. 6(1)(b)).',
    retention: {
      kind: 'cascade',
      parent: 'auth.users',
      why: 'Deleting the account deletes the profile. Staff erasure is the property’s HR process, not this sweep — see the design note §5.',
    },
    erasure: {
      kind: 'keep',
      why: 'Not a guest. Out of the guest erasure routine by design (ADR-017).',
    },
    exportVia: 'none',
  },
  {
    table: 'property_members',
    subject: 'staff',
    categories: ['identity'],
    basis: 'Access control. Contract with the property (Art. 6(1)(b)).',
    retention: {
      kind: 'cascade',
      parent: 'auth.users',
      why: 'A membership without an account is nothing.',
    },
    erasure: {
      kind: 'keep',
      why: 'Not a guest. Removing a membership is an access-control action the owner takes in the team screen, and it is not a data-subject right exercised through this desk.',
    },
    exportVia: 'none',
  },
  {
    table: 'entitlements',
    subject: 'none',
    categories: [],
    basis: 'Commercial configuration.',
    retention: {
      kind: 'keep',
      why: 'The record of which modules were live when. A billing question is asked years later.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },

  // -------------------------------------------------------------------------
  // The guest and the stay
  // -------------------------------------------------------------------------
  {
    table: 'guests',
    subject: 'guest',
    categories: ['identity', 'contact'],
    basis:
      'Performance of the accommodation contract (Art. 6(1)(b)); marketing only on consent (Art. 6(1)(a)).',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.tenYears,
      anchor: 'created_at',
      columns: { name: "'—'", email: 'null', phone: 'null', marketing_consent: 'false' },
      why: 'The row outlives the person because reservations point at it (foreign key `restrict`). At the fiscal floor the person goes and the shell stays.',
    },
    erasure: {
      kind: 'anonymise',
      columns: {
        name: "'—'",
        email: 'null',
        phone: 'null',
        locale: 'null',
        marketing_consent: 'false',
      },
      why: 'Anonymised in place. Dropping the row would orphan every reservation, and the reservation is the thing we are required to keep.',
    },
    exportVia: 'guest',
  },
  {
    table: 'reservations',
    subject: 'guest',
    categories: ['stay', 'financial', 'behavioural'],
    basis:
      'Performance of the accommodation contract (Art. 6(1)(b)); retained under a legal obligation (Art. 6(1)(c)).',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.tenYears,
      anchor: 'created_at',
      dependents: [
        { table: 'alloggiati_submissions', via: 'reservation_id' },
        { table: 'fee_events', via: 'reservation_id' },
        { table: 'payments', via: 'reservation_id' },
        { table: 'external_refs', via: 'entity_id', where: "entity_type = 'reservation'" },
      ],
      why: 'Ten years is the fiscal-adjacent minimum in PRD D6, flagged there for counsel. It is a floor we hold to, not a ceiling we chose.',
    },
    erasure: {
      kind: 'keep',
      why: 'Art. 17(3)(b): retention required by law. The guest is anonymised; the transaction is not erasable on request and the desk says so before the button.',
    },
    exportVia: 'guest',
  },
  {
    table: 'journey_states',
    subject: 'guest',
    categories: ['stay'],
    basis: 'Operation of the stay (Art. 6(1)(b)).',
    retention: {
      kind: 'cascade',
      parent: 'reservations',
      why: 'One row per reservation, deleted with it.',
    },
    erasure: {
      kind: 'keep',
      why: 'Five enum values and no person in them once the guest is anonymised.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'external_refs',
    subject: 'none',
    categories: [],
    basis: 'Technical correlation with the property’s own systems.',
    retention: {
      kind: 'cascade',
      parent: 'reservations',
      why: 'An identifier for a row that no longer exists is litter.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },

  // -------------------------------------------------------------------------
  // Registration and the filing (E2.3, E2.4)
  // -------------------------------------------------------------------------
  {
    table: 'registration_records',
    subject: 'guest',
    categories: ['identity', 'document'],
    basis: 'Legal obligation — the accommodated-persons registry (Art. 6(1)(c), TULPS art. 109).',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.thirty,
      anchor: 'departure',
      columns: { data: "'{}'::jsonb" },
      stamp: 'deleted_at',
      why: 'The registration fields are needed while the guest is in the house and for a short tail afterwards — a correction, a query from the Questura. After that the filed payload is the record and this is a duplicate of identity data with no purpose. The *document image* goes earlier, on acknowledgement, under the E2.4 job.',
    },
    erasure: {
      kind: 'redact',
      columns: { data: "'{}'::jsonb", document_path: 'null' },
      why: 'The document image and the fields go. The row survives so the filing can still be traced to a stay.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'alloggiati_submissions',
    subject: 'guest',
    categories: ['identity'],
    basis: 'Legal obligation (Art. 6(1)(c)); the payload is the property’s evidence that it filed.',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.twoYears,
      anchor: 'acknowledged_at',
      columns: { payload: "''" },
      stamp: 'payload_purged_at',
      why: 'The transmitted text names every guest in the party. Two years is our judgement of how long a filing can plausibly be challenged, not a period anybody has given us — counsel to confirm. The checksum, the receipt and the status stay forever: they prove the filing happened without repeating who was in it.',
    },
    erasure: {
      kind: 'keep',
      why: 'Art. 17(3)(b), and the one carve-out that leaves a name behind. The transmitted text is the property’s evidence it met an obligation to a public authority, and it names every guest in the party — so honouring one person’s request by deleting it would destroy another person’s record and the property’s compliance evidence together. It goes on the two-year clock above instead, and the desk tells the requester that date rather than implying the filing is gone.',
    },
    exportVia: 'reservation',
  },

  // -------------------------------------------------------------------------
  // Money
  // -------------------------------------------------------------------------
  {
    table: 'payments',
    subject: 'guest',
    categories: ['financial'],
    basis: 'Performance of contract (Art. 6(1)(b)); accounting retention (Art. 6(1)(c)).',
    retention: {
      kind: 'cascade',
      parent: 'reservations',
      why: 'Held as long as the reservation, and for the same reason.',
    },
    erasure: {
      kind: 'keep',
      why: 'Art. 17(3)(b). Card data never lands here — amounts, statuses and a provider reference do.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'fee_events',
    subject: 'none',
    categories: ['financial'],
    basis: 'Our own contract with the property (Art. 6(1)(b)).',
    retention: {
      kind: 'cascade',
      parent: 'reservations',
      why: 'The fee is about the property, not the guest, but it hangs off the reservation row.',
    },
    erasure: {
      kind: 'keep',
      why: 'What we invoiced the hotel. Not the guest’s to erase, and D14 makes it the invoice basis.',
    },
    exportVia: 'none',
  },
  {
    table: 'attribution_events',
    subject: 'guest',
    categories: ['behavioural'],
    basis:
      'Legitimate interest in billing our own service accurately (Art. 6(1)(f)); pseudonymous session identifiers only.',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.twoYears,
      anchor: 'occurred_at',
      why: 'Once a monthly report is issued its snapshot freezes the evidence (D14), so the raw touches stop being the record and start being a browsing history. Two years covers any dispute window that has ever been opened against a statement.',
    },
    erasure: {
      kind: 'delete',
      why: 'The touches on the erased guest’s own reservations go. Once the report that billed them is issued its snapshot holds the evidence, so nothing that has to be defensible depends on these rows.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'stay_extras',
    subject: 'guest',
    categories: ['financial', 'stay'],
    basis: 'Performance of contract (Art. 6(1)(b)).',
    retention: { kind: 'cascade', parent: 'reservations', why: 'Part of the bill for the stay.' },
    erasure: { kind: 'keep', why: 'A line on a bill. Anonymised by the guest being anonymised.' },
    exportVia: 'reservation',
  },
  {
    table: 'invoice_requests',
    subject: 'guest',
    categories: ['identity', 'financial'],
    basis: 'Performance of contract (Art. 6(1)(b)) — the guest asked for an invoice.',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.tenYears,
      anchor: 'created_at',
      columns: { bill_to: "'—'", details: "'{}'::jsonb" },
      why: 'Billing details are a name and often a company address. They ride the same fiscal floor as the reservation because that is what they are part of.',
    },
    erasure: {
      kind: 'redact',
      columns: { bill_to: "'—'", details: "'{}'::jsonb" },
      why: 'The row stays as proof the request was routed; the name and the billing address do not. Our copy is not the legal record — the property issues the document and keeps it under their own obligation — so there is no carve-out to claim here, and the first version of this map claimed one anyway. An erasure that leaves the guest’s name in a column called `bill_to` is not an erasure.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'subscriptions',
    subject: 'none',
    categories: ['financial'],
    basis: 'Our contract with the property.',
    retention: {
      kind: 'keep',
      why: 'What the hotel was on and when. A billing question is asked years later.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
  {
    table: 'monthly_reports',
    subject: 'none',
    categories: ['financial'],
    basis: 'Our contract with the property (D14: the report is the invoice basis).',
    retention: {
      kind: 'keep',
      why: 'An issued statement is frozen evidence. Deleting one deletes an invoice.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
  {
    table: 'fee_disputes',
    subject: 'none',
    categories: ['financial'],
    basis: 'Our contract with the property.',
    retention: {
      kind: 'keep',
      why: 'The record that a charge was argued and what happened. M6 rests on this being complete.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },

  // -------------------------------------------------------------------------
  // Conversation
  // -------------------------------------------------------------------------
  {
    table: 'message_threads',
    subject: 'guest',
    categories: ['stay'],
    basis: 'Performance of contract (Art. 6(1)(b)) — answering a guest who asked.',
    retention: {
      kind: 'cascade',
      parent: 'reservations',
      why: 'The shell outlives its messages on purpose: a thread with none left still says a conversation happened, and the timestamps on it are the SLA record.',
    },
    erasure: {
      kind: 'redact',
      columns: { escalation_reason: 'null' },
      why: 'The escalation reason quotes the guest. Everything else here is timestamps and a status.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'messages',
    subject: 'guest',
    categories: ['content'],
    basis: 'Performance of contract (Art. 6(1)(b)).',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.twoYears,
      anchor: 'created_at',
      why: 'Twenty-four months, the period declared in PRD D6. Free text a guest wrote is the category most likely to contain something nobody planned for it to contain.',
    },
    erasure: {
      kind: 'delete',
      why: 'Deleted outright. There is no obligation to keep a conversation and no defensible reason to.',
    },
    exportVia: 'thread',
  },
  {
    table: 'stay_tasks',
    subject: 'guest',
    categories: ['content'],
    basis: 'Performance of contract (Art. 6(1)(b)) — a request a guest made.',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.twoYears,
      anchor: 'created_at',
      why: 'A summary of what a guest asked for. Same category and same clock as the message it came from.',
    },
    erasure: { kind: 'delete', why: 'Goes with the conversation it came from.' },
    exportVia: 'reservation',
  },
  {
    table: 'notifications',
    subject: 'guest',
    categories: ['contact', 'content'],
    basis: 'Performance of contract (Art. 6(1)(b)); the row is the delivery record.',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.twoYears,
      anchor: 'created_at',
      why: '`recipient` is an email address or a phone number and `payload` is what we said. Kept as long as the messages, because it answers the same question: what did this hotel send this person.',
    },
    erasure: {
      kind: 'redact',
      columns: { recipient: "'—'", payload: "'{}'::jsonb" },
      why: 'The row survives as proof a required notice went out; the address it went to does not.',
    },
    exportVia: 'reservation',
  },
  {
    table: 'kb_articles',
    subject: 'none',
    categories: [],
    basis: 'The property’s own content.',
    retention: { kind: 'keep', why: 'Written by the hotel about the hotel. No person in it.' },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },

  // -------------------------------------------------------------------------
  // The record of what happened
  // -------------------------------------------------------------------------
  {
    table: 'domain_events',
    subject: 'guest',
    categories: ['behavioural'],
    basis:
      'Legitimate interest in an auditable record of our own processing (Art. 6(1)(f)); Art. 30 accountability.',
    retention: {
      kind: 'keep',
      why: 'Append-only and kept. It is the basis of G1, the agent audit trail, the reconciliation evidence D11 asks for and the attribution report that is the invoice. An event log that expires answers no question worth asking.',
    },
    erasure: {
      kind: 'redact',
      columns: { payload: "'{}'::jsonb" },
      why: 'The event stays, the payload goes, for events about the erased guest’s own entities. What survives is that something happened to a reservation, by whom, when — pseudonymous, and the evidence that the erasure itself was performed.',
    },
    exportVia: 'none',
  },
  {
    table: 'agent_runs',
    subject: 'guest',
    categories: ['content'],
    basis:
      'Legitimate interest in auditing our own automated processing (Art. 6(1)(f)); ADR-011 requires every run recorded.',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.twoYears,
      anchor: 'at',
      columns: { tool_calls: "'[]'::jsonb", output: "'{}'::jsonb" },
      why: 'The run stays forever — tier, outcome, cost and confidence are the evals’ own history. What it said and what it was given go on the message clock, because that is where a guest’s words end up.',
    },
    erasure: {
      kind: 'redact',
      columns: { tool_calls: "'[]'::jsonb", output: "'{}'::jsonb" },
      why: 'A concierge reply quotes the guest. The run record survives so the audit trail has no hole where a person used to be.',
    },
    exportVia: 'none',
  },
  {
    table: 'reconciliation_runs',
    subject: 'none',
    categories: [],
    basis: 'Legitimate interest — parity measurement (Art. 6(1)(f)).',
    retention: {
      kind: 'keep',
      why: 'The parity ratio is the evidence D11’s condition C2 turns on. A measurement deleted is a gate that cannot open.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
  {
    table: 'discrepancies',
    subject: 'guest',
    categories: ['stay'],
    basis: 'Legitimate interest — detecting divergence between two systems (Art. 6(1)(f)).',
    retention: {
      kind: 'purge-columns',
      afterDays: DAYS.twoYears,
      anchor: 'created_at',
      columns: { ours: "'{}'::jsonb", theirs: "'{}'::jsonb" },
      why: '`ours` and `theirs` are snapshots of two rows that disagreed, and one of them can be a reservation with a name on it. The class, the status and the count — which is what the ratio is computed from — stay.',
    },
    erasure: {
      kind: 'redact',
      columns: { ours: "'{}'::jsonb", theirs: "'{}'::jsonb" },
      why: 'Same columns, on request rather than on the clock.',
    },
    exportVia: 'none',
  },

  {
    table: 'privacy_requests',
    subject: 'guest',
    categories: ['identity'],
    basis:
      'Legal obligation (Art. 6(1)(c)) — Art. 12(3) requires us to be able to show we answered, and when, and Art. 5(2) makes that our burden to prove.',
    retention: {
      kind: 'keep',
      why: 'The record that a right was exercised has to outlive the data it was exercised over, or erasure leaves no trace that it happened and we cannot prove we honoured it. It names a guest id and nothing else — after erasure that id points at a row with no person behind it.',
    },
    erasure: {
      kind: 'keep',
      why: 'Erasing the erasure record would be the one deletion that makes every other one unprovable. Art. 17(3)(b): needed to comply with a legal obligation.',
    },
    exportVia: 'guest',
  },

  // -------------------------------------------------------------------------
  // Caches and configuration
  // -------------------------------------------------------------------------
  {
    table: 'room_types',
    subject: 'none',
    categories: [],
    basis: 'Property configuration.',
    retention: { kind: 'keep', why: 'Configuration. Referenced by reservations.' },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
  {
    table: 'rate_snapshots',
    subject: 'none',
    categories: [],
    basis: 'Display cache of the property’s own prices.',
    retention: {
      kind: 'delete-rows',
      afterDays: DAYS.ninety,
      anchor: 'fetched_at',
      why: 'A cache. Ninety days is generous for one — it is kept at all only so a reservation’s `rate_snapshot_ids` can still explain the price it was booked at.',
    },
    erasure: { kind: 'none' },
    exportVia: 'none',
  },
]

/** The map, by table, for the callers that look one up. */
export const DATA_MAP_BY_TABLE: ReadonlyMap<string, DataMapEntry> = new Map(
  DATA_MAP.map((entry) => [entry.table, entry]),
)

export function entryFor(table: string): DataMapEntry | undefined {
  return DATA_MAP_BY_TABLE.get(table)
}

/** Every rule the retention sweep can actually execute, in a stable order. */
export function executableRules(): DataMapEntry[] {
  return DATA_MAP.filter(
    (entry) => entry.retention.kind === 'purge-columns' || entry.retention.kind === 'delete-rows',
  )
}
