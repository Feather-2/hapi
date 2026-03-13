import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

describe('SessionCache.mergeSessions', () => {
    it('preserves native resume ids when resumed session metadata is still incomplete', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const oldSession = cache.getOrCreateSession(
            'session-old',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                claudeSessionId: 'claude-session-old',
                codexSessionId: 'codex-session-old',
                geminiSessionId: 'gemini-session-old',
                opencodeSessionId: 'opencode-session-old',
                cursorSessionId: 'cursor-session-old'
            },
            {},
            'default'
        )

        const newSession = cache.getOrCreateSession(
            'session-new',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude'
            },
            {},
            'default'
        )

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        const metadata = merged?.metadata as Record<string, unknown> | null

        expect(metadata?.claudeSessionId).toBe('claude-session-old')
        expect(metadata?.codexSessionId).toBe('codex-session-old')
        expect(metadata?.geminiSessionId).toBe('gemini-session-old')
        expect(metadata?.opencodeSessionId).toBe('opencode-session-old')
        expect(metadata?.cursorSessionId).toBe('cursor-session-old')
    })

    it('does not overwrite a newer native resume id already present on the resumed session', async () => {
        const store = new Store(':memory:')
        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))

        const oldSession = cache.getOrCreateSession(
            'session-old',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                claudeSessionId: 'claude-session-old'
            },
            {},
            'default'
        )

        const newSession = cache.getOrCreateSession(
            'session-new',
            {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'claude',
                claudeSessionId: 'claude-session-new'
            },
            {},
            'default'
        )

        await cache.mergeSessions(oldSession.id, newSession.id, 'default')

        const merged = cache.getSession(newSession.id)
        const metadata = merged?.metadata as Record<string, unknown> | null

        expect(metadata?.claudeSessionId).toBe('claude-session-new')
    })
})
