import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { logger } from "@/lib";
import type { SDKMessage, SDKAssistantMessage } from '@/claude/sdk';

export interface SmartContinueConfig {
    enabled: boolean;
    model: string;
    maxRetries: number;
    bufferSize: number;
    completionMarker: string;
    timeoutMs: number;
    continueMessage: string;
    provider?: 'anthropic' | 'openai' | 'gemini';
}

const DEFAULT_SMART_CONTINUE: SmartContinueConfig = {
    enabled: true,
    model: 'claude-haiku-4-5-20251001',
    maxRetries: 2,
    bufferSize: 5,
    completionMarker: '[CHECKPOINT_COMPLETE]',
    timeoutMs: 8000,
    continueMessage: '好的，请你继续来写。你在完成任务之前停下了，请从你停止的地方继续。',
};

const ASSESSMENT_PROMPT = `You are a task completion detector. Given the recent AI assistant output below, determine if the task is DONE or NOT_DONE.

Rules:
- DONE = explicit completion summary, all steps finished, or user-facing final report
- NOT_DONE = mid-step, partial work, no conclusion, or stopped abruptly

Respond with exactly one word: DONE or NOT_DONE`;

const DEFAULT_MODELS: Record<string, string> = {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
};

type ProviderConfig = {
    provider: string;
    apiKey: string;
    baseUrl: string;
    model: string;
};

function detectProvider(config: SmartContinueConfig): ProviderConfig | null {
    if (config.provider === 'anthropic') {
        const apiKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
        if (apiKey) {
            return {
                provider: 'anthropic',
                apiKey,
                baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
                model: config.model || DEFAULT_MODELS.anthropic,
            };
        }
    }
    if (config.provider === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY || '';
        if (apiKey) {
            return {
                provider: 'openai',
                apiKey,
                baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
                model: config.model || DEFAULT_MODELS.openai,
            };
        }
    }
    if (config.provider === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
        if (apiKey) {
            return {
                provider: 'gemini',
                apiKey,
                baseUrl: 'https://generativelanguage.googleapis.com',
                model: config.model || DEFAULT_MODELS.gemini,
            };
        }
    }

    // Auto-detect: try each provider in order
    const anthropicKey = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '';
    if (anthropicKey) {
        return {
            provider: 'anthropic',
            apiKey: anthropicKey,
            baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
            model: config.model.startsWith('claude') ? config.model : DEFAULT_MODELS.anthropic,
        };
    }

    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (openaiKey) {
        return {
            provider: 'openai',
            apiKey: openaiKey,
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
            model: config.model.startsWith('gpt') ? config.model : DEFAULT_MODELS.openai,
        };
    }

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    if (geminiKey) {
        return {
            provider: 'gemini',
            apiKey: geminiKey,
            baseUrl: 'https://generativelanguage.googleapis.com',
            model: config.model.startsWith('gemini') ? config.model : DEFAULT_MODELS.gemini,
        };
    }

    return null;
}

async function callAnthropic(pc: ProviderConfig, prompt: string, timeoutMs: number): Promise<string> {
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
    });
    if (!resp.ok) throw new Error(`Anthropic API returned ${resp.status}`);
    const data = await resp.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text?.trim().toUpperCase() ?? '';
}

async function callOpenAI(pc: ProviderConfig, prompt: string, timeoutMs: number): Promise<string> {
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
    });
    if (!resp.ok) throw new Error(`OpenAI API returned ${resp.status}`);
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? '';
}

async function callGemini(pc: ProviderConfig, prompt: string, timeoutMs: number): Promise<string> {
    const url = `${pc.baseUrl}/v1beta/models/${pc.model}:generateContent?key=${pc.apiKey}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) throw new Error(`Gemini API returned ${resp.status}`);
    const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase() ?? '';
}

export function loadCheckpointConfig(cwd: string): SmartContinueConfig | null {
    try {
        const currentFile = join(cwd, '.checkpoints', 'current');
        if (!existsSync(currentFile)) return null;
        const threadId = readFileSync(currentFile, 'utf-8').trim();
        if (!threadId) return null;

        const threadJsonPath = join(cwd, '.checkpoints', 'threads', threadId, 'thread.json');
        if (existsSync(threadJsonPath)) {
            const threadData = JSON.parse(readFileSync(threadJsonPath, 'utf-8'));
            const sc = threadData?.config?.smartContinue;
            if (sc) {
                return {
                    enabled: sc.enabled ?? DEFAULT_SMART_CONTINUE.enabled,
                    model: sc.model ?? DEFAULT_SMART_CONTINUE.model,
                    maxRetries: sc.maxRetries ?? DEFAULT_SMART_CONTINUE.maxRetries,
                    bufferSize: sc.bufferSize ?? DEFAULT_SMART_CONTINUE.bufferSize,
                    completionMarker: sc.completionMarker ?? DEFAULT_SMART_CONTINUE.completionMarker,
                    timeoutMs: sc.timeoutMs ?? DEFAULT_SMART_CONTINUE.timeoutMs,
                    continueMessage: sc.continueMessage ?? DEFAULT_SMART_CONTINUE.continueMessage,
                    provider: sc.provider,
                };
            }
        }

        return { ...DEFAULT_SMART_CONTINUE };
    } catch {
        return null;
    }
}

export function extractAssistantText(message: SDKMessage): string | null {
    if (message.type !== 'assistant') return null;
    const assistantMsg = message as SDKAssistantMessage;
    const texts: string[] = [];
    for (const block of assistantMsg.message?.content ?? []) {
        if (block.type === 'text' && block.text) {
            texts.push(block.text);
        }
    }
    return texts.length > 0 ? texts.join('\n') : null;
}

export async function assessTaskCompletion(recentTexts: string[], config: SmartContinueConfig): Promise<boolean> {
    const pc = detectProvider(config);
    if (!pc) {
        logger.debug('[smartContinue] No API key available for assessment, assuming not done');
        return false;
    }

    const context = recentTexts.join('\n---\n').slice(-3000);
    const prompt = `${ASSESSMENT_PROMPT}\n\n<recent_output>\n${context}\n</recent_output>`;

    const callers: Record<string, typeof callAnthropic> = {
        anthropic: callAnthropic,
        openai: callOpenAI,
        gemini: callGemini,
    };
    const caller = callers[pc.provider];
    if (!caller) {
        logger.debug(`[smartContinue] Unknown provider: ${pc.provider}`);
        return false;
    }

    try {
        logger.debug(`[smartContinue] Assessing via ${pc.provider} (${pc.model})`);
        const answer = await caller(pc, prompt, config.timeoutMs);
        logger.debug(`[smartContinue] Assessment result: ${answer}`);
        return answer === 'DONE';
    } catch (err) {
        logger.debug(`[smartContinue] Assessment failed (${pc.provider}): ${err}`);
        return false;
    }
}
