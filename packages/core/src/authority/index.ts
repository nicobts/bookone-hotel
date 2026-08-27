// AuthorityMap + write-router (ADR-001, D10).
//
// Authority is configured per domain per property on `properties.authority_map`;
// the router reads it and sends each write to the platform or to the PMS
// accordingly. Both routes are unit-tested per domain (E6.2).
//
// Fills in day-1 task 3.
export {}
