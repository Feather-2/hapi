/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 * and collaboration mode switching.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { z } from "zod";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";

export interface HappyServerOptions {
    client: ApiSessionClient;
    onSwitchMode?: (mode: string) => { success: boolean; error?: string };
    getCurrentMode?: () => string;
}

export async function startHappyServer(clientOrOpts: ApiSessionClient | HappyServerOptions) {
    const opts: HappyServerOptions = 'client' in clientOrOpts
        ? clientOrOpts as HappyServerOptions
        : { client: clientOrOpts as ApiSessionClient };
    const { client, onSwitchMode, getCurrentMode } = opts;

    // Handler that sends title updates via the client
    const handler = async (title: string) => {
        logger.debug('[hapiMCP] Changing title to:', title);
        try {
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: title,
                leafUuid: randomUUID()
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    // Avoid TS instantiation depth issues by widening the schema type.
    const changeTitleInputSchema: z.ZodTypeAny = z.object({
        title: z.string().describe('The new title for the chat session'),
    });

    mcp.registerTool<any, any>('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
        logger.debug('[hapiMCP] Response:', response);

        if (response.success) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Successfully changed chat title to: "${args.title}"`,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    // switch_mode tool: allows AI to request collaboration mode transitions
    const switchModeInputSchema: z.ZodTypeAny = z.object({
        mode: z.enum(['code', 'plan', 'review']).describe('The collaboration mode to switch to'),
        reason: z.string().optional().describe('Why the mode switch is needed'),
    });

    mcp.registerTool<any, any>('switch_mode', {
        description: 'Switch the collaboration mode of the current session. Call this when you have finished planning and want to switch to code mode for implementation, or when you need to switch to plan or review mode.',
        title: 'Switch Collaboration Mode',
        inputSchema: switchModeInputSchema,
    }, async (args: { mode: string; reason?: string }) => {
        logger.debug(`[hapiMCP] switch_mode requested: ${args.mode} (reason: ${args.reason || 'none'})`);
        if (!onSwitchMode) {
            return {
                content: [{ type: 'text' as const, text: 'Mode switching is not available in this session.' }],
                isError: true,
            };
        }
        const result = onSwitchMode(args.mode);
        if (result.success) {
            return {
                content: [{ type: 'text' as const, text: `Switched collaboration mode to: ${args.mode}` }],
                isError: false,
            };
        }
        return {
            content: [{ type: 'text' as const, text: `Failed to switch mode: ${result.error || 'Unknown error'}` }],
            isError: true,
        };
    });

    // get_current_mode tool: allows AI to query the current collaboration mode
    mcp.registerTool<any, any>('get_current_mode', {
        description: 'Get the current collaboration mode of this session. Returns one of: code, plan, review.',
        title: 'Get Current Collaboration Mode',
        inputSchema: z.object({}) as z.ZodTypeAny,
    }, async () => {
        const mode = getCurrentMode ? getCurrentMode() : 'code';
        return {
            content: [{ type: 'text' as const, text: `Current collaboration mode: ${mode}` }],
            isError: false,
        };
    });

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames: ['change_title', 'switch_mode', 'get_current_mode'],
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
