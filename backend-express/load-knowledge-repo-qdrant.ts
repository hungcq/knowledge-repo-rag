/**
 * Knowledge Repository Loader with Multimodal Support
 * 
 * This script loads knowledge repository content into Qdrant vector database
 * using Google's multimodal embedding model. It supports both text (markdown)
 * and image files (JPG, PNG) for unified semantic search.
 * 
 * For images, only metadata and source URLs are stored in Qdrant - the actual
 * image content is not stored to optimize storage efficiency.
 * 
 * Required environment variables:
 * - KNOWLEDGE_REPO_PATH: Path to the knowledge repository directory
 * - QDRANT_URL: Qdrant server URL (default: http://localhost:6333)
 * - QDRANT_API_KEY: Qdrant API key (optional)
 * - GOOGLE_API_KEY: Google API key for multimodal embeddings
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
import dotenv from 'dotenv';
import { generateTextEmbedding, generateMultimodalEmbedding } from './src/tools/googleEmbeddings.js';
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
  file_type: 'text' | 'image';
  mime_type?: string;
}

interface MarkdownChunk {
  content: string;
  header: string;
  level: number;
  metadata: ChunkMetadata;
}

interface ImageChunk {
  header: string;
  metadata: ChunkMetadata;
}

interface ProcessingProgress {
  startTime: string;
  lastUpdate: string;
  totalFiles: number;
  processedFiles: number;
  failedFiles: string[];
  completedDirectories: string[];
  collectionInitialized: boolean;
}

interface FileProcessingResult {
  filePath: string;
  success: boolean;
  error?: string;
  chunksProcessed: number;
  timestamp: string;
}

class KnowledgeRepoLoader {
  private qdrant: QdrantClient;
  private textCollectionName = 'knowledge-repo-text';
  private imageCollectionName = 'knowledge-repo-diagrams';
  private supportedExtensions = ['md', 'jpg', 'jpeg', 'png'];
  private rootDir: string;
  constructor(rootDir: string) {
    this.qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
    });
    this.rootDir = rootDir;
  }

  async initialize(): Promise<void> {
    console.log('Initializing Qdrant collections...');

    const collections = await this.qdrant.getCollections();

    // Check and create text collection
    const textCollectionExists = collections.collections.some(
      (col) => col.name === this.textCollectionName
    );

    if (textCollectionExists) {
      console.log(`Collection ${this.textCollectionName} already exists. Purging...`);
      await this.qdrant.deleteCollection(this.textCollectionName);
    }

    await this.qdrant.createCollection(this.textCollectionName, {
      vectors: {
        size: 3072, // Google text embedding size
        distance: 'Cosine',
      },
    });
    console.log(`Collection ${this.textCollectionName} created successfully.`);

    // Check and create image collection
    const imageCollectionExists = collections.collections.some(
      (col) => col.name === this.imageCollectionName
    );

    if (imageCollectionExists) {
      console.log(`Collection ${this.imageCollectionName} already exists. Purging...`);
      await this.qdrant.deleteCollection(this.imageCollectionName);
    }

    await this.qdrant.createCollection(this.imageCollectionName, {
      vectors: {
        size: 1408, // Google multimodal embedding size
        distance: 'Cosine',
      },
    });
    console.log(`Collection ${this.imageCollectionName} created successfully.`);
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
              file_type: 'text',
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
          file_type: 'text',
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
        .replace(/&/g, 'and')
        .replace(/:/g, ''); // Remove all colons

      // Check if the section header starts with a number
      if (/^\d+\./.test(sectionHeader)) {
        anchorText = `id-${anchorText}`;
      }

      anchor = `#${anchorText}`;
    }

    return `${baseUrl}/${urlPath}${anchor}`;
  }

  private generateImageReferenceUrl(filePath: string): string {
    // Convert file path to GitBook-style URL
    const relativePath = path.relative(this.rootDir, filePath);

    // Remove file extension and convert to lowercase
    const fileName = path.basename(relativePath);
    const directory = path.dirname(relativePath).toLowerCase();

    // Create GitBook-style URL
    const baseUrl = 'https://raw.githubusercontent.com/hungcq/knowledge-repo/refs/heads/master';
    const urlPath = directory ? `${directory}/${fileName}` : fileName;

    return `${baseUrl}/${urlPath}`;
  }

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      default:
        return 'text/plain';
    }
  }

  private async processImageFile(filePath: string): Promise<void> {
    console.log(`Processing image file: ${filePath}`);

    const fileName = path.basename(filePath);
    const mimeType = this.getMimeType(filePath);

    // Read image file as base64 for embedding generation only
    const imageBuffer = fs.readFileSync(filePath);
    const imageData = imageBuffer.toString('base64');

    // Create image chunk (without storing content)
    const imageChunk: ImageChunk = {
      header: fileName,
      metadata: {
        file_path: filePath,
        file_name: fileName,
        section_header: fileName,
        chunk_index: 0,
        total_chunks: 1,
        reference_url: this.generateImageReferenceUrl(filePath),
        file_type: 'image',
        mime_type: mimeType,
      }
    };

    // Generate multimodal embedding for the image
    console.log(`Generating multimodal embedding for image: ${fileName}`);
    const embedding = await generateMultimodalEmbedding(fileName, imageData, mimeType);

    // Upload to Qdrant image collection (without storing image content)
    await this.qdrant.upsert(this.imageCollectionName, {
      wait: true,
      points: [{
        id: uuidv4(),
        vector: embedding.imageEmbedding,
        payload: {
          header: imageChunk.header,
          ...imageChunk.metadata,
        }
      }],
    });

    console.log(`Uploaded image metadata from ${fileName}`);
  }

  private async processFile(filePath: string): Promise<FileProcessingResult> {
    const result: FileProcessingResult = {
      filePath,
      success: false,
      chunksProcessed: 0,
      timestamp: new Date().toISOString(),
    };

    try {
      console.log(`Processing file: ${filePath}`);
      const fileName = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase().slice(1);

      // Check if it's an image file
      if (['jpg', 'jpeg', 'png'].includes(ext)) {
        await this.processImageFile(filePath);
        result.chunksProcessed = 1;
        result.success = true;
        return result;
      }

      // Process as markdown file
      const content = fs.readFileSync(filePath, 'utf-8');
      const chunks = this.parseMarkdownHeaders(content);

      if (chunks.length === 0) {
        console.log(`No chunks found in ${filePath}`);
        result.success = true;
        return result;
      }

      // Update metadata for all chunks
      chunks.forEach((chunk) => {
        chunk.metadata.file_path = filePath;
        chunk.metadata.file_name = fileName;
        chunk.metadata.total_chunks = chunks.length;
        chunk.metadata.reference_url = this.generateReferenceUrl(filePath, chunk.metadata.section_header);
        chunk.metadata.file_type = 'text';
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

        console.log(`Generating text embedding for chunk ${i + 1}/${chunks.length} in ${fileName}`);
        const embedding = await generateTextEmbedding(searchableText);

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

      // Upload points to Qdrant text collection
      await this.qdrant.upsert(this.textCollectionName, {
        wait: true,
        points: points,
      });

      result.chunksProcessed = points.length;
      result.success = true;
      console.log(`Uploaded ${points.length} chunks from ${fileName}`);

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      console.error(`Error processing ${filePath}:`, error);
    }

    return result;
  }

  async processDirectory(subdirPath: string): Promise<void> {

    const filePaths = this.getFilteredFilePaths(subdirPath);

    if (filePaths.length === 0) {
      console.log(`Skipping ${subdirPath}: no valid files.`);
      return;
    }

    console.log(`Processing ${subdirPath} with ${filePaths.length} files...`);

    let processedInThisDir = 0;
    let failedInThisDir = 0;

    for (const filePath of filePaths) {
      const result = await this.processFile(filePath);
      
      if (result.success) {
        processedInThisDir++;
        console.log(`✓ Processed ${filePath} (${result.chunksProcessed} chunks)`);
      } else {
        failedInThisDir++;
        console.log(`✗ Failed ${filePath}: ${result.error}`);
      }
    }

    console.log(`Completed processing ${subdirPath}: ${processedInThisDir} successful, ${failedInThisDir} failed`);
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

    // Get collection info for both collections
    const textCollectionInfo = await this.qdrant.getCollection(this.textCollectionName);
    const imageCollectionInfo = await this.qdrant.getCollection(this.imageCollectionName);

    console.log(`\nLoading completed!`);
    console.log(`\nCollection Statistics:`);
    console.log(`- Text collection (${this.textCollectionName}): ${textCollectionInfo.points_count ?? 0} points`);
    console.log(`- Image collection (${this.imageCollectionName}): ${imageCollectionInfo.points_count ?? 0} points`);
    console.log(`- Total points: ${(textCollectionInfo.points_count ?? 0) + (imageCollectionInfo.points_count ?? 0)}`);
  }

  async search(query: string, limit: number = 5): Promise<any[]> {
    console.log(`Searching for: "${query}"`);

    // Generate text embedding for text collection search
    const textEmbedding = await generateTextEmbedding(query);

    // Generate multimodal embedding for image collection search
    const multimodalEmbedding = await generateMultimodalEmbedding(query);

    // Search both collections in parallel
    const [textResults, imageResults] = await Promise.all([
      this.qdrant.search(this.textCollectionName, {
        vector: textEmbedding,
        limit: limit,
        with_payload: true,
      }),
      this.qdrant.search(this.imageCollectionName, {
        vector: multimodalEmbedding.textEmbedding,
        limit: limit,
        with_payload: true,
      })
    ]);

    // Combine and sort results by score
    const combinedResults = [...textResults, ...imageResults]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);

    console.log(`Found ${textResults.length} text results and ${imageResults.length} image results`);
    return combinedResults;
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
  await loader.loadKnowledgeRepo();
}

main().catch(console.error);