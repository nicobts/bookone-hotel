'use client'

import * as React from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { MessageScroller as MessageScrollerPrimitive } from '@shadcn/react/message-scroller'
import { cn } from '../../lib/utils'
import { Button } from '../button'

/*
 * The chat's scroll container: stays pinned to the newest message and shows a
 * "scroll to end" button when the reader has scrolled up. Adapted from shadcn's
 * chatbot-template (MIT, see LICENSE-chatbot-template), with the template's
 * custom scrollbar utilities replaced by plain Tailwind.
 */

function MessageScrollerProvider(
  props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>,
) {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('relative flex size-full min-h-0 flex-col overflow-hidden', className)}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn('size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain', className)}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-6', className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn('min-w-0 shrink-0', className)}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = 'end',
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Button>) {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      direction={direction}
      className={cn(
        'absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full transition-opacity data-[active=false]:pointer-events-none data-[active=false]:opacity-0',
        className,
      )}
      render={<Button variant="outline" size="icon-sm" />}
      {...props}
    >
      <ArrowDownIcon />
      <span className="sr-only">Scroll to the newest message</span>
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
}
