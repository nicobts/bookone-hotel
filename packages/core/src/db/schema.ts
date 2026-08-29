import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { authUsers } from 'drizzle-orm/supabase'

/**
 * Schema v1 — the canonical core (03-ARCHITECTURE §2).
 *
 * Three rules bind every table here and are worth stating once:
 *
 *   1. Platform UUIDs are the only keys. An external system's identifier is
 *      never a primary or foreign key; it attaches through `external_refs`
 *      (ADR-001). This is the one the CI gate checks.
 *   2. Every domain table carries `property_id`, denormalized even where a join
 *      could derive it, because the RLS policy is written against that column
 *      and a policy that has to join is a policy that gets written wrong.
 *   3. Money is integer cents with an explicit currency. Never a float.
 *
 * Nothing fiscal appears here under any name — no SDI, corrispettivi, night
 * audit or invoice issuance (ADR-002 / D11). That gate is enforced by absence.
 */

// ---------------------------------------------------------------------------
// Enumerated vocabularies
// ---------------------------------------------------------------------------
// Postgres enums, not free text: these sets are small, closed, and named in the
// docs. Adding a value later is `alter type ... add value`, which is forward-only
// and cheap; that is the direction these actually move in.

/** Owner administers the property; staff operates it (PRD D3, E5.5). */
export const memberRole = pgEnum('member_role', ['owner', 'staff'])

/**
 * Where a reservation was born. `platform` means we are authoritative for it and
 * it reflects outward; `sync` means it arrived from the PMS (ADR-001, D12).
 */
export const reservationOrigin = pgEnum('reservation_origin', ['platform', 'sync'])

/**
 * `hold` is the 30-minute booking hold before payment confirms (03 §7.1).
 * Arrival and departure are journey state, not reservation state — they live in
 * `journey_states` (ADR-013), which lands in Sprint 2.
 */
export const reservationStatus = pgEnum('reservation_status', [
  'hold',
  'confirmed',
  'cancelled',
  'no_show',
])

/** Which half of the dual-source engine wrote the row (binding rule 2). */
export const eventOrigin = pgEnum('event_origin', ['platform', 'sync', 'reconciliation'])

/** Autonomy tier actually applied to a run, which may be lower than declared (ADR-011). */
export const agentTier = pgEnum('agent_tier', ['T1', 'T2', 'T3'])

/** What a human did with the run. This column is the evidence a tier may widen (06 §4). */
export const agentOutcome = pgEnum('agent_outcome', ['accepted', 'edited', 'rejected', 'auto'])

// ---------------------------------------------------------------------------
// Journey (ADR-013)
// ---------------------------------------------------------------------------
// Five dimensions, each with its own small state, rather than one linear status
// column. 03 §5 writes the happy path as a single chain — that chain is a
// *path through* these five, not a sixth thing.
//
// Modelled this way because the dimensions genuinely move independently: a
// guest can state an arrival time before uploading a document, documents are
// deleted long after arrival, and Alloggiati can fail and be retried while the
// stay is already active. A single column would have to enumerate the product
// of all five, and the first unexpected ordering would need a new value.

/** Has the guest been asked, and have they answered (E2.1). */
export const precheckinState = pgEnum('precheckin_state', ['pending', 'invited', 'submitted'])

/**
 * Identity documents (E2.1, E2.4).
 *
 * `deleted` is terminal and it is a *feature*: the property holds no
 * unnecessary personal data once the submission is acknowledged, and the state
 * says so rather than an absent row implying it.
 */
export const documentsState = pgEnum('documents_state', [
  'pending',
  'captured',
  'validated',
  'deleted',
])

/** Sprint 6 owns these transitions; the column exists now so the machine is whole. */
export const alloggiatiState = pgEnum('alloggiati_state', [
  'pending',
  'staged',
  'submitted',
  'acknowledged',
  'failed',
])

/** `expected` means the guest told us when (E2.2); `confirmed` means they are here. */
export const arrivalState = pgEnum('arrival_state', ['pending', 'expected', 'confirmed'])

export const departureState = pgEnum('departure_state', ['pending', 'settled', 'closed'])

/**
 * How one submission ended.
 *
 * `acknowledged` is the only state that permits destroying the documents
 * (E2.4). Anything else and the property still needs them.
 */
export const submissionStatus = pgEnum('submission_status', [
  'staged',
  'submitted',
  'acknowledged',
  'failed',
])

/**
 * What a payment row is for.
 *
 * `deposit` and `balance` are money in; `refund` is money out and carries a
 * negative amount, so summing the column for a reservation gives what the
 * property actually holds without anyone remembering which signs to flip.
 */
export const paymentKind = pgEnum('payment_kind', ['deposit', 'balance', 'refund'])

/**
 * Mirrors the port's `PaymentIntentStatus` (ADR-010), plus nothing.
 *
 * A status the adapter cannot produce is a status no code path can reach, and
 * an enum with aspirational values is a `switch` nobody can prove exhaustive.
 */
export const paymentStatus = pgEnum('payment_status', [
  'requires_payment',
  'requires_action',
  'succeeded',
  'failed',
  'cancelled',
])

/**
 * Which half of D14's hybrid model a fee belongs to.
 *
 * `ai_attributed` rows are only ever written where the attribution rule's
 * evidence chain is complete (PRD §6) — the report built on this table is the
 * invoice, and a fee nobody can evidence is a fee that gets disputed.
 */
export const feeKind = pgEnum('fee_kind', ['direct_booking', 'ai_attributed'])

/**
 * How a guest is reached. Email is first and unconditional (04 §1 Sprint 3);
 * SMS and WhatsApp are additive and gated on BSP verification, which is exactly
 * why the channel is a column rather than four parallel tables.
 */
export const notificationChannel = pgEnum('notification_channel', ['email', 'sms', 'whatsapp'])

/**
 * `queued` is written in the same transaction as the thing being announced;
 * the send happens afterwards and moves the row. See `notifications`.
 */
export const notificationStatus = pgEnum('notification_status', [
  'queued',
  'sent',
  'failed',
  'suppressed',
])

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /**
     * The URL segment (ADR-016). Globally unique, effectively immutable, and
     * deliberately without an edit UI — changing one breaks every saved link.
     */
    slug: text('slug').notNull().unique(),

    name: text('name').notNull(),

    /** Fallback for guests whose own locale is not one of the four. */
    localeDefault: text('locale_default').notNull().default('en'),

    /** Subset of it/de/en/sl this property actually offers. */
    languages: jsonb('languages')
      .notNull()
      .default(sql`'["en"]'::jsonb`),

    /**
     * IANA zone. The authority for every arrival and departure date: those are
     * hotel-local calendar dates, not instants, and reconciliation classifies
     * timezone discrepancies separately for exactly this reason.
     */
    timezone: text('timezone').notNull().default('Europe/Rome'),

    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Per-domain authority (ADR-001). The write-router reads this to decide
     * whether a domain writes here or reflects to the PMS. Empty means the
     * defaults in `packages/core/src/authority` apply.
     */
    authorityMap: jsonb('authority_map')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * ADR-016's reserved-word list. The framework resolves static segments
     * before dynamic ones, so a property slugged `book` would insert cleanly and
     * then be permanently unreachable — a silent failure, which is why it is a
     * constraint and not a code comment.
     *
     * EXTEND THIS whenever a route is added under `/[locale]/`.
     */
    check(
      'properties_slug_reserved',
      sql`${t.slug} not in (
        'book', 'stay', 'console', 'login', 'logout', 'signup', 'auth',
        'api', 'admin', 'settings', 'forgot-password', 'update-password',
        'no-property', 'imprint', 'privacy', 'terms',
        'it', 'de', 'en', 'sl'
      )`,
    ),
    /** Lowercase, digits and single hyphens: a slug is typed by humans. */
    check('properties_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
)

// ---------------------------------------------------------------------------
// Identity (ADR-017 — outside tenancy)
// ---------------------------------------------------------------------------

/**
 * One row per person. Carries no `property_id` by decision, not by oversight:
 * a name, a locale and a theme are facts about a human being, and duplicating
 * them per membership makes one fact into N that must agree (ADR-017).
 *
 * Isolated by identity instead of tenancy — a person reads and writes their own
 * row and no other. The cross-tenant suite asserts that separately, because it
 * does not follow from any property-scoped policy.
 */
export const profiles = pgTable('profiles', {
  /** Same id as the auth user. One row per person, enforced by the PK. */
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),

  fullName: text('full_name'),

  /** One of it/de/en/sl. Not constrained here — @bookone/i18n owns that list. */
  locale: text('locale').notNull().default('en'),

  theme: text('theme').notNull().default('system'),

  /**
   * Where this person lands when they arrive without naming a property.
   *
   * A *preference*, never a permission. Resolving it must re-check membership:
   * an owner removed from the property they had chosen would otherwise be
   * redirected into a 404 on every login, with nothing on screen saying why.
   *
   * `set null` on delete rather than cascade — losing a preference must never
   * take the person with it.
   */
  defaultPropertyId: uuid('default_property_id').references(() => properties.id, {
    onDelete: 'set null',
  }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Who may work on which property, and in what role.
 *
 * Not an ADR-017 exception: this describes a *relationship* to a property, so it
 * carries `property_id` and takes an ordinary policy. It is also the table every
 * other policy resolves membership through — which is why the helper functions
 * that read it are `security definer` (a policy on this table that queried this
 * table would recurse forever).
 */
export const propertyMembers = pgTable(
  'property_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('staff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One role per person per property — two rows would make "the" role ambiguous. */
    unique('property_members_property_user').on(t.propertyId, t.userId),
    index('property_members_user_idx').on(t.userId),
  ],
)

// ---------------------------------------------------------------------------
// External references (ADR-001, D10)
// ---------------------------------------------------------------------------

/**
 * The single place an external system's identifier is allowed to live.
 *
 * This table is what makes graduation a flip of a source rather than a
 * migration of a product: our rows keep their own UUIDs from the first commit,
 * and Ericsoft's ids hang off the side. Revoking the PMS API deletes rows here
 * and nothing else.
 */
export const externalRefs = pgTable(
  'external_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** `ericsoft`, `stripe`, … */
    system: text('system').notNull(),

    /** `reservation`, `guest`, `room_type`, … */
    entityType: text('entity_type').notNull(),

    /**
     * Our UUID for the thing. Deliberately not a foreign key: it points into
     * whichever table `entity_type` names, and a polymorphic FK cannot be
     * expressed. Integrity here is the sync engine's job, and the reconciliation
     * run is where a dangling ref surfaces.
     */
    entityId: uuid('entity_id').notNull(),

    /** Their identifier. A value, never a key (binding rule 1). */
    externalId: text('external_id').notNull(),

    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * The idempotency guarantee the reflection job depends on: within one
     * property, an external id maps to exactly one of our entities, so a
     * retried reflect cannot create a second row.
     *
     * **Scoped by property, deliberately.** The 03 §2 sketch omits
     * `property_id` here, and that is wrong for a multi-tenant install: every
     * property runs its own PMS instance, numbering bookings from its own
     * sequence, so two hotels both having booking `1001` is ordinary rather
     * than exceptional. A global constraint rejects the second hotel's booking
     * — a cross-tenant collision that surfaces as "the connector randomly
     * stops working" for whoever onboarded later. Found by the reflection test
     * doing exactly that with two properties.
     */
    unique('external_refs_property_system_entity').on(
      t.propertyId,
      t.system,
      t.entityType,
      t.externalId,
    ),
    index('external_refs_entity_idx').on(t.entityType, t.entityId),
    index('external_refs_property_idx').on(t.propertyId),
  ],
)

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    locale: text('locale'),

    /**
     * Explicitly false by default. A consent that defaults to true is not a
     * consent, and this column is one a supervisory authority would ask about.
     */
    marketingConsent: boolean('marketing_consent').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('guests_property_idx').on(t.propertyId)],
)

export const roomTypes = pgTable(
  'room_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** The property's own code for it. Theirs, but ours to key on — not external. */
    code: text('code').notNull(),

    /** `{ it: "Doppia", de: "Doppelzimmer", … }` with the guest → property → en chain. */
    nameI18n: jsonb('name_i18n')
      .notNull()
      .default(sql`'{}'::jsonb`),

    capacity: smallint('capacity').notNull().default(2),
  },
  (t) => [unique('room_types_property_code').on(t.propertyId, t.code)],
)

/**
 * Display cache. **Never authority** (03 §2).
 *
 * Every price shown to a guest carries the id of the snapshot it came from
 * (PRD A2), so a disputed rate can be traced to the fetch that produced it. A
 * row here is evidence of what a source said at a moment, not a statement of
 * what anything costs.
 */
export const rateSnapshots = pgTable(
  'rate_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    roomTypeId: uuid('room_type_id')
      .notNull()
      .references(() => roomTypes.id, { onDelete: 'cascade' }),

    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to').notNull(),

    priceCents: integer('price_cents').notNull(),

    /**
     * Not in the 03 §2 sketch, added deliberately: every stored amount carries
     * its currency even while the product is single-currency, because adding it
     * later means backfilling every row.
     */
    currency: text('currency').notNull().default('EUR'),

    /** Provenance is the point of this table: `ericsoft`, `mock`, `manual`. */
    source: text('source').notNull(),

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('rate_snapshots_lookup_idx').on(t.propertyId, t.roomTypeId, t.dateFrom),
    check('rate_snapshots_date_order', sql`${t.dateTo} >= ${t.dateFrom}`),
    check('rate_snapshots_price_non_negative', sql`${t.priceCents} >= 0`),
  ],
)

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * `restrict`, not `cascade`: a reservation outlives our interest in the
     * guest record, and deleting a person must not silently delete their stay.
     * GDPR erasure anonymises the guest row; it does not drop the booking.
     */
    guestId: uuid('guest_id').references(() => guests.id, { onDelete: 'restrict' }),

    roomTypeId: uuid('room_type_id').references(() => roomTypes.id, { onDelete: 'restrict' }),

    status: reservationStatus('status').notNull().default('hold'),

    /** Hotel-local calendar dates in the property's timezone, not instants. */
    arrivalDate: date('arrival_date').notNull(),
    departureDate: date('departure_date').notNull(),

    /** `{ adults: 2, children: 1 }` — shape belongs to the booking engine. */
    pax: jsonb('pax')
      .notNull()
      .default(sql`'{}'::jsonb`),

    totalCents: integer('total_cents'),
    currency: text('currency').notNull().default('EUR'),

    origin: reservationOrigin('origin').notNull().default('platform'),

    /**
     * The two session ids the attribution rule reads (PRD §6). A booking counts
     * as AI-attributed only when a concierge session is present and no engine
     * session preceded it within 24h — and that report is the invoice, so these
     * are captured at creation and never backfilled.
     */
    engineSessionId: text('engine_session_id'),
    conciergeSessionId: text('concierge_session_id'),

    /**
     * The booking reference a guest reads out on the phone (E1.2).
     *
     * Not a key and never used as one — the UUID is the key (binding rule 1).
     * This exists because "my booking is 3f2a…-9c" is not a sentence a human
     * says, and the confirmation email, the front desk and the guest all need
     * one short string they can agree on.
     *
     * Nullable: reservations arriving from the PMS (`origin='sync'`) already
     * have the hotel's own reference and inventing a second one would give the
     * same stay two names.
     */
    reference: text('reference'),

    /**
     * When a `hold` stops being one (E1.3: 30 minutes).
     *
     * A *price* hold, not an inventory hold — see docs/design-notes/booking-flow.md
     * §4A. It fixes the quoted total and the snapshots below; it reserves no
     * room, because in V1 we hold no inventory to reserve.
     */
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),

    /**
     * The `rate_snapshots` rows this total was computed from (PRD A2).
     *
     * Provenance, not a foreign key: snapshots are a cache and get replaced by
     * the next refresh, so a real reference would either block the refresh or
     * cascade the booking away. Kept as ids so a disputed price can be traced
     * to the fetch that produced it — and the fetch is in the event log even
     * once the row is gone.
     */
    rateSnapshotIds: jsonb('rate_snapshot_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reservations_property_arrival_idx').on(t.propertyId, t.arrivalDate),
    index('reservations_property_status_idx').on(t.propertyId, t.status),
    check('reservations_date_order', sql`${t.departureDate} > ${t.arrivalDate}`),
    /**
     * Scoped to the property, like every other identifier here. Two hotels
     * independently generating `BO-7QK2M9` is not a collision worth preventing
     * globally, and a global constraint would make one property's booking
     * volume able to fail another's checkout (the same lesson as
     * `external_refs_property_system_entity`).
     */
    unique('reservations_property_reference').on(t.propertyId, t.reference),
    /** A hold with no expiry never expires, which is the one thing it must do. */
    check(
      'reservations_hold_has_expiry',
      sql`${t.status} <> 'hold' or ${t.holdExpiresAt} is not null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Dual-source machinery
// ---------------------------------------------------------------------------

/**
 * Append-only. Every mutation anywhere in the platform lands here with an actor
 * and an origin (binding rule 2).
 *
 * This table is what makes the zero-touch metric (G1) computable, the agent
 * audit trail real, and reconciliation able to explain itself. It has no update
 * or delete policy — not as caution, but because an event log that can be
 * rewritten answers no question worth asking.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    /** bigserial: this is the highest-volume table in the product. */
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),

    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),

    /** Dotted, past tense: `reservation.confirmed`, `documents.uploaded`. */
    eventType: text('event_type').notNull(),

    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),

    origin: eventOrigin('origin').notNull(),

    /**
     * `user:{uuid}`, `agent:{name}`, `system`, `guest:{reservation_uuid}`.
     *
     * Text rather than a foreign key because the set of things that can act is
     * open — an agent is not a row in any users table, and a guest never holds
     * an account (ADR-007). The `agent:` prefix is what ADR-011 requires.
     */
    actor: text('actor').notNull(),

    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('domain_events_property_at_idx').on(t.propertyId, t.at),
    index('domain_events_entity_idx').on(t.entityType, t.entityId),
    index('domain_events_type_idx').on(t.eventType),
  ],
)

// ---------------------------------------------------------------------------
// Agent layer (ADR-011, 06 §3)
// ---------------------------------------------------------------------------

/**
 * One row per agent run. Input, tool calls, output, confidence, tier, outcome,
 * reviewer, cost, latency, model.
 *
 * Ships in Sprint 1 alongside the first tables rather than with the runner in
 * Sprint 2, because retrofitting an audit trail onto agents that already act is
 * how audit trails end up with gaps. The table exists before anything can write
 * to it — which is the order that makes "every run is recorded" true.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Registry key: `AG-01`, `AG-05`. */
    agent: text('agent').notNull(),

    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * The `domain_events` row that triggered the run, when one did. Nullable:
     * scheduled agents (AG-07 runs nightly) have no triggering event.
     */
    triggerEventId: bigint('trigger_event_id', { mode: 'bigint' }).references(
      () => domainEvents.id,
      { onDelete: 'set null' },
    ),

    inputRef: text('input_ref'),
    toolCalls: jsonb('tool_calls')
      .notNull()
      .default(sql`'[]'::jsonb`),
    output: jsonb('output'),

    /**
     * 0.000–1.000, null where the agent does not produce one. Exact numeric
     * rather than a float: this value is compared against the per-agent tier
     * threshold that decides whether a run acts or only proposes, and a
     * comparison that is occasionally off by a float epsilon is a run that
     * occasionally picks the wrong tier.
     */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),

    tierApplied: agentTier('tier_applied').notNull(),
    outcome: agentOutcome('outcome'),

    reviewedBy: uuid('reviewed_by').references(() => authUsers.id, { onDelete: 'set null' }),

    /** Agent COGS is a first-class metric (06 §6: ≤ €0.40 per stay). */
    costCents: integer('cost_cents'),
    latencyMs: integer('latency_ms'),
    model: text('model'),

    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_runs_property_at_idx').on(t.propertyId, t.at),
    index('agent_runs_agent_idx').on(t.agent),
  ],
)

// ---------------------------------------------------------------------------
// Reconciliation (03-ARCHITECTURE §4)
// ---------------------------------------------------------------------------

/** Classes of divergence. The split is the whole value of the nightly run. */
export const discrepancyClass = pgEnum('discrepancy_class', [
  /** Cents apart. Almost always ours or theirs rounding a rate differently. */
  'rounding',
  /**
   * A date or time that disagrees because someone resolved it in the wrong
   * zone. Expected, and separable from real divergence precisely because it has
   * its own class — an arrival is a hotel-local calendar date, not an instant.
   */
  'tz',
  /** Neither of the above. Something actually disagrees, and a human decides. */
  'logic',
])

export const discrepancyStatus = pgEnum('discrepancy_status', [
  'open',
  /** A human, or AG-05 at T2, decided this one is benign and said why. */
  'explained',
  /** Cannot be explained away. Pages someone (03 §8 alert classes). */
  'blocking',
])

/**
 * One nightly pass over one domain at one property.
 *
 * `parity_ratio` is the number the owner actually watches: the share of
 * compared entities that matched. It is the evidence D11's condition C2 asks
 * for — six months of shadow parity ≥99.9% — so these rows are kept, not
 * rotated. A run with a ratio nobody recorded proves nothing later.
 */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** An AuthorityMap domain name — `booking`, `availability`, … */
    domain: text('domain').notNull(),

    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * 0.0000–1.0000. Exact numeric, not a float: this is compared against a
     * 0.999 threshold that gates a decision worth six figures, and a
     * float comparison that is occasionally off by an epsilon is a threshold
     * that occasionally lies.
     */
    parityRatio: numeric('parity_ratio', { precision: 5, scale: 4 }),

    /** Denormalised from `discrepancies` so the trend chart is one query. */
    discrepanciesCount: integer('discrepancies_count').notNull().default(0),

    /** How many entities were compared. A ratio without it is unreadable. */
    comparedCount: integer('compared_count').notNull().default(0),
  },
  (t) => [
    index('reconciliation_runs_property_idx').on(t.propertyId, t.ranAt),
    check(
      'reconciliation_runs_parity_range',
      sql`${t.parityRatio} is null or (${t.parityRatio} >= 0 and ${t.parityRatio} <= 1)`,
    ),
  ],
)

/**
 * One entity that disagreed.
 *
 * Carries `property_id` even though `run_id` could derive it (binding rule 3).
 * The policy is written against the column, and a policy that has to join is a
 * policy that gets written wrong.
 */
export const discrepancies = pgTable(
  'discrepancies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => reconciliationRuns.id, { onDelete: 'cascade' }),

    /** `reservation:{uuid}`, `availability:{roomType}:{date}` — what disagreed. */
    entityRef: text('entity_ref').notNull(),

    class: discrepancyClass('class').notNull(),

    /** The two sides, as we and they saw them. Both, always: an explanation */
    /** written months later needs the values, not a description of them. */
    ours: jsonb('ours'),
    theirs: jsonb('theirs'),

    status: discrepancyStatus('status').notNull().default('open'),

    /** Why it was explained away. Required in practice by the console. */
    explanation: text('explanation'),

    /** Null until someone resolves it. `agent:AG-05` is a valid value here. */
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('discrepancies_property_status_idx').on(t.propertyId, t.status),
    index('discrepancies_run_idx').on(t.runId),
    /**
     * One open row per entity per run. Without this a retried nightly run
     * doubles every discrepancy, and the count the owner sees — and judges the
     * connector by — silently inflates.
     */
    unique('discrepancies_run_entity').on(t.runId, t.entityRef),
  ],
)

// ---------------------------------------------------------------------------
// Guest communication
// ---------------------------------------------------------------------------

/**
 * The outbound message outbox (E1.2, 04 §1 Sprint 3).
 *
 * An outbox rather than a direct send, because the alternative is a dual write:
 * confirm the booking, then call an email provider. A crash between the two
 * leaves a confirmed guest who was never told, and a provider timeout after a
 * successful send leaves a retry that tells them twice. Writing the row in the
 * same transaction as the confirmation makes "the guest will be told" a
 * property of the commit, and the worker turns it into an actual message.
 *
 * The row is also the evidence. E1.2 requires a confirmation within 60 seconds;
 * `created_at` to `sent_at` is that measurement, per message, without anyone
 * having to instrument anything.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** What it is about. Null for messages that are not about one stay. */
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'cascade',
    }),

    channel: notificationChannel('channel').notNull(),

    /** Template name, resolved in `packages/core/src/notifications`. */
    template: text('template').notNull(),

    /** The locale actually rendered, after the guest -> property -> en chain. */
    locale: text('locale').notNull(),

    /**
     * Where it went. Personal data, deliberately kept: a guest asking why they
     * never got their confirmation is answered by this column and nothing else.
     * In scope for the E8 retention job — it ages out with the stay, not with
     * the row.
     */
    recipient: text('recipient').notNull(),

    /**
     * The facts the template rendered from, captured at queue time.
     *
     * Stored rather than re-derived on send: the message must say what was true
     * when the booking was confirmed, not what is true when the queue drains.
     * This is also what makes a message reproducible during a dispute.
     */
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),

    status: notificationStatus('status').notNull().default('queued'),

    attempts: smallint('attempts').notNull().default(0),

    /** Provider identity and their id for it, for tracing a delivery complaint. */
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),

    /** Last failure, human-readable. Kept even after a later attempt succeeds. */
    lastError: text('last_error'),

    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_property_status_idx').on(t.propertyId, t.status),
    index('notifications_reservation_idx').on(t.reservationId),
    /**
     * One message per template per reservation per channel.
     *
     * The confirmation path is retryable from several places (a retried job, an
     * owner re-sending, a webhook replay in Sprint 4). Without this, each of
     * them mails the guest again — and a guest who receives four identical
     * confirmations concludes the hotel is broken, which is a worse outcome
     * than the one the retry was fixing.
     */
    unique('notifications_reservation_template_channel').on(t.reservationId, t.template, t.channel),
  ],
)

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Every movement of money, in or out (03 §7.4).
 *
 * A ledger, not a status column: a reservation can have a deposit, a balance
 * and two partial refunds, and collapsing that into one `paid` field on the
 * reservation loses the history exactly when someone disputes it.
 *
 * The provider's own identifier for the transaction is **not** here. It goes in
 * `external_refs` with `entity_type = 'payment'`, like every other foreign id
 * (ADR-001, binding rule 1) — which also means a provider swap does not leave a
 * column named after the provider we left.
 *
 * Nothing fiscal (ADR-002 / D11). This records that money moved; it issues no
 * document, computes no tax and produces no receipt.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * `restrict`, not `cascade`. A payment outlives our interest in the
     * booking: deleting a reservation must never silently delete the record
     * that someone was charged.
     */
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),

    kind: paymentKind('kind').notNull(),
    status: paymentStatus('status').notNull().default('requires_payment'),

    /** Negative for a refund, so the column sums to what the property holds. */
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),

    /** `mock`, `stripe`, `nexi`. Kept per row: a property can change provider. */
    provider: text('provider').notNull(),

    /**
     * True when no real money moved.
     *
     * Denormalised onto the row on purpose. Once a real provider is connected
     * these two kinds of row sit side by side forever, and any report that
     * sums them together is wrong. Deriving it from `provider` later means
     * every such query has to know which provider names were simulated.
     */
    simulated: boolean('simulated').notNull().default(false),

    failureReason: text('failure_reason'),

    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_property_status_idx').on(t.propertyId, t.status),
    index('payments_reservation_idx').on(t.reservationId),
    /**
     * One live charge per reservation per kind — and **only** for charges.
     *
     * The webhook is the state authority and webhooks are redelivered; without
     * this, a replayed `payment_intent.succeeded` writes a second deposit and
     * the property appears to hold twice what it does.
     *
     * A partial index rather than a table constraint, because refunds have to
     * be excluded: a stay can legitimately have several, and a plain unique on
     * (reservation, kind, provider) would silently reject the second one. That
     * was written as a constraint first, with a comment claiming refunds were
     * excluded when nothing excluded them — caught by a test that refunded
     * twice on purpose.
     */
    uniqueIndex('payments_reservation_charge')
      .on(t.reservationId, t.kind, t.provider)
      .where(sql`${t.kind} <> 'refund'`),
    check('payments_refund_is_negative', sql`${t.kind} <> 'refund' or ${t.amountCents} <= 0`),
    check('payments_charge_is_positive', sql`${t.kind} = 'refund' or ${t.amountCents} >= 0`),
  ],
)

/**
 * The fee this platform earned on a booking (D14).
 *
 * Written once, at confirmation, from the values true at that moment. Not
 * recomputed later and not derived on demand: the monthly report built on these
 * rows **is the invoice** (PRD C4), and an invoice that changes when a rate card
 * changes is an invoice that gets disputed and lost.
 *
 * This is a record of what we will bill the property. It is not an invoice, it
 * issues nothing, and it stays firmly outside the fiscal gate (D11).
 */
export const feeEvents = pgTable(
  'fee_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),

    kind: feeKind('kind').notNull(),

    /** What the percentage was applied to — the stay total at confirmation. */
    basisCents: integer('basis_cents').notNull(),

    /**
     * Basis points, integer. 2.5% is 250.
     *
     * Not a decimal percentage: a float rate times a cents basis reintroduces
     * exactly the rounding this schema keeps out of money everywhere else.
     */
    rateBps: integer('rate_bps').notNull(),

    feeCents: integer('fee_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),

    /**
     * The evidence chain, for `ai_attributed` rows (PRD §6).
     *
     * Stored with the fee rather than reconstructed, because the reconstruction
     * would run against a database that has moved on — and disputes resolve in
     * the owner's favour, so an unevidenced fee is a fee we drop.
     */
    evidence: jsonb('evidence')
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('fee_events_property_created_idx').on(t.propertyId, t.createdAt),
    /**
     * One fee per booking per kind. A retried confirmation must not bill the
     * property twice for the same stay — and this is the table the invoice is
     * built from, so a duplicate here is a real overcharge.
     */
    unique('fee_events_reservation_kind').on(t.reservationId, t.kind),
    check('fee_events_rate_sane', sql`${t.rateBps} >= 0 and ${t.rateBps} <= 10000`),
  ],
)

// ---------------------------------------------------------------------------
// The guest journey
// ---------------------------------------------------------------------------

/**
 * The single source of stay truth (ADR-013, 03 §5).
 *
 * One row per reservation, keyed by it — a stay has exactly one journey, and a
 * surrogate key here would only make room for two.
 *
 * **Nothing writes this table directly** (binding rule 4). Every change goes
 * through `applyJourneyCommand` in `packages/core/src/journey`, which validates
 * the transition and emits the event in the same transaction. That discipline
 * is the whole point of the ADR: the console, the agents, the voice concierge
 * and later the door sensors are all trigger *sources* into one machine, and a
 * module that writes a state column directly is a module whose transitions
 * nobody can audit, replay or count.
 */
export const journeyStates = pgTable(
  'journey_states',
  {
    reservationId: uuid('reservation_id')
      .primaryKey()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    /**
     * Denormalized like everywhere else (binding rule 3): the RLS policy is
     * written against this column, and a policy that has to join is a policy
     * that gets written wrong.
     */
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    precheckin: precheckinState('precheckin_state').notNull().default('pending'),
    documents: documentsState('documents_state').notNull().default('pending'),
    alloggiati: alloggiatiState('alloggiati_state').notNull().default('pending'),
    arrival: arrivalState('arrival_state').notNull().default('pending'),
    departure: departureState('departure_state').notNull().default('pending'),

    /**
     * When the guest says they will arrive (E2.2).
     *
     * A local clock time as text, not an instant. A guest saying "around six"
     * is saying it in the hotel day; storing it as UTC would move it the moment
     * anything about the property timezone changed, and "18:00" is the thing
     * the arrival-prep hook actually wants.
     */
    expectedArrivalTime: text('expected_arrival_time'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('journey_states_property_idx').on(t.propertyId),
    /** The console Today query: who is arriving, and how far along they are. */
    index('journey_states_property_arrival_idx').on(t.propertyId, t.arrival),
    check(
      'journey_states_arrival_time_format',
      sql`${t.expectedArrivalTime} is null or ${t.expectedArrivalTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
  ],
)

/**
 * One person in the party, and their identity document (E2.1, E2.4).
 *
 * Named for what it is: the record a property is legally required to register.
 * The lead guest is `guest_index = 0` and is the same person as
 * `reservations.guest_id`; the rest are travelling companions who hold no
 * account and may never give us an email.
 *
 * ## The deletion story is the design
 *
 * `document_path` points at a private object in EU Storage; `data` holds the
 * registration fields. E2.4 requires the document to be hard-deleted once the
 * submission is acknowledged, keeping only the receipt — so the *file* and the
 * *fields* are deliberately separable, and `deleted_at` records that it
 * happened rather than leaving an absence to be interpreted later.
 *
 * Nothing here is fiscal and nothing here is a document we issue (D11).
 */
export const registrationRecords = pgTable(
  'registration_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    /** 0 is the lead guest. Stable, so a resumed form updates rather than adds. */
    guestIndex: smallint('guest_index').notNull(),

    /**
     * Registration fields — name, birth date, nationality, document number.
     *
     * Jsonb rather than columns because the required set is defined by the
     * *destination* (Alloggiati today, an Austrian or Slovenian equivalent
     * later) and the two do not agree. Validated against a schema at the point
     * of staging, which is where the requirement actually lives.
     */
    data: jsonb('data')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Object path in the private EU bucket. Null once deleted, or if never captured. */
    documentPath: text('document_path'),

    validatedAt: timestamp('validated_at', { withTimezone: true }),

    /** Set when the file is destroyed. The row survives; the document does not. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('registration_records_property_idx').on(t.propertyId),
    /**
     * One record per person per stay. A resumable form that posts twice must
     * update the same person rather than register them again — and a party of
     * two that becomes a party of four in the registry is a compliance problem,
     * not a cosmetic one.
     */
    unique('registration_records_reservation_index').on(t.reservationId, t.guestIndex),
    check('registration_records_index_non_negative', sql`${t.guestIndex} >= 0`),
    /** A deleted document keeps no path. Enforced, not merely intended (E2.4). */
    check(
      'registration_records_deleted_has_no_path',
      sql`${t.deletedAt} is null or ${t.documentPath} is null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Alloggiati (E2.3, E2.4)
// ---------------------------------------------------------------------------

/**
 * One submission of a stay to the accommodated-persons registry (E2.3).
 *
 * Italian law requires an accommodation provider to report every guest to the
 * Questura within 24 hours of arrival. **The obligation is the property's, not
 * ours** — we build the payload and carry it, they remain the declarant. The
 * contract mirror in docs/contracts says so in the words counsel approves.
 *
 * ## Why the payload is stored, and why that is not duplication
 *
 * `payload` is the exact text that was transmitted, and `payload_checksum` its
 * digest. Keeping it looks redundant next to `registration_records` until the
 * first time somebody asks what was actually filed for a guest whose details
 * were later corrected — at which point the records say one thing and the
 * authority holds another, and only this column can answer.
 *
 * It is also what makes E2.4 possible: once the receipt is in, the identity
 * *documents* are destroyed, and this row is the entire remaining evidence that
 * the property met its obligation.
 *
 * Not fiscal, under any reading (D11). This is public-security registration —
 * it issues no document, computes no tax, and touches no revenue.
 */
export const alloggiatiSubmissions = pgTable(
  'alloggiati_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * `restrict`, not `cascade`. This row is the evidence a legal obligation
     * was met; deleting the reservation must never take it with them.
     */
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'restrict' }),

    status: submissionStatus('status').notNull().default('staged'),

    /** How many people this submission covers. One line each. */
    guestCount: smallint('guest_count').notNull(),

    /** The exact text transmitted. See the note above. */
    payload: text('payload').notNull(),

    /** SHA-256 of the payload. PRD B2 asks for a checksum per the spec. */
    payloadChecksum: text('payload_checksum').notNull(),

    /**
     * What the authority sent back.
     *
     * Retained after the documents are destroyed (E2.4) — it is the receipt,
     * and a property that cannot produce one has no defence that it filed.
     */
    receipt: jsonb('receipt'),

    /** Why it failed, in words a person can act on. */
    lastError: text('last_error'),

    attempts: smallint('attempts').notNull().default(0),

    /** Which channel carried it: `mock`, `alloggiati-web`, an intermediary. */
    channel: text('channel').notNull(),

    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('alloggiati_submissions_property_status_idx').on(t.propertyId, t.status),
    index('alloggiati_submissions_reservation_idx').on(t.reservationId),
    /**
     * One live submission per stay per channel.
     *
     * A retried job must not file the same guests twice: a duplicate schedina
     * is a compliance problem for the property, and the authority has no
     * interest in our retry policy. Re-filing after a genuine correction is a
     * different act and gets its own decision, not an accidental second row.
     */
    unique('alloggiati_submissions_reservation_channel').on(t.reservationId, t.channel),
    check('alloggiati_submissions_guest_count', sql`${t.guestCount} > 0`),
    /** An acknowledgement without a receipt is not an acknowledgement. */
    check(
      'alloggiati_submissions_ack_has_receipt',
      sql`${t.status} <> 'acknowledged' or ${t.receipt} is not null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Knowledge base, messaging and departure (E3.2, E3.3, E3.4, E4.1)
// ---------------------------------------------------------------------------

/** Where a thread stands. The console queue is ordered by this and by waiting time. */
export const threadStatus = pgEnum('thread_status', [
  /** Open, and the last word was ours. Nothing is owed. */
  'open',
  /** The guest wrote and nobody has answered yet. */
  'awaiting_reply',
  /** Handed to a person. Unassigned until somebody takes it. */
  'escalated',
  /** Answered and quiet. Reopens the moment the guest writes again. */
  'answered',
  /** The stay is over and the thread is done. */
  'closed',
])

/**
 * Who wrote a message.
 *
 * `agent` is separate from `staff` on purpose, and it is not cosmetic: the
 * tool-boundary audit (E3.2) reads exactly the `agent` rows, the transparency
 * disclosure exists because some rows are `agent`, and an owner reviewing a
 * thread needs to know which sentences their property is answerable for as
 * *authored* rather than merely *sent*.
 */
export const messageAuthor = pgEnum('message_author', ['guest', 'agent', 'staff', 'system'])

/** A task's life. Small on purpose — see `stayTasks`. */
export const taskStatus = pgEnum('task_status', ['open', 'done', 'cancelled'])

/** Which side of the folio line an extra came from. See `stayExtras`. */
export const extraSource = pgEnum('extra_source', ['platform', 'pms'])

/**
 * A property's answers to the questions guests actually ask (E3.2, E5.3).
 *
 * The concierge answers from here or it escalates. There is no third option in
 * which it composes an answer from general knowledge about hotels — binding
 * rule 7, and the reason `search_kb` returns a stored string rather than
 * context for a model to paraphrase.
 *
 * ## Why answers are jsonb per locale rather than one row per language
 *
 * Because a missing locale must be *visibly* missing. A row per language makes
 * absence look like any other empty result set, and the tempting fix is to fall
 * back to the property default and translate it. Translating a property's
 * breakfast hours into a language nobody at the property has read is a
 * generated guest-facing fact, which is what rule 7 forbids. Here the key is
 * simply absent, the lookup returns null, and the concierge escalates.
 *
 * Authoring UI is Sprint 9 (E5.3). Until then these rows are seeded and the
 * runbook says so — which is why the concierge escalates more than it answers
 * in Sprint 7, and why that is the correct failure direction.
 */
export const kbArticles = pgTable(
  'kb_articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** `wifi`, `breakfast`, `parking`, `checkin`. Free text; the set is a property's own. */
    topic: text('topic').notNull(),

    /**
     * Ways a guest might ask this, in any of the property's languages.
     *
     * Plain text, one phrasing per element. Matching is lexical: a stored
     * phrasing is evidence a human expected this question, which is a stronger
     * signal than an embedding's opinion and — more to the point — is
     * inspectable by the owner whose property is answering.
     */
    questionVariants: jsonb('question_variants')
      .notNull()
      .default(sql`'[]'::jsonb`),

    /** `{ it: "...", de: "..." }`. A missing locale is a missing answer, deliberately. */
    answers: jsonb('answers')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Bumped on every edit. The audit needs to name the version that produced a
     * reply, because "the KB said so" is only a defence if the KB can be shown
     * as it stood.
     */
    version: integer('version').notNull().default(1),

    /** Draft articles are invisible to the concierge. AG-03 writes drafts (Sprint 9). */
    published: boolean('published').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /*
     * No separate (property_id, topic) index: the unique constraint below
     * already builds exactly that one, and a duplicate costs a write on every
     * insert while answering no query the first cannot.
     */
    unique('kb_articles_property_topic').on(t.propertyId, t.topic),
    check('kb_articles_version_positive', sql`${t.version} >= 1`),
  ],
)

/**
 * One conversation per stay (E3.2).
 *
 * Keyed by reservation rather than by guest or by channel. A guest with two
 * stays has two threads, which is what both they and the property mean: the
 * question "is my room ready" belongs to one of them.
 *
 * ## Why the channel is a column and not a table
 *
 * The thread is stored channel-agnostically because WhatsApp is blocked on BSP
 * verification (04 §0) and will arrive as a transport, not as a second model.
 * `channel` records where the guest last reached us so a reply goes back the
 * same way; it is not part of the thread's identity.
 */
export const messageThreads = pgTable(
  'message_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    status: threadStatus('status').notNull().default('open'),

    /** Where the guest last reached us. Web until a BSP is verified. */
    channel: notificationChannel('channel').notNull().default('email'),

    /** The guest's language for this thread, so a reply is not sent in the property's. */
    locale: text('locale').notNull(),

    /**
     * Who has it.
     *
     * Null while escalated-and-unowned, which the console shows loudly: unowned
     * work is how a support surface fails, and a ten-room property has nobody
     * whose job is to notice.
     */
    assignedTo: uuid('assigned_to').references(() => authUsers.id, { onDelete: 'set null' }),

    /** Why the concierge handed over, in words a person can act on. */
    escalationReason: text('escalation_reason'),

    /**
     * When the guest last wrote and when we last answered.
     *
     * Denormalized from `messages` because the SLA sweep and the console queue
     * both order by "how long has this been waiting", and computing that from a
     * join over every message in every thread is the query that gets slow first.
     */
    lastGuestMessageAt: timestamp('last_guest_message_at', { withTimezone: true }),
    lastReplyAt: timestamp('last_reply_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),

    /** Set once the SLA alert has fired, so it fires once and not every sweep. */
    slaAlertedAt: timestamp('sla_alerted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('message_threads_property_status_idx').on(t.propertyId, t.status),
    /** One thread per stay. A second would split the history the guest can see. */
    unique('message_threads_reservation').on(t.reservationId),
    /** An escalation without a time is one the SLA sweep cannot see. */
    check(
      'message_threads_escalated_has_time',
      sql`${t.status} <> 'escalated' or ${t.escalatedAt} is not null`,
    ),
  ],
)

/**
 * One message (E3.2).
 *
 * Append-only in practice: nothing edits a message, because a thread a guest
 * has read is a record of what they were told. A correction is a new message.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThreads.id, { onDelete: 'cascade' }),

    author: messageAuthor('author').notNull(),

    /** Which person, when a person wrote it. Null for guest, agent and system. */
    authorUserId: uuid('author_user_id').references(() => authUsers.id, { onDelete: 'set null' }),

    body: text('body').notNull(),

    /**
     * The `agent_runs` row that produced this, when an agent did.
     *
     * This is what makes the tool-boundary audit possible at all: the audit
     * compares a reply against the tool outputs of *its own run*, and without
     * this column it would be comparing against whatever ran nearby in time.
     */
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_thread_idx').on(t.threadId, t.createdAt),
    index('messages_property_idx').on(t.propertyId),
    /** An agent message carries its run; anything else carrying one is a mislabel. */
    check(
      'messages_agent_run_only_for_agent',
      sql`${t.agentRunId} is null or ${t.author} = 'agent'`,
    ),
    /** Only a person has a user id. An agent that claimed one would launder its authorship. */
    check(
      'messages_author_user_only_for_staff',
      sql`${t.authorUserId} is null or ${t.author} = 'staff'`,
    ),
    check('messages_body_not_empty', sql`length(btrim(${t.body})) > 0`),
  ],
)

/**
 * Something a guest asked for that a person has to do (E3.4).
 *
 * P1 in the stories, built now because `create_task` is in AG-01's tool grant
 * (06 §2) and the alternative is an agent that says "I will let them know" into
 * a void. The row is the difference between a promise and a record.
 *
 * Deliberately thin: no priority, no due date, no assignee, no categories. A
 * ten-room property does not triage; it does the thing or it does not. Fields
 * nobody fills in make a list look maintained when it is not.
 */
export const stayTasks = pgTable(
  'stay_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),
    /** The conversation it came from, when it came from one. */
    threadId: uuid('thread_id').references(() => messageThreads.id, { onDelete: 'set null' }),

    /** What was asked, in the guest's own words where possible. */
    summary: text('summary').notNull(),

    status: taskStatus('status').notNull().default('open'),

    /** `guest`, `staff:{uuid}`, `agent:AG-01` — the actor vocabulary of `domain_events`. */
    createdBy: text('created_by').notNull(),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stay_tasks_property_status_idx').on(t.propertyId, t.status),
    index('stay_tasks_reservation_idx').on(t.reservationId),
    check('stay_tasks_summary_not_empty', sql`length(btrim(${t.summary})) > 0`),
    /** Done means done at a time. A completed task with no timestamp cannot be reported on. */
    check('stay_tasks_done_has_time', sql`${t.status} <> 'done' or ${t.completedAt} is not null`),
  ],
)

/**
 * Something charged to a stay that **we** registered (E4.1).
 *
 * Note what this is not: it is not the folio. A PMS owns the minibar, the
 * restaurant and the spa, and in V1 that is Ericsoft behind an adapter — which
 * means our view of what a guest owes is partial by construction. The checkout
 * surface says so in words rather than presenting a total that is confidently
 * short (docs/design-notes/express-checkout.md §4A).
 *
 * `source` records which side of that line a row came from. A `pms` row is
 * read-through for display and is never settled by us.
 */
export const stayExtras = pgTable(
  'stay_extras',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    description: text('description').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),

    source: extraSource('source').notNull().default('platform'),

    /** The settlement that cleared it, when one did. Null while outstanding. */
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stay_extras_reservation_idx').on(t.reservationId),
    index('stay_extras_property_idx').on(t.propertyId),
    check('stay_extras_amount_non_negative', sql`${t.amountCents} >= 0`),
    check('stay_extras_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    /**
     * We settle what we registered. A PMS-sourced line carrying one of our
     * payments would mean we had collected money for a charge the property
     * raised, which is the property's transaction and not ours to clear.
     */
    check(
      'stay_extras_only_platform_is_settled',
      sql`${t.paymentId} is null or ${t.source} = 'platform'`,
    ),
  ],
)

/**
 * A guest asking the property for an invoice (E4.1).
 *
 * **This table issues nothing.** It assigns no number, generates no document,
 * computes no tax and transmits nothing to any authority. It records that a
 * guest asked, and who they asked it to be made out to, so the request can be
 * routed to the property and to their PMS — where the *fattura* is issued by
 * the property's own certified chain, as D11 and binding rule 6 require.
 *
 * The distinction is the whole reason this is a separate table with this
 * comment on it rather than a jsonb blob on a task: someone reading the schema
 * to check the fiscal gate should be able to see that we hold a request and
 * issue no document.
 */
export const invoiceRequests = pgTable(
  'invoice_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id')
      .notNull()
      .references(() => reservations.id, { onDelete: 'cascade' }),

    /** Who the guest wants it made out to. A person, or a company. */
    billTo: text('bill_to').notNull(),

    /**
     * Whatever else the guest supplied — address, tax identifiers, a reference.
     *
     * Jsonb because the required set differs by country and by whether the
     * payer is a person or a business, and because *we do not validate it*: it
     * is passed through to the party that issues the document, and a validation
     * rule of ours that rejected a legitimate Austrian UID would be us blocking
     * a transaction we are not party to.
     */
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** When the request was handed to the property. Null while queued. */
    routedAt: timestamp('routed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoice_requests_property_idx').on(t.propertyId),
    /** One per stay. A guest who changes the details corrects the request. */
    unique('invoice_requests_reservation').on(t.reservationId),
    check('invoice_requests_bill_to_not_empty', sql`length(btrim(${t.billTo})) > 0`),
  ],
)

// ---------------------------------------------------------------------------
// Attribution, subscriptions and the monthly report (E5.4, D14, ADR-015)
// ---------------------------------------------------------------------------

/**
 * Where a booking session came from.
 *
 * `engine` is our own booking surface; the two concierge values are the chat
 * thread (E3.2) and the voice workstream (WS-B). Separate rather than one
 * `concierge` value because D14 prices AI-attributed business and somebody will
 * eventually ask which channel earned it — and adding an enum value later is
 * cheap while splitting a conflated one is not.
 */
export const attributionChannel = pgEnum('attribution_channel', [
  'engine',
  'concierge_chat',
  'concierge_voice',
])

/** Where a report stands. Issued is frozen — see `monthlyReports`. */
export const reportStatus = pgEnum('report_status', ['draft', 'issued'])

/** A dispute is raised and then credited. There is no "rejected" — see `feeDisputes`. */
export const disputeStatus = pgEnum('dispute_status', ['open', 'credited'])

/**
 * A session touching a booking (D14, PRD §6).
 *
 * This table exists to answer one question with a timestamp: **did an engine
 * session precede the concierge session that produced this booking?** D14's
 * attribution rule is written as a 24-hour window, and Sprint 4 could not
 * implement it — the reservation carried session *ids* but nothing carried
 * *when*, so `classifyBooking` used the presence of an engine id as a stricter
 * proxy and said so in a comment.
 *
 * Note the direction of that compromise. The proxy under-attributes: a booking
 * where the guest browsed the engine three weeks earlier and then booked by
 * chat was billed at the direct rate. Replacing it with the real window can
 * only move fees **up**, which is a conversation with an owner rather than a
 * refund to them — the only direction it was safe to be wrong in.
 *
 * ## Why events rather than columns on `reservations`
 *
 * Because a session that did not convert is still evidence. "No engine session
 * preceded it" is a claim about sessions that produced no booking, and a column
 * on the reservation can only ever record the one that did.
 */
export const attributionEvents = pgTable(
  'attribution_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * The session, as the surface that created it knows it.
     *
     * Not a foreign key and not a platform UUID: a session belongs to a browser
     * or a phone call, exists before any row does, and often never becomes
     * anything. It is an opaque string we compare to itself.
     */
    sessionId: text('session_id').notNull(),

    channel: attributionChannel('channel').notNull(),

    /**
     * The booking it produced, once it produces one.
     *
     * Null for the overwhelming majority of rows, which is the point: those are
     * the ones that evidence "somebody was already looking".
     */
    reservationId: uuid('reservation_id').references(() => reservations.id, {
      onDelete: 'cascade',
    }),

    /**
     * When it happened, from the caller.
     *
     * Passed in rather than defaulted, because the window is computed from it
     * and a row written by a retried job must carry the time of the touch and
     * not the time of the retry.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * The window query: everything this property saw in a time range.
     *
     * `(property_id, occurred_at)` rather than `(property_id, session_id)`
     * because the expensive question is "was there an engine touch in the 24
     * hours before this one", which is a range scan.
     */
    index('attribution_events_property_time_idx').on(t.propertyId, t.occurredAt),
    index('attribution_events_reservation_idx').on(t.reservationId),
  ],
)

/**
 * What a property pays us for the platform itself (D14 row 1).
 *
 * The base fee, €150–400/property/month. One live row per property; history is
 * kept by ending a row rather than editing it, because the monthly report for
 * March has to be able to say what March cost even after the price changes in
 * June.
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** Contract label — `starter`, `standard`. Ours, never a competitor's coined name (ADR-014). */
    plan: text('plan').notNull(),

    baseCents: integer('base_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),

    /**
     * How many rooms the per-room equivalence divides by (ADR-015, D20).
     *
     * Stored on the subscription rather than counted from `room_types`, and the
     * difference matters: `room_types` holds *types* with capacities, not a
     * room count. Deriving "45 rooms" from three room types would produce a
     * number that is wrong and looks authoritative — on the one line of the
     * report designed to be compared against a competitor's price.
     */
    rooms: integer('rooms'),

    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null while live. Ending a subscription never deletes it. */
    endedAt: timestamp('ended_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('subscriptions_property_idx').on(t.propertyId),
    check('subscriptions_base_non_negative', sql`${t.baseCents} >= 0`),
    check('subscriptions_rooms_positive', sql`${t.rooms} is null or ${t.rooms} > 0`),
    check('subscriptions_currency_iso', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    /** A subscription that ended before it started is a data-entry accident. */
    check(
      'subscriptions_dates_ordered',
      sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`,
    ),
  ],
)

/**
 * One month, frozen (E5.4, PRD C4).
 *
 * **This report is the invoice basis**, which is the whole reason it is a table
 * and not a query. A statement recomputed on read changes when a reservation is
 * cancelled, a rate card is edited or a dispute is credited — and an invoice
 * that shows different numbers on two readings is an invoice that gets disputed
 * and lost (design-notes/monthly-report.md §4A).
 *
 * A draft recomputes freely. Issuing writes the numbers down.
 */
export const monthlyReports = pgTable(
  'monthly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** First day of the month, in the property's own timezone. */
    periodStart: date('period_start').notNull(),

    status: reportStatus('status').notNull().default('draft'),

    /**
     * The whole statement as rendered, at issue time.
     *
     * Jsonb rather than a normalised line table, and this is the one place in
     * the schema where that is the right answer: the value of the snapshot is
     * precisely that it does **not** join to anything. A line table would
     * reference `fee_events` and `reservations`, and a report is only frozen if
     * nothing it points at can change underneath it.
     */
    snapshot: jsonb('snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /** Denormalized for the list. The snapshot is the authority. */
    totalCents: integer('total_cents').notNull().default(0),
    currency: text('currency').notNull().default('EUR'),

    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** One report per property per month. A second would be a second invoice. */
    unique('monthly_reports_property_period').on(t.propertyId, t.periodStart),
    check(
      'monthly_reports_issued_has_time',
      sql`${t.status} <> 'issued' or ${t.issuedAt} is not null`,
    ),
    check('monthly_reports_period_is_first', sql`extract(day from ${t.periodStart}) = 1`),
  ],
)

/**
 * An owner disagreeing with a fee (E5.4).
 *
 * ## Why there is no `rejected` status
 *
 * D14: *disputes resolve in the owner's favour*. Implemented literally — raising
 * one credits it, and the conversation happens afterwards. A workflow with an
 * adjudication step would be a policy that reads well in a contract and behaves
 * differently under load, and the first time an owner lost one they would stop
 * believing the rest of the statement.
 *
 * The cost of being wrong is one fee. The cost of the alternative is the owner
 * deciding the numbers are a negotiation, which is M6 — trust architecture —
 * failing at exactly the point it was supposed to pay off.
 *
 * A rising dispute rate means the attribution rule is wrong. It is a signal to
 * read, not a queue to work.
 */
export const feeDisputes = pgTable(
  'fee_disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * `restrict`, not `cascade`. The dispute is the record that we credited
     * something back, and it outlives our interest in the fee it was about.
     */
    feeEventId: uuid('fee_event_id')
      .notNull()
      .references(() => feeEvents.id, { onDelete: 'restrict' }),

    /** The member who raised it. Null once the person is gone; the credit stands. */
    raisedBy: uuid('raised_by').references(() => authUsers.id, { onDelete: 'set null' }),

    /** The owner's words. Not a category — a category is us framing their complaint. */
    reason: text('reason'),

    status: disputeStatus('status').notNull().default('open'),

    /** What came off the statement. Set when credited, which is immediately. */
    creditCents: integer('credit_cents').notNull().default(0),

    creditedAt: timestamp('credited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('fee_disputes_property_idx').on(t.propertyId),
    /** One dispute per fee. Disputing twice is the same disagreement. */
    unique('fee_disputes_fee_event').on(t.feeEventId),
    check('fee_disputes_credit_non_negative', sql`${t.creditCents} >= 0`),
    check(
      'fee_disputes_credited_has_time',
      sql`${t.status} <> 'credited' or ${t.creditedAt} is not null`,
    ),
  ],
)

// ---------------------------------------------------------------------------
// Entitlements (E7.3, D14 row 4)
// ---------------------------------------------------------------------------

/**
 * What a property has bought (E7.3).
 *
 * D14's fourth pricing row is per-room module fees, and modules are sold as
 * capabilities: Concierge, Rooms, and whatever comes after. A flag per property
 * per feature is what maps a contract to what the software will do.
 *
 * ## Why a table and not a jsonb column on `properties`
 *
 * Because these rows decide what a property is charged for, which makes them
 * the same kind of object as `subscriptions` and `fee_events`: a contract term
 * that somebody will one day dispute. A jsonb blob has no grant timestamp, no
 * per-key policy, and no way to answer "since when" — and "since when" is the
 * whole question in a billing argument.
 *
 * It is also the difference between a feature that was *never enabled* and one
 * that was *turned off in March*. A key vanishing from a blob cannot tell them
 * apart; a row with an `ended_at` can.
 *
 * ## Absence is the default, and the default is off
 *
 * There is no row meaning "not entitled". A feature is enabled when a live row
 * says so, which means a bug in this table's plumbing fails closed — a property
 * loses a module they paid for, which they will tell us about within the hour,
 * rather than silently gaining one they did not, which nobody reports.
 */
export const entitlements = pgTable(
  'entitlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /**
     * The capability, as the code names it: `concierge`, `rooms`, `reporting`.
     *
     * Free text rather than an enum, and this is the one place that choice is
     * right: the set grows with the commercial roster rather than with the
     * schema, and a migration to sell a module is a migration nobody will
     * remember to write on the day the contract is signed.
     */
    feature: text('feature').notNull(),

    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    /** Null while live. Revoking ends a row; it never deletes one. */
    endedAt: timestamp('ended_at', { withTimezone: true }),

    /** Why, when there is a reason worth keeping — a trial, a contract change. */
    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entitlements_property_idx').on(t.propertyId),
    /**
     * One live grant per feature, enforced where it can be.
     *
     * Partial, because a property that had `concierge`, lost it, and bought it
     * again has two legitimate rows — and only one of them is live. A plain
     * unique would make re-selling a module impossible.
     */
    uniqueIndex('entitlements_property_feature_live')
      .on(t.propertyId, t.feature)
      .where(sql`${t.endedAt} is null`),
    check('entitlements_dates_ordered', sql`${t.endedAt} is null or ${t.endedAt} > ${t.grantedAt}`),
    check('entitlements_feature_not_empty', sql`length(btrim(${t.feature})) > 0`),
  ],
)
