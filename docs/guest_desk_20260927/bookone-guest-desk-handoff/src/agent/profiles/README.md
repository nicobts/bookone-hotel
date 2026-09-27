Profiles are loaded and validated by the router at boot. Hard rules (money, identity, emergency, unknown-twice)
are in `src/agent/router/hard-rules.ts` and run before routing. Prompts live in `prompts/<id>.md` (Italian
and English sections in one file). Phase 2 adds `post-stay.json` and `in-stay-requests.json`.
Owner authentication: `owner-backoffice` is bound to verified owner phone numbers per tenant; a guest number
can never reach it.
