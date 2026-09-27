import type { UIMessage } from 'ai'
import { previewTranscript } from '@bookone/agents/preview'
import { listPreviewTargets } from '@bookone/core/preview'
import { Button } from '@bookone/ui/components/button'
import { PageShell } from '@/components/shell/page-shell'
import { PlaygroundChat } from './playground-chat'

export const metadata = { title: 'Agent playground' }
export const dynamic = 'force-dynamic'

/** Test prompts that exercise each path: an answer, an unknown, an approval, money, a complaint, an emergency. */
const GUEST_SUGGESTIONS = [
  'A che ora è la colazione?',
  'Avete una sauna?',
  'Possiamo fare il check-out alle 13?',
  'Voglio un rimborso.',
  'La camera è sporca, è inaccettabile.',
  'C’è odore di gas in camera!',
]
const OWNER_SUGGESTIONS = [
  'Chi non ha ancora mandato i documenti?',
  'Quanti arrivi domani?',
  'Ci sono reclami aperti?',
  'Cosa aspetta la mia approvazione?',
]

/**
 * The agent playground (ADR-037): talk to the concierge as any current guest
 * of a demo property, or to the owner assistant as its owner, and see what
 * each run decided. Demo properties only — every turn is a real one.
 */
export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; as?: string }>
}) {
  const params = await searchParams
  const targets = await listPreviewTargets()

  if (targets.length === 0) {
    return (
      <PageShell title="Agent playground">
        <p className="text-muted-foreground text-sm">
          No demo property. Run <code className="font-mono">pnpm demo:seed</code> — the playground
          only works on properties the demo seed created, because every turn is a real one.
        </p>
      </PageShell>
    )
  }

  const property = targets.find((t) => t.id === params.property) ?? targets[0]!
  const persona = params.as ?? property.stays[0]?.reservationId ?? 'owner'
  const stay = property.stays.find((s) => s.reservationId === persona) ?? null
  const asOwner = !stay

  const history = stay ? await previewTranscript(property.id, stay.reservationId) : []
  const initialMessages: UIMessage[] = history.map((row) => ({
    id: row.id,
    role: row.author === 'guest' ? 'user' : 'assistant',
    parts:
      row.author === 'system'
        ? [{ type: 'data-note', data: row.body }]
        : [{ type: 'text', text: row.author === 'staff' ? `Staff: ${row.body}` : row.body }],
  }))

  const body = asOwner
    ? {
        propertyId: property.id,
        mode: 'owner',
        ownerPhone: property.ownerPhone,
        locale: property.localeDefault,
      }
    : {
        propertyId: property.id,
        mode: 'guest',
        reservationId: stay.reservationId,
        locale: stay.locale,
      }

  return (
    <PageShell
      title="Agent playground"
      subtitle={
        asOwner
          ? `${property.name} · owner assistant (AG-06)`
          : `${property.name} · concierge (AG-01) as ${stay.guestName ?? stay.reference}`
      }
    >
      <form
        method="get"
        className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-3 text-sm"
      >
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Demo property</span>
          <select
            name="property"
            defaultValue={property.id}
            className="border-input bg-background h-9 rounded-md border px-2"
          >
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-72 flex-col gap-1">
          <span className="text-muted-foreground text-xs">Speak as</span>
          <select
            name="as"
            defaultValue={asOwner ? 'owner' : stay.reservationId}
            className="border-input bg-background h-9 rounded-md border px-2"
          >
            {property.ownerPhone ? (
              <option value="owner">The owner — owner assistant (AG-06)</option>
            ) : null}
            {property.stays.map((s) => (
              <option key={s.reservationId} value={s.reservationId}>
                {s.guestName ?? s.reference} · {s.arrivalDate} → {s.departureDate} ·{' '}
                {s.locale.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Open
        </Button>
        <p className="text-muted-foreground basis-full text-xs">
          Turns are real: messages land in the stay’s thread, tools write, approvals wait in the
          hotel console. Reset with <code className="font-mono">pnpm demo:reset</code>.
        </p>
      </form>

      <div className="bg-card flex h-[calc(100dvh-15rem)] min-h-[28rem] flex-col rounded-lg border">
        <PlaygroundChat
          key={`${property.id}:${persona}`}
          body={body}
          initialMessages={initialMessages}
          suggestions={asOwner ? OWNER_SUGGESTIONS : GUEST_SUGGESTIONS}
          assistantLabel={asOwner ? 'AG6' : 'AG1'}
          placeholder={asOwner ? 'Ask the owner assistant…' : 'Write as the guest…'}
        />
      </div>
    </PageShell>
  )
}
