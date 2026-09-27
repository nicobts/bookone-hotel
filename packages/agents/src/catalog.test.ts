import { describe, expect, it } from 'vitest'
import de from '@bookone/i18n/messages/de.json'
import en from '@bookone/i18n/messages/en.json'
import it_ from '@bookone/i18n/messages/it.json'
import sl from '@bookone/i18n/messages/sl.json'
import { AGENT_CATALOG, catalogToolNames, HARD_RULES } from './catalog'
import { getAgent } from './registry'
import { profiles } from './profiles'
import { READ_ONLY_TOOLS, getTool, tools } from './tools'

/**
 * The agents page tells owners what their agents may do (ADR-038). These
 * checks keep that true: the catalogue matches the registry, the profiles and
 * the tools; nothing that writes is classed as a read; and every name it shows
 * exists in all four languages.
 */
describe('agents catalogue', () => {
  it('matches the registry: tier, feature and granted tools', () => {
    for (const agent of AGENT_CATALOG) {
      const registered = getAgent(agent.id)
      expect(registered.tier, agent.id).toBe(agent.tier)
      expect(registered.feature, agent.id).toBe(agent.feature)
      const granted = new Set(registered.tools)
      for (const name of [
        ...agent.tools.map((t) => t.name),
        ...agent.profiles.flatMap((p) => p.tools.map((t) => t.name)),
      ]) {
        expect(granted.has(name), `${agent.id} is shown with ${name}`).toBe(true)
      }
    }
  })

  it('shows every guest profile the concierge has, and each profile as loaded', () => {
    const loaded = profiles()
    const shown = AGENT_CATALOG.flatMap((a) => a.profiles.map((p) => p.id)).sort()
    expect(shown).toEqual([...loaded.keys()].sort())
    for (const profile of AGENT_CATALOG.flatMap((a) => a.profiles)) {
      expect(profile.tools.map((t) => t.name)).toEqual(loaded.get(profile.id)!.tools)
    }
  })

  it('never classes a writing tool as a read', () => {
    for (const name of READ_ONLY_TOOLS) {
      const tool = getTool(name)
      expect(tool, `${name} exists`).toBeDefined()
      expect(tool!.write ?? false, `${name} is read-only but flagged as a write`).toBe(false)
    }
    // Found when this list was drawn up: it writes, and was not flagged.
    expect(getTool('create_task')!.write).toBe(true)
    expect(READ_ONLY_TOOLS.has('create_task')).toBe(false)
    // Every tool is either on the allowlist or simulated in preview; nothing
    // flagged as a write may be on it.
    for (const tool of Object.values(tools)) {
      if (tool.write) expect(READ_ONLY_TOOLS.has(tool.name), tool.name).toBe(false)
    }
  })

  it('has every agent, profile, tool and rule in all four languages', () => {
    for (const [locale, messages] of Object.entries({ de, en, it: it_, sl })) {
      const agents = (messages.console as unknown as { agents: unknown }).agents as {
        agents: Record<string, { name?: string; purpose?: string }>
        profiles: Record<string, { name?: string; description?: string }>
        tools: Record<string, { label?: string; would?: string }>
        rules: Record<string, { name?: string; description?: string }>
      }
      for (const agent of AGENT_CATALOG) {
        expect(agents.agents[agent.id]?.name, `${locale} ${agent.id}`).toBeTruthy()
        expect(agents.agents[agent.id]?.purpose, `${locale} ${agent.id}`).toBeTruthy()
        for (const profile of agent.profiles) {
          expect(agents.profiles[profile.id]?.name, `${locale} ${profile.id}`).toBeTruthy()
          expect(agents.profiles[profile.id]?.description, `${locale} ${profile.id}`).toBeTruthy()
        }
      }
      for (const name of catalogToolNames()) {
        expect(agents.tools[name]?.label, `${locale} ${name}`).toBeTruthy()
        expect(agents.tools[name]?.would, `${locale} ${name}`).toBeTruthy()
      }
      for (const rule of HARD_RULES) {
        expect(agents.rules[rule]?.name, `${locale} ${rule}`).toBeTruthy()
        expect(agents.rules[rule]?.description, `${locale} ${rule}`).toBeTruthy()
      }
    }
  })
})
