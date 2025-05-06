import { Anthropic } from "@anthropic-ai/sdk";
import readline from "readline/promises";
import dotenv from "dotenv";
import { loadMcpConfig } from "./utils/mcpUtils.js";
import { MCPClient } from "./mcp.js";


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
    console.log("Type ':exit' to exit the chat.");
    while (true) {
      const userInput = await rl.question(model + "> ");
      if (userInput === ":exit") {
        break;
      }
      
      // Process query
      let messages = [
        {
          role: "user",
          content: userInput,
        },
      ];
      const response = await anthropic.messages.create({
        model: model,
        max_tokens: 1000,
        messages,
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

          const result = await mcpClient.callTool(toolName, toolArgs);

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
    if (mcpClient) {
      await mcpClient.cleanup();
    }
    process.exit(0);
  }
}

main();
