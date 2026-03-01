import { Worker } from 'bullmq';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables configured in server/.env
dotenv.config();

let redisConnection;
if (process.env.REDIS_HOST && process.env.REDIS_HOST.startsWith('redis')) {
    // If it's a full URL string (e.g., from Upstash token endpoint)
    redisConnection = {
        url: process.env.REDIS_HOST,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    };
} else {
    redisConnection = {
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    };
}

// Pre-configured embeddings client using text-embedding-004 model structure
const getEmbeddingsParams = () => {
    return new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001", 
        taskType: "RETRIEVAL_DOCUMENT", 
        apiKey: process.env.GEMINI_API_KEY || ""
    });
};

const worker = new Worker('file-upload-queue', async job => {
    console.log("Job Processing Started:", job.data.filename);
    const data = JSON.parse(job.data);

    try {
        // Step 1: Read extracted text directly from the queue payload
        console.log(`Loading pre-extracted text for ${data.filename}...`);
        
        if (!data.text) {
             throw new Error("No text payload provided in the queue job.");
        }

        const docs = [
            new Document({
                pageContent: data.text,
                metadata: { source: data.filename }
            })
        ];

        // Step 2: Chunk the PDF text
        console.log("Splitting PDF text into chunks...");
        // This splits text into chunks of 1000 characters with a 200-character overlap for context
        const textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
        });
        const splittedDocs = await textSplitter.splitDocuments(docs);
        
        // Enhance document metadata with job or file specific information for better filtering
        const processedDocs = splittedDocs.map(doc => {
            return {
                ...doc,
                metadata: {
                    ...doc.metadata,
                    source_filename: data.filename,
                    upload_timestamp: new Date().toISOString()
                }
            }
        });

        // Step 3: Configure Gemini Embedding model
        const embeddings = getEmbeddingsParams();

        // Step 4: Clean up old embeddings for this filename in Qdrant
        console.log(`Checking Qdrant for old embeddings of ${data.filename}...`);
        const collectionName = `pdf_docs`;

        try {
            const { QdrantClient } = await import('@qdrant/js-client-rest');
            const client = new QdrantClient({
                url: process.env.QDRANT_URL || "http://localhost:6333",
                apiKey: process.env.QDRANT_API_KEY || undefined,
            });

            // Delete any existing vectors that match this document's filename exactly
            await client.delete(collectionName, {
                filter: {
                    must: [{
                        key: "metadata.source_filename",
                        match: { value: data.filename }
                    }]
                }
            });
            console.log(`Successfully purged previous context for ${data.filename}`);
        } catch (cleanupError) {
             console.log(`Skipped cleanup step (maybe first upload or network error): ${cleanupError.message}`);
        }

        // Step 5: Store document embeddings in Qdrant
        console.log(`Connecting to Qdrant to store ${processedDocs.length} new chunks...`);

        await QdrantVectorStore.fromDocuments(
            processedDocs,
            embeddings,
            {
                url: process.env.QDRANT_URL || "http://localhost:6333",
                apiKey: process.env.QDRANT_API_KEY || undefined,
                collectionName: collectionName,
                clientConfig: { checkCompatibility: false }
            }
        );
        console.log("Embeddings stored successfully in Qdrant collection: ", collectionName);
        
    } catch (error) {
        console.error("Error processing job:", error);
        throw error;
    }

}, { 
    concurrency: 10,  // Reduced concurrency slightly for API rate limiting safety
    connection: redisConnection
});

worker.on('completed', job => {
  console.log(`${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`${job.id ? job.id : 'Job'} has failed with ${err.message}`);
});

worker.on('error', err => {
  console.error('Worker error:', err); // Log Redis connection errors
});

console.log("Worker initialized and listening on file-upload-queue");