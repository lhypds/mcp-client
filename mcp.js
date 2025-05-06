import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";


export class MCPClient {
  constructor() {
    this.servers = new Map();
    this.tools = [];  // global tools list
  }

  // Connect to MCP server
  async connectToServer(serverName, mcpServerConfig) {
    try {
      const client = new Client({ name: serverName, version: "0.0.1" });
      const transport = new StdioClientTransport({
        command: mcpServerConfig.command,
        args: mcpServerConfig.args,
      });

      await client.connect(transport);
      const toolsResult = await client.listTools();
      const tools = toolsResult.tools.map((tool) => {
        // Tools listing result parameter mapping
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema, // !important
        };
      });

      // Store server
      this.servers.set(serverName, {
        client: client,
        transport: transport,
        tools: tools,
      });

      // Store tool in global tools list
      this.tools = [...this.tools, ...tools];
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  // Call tool
  async callTool(toolName, toolArgs) {
    // Find server, and use the correct one to call the tool
    let callServer = null;
    for (let [, s] of this.servers) {
      if (s.tools.some((t) => t.name === toolName)) {
        callServer = s;
        break;
      }
    }

    if (!callServer) {
      throw new Error(`Server not found for tool: ${toolName}`);
    }
    
    const result = await callServer.client.callTool({
      name: toolName,
      arguments: toolArgs,
    });
    return result;
  }

  async cleanup() {
    for (let [, s] of this.servers) {
      await s.client.close();
      await s.transport.close();
    }
    this.servers.clear();
    this.tools = [];
  }
}