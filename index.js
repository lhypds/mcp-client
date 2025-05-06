import { Anthropic } from "@anthropic-ai/sdk";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import readline from "readline/promises";
import dotenv from "dotenv";
import fs from "fs";


dotenv.config(); // load environment variables from .env
const model = "claude-3-5-sonnet-20241022";


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

    this.client = new Client({ name: "mcp-client-cli", version: "1.0.0" });
    this.stidoClientTransport = null;
    
    this.tools = [];
    this.toolsServerMap = new Map(); // Map to store tools and their server
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
      console.log("Connecting to server: " + serverName + ", server config: " + JSON.stringify(mcpServerConfig, null, 2));
      await this.client.connect(this.stidoClientTransport);
      console.log("Connected.");
    } catch (e) {
      console.log("Failed to connect to MCP server: ", e);
      throw e;
    }
  }

  async detectNewTools() {
    // List available tools in current server
    const toolsResult = await this.client.listTools();
    const currentServerTools = toolsResult.tools.map((tool) => {
      return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };
    });

    // Check current tools list
    // If the tool is already in the list, skip adding it
    for (const tool of currentServerTools) {
      if (!this.tools.some((t) => t.name === tool.name)) {
        console.log("New tool detected: " + JSON.stringify(tool, null, 2)); 
        this.tools.push(tool);
        this.toolsServerMap.set(tool.name, this.currentServerName); // Map tool to server
      }
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
      model: model,
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

        const result = await this.client.callTool({
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
      console.log("\nChat loop started.");
      console.log("Available tools: ");
      this.tools.forEach((tool) => {
        console.log(`${tool.name}: ${tool.description}`);
      });

      console.log("\nType your queries or 'quit' to exit.");
      while (true) {
        const message = await rl.question(model + ">: ");
        if (message.toLowerCase() === "quit") {
          break;
        }
        const response = await this.processQuery(message);
        console.log(response.trim() + "\n");
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.client.close();
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
      await mcpClient.detectNewTools();
    }
    
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

main();
