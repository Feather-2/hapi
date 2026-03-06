/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call hapi MCP tools for
 * session title management and collaboration mode switching.
 */

import { trimIdent } from '@/utils/trimIdent';

/**
 * Title instruction for Codex to call the hapi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.hapi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat, call the title tool to set a concise task title.
    Prefer calling functions.hapi__change_title.
    If that exact tool name is unavailable, call an equivalent alias such as hapi__change_title, mcp__hapi__change_title, or hapi_change_title.
    If the task focus changes significantly later, call the title tool again with a better title.
`);

/**
 * Mode switch instruction for Codex to call the hapi MCP tool.
 * Allows AI to semantically drive collaboration mode transitions.
 */
export const MODE_SWITCH_INSTRUCTION = trimIdent(`
    The default collaboration mode is "code". You can check the current mode at any time by calling functions.hapi__get_current_mode.
    You have access to functions.hapi__switch_mode to switch collaboration modes (code, plan, review).
    When the user asks you to switch to a specific mode, call functions.hapi__switch_mode immediately without additional conditions.
    You may also switch modes proactively based on workflow context:
    - When you finish planning and are ready to implement, switch to "code".
    - When you need to review code, switch to "review".
    - When you need to create a plan first, switch to "plan".
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = [TITLE_INSTRUCTION, MODE_SWITCH_INSTRUCTION].join('\n\n');
