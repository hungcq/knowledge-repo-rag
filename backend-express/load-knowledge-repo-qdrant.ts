import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAI } from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

interface ChunkMetadata {
  file_path: string;
  file_name: string;
  section_header: string;
  chunk_index: number;
  total_chunks: number;
  reference_url: string;
  parent_section?: string;
  parent_content?: string;
}

interface MarkdownChunk {
  content: string;
  header: string;
  level: number;
  metadata: ChunkMetadata;
}

class KnowledgeRepoLoader {
  private qdrant: QdrantClient;
  private openai: OpenAI;
  private collectionName = 'knowledge-repo';
  private supportedExtensions = ['md'];
  private rootDir: string;

  constructor(rootDir: string) {
    this.qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
    });
    this.openai = new OpenAI();
    this.rootDir = rootDir;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Qdrant collection...');
    
    // Check if collection exists
    const collections = await this.qdrant.getCollections();
    const collectionExists = collections.collections.some(
      (col) => col.name === this.collectionName
    );

    if (collectionExists) {
      console.log(`Collection ${this.collectionName} already exists. Purging...`);
      await this.qdrant.deleteCollection(this.collectionName);
    }

    // Create collection
    await this.qdrant.createCollection(this.collectionName, {
      vectors: {
        size: 1536, // OpenAI embedding size
        distance: 'Cosine',
      },
    });

    console.log(`Collection ${this.collectionName} created successfully.`);
  }

  private getFilteredFilePaths(directory: string): string[] {
    const filteredFiles: string[] = [];
    
    const walkDir = (dir: string): void => {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else if (stat.isFile()) {
          const ext = path.extname(file).toLowerCase().slice(1);
          if (this.supportedExtensions.includes(ext)) {
            if (stat.size === 0) {
              console.log('File is empty:', filePath);
            } else {
              filteredFiles.push(filePath);
            }
          }
        }
      }
    };

    walkDir(directory);
    return filteredFiles;
  }

  private parseMarkdownHeaders(content: string): MarkdownChunk[] {
    const lines = content.split('\n');
    const chunks: MarkdownChunk[] = [];
    let currentChunk = '';
    let currentHeader = '';
    let currentLevel = 0;
    let parentSection = '';
    let chunkIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
      
      if (headerMatch) {
        // Save previous chunk if it exists
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            header: currentHeader,
            level: currentLevel,
            metadata: {
              file_path: '', // Will be set later
              file_name: '', // Will be set later
              section_header: currentHeader,
              chunk_index: chunkIndex++,
              total_chunks: 0, // Will be set later
              reference_url: '', // Will be set later
              parent_section: parentSection || undefined,
            }
          });
        }

        // Start new chunk
        const level = headerMatch[1].length;
        const header = headerMatch[2].trim();
        
        // Update parent section (only if this is a higher level header)
        if (level <= currentLevel) {
          parentSection = '';
        } else if (currentLevel > 0) {
          parentSection = currentHeader;
        }
        
        currentChunk = line + '\n';
        currentHeader = header;
        currentLevel = level;
      } else {
        currentChunk += line + '\n';
      }
    }

    // Add the last chunk
    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        header: currentHeader,
        level: currentLevel,
        metadata: {
          file_path: '', // Will be set later
          file_name: '', // Will be set later
          section_header: currentHeader,
          chunk_index: chunkIndex++,
          total_chunks: 0, // Will be set later
          reference_url: '', // Will be set later
          parent_section: parentSection || undefined,
        }
      });
    }

    return chunks;
  }

  private generateReferenceUrl(filePath: string, sectionHeader: string): string {
    // Convert file path to GitBook-style URL
    const relativePath = path.relative(this.rootDir, filePath);
    
    // Remove file extension and convert to lowercase
    const fileName = path.basename(relativePath, '.md').toLowerCase();
    const directory = path.dirname(relativePath).toLowerCase();
    
    // Create GitBook-style URL
    const baseUrl = 'https://hungcq.gitbook.io/knowledge-repository';
    const urlPath = directory ? `${directory}/${fileName}` : fileName;
    
    // Add section anchor if available
    let anchor = '';
    if (sectionHeader) {
      let anchorText = sectionHeader.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/:/g, ''); // Remove all colons
      
      // Check if the section header starts with a number
      if (/^\d+\./.test(sectionHeader)) {
        anchorText = `id-${anchorText}`;
      }
      
      anchor = `#${anchorText}`;
    }
    
    return `${baseUrl}/${urlPath}${anchor}`;
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }

  private async processFile(filePath: string): Promise<void> {
    console.log(`Processing file: ${filePath}`);
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const chunks = this.parseMarkdownHeaders(content);
    
    if (chunks.length === 0) {
      console.log(`No chunks found in ${filePath}`);
      return;
    }

    const fileName = path.basename(filePath);
    const relativePath = path.relative(this.rootDir, filePath);
    
    // Update metadata for all chunks
    chunks.forEach((chunk, index) => {
      chunk.metadata.file_path = filePath;
      chunk.metadata.file_name = fileName;
      chunk.metadata.total_chunks = chunks.length;
      chunk.metadata.reference_url = this.generateReferenceUrl(filePath, chunk.metadata.section_header);
    });

    // Generate embeddings and upload to Qdrant
    const points = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Create searchable text (header + content + parent context)
      let searchableText = chunk.content;
      if (chunk.metadata.parent_section) {
        searchableText = `Parent Section: ${chunk.metadata.parent_section}\n\n${searchableText}`;
      }
      
      console.log(`Generating embedding for chunk ${i + 1}/${chunks.length} in ${fileName}`);
      const embedding = await this.generateEmbedding(searchableText);
      
      points.push({
        id: uuidv4(),
        vector: embedding,
        payload: {
          content: chunk.content,
          header: chunk.header,
          level: chunk.level,
          ...chunk.metadata,
        }
      });
    }

    // Upload points to Qdrant
    await this.qdrant.upsert(this.collectionName, {
      wait: true,
      points: points,
    });

    console.log(`Uploaded ${points.length} chunks from ${fileName}`);
  }

  async processDirectory(subdirPath: string): Promise<void> {
    const filePaths = this.getFilteredFilePaths(subdirPath);
    
    if (filePaths.length === 0) {
      console.log(`Skipping ${subdirPath}: no valid files.`);
      return;
    }

    console.log(`Processing ${subdirPath} with ${filePaths.length} files...`);

    for (const filePath of filePaths) {
      try {
        await this.processFile(filePath);
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
      }
    }

    console.log(`Completed processing ${subdirPath}`);
  }

  async loadKnowledgeRepo(): Promise<void> {
    console.log('Starting knowledge repository loading process...');
    
    await this.initialize();

    // Process each top-level subdirectory
    const items = fs.readdirSync(this.rootDir);
    
    for (const item of items) {
      const subdirPath = path.join(this.rootDir, item);
      const stat = fs.statSync(subdirPath);
      
      if (stat.isDirectory()) {
        await this.processDirectory(subdirPath);
      }
    }

    // Get collection info
    const collectionInfo = await this.qdrant.getCollection(this.collectionName);
    console.log(`\nLoading completed!`);
    console.log(`Total points in collection: ${collectionInfo.points_count}`);
    console.log(`Collection name: ${this.collectionName}`);
  }

  async search(query: string, limit: number = 5): Promise<any[]> {
    console.log(`Searching for: "${query}"`);
    
    const queryEmbedding = await this.generateEmbedding(query);
    
    const results = await this.qdrant.search(this.collectionName, {
      vector: queryEmbedding,
      limit: limit,
      with_payload: true,
    });

    return results;
  }
}

// Main execution
async function main() {
  const rootDir = process.env.KNOWLEDGE_REPO_PATH || '';
  
  if (!fs.existsSync(rootDir)) {
    console.error(`Root directory does not exist: ${rootDir}`);
    process.exit(1);
  }

  const loader = new KnowledgeRepoLoader(rootDir);
  
  try {
    await loader.loadKnowledgeRepo();
    
    // Example search
    console.log('\n--- Example Search ---');
    const searchResults = await loader.search('microservices patterns', 3);
    
    searchResults.forEach((result, index) => {
      console.log(`\nResult ${index + 1}:`);
      console.log(`Score: ${result.score}`);
      console.log(`Header: ${result.payload?.header}`);
      console.log(`File: ${result.payload?.file_name}`);
      console.log(`Reference: ${result.payload?.reference_url}`);
      console.log(`Content preview: ${result.payload?.content?.substring(0, 200)}...`);
    });
    
  } catch (error) {
    console.error('Error during loading process:', error);
    process.exit(1);
  }
}

main().catch(console.error);
