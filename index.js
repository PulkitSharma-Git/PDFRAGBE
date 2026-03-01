import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import * as dotenv from 'dotenv';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

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

const queue = new Queue("file-upload-queue", {
    connection: redisConnection
});

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const app = express();
app.use(cors());
app.use(express.json()); // Allow parsing JSON bodies

app.get("/", (req, res) => {
    res.json({ status: "All Good !" });
});

// Provide pdf-parse globally for the backend
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import fs from 'fs';
import os from 'os';
import path from 'path';

// Endpoint to upload PDF to be processed by the worker
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
    let tmpPath;
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No PDF file uploaded" });
        }
        
        console.log(`Extracting text from uploaded PDF...`);
        // Workaround for pdf-parse buffer bug: write to temp file then parse
        tmpPath = path.join(os.tmpdir(), `upload-${Date.now()}-${req.file.originalname}`);
        fs.writeFileSync(tmpPath, req.file.buffer);
        
        const dataBuffer = fs.readFileSync(tmpPath);
        const pdfData = await pdfParse(dataBuffer);

        await queue.add("file-ready", JSON.stringify({
            filename: req.originalname || req.file.originalname,
            text: pdfData.text, 
        }));

        // Clean up temp file immediately after parsing
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

        return res.json({ message: "PDF extracted and queued for processing" });

    } catch (error) {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        console.error("Upload/Parsing Error:", error);
        return res.status(500).json({ error: "An error occurred while parsing the uploaded PDF" });
    }
});

// Helper for Google Embeddings instance
const getEmbeddingsParams = () => {
    return new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001", 
        taskType: "RETRIEVAL_QUERY", 
        apiKey: process.env.GEMINI_API_KEY || ""
    });
};

// Endpoint to query the vectorized PDF data
app.post("/query", async (req, res) => {
    try {
        const { question } = req.body;
        if (!question) {
            return res.status(400).json({ error: "Missing 'question' in request body" });
        }

        console.log(`Received Query: "${question}"`);

        // 1. Initialize Gemini LLM (gemini-2.5-flash for speed and cost efficiency)
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            temperature: 0.2, // Keep temperature low for factual RAG tasks
            apiKey: process.env.GEMINI_API_KEY || "", // Explicitly fallback safely
        });

        // 2. Setup Vector Store Retriever
        const embeddings = getEmbeddingsParams();
        const vectorStore = await QdrantVectorStore.fromExistingCollection(
            embeddings,
            {
                url: process.env.QDRANT_URL || "http://localhost:6333",
                apiKey: process.env.QDRANT_API_KEY || undefined,
                collectionName: "pdf_docs",
                clientConfig: { checkCompatibility: false }
            }
        );
        // Ask Qdrant for the top 4 most relevant chunks
        const retriever = vectorStore.asRetriever(4);

        // 3. Define the Prompt Template
        const template = `You are a helpful assistant answering queries based on the provided PDF context.
Use the following pieces of context to answer the question at the end.
If you don't know the answer, just say that you don't know, don't try to make up an answer.
Keep the answer as concise as possible unless detailed explanation is requested.

Context: 
{context}

Question: {input}
Helpful Answer:`;
        const prompt = PromptTemplate.fromTemplate(template);

        // 4. Create the RAG Chain for Answer Generation
        const combineDocsChain = await createStuffDocumentsChain({
            llm: llm,
            prompt: prompt,
        });

        // 5. Execute Query Manually to bypass createRetrievalChain embedding mismatch bug
        const sourceDocuments = await retriever.invoke(question);
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
        return res.status(500).json({ error: "An error occurred while processing the query" });
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