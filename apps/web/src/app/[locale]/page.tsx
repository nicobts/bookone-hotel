import { setRequestLocale } from 'next-intl/server'

export default async function RootPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-medium tracking-tight">BookOne</h1>
      <p className="text-muted-foreground text-sm">
        Scaffold. Surfaces live at <code>/book/[property]</code>, <code>/stay/[token]</code> and{' '}
        <code>/console</code>.
      </p>
    </main>
  )
}
