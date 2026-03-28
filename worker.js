import { Worker } from 'bullmq';
import redisConnection from './redisConnection';

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import dotenv from 'dotenv';

dotenv.config();

const worker = new Worker('file-upload-queue', async job => {
    console.log("Job Processing Started:", job.data.filename);
    const data = JSON.parse(job.data);

    try {
        //Read extracted text directly from the queue payload
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

        //Chunk the PDF text
        console.log("Splitting PDF text into chunks...");
        
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
        const embeddings = new GoogleGenerativeAIEmbeddings({
            model: "gemini-embedding-001", 
            taskType: "RETRIEVAL_DOCUMENT", 
            apiKey: process.env.GEMINI_API_KEY || ""
        });

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