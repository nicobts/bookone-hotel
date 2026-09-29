import { randomUUID } from 'node:crypto'
import {
  IstatTransportError,
  type DayMovement,
  type IstatTransport,
} from '@bookone/core/compliance'

/**
 * WebTur, simulated (WP1.3). Files nothing: it keeps each property's days in
 * memory, so the lifecycle, the comparison and the drills can run before the
 * Regione's specification exists.
 *
 * `failNext` injects failures; `editOnPortal` changes a day as a person would
 * on the portal, which is what the comparison exists to catch.
 */
export class MockIstatTransport implements IstatTransport {
  readonly channel = 'mock-webtur'
  readonly simulated = true

  private readonly days = new Map<string, { reference: string; movement: DayMovement }>()
  private readonly instance = randomUUID().slice(0, 8)
  private sequence = 0
  private failures: { code: 'unavailable' | 'rejected' | 'unauthorized'; times: number }[] = []

  /** The next `times` submits fail with `code` (`unavailable` is retryable). */
  failNext(code: 'unavailable' | 'rejected' | 'unauthorized', times = 1): void {
    this.failures.push({ code, times })
  }

  async submitDay(input: {
    propertyId: string
    day: string
    movement: DayMovement
  }): Promise<{ reference: string }> {
    const failure = this.failures[0]
    if (failure) {
      failure.times -= 1
      if (failure.times <= 0) this.failures.shift()
      throw new IstatTransportError(
        failure.code,
        `injected ${failure.code}`,
        failure.code === 'unavailable',
      )
    }

    const key = `${input.propertyId}|${input.day}`
    const existing = this.days.get(key)
    if (existing && JSON.stringify(existing.movement) === JSON.stringify(input.movement)) {
      return { reference: existing.reference }
    }
    this.sequence += 1
    const reference = `IST-${this.instance}-${this.sequence}`
    this.days.set(key, { reference, movement: structuredClone(input.movement) })
    return { reference }
  }

  async readDay(input: { propertyId: string; day: string }): Promise<DayMovement | null> {
    const filed = this.days.get(`${input.propertyId}|${input.day}`)
    return filed ? structuredClone(filed.movement) : null
  }

  /** A person changes the day on the portal after we filed it. */
  editOnPortal(propertyId: string, day: string, change: (movement: DayMovement) => void): void {
    const filed = this.days.get(`${propertyId}|${day}`)
    if (filed) change(filed.movement)
  }
}
