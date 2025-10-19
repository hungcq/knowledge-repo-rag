import { Agent, tool, RunContext, MCPServerStdio, handoff, MCPServerSSE } from '@openai/agents';
import { CHAT_MODEL } from '../config/index.js';
import { kbSearchToolDefinition } from '../tools/kbSearch.js';

interface ChatContext {
    summary: string | null;
}

// Create MCP server for photo album search
const photoAlbumMCPServer = new MCPServerSSE({
  url: process.env.MCP_SERVER_URL || 'https://multimodal-mcp.onrender.com/mcp',
  name: 'Photo Album Search Server',
  cacheToolsList: true,
});

// const photoAlbumMCPServer = new MCPServerStdio({
//     name: 'Photo Album Search Server',
//     command: 'npx',
//     args: ['ts-node', '/Users/hungcq/projects/multimodal-mcp/src/stdio-server.ts'],
//     env: {
//         WEAVIATE_URL: "p88qbrzns3aqczhmgputqw.c0.europe-west3.gcp.weaviate.cloud",
//         WEAVIATE_API_KEY: 'key'
//     },
//     cacheToolsList: true,
// });

await photoAlbumMCPServer.connect();

// Create the knowledge search tool
const kbSearchTool = tool(kbSearchToolDefinition);

// Knowledge-only agent
export const knowledgeAgent = new Agent<ChatContext>({
    name: 'Knowledge Assistant',
    instructions: (ctx: RunContext<ChatContext>) => {
        const summary = ctx.context?.summary;
        const baseInstructions = `You are a knowledge assistant that helps users find information from the knowledge base, including both text content and diagrams/images.

You have access to:
1) Your own parametric knowledge.
2) The kb_search tool (returns both text passages and images with {type, title, url, snippet, mimeType}).

MANDATORY RULES:
- You MUST ALWAYS call the kb_search tool for EVERY user query, regardless of how simple or complex it is.
- Search the knowledge base first, then provide your response based on both the KB results and your knowledge.

HANDLING RESULTS:
- For text results (type="text"): Use the snippet content and cite it inline like: (source: [Title](URL))
- For image results (type="image"): Display the image using HTML img tags: <img src="URL" alt="Title" style="max-width: 600px; height: auto;"/>
- When an image is relevant, ALWAYS display it in your response
- Combine text and images naturally in your response when both are relevant

CITATION RULES:
- If you use any KB content, cite it inline like: (source: [Title](URL))
- Do NOT invent URLs or titles
- If the KB doesn't contain relevant information, provide your best answer from your knowledge
- Be concise and correct`;

        return summary
            ? `${baseInstructions}\n\nConversation summary so far (for context only, do not repeat verbatim):\n${summary}`
            : baseInstructions;
    },
    model: CHAT_MODEL,
    tools: [kbSearchTool],
});

// Photo-only agent
const photoAgent = new Agent<ChatContext>({
    name: 'Photo Assistant',
    instructions: (ctx: RunContext<ChatContext>) => {
        const summary = ctx.context?.summary;
        const baseInstructions = `You are a photo assistant that helps users find photos and images from their photo albums.

You have access to:
1) Your own knowledge about photo organization and search.
2) Photo Album Search MCP Server tools for finding photos using natural language queries.

GUIDELINES:
- Use the Photo Album Search tools to find relevant photos based on the user's description.
- Help users refine their search queries if needed.
- Be helpful in suggesting alternative search terms if no results are found.
- Show the photo in the response as HTML tags (ie <img src=[source url]/>), never as a image tag (ie ![alt text]]([source url])).
- Provide context about the photos found when possible.`;

        return summary
            ? `${baseInstructions}\n\nConversation summary so far (for context only, do not repeat verbatim):\n${summary}`
            : baseInstructions;
    },
    model: CHAT_MODEL,
    mcpServers: [photoAlbumMCPServer],
});

// Create the routing agent that delegates to specialized agents
export const routingAgent = new Agent<ChatContext>({
    name: 'Routing Assistant',
    instructions: (ctx: RunContext<ChatContext>) => {
        const summary = ctx.context?.summary;
        const baseInstructions = `You are a routing assistant that determines which specialized agent should handle the user's query.

You have access to handoffs to two specialized agents:
1. knowledgeAgent: For general knowledge questions, documentation, technical queries, diagrams from the knowledge base (text and images)
2. photoAgent: For finding personal photos and images from photo albums

ROUTING RULES:
- Use handoff to knowledgeAgent for: questions, documentation, technical help, general knowledge, diagrams, architecture images, flowcharts - anything from the knowledge base
- Use handoff to photoAgent for: finding personal photos, family pictures, vacation photos, personal album images - anything from personal photo albums

IMPORTANT DISTINCTIONS:
- Knowledge base diagrams/images (technical, educational): Use knowledgeAgent
- Personal photos/albums (memories, events): Use photoAgent

You can handoff to BOTH agents if the query involves both knowledge base content and personal photos. In that case, synthesize the results from both agents.

Always provide helpful responses by delegating to the appropriate specialized agent(s).`;

        return summary
            ? `${baseInstructions}\n\nConversation summary so far (for context only, do not repeat verbatim):\n${summary}`
            : baseInstructions;
    },
    model: CHAT_MODEL,
    handoffs: [
        handoff(knowledgeAgent),
        handoff(photoAgent),
    ],
});
