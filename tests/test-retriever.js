import * as dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";

async function test() {
    const embeddings = new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001", 
        taskType: "RETRIEVAL_QUERY", 
        apiKey: process.env.GEMINI_API_KEY || ""
    });
    
    // Test the embedding explicitly
    try {
        await embeddings.embedQuery("Test string");
        console.log("Embed query string works!");
    } catch (err) {
        console.log("Embed string failed:", err.message);
    }

    try {
        const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { url: "http://localhost:6333", collectionName: "pdf_docs", clientConfig: { checkCompatibility: false } });
        const retriever = vectorStore.asRetriever(4);
        const results = await retriever.invoke("What does this standard document talk about?");
        console.log("Retriever works! Docs found:", results.length);
    } catch (err) {
        console.log("Retriever failed:", err);
    }
}
test();
