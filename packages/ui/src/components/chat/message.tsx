import * as React from 'react'
import { cn } from '../../lib/utils'

/*
 * Message layout for the chat interface (ADR-037). Adapted from shadcn's
 * chatbot-template (MIT, see LICENSE-chatbot-template).
 */

function MessageGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-group"
      className={cn('flex min-w-0 flex-col gap-2', className)}
      {...props}
    />
  )
}

function Message({
  className,
  align = 'start',
  ...props
}: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        'group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse',
        className,
      )}
      {...props}
    />
  )
}

function MessageAvatar({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        'bg-muted flex size-8 shrink-0 items-center justify-center self-start overflow-hidden rounded-full text-xs font-medium',
        className,
      )}
      {...props}
    />
  )
}

function MessageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        'flex w-full min-w-0 flex-col gap-1.5 break-words group-data-[align=end]/message:items-end',
        className,
      )}
      {...props}
    />
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        'text-muted-foreground flex max-w-full min-w-0 flex-wrap items-center gap-1.5 px-1 text-xs',
        className,
      )}
      {...props}
    />
  )
}

/** A speech bubble. `variant` follows the template's names. */
function Bubble({
  variant = 'default',
  className,
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'muted' | 'outline' | 'note' }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(
        'w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap',
        variant === 'default' && 'bg-primary text-primary-foreground',
        variant === 'muted' && 'bg-muted text-foreground',
        variant === 'outline' && 'border-border bg-background border',
        variant === 'note' &&
          'text-muted-foreground max-w-full rounded-lg border border-dashed bg-transparent text-xs',
        className,
      )}
      {...props}
    />
  )
}

export { Bubble, Message, MessageAvatar, MessageContent, MessageFooter, MessageGroup }
