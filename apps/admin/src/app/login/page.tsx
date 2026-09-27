import { AuthShell } from '@/components/auth-shell'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <AuthShell title="Sign in" subtitle="BookOne staff account. Every change you make is recorded.">
      {error === 'no-role' ? (
        <p className="border-destructive/40 text-destructive mb-4 rounded-md border p-3 text-sm">
          This account has no staff role.
        </p>
      ) : null}
      <LoginForm />
    </AuthShell>
  )
}
