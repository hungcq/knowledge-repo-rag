import {z} from 'zod';
import {kb_search, kbSearchToolDefinition} from '../tools/kbSearch.js';
import {GEMINI_MODEL} from '../config/index.js';

// LangChain imports
import {ChatGoogleGenerativeAI} from '@langchain/google-genai';
import {tool} from "@langchain/core/tools";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import {concat} from "@langchain/core/utils/stream";

// Types
interface ChatContext {
  summary: string | null;
}

const geminiKnowledgeSchema = z.object({
  query: z.string().describe('The user query to answer using the knowledge base with multimodal understanding'),
  summary: z.string().optional().nullable().describe('Optional conversation summary for context'),
});
type GeminiKnowledgeParams = z.infer<typeof geminiKnowledgeSchema>;

/**
 * LangChain Tool wrapper around your existing kbSearchToolDefinition.execute(...)
 * The tool returns a JSON string so the model/agent can inspect structured results.
 */
const kbTool = tool(
  kb_search,
  {
    name: kbSearchToolDefinition.name,
    description: kbSearchToolDefinition.description,
    schema: kbSearchToolDefinition.parameters,
  }
);

const toolsByName: Record<string, any> = {
  kb_search: kbTool,
};

/**
 * GeminiKnowledgeAgent implemented using LangChain + ChatGoogleGenerativeAI
 */
export class GeminiKnowledgeAgent {
  private context: ChatContext;
  private llm;

  constructor(context: ChatContext = {summary: null}) {
    this.context = context;
    this.llm = new ChatGoogleGenerativeAI({
      model: GEMINI_MODEL,
    }).bindTools([kbTool]);
  }

  private getInstructions(): string {
    const baseInstructions = `You are a knowledge assistant with multimodal understanding that helps users find information from the knowledge base, including both text content and diagrams/images.

You have access to:
1) Your own parametric knowledge.
2) The kb_search tool (returns both text passages and images with {type, title, url, snippet, mimeType}).

MANDATORY RULES:
- You MUST ALWAYS call the kb_search tool for EVERY user query, regardless of how simple or complex it is.
- Search the knowledge base first, then provide your response based on both the KB results and your knowledge.

HANDLING RESULTS:
- For text results (type="text"): Use the snippet content and cite it inline like: (source: [Title](URL))
- For image results (type="image"):
  * FETCH AND VIEW the image from the URL provided
  * Analyze the image content using your vision capabilities
  * Describe what you see in the image and how it relates to the query
  * Display the image using HTML img tags: <img src="URL" alt="Title" style="max-width: 600px; height: auto;"/>
- When an image is relevant, ALWAYS fetch, analyze, and display it in your response
- Combine text and images naturally in your response when both are relevant

MULTIMODAL CAPABILITIES:
- You can VIEW and UNDERSTAND images from URLs
- Analyze diagrams, flowcharts, architecture diagrams, and screenshots
- Explain visual content and relate it to the user's question
- Compare information from text and images

CITATION RULES:
- If you use any KB content, cite it inline like: (source: [Title](URL))
- Do NOT invent URLs or titles
- If the KB doesn't contain relevant information, provide your best answer from your knowledge
- Be concise and correct`;

    return this.context.summary
      ? `${baseInstructions}\n\nConversation summary so far (for context only, do not repeat verbatim):\n${this.context.summary}`
      : baseInstructions;
  }

  async chat(userMessage: string): Promise<string> {
    const messages: BaseMessage[] = [
      new SystemMessage(this.getInstructions()),
      new HumanMessage(userMessage)
    ];
    while (true) {
      const aiMessage = await this.llm.invoke(messages);
      messages.push(aiMessage);

      if (aiMessage.tool_calls?.length === 0) {
        return aiMessage.content as string;
      }

      for (const toolCall of aiMessage.tool_calls || []) {
        const selectedTool = toolsByName[toolCall.name];
        const toolMessage = await selectedTool.invoke(toolCall);
        messages.push(toolMessage);
      }
    }
  }

  async *chatStream(userMessage: string): AsyncGenerator<string, void, unknown> {
    const messages: BaseMessage[] = [
      new SystemMessage(this.getInstructions()),
      new HumanMessage(userMessage),
    ];

    while (true) {
      const stream = await this.llm.stream(messages);
      let gathered: AIMessageChunk | undefined = undefined;

      // Accumulate chunks and stream text content
      for await (const chunk of stream) {
        // Accumulate chunks using concat utility as per LangChain docs
        gathered = gathered !== undefined ? concat(gathered, chunk) : chunk;

        // Stream text content as it arrives
        if (typeof chunk.content === 'string') {
          yield chunk.content;
        }
      }

      if (!gathered) {
        break;
      }

      // Check if we have tool calls to execute
      const toolCalls = gathered.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // No tool calls, we're done
        break;
      }

      // First, add the AI message with tool calls to history
      messages.push(new AIMessage({
        content: gathered.content,
        tool_calls: toolCalls,
      }));

      // Execute tool calls and add results to history
      for (const toolCall of toolCalls) {
        toolsByName[toolCall.name].invoke(toolCall);
        const selectedTool = toolsByName[toolCall.name];
        const toolMessage = await selectedTool.invoke(toolCall);
        messages.push(toolMessage);
      }
    }
  }
}

/**
 * Thin tool wrapper to preserve your existing tool interface.
 */
async function gemini_knowledge_search({query, summary}: GeminiKnowledgeParams): Promise<string> {
  try {
    const agent = new GeminiKnowledgeAgent({summary: summary ?? null});
    return await agent.chat(query);
  } catch (err) {
    console.error('gemini_knowledge_search error', err);
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const geminiKnowledgeToolDefinition = {
  name: 'gemini_knowledge_search',
  description: 'Search the knowledge base and return answers with multimodal understanding (LangChain agent).',
  parameters: geminiKnowledgeSchema,
  execute: gemini_knowledge_search,
};
