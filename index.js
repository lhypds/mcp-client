import { Anthropic } from "@anthropic-ai/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import { loadMcpConfig } from "./utils/mcpUtils.js";


dotenv.config(); // load environment variables from .env
const model = "claude-3-5-sonnet-20241022";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});


class MCPClient {
  constructor() {
    this.servers = new Map();
    this.tools = [];
  }

  // The mcp server is like:
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

  async callTool(toolName, toolArgs) {
    // Find server, and use the correct one to call the tool
    let callServer = null;
    // Loop through servers to find the one that has the tool
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
    await this.client.close();
  }
}

async function main() {
  let mcpClient;
  try {
    const mcpServerConfigs = await loadMcpConfig();
    
    // Initialize MCP client
    mcpClient = new MCPClient();
    for (let mcpServerConfig in mcpServerConfigs) {
      const serverConfig = mcpServerConfigs[mcpServerConfig];
      await mcpClient.connectToServer(mcpServerConfig, serverConfig);
    }
    
    // Start a chat loop
    while (true) {
      const userInput = await rl.question(model + "> ");
      
      // Process query
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: userInput,
        }],
        tools: mcpClient.tools,
      });

      // Process response and handle tool calls
      const textResults = [];
      const toolResults = [];
      for (const content of response.content) {
        if (content.type === "text") {
          textResults.push(content.text);
        }
        
        if (content.type === "tool_use") {
          // Execute tool call
          const toolName = content.name;
          const toolArgs = content.input;

          const result = await this.callTool(toolName, toolArgs);

          toolResults.push(result);
          textResults.push(
            `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
          );

          // Continue conversation with tool results
          messages.push({
            role: "user",
            content: result.content,
          });

          // Get next response from Claude
          const response2 = await anthropic.messages.create({
            model: "claude-3-5-sonnet-20241022",
            max_tokens: 1000,
            messages,
          });

          textResults.push(
            response2.content[0].type === "text" ? response2.content[0].text : "",
          );
        }
      }
      console.log(textResults.join("\n").trim() + "\n");
    }
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  } finally {
    if (mcpClient) await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
