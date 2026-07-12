// This file handles Uploads and Query
// After Upload the file is added the worker 
import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import dotenv from 'dotenv';
import pdfParse from "pdf-parse";
import redisConnection from "./redisConnection.js"; // Importing the redis client


import { ChatGroq } from "@langchain/groq";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

const app = express();
app.use(cors());
app.use(express.json());

dotenv.config({ override: true }); // load env variables

const queue = new Queue("file-upload-queue", {
    connection: redisConnection
});

const storage = multer.memoryStorage(); // Multer will store uploaded files in memory as a Buffer (not on disk)
const upload = multer({ storage: storage }); //Multer middleware reads the file from the incoming request and puts it on req.file
/*

req.file looks like this:
{
  fieldname: 'pdf',         // field name in form
  originalname: 'my.pdf',   // original file name
  encoding: '7bit',
  mimetype: 'application/pdf',
  buffer: <Buffer ...>,     // the actual file content
  size: 123456              // file size in bytes
}
*/


app.get("/", (req, res) => {
    res.json({ status: "All Good !" });
});

// Endpoint to upload PDF to be processed by the worker
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    console.log(`Extracting text from uploaded PDF: ${req.file.originalname}`);

    const pdfData = await pdfParse(req.file.buffer); //parse pdf form buffer

    await queue.add("file-ready", {
      filename: req.file.originalname,
      text: pdfData.text,
    }, {
      jobId: `upload-${req.file.originalname}`,
      removeOnComplete: { age: 1800 },
      removeOnFail: { age: 86400 }
    });

    return res.json({ message: "PDF processed and queued", text: pdfData.text });

  } catch (error) {
        console.error("PDF Upload Error:", error);
        return res.status(500).json({ error: "Failed to process PDF: " + error.message });
  }
});

// Endpoint to check status of vectorized PDF
app.get("/upload/status", async (req, res) => {
  try {
    const { filename } = req.query;
    if (!filename) {
      return res.status(400).json({ error: "Missing 'filename' query parameter" });
    }
    const jobId = `upload-${filename}`;
    const job = await queue.getJob(jobId);
    if (!job) {
      // Default to completed if job has completed and aged out
      return res.json({ filename, status: "completed" });
    }
    const state = await job.getState();
    let status = "processing";
    if (state === "completed") {
      status = "completed";
    } else if (state === "failed") {
      status = "failed";
    }
    return res.json({ filename, status });
  } catch (error) {
    console.error("Status check error:", error);
    return res.status(500).json({ error: "Failed to get upload status" });
  }
});

// Endpoint to query the vectorized PDF data
app.post("/query", async (req, res) => {
    try {
        const { question, filename } = req.body;
        if (!question) {
            return res.status(400).json({ error: "Missing 'question' in request body" });
        }

        console.log(`Query: "${question}" for file: ${filename || 'Any'}`);

        //llm client
        const llm = new ChatGroq({
            model: "llama-3.3-70b-versatile",
            temperature: 0.2, // low temp for factual RAG tasks
            apiKey: process.env.GROQ_API_KEY || "",
        });

        const embeddingClient = new HuggingFaceInferenceEmbeddings({
            apiKey: process.env.HUGGINGFACE_API_KEY || "",
            model: "BAAI/bge-large-en-v1.5",
        });

        // Now during the sematic search qdrant convert the query using our embedding client
        const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
        const qdrantPort = qdrantUrl.startsWith("https://") ? 443 : 6333;

        // Dynamically extract QdrantClient class to bypass LangChain constructor options filtering limitation
        const dummyStore = new QdrantVectorStore(embeddingClient, {
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

        let vectorStore;
        try {
            vectorStore = await QdrantVectorStore.fromExistingCollection(
                embeddingClient,
                {
                    client: qdrantClientInstance,
                    collectionName: "pdf_docs"
                }
            );
            // Ensure payload index is created for source_filename keyword matching
            try {
                await qdrantClientInstance.createPayloadIndex("pdf_docs", {
                    field_name: "metadata.source_filename",
                    field_schema: "keyword"
                });
            } catch (indexError) {
                // Ignore if already exists
            }
        } catch (collectionError) {
            console.error("Failed to connect to Qdrant collection:", collectionError.message);
            if (collectionError.message.includes("Not Found") || collectionError.status === 404) {
                return res.json({
                    answer: "I couldn't find any indexed documents. Please upload a PDF on the left panel to begin.",
                    sourceDocuments: []
                });
            }
            throw collectionError;
        }
        
        // Ask Qdrant for the top 4 most relevant chunks
        //filtering by filename if provided ( User choosed a file and asked question about it)
        let filter = undefined;
        if (filename) {
            filter = {
                must: [{
                    key: "metadata.source_filename",
                    match: { value: filename }
                }]
            };
        }
        
        const retriever = vectorStore.asRetriever({ k: 4, filter });
        const sourceDocuments = await retriever.invoke(question);

        //Prompt Template
        const template = `You are a helpful assistant answering queries based on the provided PDF context.
Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Keep the answer as concise as possible unless detailed explanation is requested.

Context: 
{context}

Question: {input}
Helpful Answer:`;
        const prompt = PromptTemplate.fromTemplate(template); // convert prompt tempelate into prompt

        // Create the RAG Chain for Answer Generation
        const combineDocsChain = await createStuffDocumentsChain({
            llm: llm,
            prompt: prompt,
        });

        // Execute Query
        const answer = await combineDocsChain.invoke({
            context: sourceDocuments,
            input: question
        });

        return res.json({
            answer: answer,
            sourceDocuments: sourceDocuments 
        });

    } catch (error) {
        console.error("Query Error:", error);
        return res.status(500).json({ error: "Failed to process query" });
    }
});



const PORT = process.env.PORT || 8000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on Port ${PORT}`)
    
    // Start worker in the same process for Render free tier compatibility
    if (process.env.RUN_WORKER !== 'false') {
        console.log("Starting background worker...");
        import('./worker.js').catch(err => console.error("Failed to start worker:", err));
    }
});
// Triggering watcher restart to load new env credentials