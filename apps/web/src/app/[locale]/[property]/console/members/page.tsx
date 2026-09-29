import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server'
import { listContacts, type Contact } from '@bookone/core/contacts'
import { NotBuiltYet, PageShell } from '@/components/shell/page-shell'
import { requireOwner } from '@/lib/auth/current-property'
import { Badge } from '@bookone/ui/components/badge'
import { Input } from '@bookone/ui/components/input'
import { Label } from '@bookone/ui/components/label'
import { PendingButton } from '@bookone/ui/components/pending-button'
import { addContactAction, confirmInformedAction, removeContactAction } from './actions'

/**
 * Team. Owner-only, at the page (`requireOwner`) and at the database: the
 * contacts below are read as the owner, and RLS gives anyone else nothing.
 *
 * "Who we page" is the one part built: the people the platform pages by phone,
 * which are not the same people as the console's users
 * (design-notes/alert-contacts.md).
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)
  const { user, property } = await requireOwner(locale, slug)

  const t = await getTranslations('nav')
  const c = await getTranslations('console.contacts')
  const format = await getFormatter()
  const contacts = await listContacts(user.id, property.id)
  const context = { locale, slug }

  const groups: { role: Contact['role']; rows: Contact[] }[] = [
    { role: 'owner', rows: contacts.filter((contact) => contact.role === 'owner') },
    { role: 'staff', rows: contacts.filter((contact) => contact.role === 'staff') },
  ]

  return (
    <PageShell locale={locale} title={t('members')}>
      <section className="flex max-w-3xl flex-col gap-6">
        <div>
          <h2 className="text-base font-semibold">{c('title')}</h2>
          <p className="text-muted-foreground text-sm">{c('body')}</p>
        </div>

        {groups.map((group) => (
          <div key={group.role} className="flex flex-col gap-2">
            <div>
              <h3 className="text-sm font-medium">{c(`role.${group.role}`)}</h3>
              <p className="text-muted-foreground text-xs">{c(`receives.${group.role}`)}</p>
            </div>

            {group.rows.length === 0 ? (
              <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
                {c(`none.${group.role}`)}
              </p>
            ) : (
              <ul className="divide-border flex flex-col divide-y rounded-md border">
                {group.rows.map((contact) => (
                  <li key={contact.id} className="flex flex-wrap items-center gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{contact.name}</p>
                      <p className="num text-muted-foreground text-xs">{contact.phone}</p>
                    </div>

                    {contact.informedAt ? (
                      <span className="text-muted-foreground text-xs">
                        {c('informedOn', {
                          date: format.dateTime(contact.informedAt, { dateStyle: 'medium' }),
                        })}
                      </span>
                    ) : (
                      <form action={confirmInformedAction.bind(null, context)}>
                        <input type="hidden" name="id" value={contact.id} />
                        <Badge variant="outline" className="mr-2">
                          {c('notInformed')}
                        </Badge>
                        <PendingButton variant="outline" size="sm">
                          {c('confirmInformed')}
                        </PendingButton>
                      </form>
                    )}

                    <form action={removeContactAction.bind(null, context)}>
                      <input type="hidden" name="id" value={contact.id} />
                      <PendingButton variant="ghost" size="sm">
                        {c('remove')}
                      </PendingButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <form
          action={addContactAction.bind(null, context)}
          className="bg-card flex flex-col gap-4 rounded-lg border p-4"
        >
          <h3 className="text-sm font-medium">{c('add')}</h3>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-name">{c('name')}</Label>
              <Input
                id="contact-name"
                name="name"
                required
                maxLength={80}
                placeholder={c('nameExample')}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-phone">{c('phone')}</Label>
              <Input
                id="contact-phone"
                name="phone"
                type="tel"
                required
                inputMode="tel"
                autoComplete="off"
                placeholder="+39 333 123 4567"
                className="num"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="contact-role">{c('roleLabel')}</Label>
              <select
                id="contact-role"
                name="role"
                defaultValue="staff"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="staff">{c('role.staff')}</option>
                <option value="owner">{c('role.owner')}</option>
              </select>
            </div>
          </div>

          <p className="text-muted-foreground text-xs">{c('phoneHint')}</p>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="informed"
              required
              className="accent-primary mt-0.5 size-4"
            />
            <span>{c('informed')}</span>
          </label>

          <div>
            <PendingButton size="sm">{c('addButton')}</PendingButton>
          </div>
        </form>
      </section>

      <NotBuiltYet sprint="Sprint 9" note="Invite staff and set roles. Owner-only." />
    </PageShell>
  )
}
