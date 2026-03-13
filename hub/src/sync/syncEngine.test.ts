import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

function createEngine() {
    const store = new Store(':memory:')
    const io = {
        of: () => ({
            to: () => ({
                emit: () => {}
            })
        })
    } as any
    const sseManager = {
        broadcast: () => {}
    } as any

    return new SyncEngine(store, io, new RpcRegistry(), sseManager)
}

describe('SyncEngine.resumeSession', () => {
    it('passes resume token as resumeSessionId instead of worktreeName', async () => {
        const engine = createEngine()

        try {
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'host-1', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const session = engine.getOrCreateSession(
                'session-tag',
                {
                    path: '/tmp/project',
                    host: 'host-1',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexSessionId: 'thread-resume-1'
                },
                {},
                'default'
            )

            let spawnArgs: unknown[] | null = null
            ;(engine as any).rpcGateway = {
                spawnSession: async (...args: unknown[]) => {
                    spawnArgs = args
                    return { type: 'success', sessionId: session.id }
                }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            expect(spawnArgs).not.toBeNull()
            if (!spawnArgs) {
                throw new Error('spawnSession was not called')
            }
            const capturedArgs = spawnArgs as unknown[]
            expect(capturedArgs.length).toBe(9)
            expect(capturedArgs[7]).toBeUndefined()
            expect(capturedArgs[8]).toBe('thread-resume-1')
        } finally {
            engine.stop()
        }
    })

    it('passes yolo when resuming a codex session that previously used yolo mode', async () => {
        const engine = createEngine()

        try {
            engine.getOrCreateMachine(
                'machine-1',
                { host: 'host-1', platform: 'linux', happyCliVersion: '0.1.0' },
                null,
                'default'
            )
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            const session = engine.getOrCreateSession(
                'session-tag-yolo',
                {
                    path: '/tmp/project',
                    host: 'host-1',
                    machineId: 'machine-1',
                    flavor: 'codex',
                    codexSessionId: 'thread-resume-yolo'
                },
                {},
                'default'
            )
            ;(engine as any).sessionCache.applySessionConfig(session.id, { permissionMode: 'yolo' })

            let spawnArgs: unknown[] | null = null
            ;(engine as any).rpcGateway = {
                spawnSession: async (...args: unknown[]) => {
                    spawnArgs = args
                    return { type: 'success', sessionId: session.id }
                }
            }
            ;(engine as any).waitForSessionActive = async () => true

            const result = await engine.resumeSession(session.id, 'default')

            expect(result).toEqual({ type: 'success', sessionId: session.id })
            if (!spawnArgs) {
                throw new Error('spawnSession was not called')
            }
            const capturedArgs = spawnArgs as unknown[]
            expect(capturedArgs[5]).toBe(true)
            expect(capturedArgs[8]).toBe('thread-resume-yolo')
        } finally {
            engine.stop()
        }
    })
})
