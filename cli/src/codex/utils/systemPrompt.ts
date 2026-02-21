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
    Based on this message, call functions.hapi__change_title to change chat session title that would represent the current task. If chat idea would change dramatically - call this function again to update the title.
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
