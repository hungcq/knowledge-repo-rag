import {Agent, tool, RunContext, MCPServerSSE} from '@openai/agents';
import {kbSearchToolDefinition} from '../tools/kbSearch.js';
import {geminiKnowledgeToolDefinition} from "./geminiKnowledgeAgent.js";
import {CHAT_MODEL} from "../config/index.js";

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

// Create the Gemini knowledge tool (with multimodal vision capabilities)
const geminiKnowledgeTool = tool(geminiKnowledgeToolDefinition);

// Create the kb_search tool for the knowledge agent
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
    const baseInstructions = `You are a routing assistant that helps users with both knowledge base queries and photo searches.

You have access to:
1. gemini_knowledge_search tool: For knowledge questions, documentation, technical queries, diagrams, and educational content from the knowledge base (with multimodal vision capabilities)
   - Parameters: query (required), summary (optional - pass conversation context if available)
2. photoAgent handoff: For finding personal photos and images from photo albums

ROUTING RULES:
- Use gemini_knowledge_search tool for: questions, documentation, technical help, general knowledge, diagrams, architecture images, flowcharts - anything from the knowledge base
- Use handoff to photoAgent for: finding personal photos, family pictures, vacation photos, personal album images - anything from personal photo albums

IMPORTANT DISTINCTIONS:
- Knowledge base diagrams/images (technical, educational): Use gemini_knowledge_search tool
- Personal photos/albums (memories, events): Use photoAgent handoff

CONTEXT HANDLING:
- When calling gemini_knowledge_search, include the summary parameter with conversation context if available
- This helps provide better, more contextual responses

You can use BOTH the tool and handoff if the query involves both knowledge base content and personal photos. In that case, synthesize the results.

Always provide helpful responses by using the appropriate tool or delegating to the appropriate agent.`;

    return summary
      ? `${baseInstructions}\n\nConversation summary so far (for context only, do not repeat verbatim):\n${summary}`
      : baseInstructions;
  },
  model: CHAT_MODEL,
  tools: [geminiKnowledgeTool],
  handoffs: [photoAgent]
});
