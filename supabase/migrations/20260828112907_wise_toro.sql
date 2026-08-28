-- Scope the external_refs uniqueness by property.
--
-- The 03 §2 sketch made this unique on (system, entity_type, external_id),
-- globally. That is wrong for a multi-tenant install: every property runs its
-- own PMS instance and numbers bookings from its own sequence, so two hotels
-- both holding booking "1001" is ordinary. The global constraint rejects the
-- second one — a cross-tenant collision that presents as "the connector
-- randomly stopped working" for whoever onboarded later.
--
-- Widening a unique constraint cannot reject existing rows: anything unique on
-- the narrower tuple is still unique on the wider one. Safe to apply forward
-- with data in place.

ALTER TABLE "external_refs" DROP CONSTRAINT "external_refs_system_entity";--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_property_system_entity" UNIQUE("property_id","system","entity_type","external_id");