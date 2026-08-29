import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BotIcon, EyeOffIcon } from 'lucide-react'
import { listArticles, missingLocales, type KbArticleRow } from '@bookone/core/onboarding'
import { PageShell } from '@/components/shell/page-shell'
import { requireOwner } from '@/lib/auth/current-property'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { save, togglePublished } from './actions'

/**
 * The knowledge-base editor (E5.3).
 *
 * This is the whole of what the concierge is permitted to say (binding rule 7),
 * so the screen is arranged around the two things that actually go wrong with
 * a property's knowledge base:
 *
 * **It is empty.** Sprint 7 shipped a concierge that escalates more than it
 * answers, because nobody writes one of these. Drafts sort to the top so this
 * page doubles as AG-03's review surface — a second approval inbox is a second
 * thing to abandon.
 *
 * **It is only in one language.** All four answers for one topic sit on one
 * screen, because the person editing knows the answer and is correcting
 * *breakfast*, not *German*. An empty German box beside a filled Italian one is
 * a prompt; a separate German screen is a place nobody goes.
 *
 * There is no translate button. Offering one would be offering to generate a
 * claim about a business, which is the thing rule 7 exists to prevent.
 */
export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; property: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { locale, property: slug } = await params
  setRequestLocale(locale)

  const { property } = await requireOwner(locale, slug)
  const query = await searchParams
  const error = typeof query.error === 'string' ? query.error : null
  const articles = await listArticles(property.id)
  const t = await getTranslations('console.knowledge')

  const languages = property.languages
  const context = { locale, slug }
  const drafts = articles.filter((article) => !article.published).length

  return (
    <PageShell
      locale={locale}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        drafts > 0 ? (
          <Badge variant="secondary" className="gap-1">
            <BotIcon className="size-3" aria-hidden />
            {t('draftsWaiting', { n: drafts })}
          </Badge>
        ) : null
      }
    >
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {articles.length === 0 && <p className="text-muted-foreground text-sm">{t('empty')}</p>}

      {articles.map((article) => (
        <ArticleForm
          key={article.id}
          article={article}
          languages={languages}
          context={context}
          locale={locale}
        />
      ))}

      <Separator />

      {/* ------------------------------------------------------------- new */}
      <section>
        <h2 className="text-foreground mb-1 font-medium">{t('newHeading')}</h2>
        <p className="text-muted-foreground mb-4 text-xs">{t('newHint')}</p>

        <ArticleFields
          article={null}
          languages={languages}
          context={context}
          locale={locale}
          idPrefix="new"
        />
      </section>
    </PageShell>
  )
}

async function ArticleForm({
  article,
  languages,
  context,
  locale,
}: {
  article: KbArticleRow
  languages: string[]
  context: { locale: string; slug: string }
  locale: string
}) {
  const t = await getTranslations('console.knowledge')
  const missing = missingLocales(article, languages)

  return (
    <section className="bg-card rounded-lg border p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-foreground font-medium">{article.topic}</h2>
          <span className="text-muted-foreground num text-xs">v{article.version}</span>

          {!article.published && (
            <Badge variant="secondary" className="gap-1">
              <EyeOffIcon className="size-3" aria-hidden />
              {t('draft')}
            </Badge>
          )}

          {/*
            The missing languages, named. The concierge escalates for each of
            them rather than translating (binding rule 7), so this is the list
            of conversations the property is currently taking by hand.
          */}
          {missing.length > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {t('missingIn', { locales: missing.join(', ').toUpperCase() })}
            </Badge>
          )}
        </div>

        <form
          action={togglePublished.bind(null, {
            ...context,
            articleId: article.id,
            published: !article.published,
          })}
        >
          <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
            {article.published ? t('unpublish') : t('publish')}
          </Button>
        </form>
      </div>

      <ArticleFields
        article={article}
        languages={languages}
        context={context}
        locale={locale}
        idPrefix={article.id}
      />
    </section>
  )
}

async function ArticleFields({
  article,
  languages,
  context,
  locale,
  idPrefix,
}: {
  article: KbArticleRow | null
  languages: string[]
  context: { locale: string; slug: string }
  locale: string
  idPrefix: string
}) {
  const t = await getTranslations('console.knowledge')
  const names = new Intl.DisplayNames([locale], { type: 'language' })

  return (
    <form action={save.bind(null, context)} className="space-y-4">
      {article ? (
        <input type="hidden" name="topic" value={article.topic} />
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-topic`}>{t('topic')}</Label>
          <Input id={`${idPrefix}-topic`} name="topic" required placeholder={t('topicExample')} />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-variants`}>{t('variants')}</Label>
        <Textarea
          id={`${idPrefix}-variants`}
          name="variants"
          rows={3}
          defaultValue={article?.questionVariants.join('\n') ?? ''}
          placeholder={t('variantsExample')}
        />
        <p className="text-muted-foreground text-xs">{t('variantsHint')}</p>
      </div>

      {/*
        Every language on one screen, ordered as the property configured them.
        A locale the property does not operate in is not offered at all — a
        Slovenian box on an Italian-and-German property is a box that will be
        left empty forever and read as an omission.
      */}
      <div className="grid gap-3 sm:grid-cols-2">
        {languages.map((language) => (
          <div key={language} className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-answer-${language}`}>
              {names.of(language) ?? language.toUpperCase()}
            </Label>
            <Textarea
              id={`${idPrefix}-answer-${language}`}
              name={`answer-${language}`}
              rows={3}
              defaultValue={article?.answers[language] ?? ''}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">{t('liveHint')}</p>
        <Button type="submit" size="sm">
          {article ? t('save') : t('create')}
        </Button>
      </div>
    </form>
  )
}
