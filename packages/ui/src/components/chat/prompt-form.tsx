'use client'

import * as React from 'react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from '../button'

/*
 * The message box: Enter sends, Shift+Enter breaks the line, IME composition
 * is respected. Adapted from shadcn's chatbot-template (MIT, see
 * LICENSE-chatbot-template), without its model picker — which model answers is
 * the orchestrator's decision here (ADR-022), not the user's.
 */
export function PromptForm({
  isBusy,
  onSubmit,
  onStop,
  placeholder = 'Send a message…',
  className,
}: {
  isBusy: boolean
  onSubmit: (text: string) => void
  onStop?: () => void
  placeholder?: string
  className?: string
}) {
  const [input, setInput] = React.useState('')

  function submit(event?: React.FormEvent) {
    event?.preventDefault()
    const text = input.trim()
    if (!text || isBusy) return
    onSubmit(text)
    setInput('')
  }

  return (
    <form
      onSubmit={submit}
      className={cn(
        'border-input bg-background focus-within:ring-ring/50 flex items-end gap-2 rounded-2xl border p-2 shadow-xs focus-within:ring-[3px]',
        className,
      )}
    >
      <textarea
        aria-label={placeholder}
        rows={1}
        placeholder={placeholder}
        className="placeholder:text-muted-foreground max-h-48 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {isBusy && onStop ? (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Stop"
          className="rounded-full"
          onClick={onStop}
        >
          <SquareIcon />
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon-sm"
          aria-label="Send"
          className="rounded-full"
          disabled={!input.trim() || isBusy}
        >
          <ArrowUpIcon />
        </Button>
      )}
    </form>
  )
}
