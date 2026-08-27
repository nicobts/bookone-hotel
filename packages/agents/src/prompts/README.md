# Versioned system prompts

One file per agent, named for its registry key (`ag-01-guest-concierge.md`).
Prompts are versioned with the code because a prompt change that regresses a
golden eval set is a blocked merge, exactly like a failing test.
