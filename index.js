import { Anthropic } from "@anthropic-ai/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import fs from "fs";


dotenv.config(); // load environment variables from .env


const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set");
}

class MCPClient {
  constructor() {
    // Initialize Anthropic client and MCP client
    this.anthropic = new Anthropic({
      apiKey: ANTHROPIC_API_KEY,
    });
    this.mcpClient = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.stidoClientTransport = null;
    this.tools = [];
  }

  // The mcp server is like:
  async connectToServer(serverName, mcpServerConfig) {
    try {
      // Initialize transport and connect to server
      this.stidoClientTransport = new StdioClientTransport({
        command: mcpServerConfig.command,
        args: mcpServerConfig.args,
      });

      // Connect!
      await this.mcpClient.connect(this.stidoClientTransport);

      // List available tools
      const toolsResult = await this.mcpClient.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });

      console.log("Connected to server: " + serverName);
      console.log("Listing tools: ", JSON.stringify(this.tools, null, 2));
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async processQuery(query) {
    const messages = [
      {
        role: "user",
        content: query,
      },
    ];

    // Initial Claude API call
    const response = await this.anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1000,
      messages,
      tools: this.tools,
    });

    // Process response and handle tool calls
    const finalText = [];
    const toolResults = [];

    for (const content of response.content) {
      if (content.type === "text") {
        finalText.push(content.text);
      } else if (content.type === "tool_use") {
        // Execute tool call
        const toolName = content.name;
        const toolArgs = content.input;

        const result = await this.mcpClient.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        toolResults.push(result);
        finalText.push(
          `[Calling tool ${toolName} with args ${JSON.stringify(toolArgs)}]`,
        );

        // Continue conversation with tool results
        messages.push({
          role: "user",
          content: result.content,
        });

        // Get next response from Claude
        const response2 = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1000,
          messages,
        });

        finalText.push(
          response2.content[0].type === "text" ? response2.content[0].text : "",
        );
      }
    }

    return finalText.join("\n");
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      console.log("\nMCP Client Started!");
      console.log("Type your queries or 'quit' to exit.");

      while (true) {
        const message = await rl.question("\nQuery: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log("\n" + response);
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcpClient.close();
  }
}

async function main() {
  let mcpServers = [];

  // Read mcpServers from JSON `mcp_config.json` file
  try {
    const mcpConfig = JSON.parse(
      await fs.promises.readFile("mcp_config.json", "utf-8"),
    );
    console.log("MCP Config: ", JSON.stringify(mcpConfig, null, 2));

    mcpServers = mcpConfig.mcpServers;
    if (!mcpServers || mcpServers.length === 0) {
      throw new Error("No MCP servers found.");
    }
  } catch (e) {
    console.error("Failed to read mcp_config.json: ", e);
    process.exit(1);
  }

  const mcpClient = new MCPClient();
  try {
    for (let mcpServer in mcpServers) {
      console.log("Connecting to MCP server: ", mcpServer);
      const mcpServerConfig = mcpServers[mcpServer];
      console.log("Server config: ", mcpServerConfig);
      await mcpClient.connectToServer(mcpServer, mcpServerConfig);
    }
    
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
