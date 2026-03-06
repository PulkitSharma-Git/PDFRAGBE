import * as dotenv from 'dotenv';
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";

dotenv.config();

const getEmbeddingsParams = () => {
    return new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001",
        taskType: "RETRIEVAL_QUERY",
        apiKey: process.env.GEMINI_API_KEY || ""
    });
};

async function testQuery() {
    try {
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
        
        const filename = "test_upload.pdf"; // dummy
        let filter = undefined;
        if (filename) {
            filter = {
                must: [{
                    key: "metadata.source_filename",
                    match: { value: filename }
                }]
            };
        }
        
        console.log("Using filter:", JSON.stringify(filter));
        const retriever = vectorStore.asRetriever({ k: 4, filter: filter });
        
        const sourceDocuments = await retriever.invoke("What is this document about?");
        console.log("Source documents retrieved successfully length:", sourceDocuments.length);
    } catch (err) {
        console.error("Error occurred:", err);
    }
}

testQuery();
