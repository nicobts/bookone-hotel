import { redirect } from 'next/navigation'

/**
 * `/[property]/console` has no page of its own — Today is the console.
 * A bare landing here would be a menu in front of a menu.
 */
export default async function ConsoleIndex({
  params,
}: {
  params: Promise<{ locale: string; property: string }>
}) {
  const { locale, property } = await params
  redirect(`/${locale}/${property}/console/today`)
}
