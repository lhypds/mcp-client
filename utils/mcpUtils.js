import fs from 'fs';


export async function loadMcpConfig(configPath = "mcp_config.json") {
  try {
    const config = JSON.parse(
      await fs.promises.readFile(configPath, "utf-8"),
    );
    const mcpServerConfigs = config.mcpServers;
    
    if (!mcpServerConfigs || mcpServerConfigs.length === 0) {
      throw new Error("No MCP servers found.");
    }
    
    return mcpServerConfigs;
  } catch (e) {
    console.error(`Failed to load MCP config: ${e.message}`);
    throw e;
  }
}