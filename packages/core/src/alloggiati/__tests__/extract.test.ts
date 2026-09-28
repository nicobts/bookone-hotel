import { describe, expect, it } from 'vitest'
import type { LlmProvider } from '../../llm/provider'
import { interpretReading, readDocument, readingMismatches } from '../extract'

/**
 * Document reading (WP0.4): the model reads, TypeScript decides what to trust.
 * ICAO 9303 specimen data only.
 */
const NOW = new Date('2026-09-27T00:00:00Z')
const TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
]

describe('interpretReading', () => {
  it('takes the fields from a valid MRZ, whatever the model read in the print', () => {
    const reading = interpretReading(
      // The model misread the printed surname; the MRZ is right and wins.
      { mrzLines: TD3, surname: 'ERIKSON', birthPlace: 'Zenith' },
      'model-x',
      NOW,
    )

    expect(reading.source).toBe('mrz')
    expect(reading.mrz).toEqual({ present: true, valid: true, format: 'TD3', repaired: false })
    expect(reading.fields).toMatchObject({
      surname: 'ERIKSSON',
      givenName: 'ANNA MARIA',
      birthDate: '1974-08-12',
      documentNumber: 'L898902C3',
      documentType: 'passport',
      birthPlace: 'Zenith',
    })
    // Only what the MRZ does not carry is low-confidence.
    expect(reading.lowConfidence).toEqual(['birthPlace'])
  })

  it('marks an MRZ with a failed check digit invalid, and trusts nothing it read', () => {
    const misread = [TD3[0]!, TD3[1]!.replace('L898902C3', 'L898903C3')]
    const reading = interpretReading({ mrzLines: misread, surname: 'ERIKSSON' }, 'model-x', NOW)

    expect(reading.mrz).toMatchObject({ present: true, valid: false })
    expect(reading.source).toBe('printed')
    expect(reading.lowConfidence).toContain('surname')
  })

  it('treats a document without an MRZ (a CIE front) as print only, all low-confidence', () => {
    const reading = interpretReading(
      { mrzLines: [], surname: 'ROSSI', givenName: 'MARIO', documentType: 'idCard' },
      'model-x',
      NOW,
    )

    expect(reading.mrz.present).toBe(false)
    expect(reading.source).toBe('printed')
    expect(reading.lowConfidence.sort()).toEqual(['documentType', 'givenName', 'surname'])
  })

  it('records nothing when nothing could be read', () => {
    expect(interpretReading({}, null, NOW).source).toBe('none')
  })
})

describe('readDocument', () => {
  it('sends the image to the model once and never lets it choose anything but the read tool', async () => {
    const seen: unknown[] = []
    const llm: LlmProvider = {
      name: 'fake',
      residency: {
        euProcessing: true,
        region: 'test',
        subProcessorRegisterEntry: 'SP-006',
        verifiedAt: '2026-09-27',
      },
      complete: async (request) => {
        seen.push(request)
        return {
          text: '',
          toolCalls: [{ name: 'record_document', input: { mrzLines: TD3 } }],
          usage: { inputTokens: 0, outputTokens: 0, costCents: 0 },
          model: 'fake-vision',
          stopReason: 'tool_use',
        }
      },
    }

    const reading = await readDocument(llm, { mediaType: 'image/png', data: 'aGVsbG8=' }, NOW)

    expect(seen).toHaveLength(1)
    expect(reading).toMatchObject({ source: 'mrz', model: 'fake-vision' })
    const request = seen[0] as { messages: { images?: unknown[] }[]; tools: { name: string }[] }
    expect(request.messages[1]?.images).toEqual([{ mediaType: 'image/png', data: 'aGVsbG8=' }])
    expect(request.tools.map((t) => t.name)).toEqual(['record_document'])
  })
})

describe('readingMismatches', () => {
  it('names the fields where the guest typed something the document does not say', () => {
    const reading = interpretReading({ mrzLines: TD3 }, null, NOW)

    expect(
      readingMismatches(
        {
          surname: 'Eriksson',
          givenName: 'Anna Maria',
          birthDate: '1974-08-21',
          documentNumber: 'L898902C3',
        },
        reading,
      ),
    ).toEqual(['birthDate'])
  })

  it('ignores case, accents and spacing — "Anna-Maria" and "ANNA MARIA" agree', () => {
    const reading = interpretReading({ mrzLines: TD3 }, null, NOW)
    expect(readingMismatches({ surname: 'eriksson', givenName: 'Anna-Maria' }, reading)).toEqual([])
  })
})
