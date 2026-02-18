/**
 * Disconnect Assessor
 *
 * Evaluates whether a session disconnect was abnormal and should trigger auto-reconnect.
 * Uses lightweight AI assessment when the disconnect reason is ambiguous.
 */

import type { DisconnectDiagnostic } from './syncEngine'

export type DisconnectAssessment = {
    shouldReconnect: boolean
    reason: string
    confidence: 'high' | 'medium' | 'low'
    assessmentMethod: 'rule' | 'ai'
}

type ProviderConfig = {
    provider: string
    apiKey: string
    baseUrl: string
    model: string
}

const ASSESSMENT_PROMPT = `You are a session disconnect analyzer. Given the session context below, determine if the AI session was interrupted abnormally (NOT_DONE) or completed its work normally (DONE).

Rules:
- NOT_DONE = session was mid-task, partial output, abrupt stop, no conclusion
- DONE = explicit completion summary, all steps finished, user-facing final report, or session was idle

Respond with exactly one word: DONE or NOT_DONE`

const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
}

function detectProvider(): ProviderConfig | null {
    const anthropicKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || ''
    if (anthropicKey) {
        return {
            provider: 'anthropic',
            apiKey: anthropicKey,
            baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
            model: DEFAULT_MODELS.anthropic,
        }
    }

    const openaiKey = process.env.OPENAI_API_KEY || ''
    if (openaiKey) {
        return {
            provider: 'openai',
            apiKey: openaiKey,
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
            model: DEFAULT_MODELS.openai,
        }
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
    if (geminiKey) {
        return {
            provider: 'gemini',
            apiKey: geminiKey,
            baseUrl: 'https://generativelanguage.googleapis.com',
            model: DEFAULT_MODELS.gemini,
        }
    }

    return null
}

async function callProvider(pc: ProviderConfig, prompt: string, timeoutMs: number = 8000): Promise<string> {
    if (pc.provider === 'anthropic') {
        const resp = await fetch(`${pc.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': pc.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: pc.model,
                max_tokens: 10,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!resp.ok) throw new Error(`Anthropic API returned ${resp.status}`)
        const data = await resp.json() as { content?: Array<{ text?: string }> }
        return data.content?.[0]?.text?.trim().toUpperCase() ?? ''
    }

    if (pc.provider === 'openai') {
        const resp = await fetch(`${pc.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${pc.apiKey}`,
            },
            body: JSON.stringify({
                model: pc.model,
                max_tokens: 10,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!resp.ok) throw new Error(`OpenAI API returned ${resp.status}`)
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> }
        return data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? ''
    }

    if (pc.provider === 'gemini') {
        const url = `${pc.baseUrl}/v1beta/models/${pc.model}:generateContent?key=${pc.apiKey}`
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 10 },
            }),
            signal: AbortSignal.timeout(timeoutMs),
        })
        if (!resp.ok) throw new Error(`Gemini API returned ${resp.status}`)
        const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? ''
    }

    throw new Error(`Unknown provider: ${pc.provider}`)
}

function extractContentPreview(content: unknown): string {
    if (typeof content === 'string') return content.slice(-2000)
    if (content && typeof content === 'object') {
        try {
            const str = JSON.stringify(content)
            return str.slice(-2000)
        } catch {
            return '[unparseable]'
        }
    }
    return '[empty]'
}

/**
 * Rule-based assessment for high-confidence cases.
 * Returns null if AI assessment is needed.
 */
function assessByRules(diagnostic: DisconnectDiagnostic): DisconnectAssessment | null {
    // Session was actively thinking → almost certainly abnormal
    if (diagnostic.wasThinking) {
        return {
            shouldReconnect: true,
            reason: `Session was actively thinking when disconnected (reason: ${diagnostic.reason})`,
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Very short connection (< 5s) → likely startup failure, don't auto-reconnect
    if (diagnostic.connectionDurationMs < 5000) {
        return {
            shouldReconnect: false,
            reason: `Connection too short (${diagnostic.connectionDurationMs}ms), likely startup failure`,
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Transport close with active session → network issue, reconnect
    if (diagnostic.reason === 'transport close' && diagnostic.wasActive) {
        return {
            shouldReconnect: true,
            reason: 'Transport closed while session was active',
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Ping timeout with active session → network issue, reconnect
    if (diagnostic.reason === 'ping timeout' && diagnostic.wasActive) {
        return {
            shouldReconnect: true,
            reason: 'Ping timeout while session was active',
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Server-initiated disconnect → intentional, don't reconnect
    if (diagnostic.reason === 'server namespace disconnect' || diagnostic.reason === 'client namespace disconnect') {
        return {
            shouldReconnect: false,
            reason: `Intentional disconnect: ${diagnostic.reason}`,
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Session was not active → already ended, don't reconnect
    if (!diagnostic.wasActive) {
        return {
            shouldReconnect: false,
            reason: 'Session was not active at disconnect time',
            confidence: 'high',
            assessmentMethod: 'rule',
        }
    }

    // Ambiguous case → need AI assessment
    return null
}

/**
 * AI-based assessment for ambiguous cases.
 */
async function assessByAI(diagnostic: DisconnectDiagnostic): Promise<DisconnectAssessment> {
    const pc = detectProvider()
    if (!pc) {
        // No API key → fallback: reconnect if active (safe default)
        return {
            shouldReconnect: diagnostic.wasActive,
            reason: 'No AI provider available, defaulting based on active state',
            confidence: 'low',
            assessmentMethod: 'ai',
        }
    }

    const contentPreview = diagnostic.lastMessage
        ? extractContentPreview(diagnostic.lastMessage.content)
        : '[no message available]'

    const context = [
        `Disconnect reason: ${diagnostic.reason}`,
        `Was thinking: ${diagnostic.wasThinking}`,
        `Was active: ${diagnostic.wasActive}`,
        `Connection duration: ${Math.round(diagnostic.connectionDurationMs / 1000)}s`,
        `Session path: ${diagnostic.sessionMeta?.path ?? 'unknown'}`,
        `Last message preview:`,
        contentPreview,
    ].join('\n')

    const prompt = `${ASSESSMENT_PROMPT}\n\n<session_context>\n${context}\n</session_context>`

    try {
        const answer = await callProvider(pc, prompt)
        const isDone = answer === 'DONE'
        return {
            shouldReconnect: !isDone,
            reason: isDone
                ? 'AI assessment: task was completed before disconnect'
                : 'AI assessment: task was interrupted, reconnection needed',
            confidence: 'medium',
            assessmentMethod: 'ai',
        }
    } catch (err) {
        // AI failed → safe default: reconnect if was active
        return {
            shouldReconnect: diagnostic.wasActive,
            reason: `AI assessment failed (${err}), defaulting based on active state`,
            confidence: 'low',
            assessmentMethod: 'ai',
        }
    }
}

/**
 * Assess a disconnect event and decide whether to auto-reconnect.
 * Uses rules first for high-confidence cases, falls back to AI.
 */
export async function assessDisconnect(diagnostic: DisconnectDiagnostic): Promise<DisconnectAssessment> {
    const ruleResult = assessByRules(diagnostic)
    if (ruleResult) {
        return ruleResult
    }
    return await assessByAI(diagnostic)
}
