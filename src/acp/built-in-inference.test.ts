import { describe, expect, test } from 'bun:test'
import { createBuiltInInference } from './built-in-inference'

describe('createBuiltInInference', () => {
  test('returns a function', () => {
    const inference = createBuiltInInference()
    expect(typeof inference).toBe('function')
  })

  test('yields a finish event with end_turn stop reason', async () => {
    const inference = createBuiltInInference()

    const events = []
    for await (const event of inference({
      messages: [{ role: 'user', content: 'Hello' }],
      modelId: 'test-model',
    })) {
      events.push(event)
    }

    expect(events).toEqual([{ type: 'finish', stopReason: 'end_turn' }])
  })

  test('ignores abort signal in placeholder implementation', async () => {
    const inference = createBuiltInInference()
    const abortController = new AbortController()

    const events = []
    for await (const event of inference({
      messages: [{ role: 'user', content: 'Hello' }],
      modelId: 'test-model',
      abortSignal: abortController.signal,
    })) {
      events.push(event)
    }

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('finish')
  })
})
