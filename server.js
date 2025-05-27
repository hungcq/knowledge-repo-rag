import express from 'express';
import {Server} from 'socket.io';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import {Server as HttpServer} from 'http';

// Load environment variables from .env file
dotenv.config();

const openai = new OpenAI();

const app = express();
const server = HttpServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow frontend to connect
  },
});

let assistant = await openai.beta.assistants.create({
  name: 'hungcq knowledge repo assistant',
  instructions: 'Use your knowledge base to answer questions.',
  model: 'gpt-4o-mini',
  tools: [{type: 'file_search'}],
});

await openai.beta.assistants.update(assistant.id, {
  tool_resources: {file_search: {vector_store_ids: ['vs_ewunN7laFAOw6m8mEOF5jixY']}},
});

// Handle WebSocket connections
io.on('connection', async (socket) => {
  console.log('A user connected');

  const thread = await openai.beta.threads.create();

  // Listen for 'message' events from the frontend
  socket.on('message', async (msg) => {
    console.log(msg);
    try {
      // Send user message to OpenAI
      const message = await openai.beta.threads.messages.create(
          thread.id,
          {
            role: 'user',
            content: msg,
          },
      );

      openai.beta.threads.runs.stream(thread.id, {
        assistant_id: assistant.id,
      }).
          on('textCreated', () => {}).
          on('toolCallCreated',
              (event) => console.log('assistant ' + event.type)).
          on('messageDone', async (event) => {
            if (event.content[0].type !== 'text') {
              return;
            }
            const {text} = event.content[0];
            const {annotations} = text;
            let output = text.value
            if (!annotations) {
              socket.emit('message', output);
              return;
            }

            let index = 0;
            for (let annotation of annotations) {
              output = output.replace(annotation.text, '[' + index + ']');
              const {file_citation} = annotation;
              if (file_citation) {
                const citedFile = await openai.files.retrieve(
                    file_citation.file_id);
                output = output.replace('[' + index + ']',
                    ' (source: ' + citedFile.filename + ')');
              }
              index++;
            }
            socket.emit('message', output);
          });
    } catch (error) {
      console.error('Error:', error);
      socket.emit('message', 'Error occurred');
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start the server
server.listen(1918, () => {
  console.log('Server running');
});
