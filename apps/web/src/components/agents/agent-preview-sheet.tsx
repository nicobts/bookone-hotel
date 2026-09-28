'use client'

import * as React from 'react'
import { MessageSquareIcon } from 'lucide-react'
import { Button } from '@bookone/ui/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@bookone/ui/components/sheet'
import { AgentChat } from './agent-chat'

/**
 * The agents page's chat panel (ADR-038): the shared chat in a side sheet, so
 * the page with the agent's scope stays in view while you try it.
 *
 * For the concierge it is a preview, and the tester may speak as a guest
 * without a booking or as one of the current stays. Changing that choice
 * starts a new conversation: a preview carries no history between guests.
 */
export function AgentPreviewSheet({
  agent,
  slug,
  locale,
  label,
  title,
  description,
  stays,
  labels,
  suggestions,
}: {
  agent: 'AG-01' | 'AG-06'
  slug: string
  locale: string
  label: string
  title: string
  description: string
  stays: { reservationId: string; label: string }[]
  labels: {
    speakAs: string
    noStay: string
    placeholder: string
    emptyTitle: string
    emptyDescription: string
  }
  suggestions: string[]
}) {
  const [stay, setStay] = React.useState('')

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button size="sm">
          <MessageSquareIcon aria-hidden />
          {label}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
          {agent === 'AG-01' ? (
            <label className="mt-2 flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">{labels.speakAs}</span>
              <select
                value={stay}
                onChange={(event) => setStay(event.target.value)}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="">{labels.noStay}</option>
                {stays.map((s) => (
                  <option key={s.reservationId} value={s.reservationId}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <AgentChat
            key={`${agent}:${stay}`}
            body={{ property: slug, locale, agent, reservationId: stay || null }}
            suggestions={suggestions}
            placeholder={labels.placeholder}
            emptyTitle={labels.emptyTitle}
            emptyDescription={labels.emptyDescription}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
