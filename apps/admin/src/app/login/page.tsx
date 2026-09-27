import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main className="mx-auto flex min-h-[80vh] max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-xl font-semibold">BookOne Ops</h1>
        <p className="text-sm text-muted-foreground">Staff only. Every change is recorded.</p>
      </div>
      {error === 'no-role' ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          This account has no staff role.
        </p>
      ) : null}
      <LoginForm />
    </main>
  )
}
