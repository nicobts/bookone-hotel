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
     * The idempotency guarantee the reflection job depends on: one external id
     * maps to exactly one of our entities, so a retried reflect cannot create a
     * second row.
     */
    unique('external_refs_system_entity').on(t.system, t.entityType, t.externalId),
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reservations_property_arrival_idx').on(t.propertyId, t.arrivalDate),
    index('reservations_property_status_idx').on(t.propertyId, t.status),
    check('reservations_date_order', sql`${t.departureDate} > ${t.arrivalDate}`),
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
