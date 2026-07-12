import { Worker } from 'bullmq';
import redisConnection from './redisConnection.js';

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import dotenv from 'dotenv';

dotenv.config({ override: true });

const worker = new Worker('file-upload-queue', async job => {
    console.log("Job Processing Started:", job.data.filename);
    const data = typeof job.data === 'string' ? JSON.parse(job.data) : job.data;

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
            return new Document({
                pageContent: doc.pageContent,
                metadata: {
                    ...doc.metadata,
                    source_filename: data.filename,
                    upload_timestamp: new Date().toISOString()
                }
            });
        });

        // Step 3: Configure Hugging Face Embedding model
        const embeddings = new HuggingFaceInferenceEmbeddings({
            apiKey: process.env.HUGGINGFACE_API_KEY || "",
            model: "BAAI/bge-large-en-v1.5",
        });

        // Step 4: Clean up old embeddings for this filename in Qdrant
        console.log(`Checking Qdrant for old embeddings of ${data.filename}...`);
        const collectionName = `pdf_docs`;

        try {
            const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
            const qdrantPort = qdrantUrl.startsWith("https://") ? 443 : 6333;

            // Dynamically extract QdrantClient class to bypass LangChain constructor options filtering limitation
            const dummyStore = new QdrantVectorStore(embeddings, {
                url: "http://localhost:6333",
                collectionName: "dummy"
            });
            const QdrantClientClass = dummyStore.client.constructor;

            const qdrantClientInstance = new QdrantClientClass({
                url: qdrantUrl,
                apiKey: process.env.QDRANT_API_KEY || undefined,
                port: qdrantPort,
                checkCompatibility: false
            });

            const vectorStore = new QdrantVectorStore(
                embeddings,
                {
                    client: qdrantClientInstance,
                    collectionName: collectionName
                }
            );

            // Delete any existing vectors that match this document's filename exactly
            await vectorStore.client.delete(collectionName, {
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

        const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
        const qdrantPort = qdrantUrl.startsWith("https://") ? 443 : 6333;

        // Dynamically extract QdrantClient class to bypass LangChain constructor options filtering limitation
        const dummyStore = new QdrantVectorStore(embeddings, {
            url: "http://localhost:6333",
            collectionName: "dummy"
        });
        const QdrantClientClass = dummyStore.client.constructor;

        const qdrantClientInstance = new QdrantClientClass({
            url: qdrantUrl,
            apiKey: process.env.QDRANT_API_KEY || undefined,
            port: qdrantPort,
            checkCompatibility: false
        });

        try {
            await QdrantVectorStore.fromDocuments(
                processedDocs,
                embeddings,
                {
                    client: qdrantClientInstance,
                    collectionName: collectionName
                }
            );
            // Ensure payload index is created for source_filename keyword matching
            try {
                await qdrantClientInstance.createPayloadIndex(collectionName, {
                    field_name: "metadata.source_filename",
                    field_schema: "keyword"
                });
                console.log("Payload index verified/created on metadata.source_filename");
            } catch (indexError) {
                console.log("Skipped payload index creation (might already exist):", indexError.message);
            }
        } catch (storeError) {
            console.warn("Error storing documents in Qdrant:", storeError.message);
            // If it looks like a dimension mismatch, attempt collection deletion and recreation
            const isDimensionMismatch = storeError.message.includes("dimension") || 
                                        storeError.message.includes("size") || 
                                        storeError.message.includes("expected") ||
                                        storeError.message.includes("vector");
            if (isDimensionMismatch) {
                console.log(`Detected dimension mismatch. Deleting and recreating collection: ${collectionName}...`);
                try {
                    await qdrantClientInstance.deleteCollection(collectionName);
                    console.log("Collection deleted. Retrying document storage...");
                    await QdrantVectorStore.fromDocuments(
                        processedDocs,
                        embeddings,
                        {
                            client: qdrantClientInstance,
                            collectionName: collectionName
                        }
                    );
                    // Recreate payload index
                    try {
                        await qdrantClientInstance.createPayloadIndex(collectionName, {
                            field_name: "metadata.source_filename",
                            field_schema: "keyword"
                        });
                        console.log("Payload index recreated on metadata.source_filename");
                    } catch (indexError) {
                        console.log("Failed to recreate payload index:", indexError.message);
                    }
                    console.log("Documents stored successfully after collection recreation!");
                } catch (recreateError) {
                    console.error("Failed to recreate collection:", recreateError);
                    throw storeError; // Throw the original error if recreation fails
                }
            } else {
                throw storeError;
            }
        }
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
// Triggering watcher restart to load new env credentials