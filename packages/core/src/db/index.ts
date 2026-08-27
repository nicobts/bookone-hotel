// Drizzle schema v1, migrations and versioned RLS policy SQL.
//
// Fills in day-1 task 2 (docs/04-IMPLEMENTATION-PLAN.md §6): properties,
// guests, reservations, external_refs, domain_events, agent_runs, plus the RLS
// baseline and the cross-tenant test harness. Table sketch: 03-ARCHITECTURE §2.
//
// Migrations are forward-only (Drizzle Kit) and RLS policy SQL ships in the
// same PR as the schema change it protects (binding rule 9).
export {}
