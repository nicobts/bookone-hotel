/**
 * Turning a property's own website into knowledge-base drafts (AG-03, 06 §2).
 *
 * ## What this is, honestly
 *
 * 06 §2 describes AG-03 as ingesting a hotel's website, PDFs and menus and
 * drafting the entire property configuration. **This is not that.** No model is
 * connected (`LLM_API_KEY` is empty, no provider passes D9), so what runs is a
 * heuristic: find headings that look like the questions guests ask, take the
 * prose under them, and write drafts.
 *
 * It is worth building anyway, and worth being precise about why. The bottleneck
 * in Sprint 7's concierge is not the matcher — it is that the knowledge base is
 * empty and stays empty, because nobody writes one. A heuristic that produces
 * six plausible drafts an owner edits in ten minutes moves that further than a
 * better matcher over nothing. And when a model arrives, it replaces the
 * *extraction* while everything around it — drafts, review, publish — is already
 * built and already the right shape.
 *
 * ## Everything it produces is a draft
 *
 * `published: false`, which `searchKb` already refuses to quote. No guest can
 * be told anything this file produced until a person has read it and pressed
 * publish. That is not a safety net bolted on; it is the only reason a
 * heuristic is allowed near guest-facing copy at all (binding rule 7).
 *
 * ## On fetching
 *
 * The page fetched is the property's own public website, at a URL they gave us,
 * on their instruction. That is not a sub-processor relationship and needs no
 * D9 entry — nothing of theirs is sent anywhere, and the content comes back to
 * our own worker in the EU. Sending that content *to a model* would be a
 * different question, and is the question to answer before AG-03 gets one.
 */

/** Topics we know how to recognise, and the words that suggest them. */
const TOPIC_HINTS: Record<string, string[]> = {
  breakfast: ['breakfast', 'colazione', 'fruhstuck', 'frühstück', 'zajtrk'],
  parking: ['parking', 'parcheggio', 'parkplatz', 'parkiranje', 'garage'],
  wifi: ['wifi', 'wi-fi', 'wlan', 'internet'],
  checkin: ['check-in', 'checkin', 'arrivo', 'anreise', 'prijava'],
  checkout: ['check-out', 'checkout', 'partenza', 'abreise', 'odjava'],
  pets: ['pets', 'dog', 'animali', 'cani', 'haustiere', 'hunde', 'hisni ljubljencki'],
  pool: ['pool', 'piscina', 'schwimmbad', 'bazen'],
  sauna: ['sauna', 'savna'],
  restaurant: ['restaurant', 'ristorante', 'dinner', 'cena', 'abendessen'],
  transfer: ['transfer', 'shuttle', 'navetta', 'taxi'],
}

export interface DraftArticle {
  topic: string
  /** The heading, kept as a phrasing — it is how the property words the subject. */
  questionVariants: string[]
  /** `{ locale: text }` for the one locale we were told the page is in. */
  answers: Record<string, string>
  /** What in the page produced this, so a reviewer can check it. */
  source: { heading: string; url: string }
}

/**
 * Strip tags and collapse whitespace, keeping block boundaries.
 *
 * Deliberately not a DOM parser. The input is one page of marketing HTML, the
 * output is fed to a person for review, and a parser dependency here would be a
 * dependency carried into every deployment for a heuristic that a model will
 * replace.
 */
export function textify(html: string): string {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      // Spaces around a line break, left by a closing tag followed by an opening
      // one. Harmless in a diff and not in an answer: they arrive as leading
      // whitespace in text a guest reads.
      .replace(/ *\n */g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim()
  )
}

/** The topic a heading is about, or null. */
export function topicFor(heading: string): string | null {
  const lowered = heading.toLowerCase()

  for (const [topic, hints] of Object.entries(TOPIC_HINTS)) {
    if (hints.some((hint) => lowered.includes(hint))) return topic
  }

  return null
}

/**
 * Pull drafts out of one page of HTML.
 *
 * Pure, so the extraction is tested without a network. The shape it looks for
 * is the one every small-hotel website has: a heading naming a subject, and a
 * paragraph or two under it.
 */
export function extractDrafts(input: {
  html: string
  url: string
  /** The language the page is written in. Not guessed — see `answers`. */
  locale: string
  maxDrafts?: number
}): DraftArticle[] {
  const drafts: DraftArticle[] = []
  const seen = new Set<string>()

  // Headings and everything up to the next heading.
  const sections = input.html.split(/(?=<h[1-6][\s>])/i)

  for (const section of sections) {
    const headingMatch = section.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
    if (!headingMatch?.[1]) continue

    const heading = textify(headingMatch[1])
    const topic = topicFor(heading)

    // One draft per topic. A site mentioning breakfast on four pages should
    // produce one article to review, not four near-duplicates.
    if (!topic || seen.has(topic)) continue

    const body = textify(section.slice(headingMatch[0].length))
      .split('\n')
      .map((line) => line.trim())
      /*
       * Lines too short to be an answer are dropped.
       *
       * Navigation, buttons and image captions all survive `textify` as
       * fragments of two or three words, and a draft whose answer is "Read
       * more" costs a reviewer more attention than writing the article.
       */
      .filter((line) => line.length >= 40)
      .slice(0, 3)
      .join(' ')

    if (!body) continue

    seen.add(topic)
    drafts.push({
      topic,
      questionVariants: [heading.toLowerCase()],
      answers: { [input.locale]: body.slice(0, 600) },
      source: { heading, url: input.url },
    })

    if (drafts.length >= (input.maxDrafts ?? 10)) break
  }

  return drafts
}

export interface FetchedPage {
  url: string
  html: string
}

/**
 * Fetch a property's page.
 *
 * Refuses anything that is not plain http(s) and bounds both the wait and the
 * size: this is a URL a person typed, pointing at a server we do not control,
 * and a worker that will happily stream a hundred megabytes from it is a worker
 * one bad paste away from falling over.
 */
export async function fetchPage(url: string, timeoutMs = 8_000): Promise<FetchedPage | null> {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  try {
    const response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'text/html' },
    })

    if (!response.ok) return null

    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('text/html')) return null

    const html = (await response.text()).slice(0, 500_000)

    return { url: parsed.toString(), html }
  } catch {
    // A property's website being down is not an error worth propagating: the
    // owner writes their knowledge base by hand, which they could always do.
    return null
  }
}
