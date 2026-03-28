// This file handles Uploads and Query
// After Upload the file is added the worker 
import express from "express";
import cors from "cors";
import multer from "multer";
import { Queue } from "bullmq";
import dotenv from 'dotenv';
import pdfParse from "pdf-parse";
import redisConnection from "./redisConnection.js"; // Importing the redis client


import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

const app = express();
app.use(cors());
app.use(express.json());

dotenv.config(); // load env variables

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
    });

    return res.json({ message: "PDF processed and queued", text: pdfData.text });

  } catch (error) {
        console.error("PDF Upload Error:", error);
        return res.status(500).json({ error: "Failed to process PDF" });
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
        const llm = new ChatGoogleGenerativeAI({
            model: "gemini-2.5-flash",
            temperature: 0.2, // low temp for factual RAG tasks
            apiKey: process.env.GEMINI_API_KEY || "",
        });

        const embeddingClient = new GoogleGenerativeAIEmbeddings({
            model: "gemini-embedding-001",
            taskType: "RETRIEVAL_QUERY",
            apiKey: process.env.GEMINI_API_KEY || "",
        });

        // Now during the sematic search qdrant convert the query using our embedding client
        const vectorStore = await QdrantVectorStore.fromExistingCollection(
            embeddingClient,
            {
                url: process.env.QDRANT_URL || "http://localhost:6333",
                apiKey: process.env.QDRANT_API_KEY || undefined,
                collectionName: "pdf_docs",
                clientConfig: { checkCompatibility: false }
            }
        );
        
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

        // 5. Execute Query
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