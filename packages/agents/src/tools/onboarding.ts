import { extractDrafts, fetchPage, saveDrafts } from '@bookone/core/onboarding'
import { agentActor } from '@bookone/core/events'
import type { Tool } from './index'

/**
 * AG-03's one tool (06 §2, Sprint 9).
 *
 * Fetches a page the owner named, extracts candidate answers, and writes them
 * as **drafts**. There is no tool here that publishes one — the agent can put
 * nothing in front of a guest, and that is a property of the tool grant rather
 * than of a review step somebody might skip (binding rule 7).
 */
export const draftKnowledgeTool: Tool = {
  name: 'draft_knowledge',
  description: "Draft knowledge-base articles from the property's own website",

  run: async (context, input) => {
    const url = typeof input.url === 'string' ? input.url.trim() : ''
    if (!url) return { ok: false, output: { error: 'url is required' } }

    const page = await fetchPage(url)
    if (!page) return { ok: true, output: { fetched: false, url, written: 0, skipped: 0 } }

    const drafts = extractDrafts({
      html: page.html,
      url: page.url,
      // The page's language, from the runner's context. Never sniffed: guessing
      // wrong files an Italian answer under `de`, which the concierge would then
      // read out to a German guest as the property's own words.
      locale: context.locale ?? 'en',
    })

    const { written, skipped } = await saveDrafts({
      propertyId: context.propertyId,
      drafts,
      actor: agentActor('AG-03'),
    })

    return {
      ok: true,
      output: {
        fetched: true,
        url: page.url,
        found: drafts.length,
        written,
        skipped,
        topics: drafts.map((draft) => draft.topic),
        // Deterministic extraction, not inference. Same reasoning as AG-05.
        confidence: 1,
      },
    }
  },
}
