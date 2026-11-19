import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpAuthContext } from './auth';
import { executeCapability, HubError } from '@/lib/hub/core';
import { CAPABILITIES } from '@/lib/hub/registry';

// Adapter MCP: każda zdolność z rejestru Data Hub staje się narzędziem MCP
// (tylko odczyt). Walidacja, zakres sklepów i audyt — w executeCapability.

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function registerTools(server: McpServer, auth: McpAuthContext): void {
  for (const cap of CAPABILITIES) {
    server.registerTool(cap.name, {
      title: cap.title,
      description: cap.description,
      inputSchema: cap.input,
      annotations: READ_ONLY,
    }, async (args: Record<string, unknown>) => {
      try {
        const payload = await executeCapability(cap, auth, args, 'mcp');
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload };
      } catch (err) {
        const message = err instanceof HubError || err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Błąd: ${message}` }], isError: true };
      }
    });
  }
}
