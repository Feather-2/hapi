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
    You have access to functions.hapi__switch_mode to switch collaboration modes.
    When you finish planning and are ready to implement, call functions.hapi__switch_mode with mode "code".
    When you need to review code, call it with mode "review".
    When you need to create a plan first, call it with mode "plan".
`);

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export const codexSystemPrompt = [TITLE_INSTRUCTION, MODE_SWITCH_INSTRUCTION].join('\n\n');
