import * as dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { PromptTemplate } from "@langchain/core/prompts";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

async function test() {
    const embeddings = new GoogleGenerativeAIEmbeddings({
        model: "gemini-embedding-001", 
        taskType: "RETRIEVAL_QUERY", 
        apiKey: process.env.GEMINI_API_KEY || ""
    });
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, { url: "http://localhost:6333", collectionName: "pdf_docs", clientConfig: { checkCompatibility: false } });
    const retriever = vectorStore.asRetriever(4);
    
    const llm = new ChatGoogleGenerativeAI({
        model: "gemini-2.5-flash",
        temperature: 0.2,
        apiKey: process.env.GEMINI_API_KEY || "", 
    });

    const template = `Context: {context}\nQuestion: {input}\nHelpful Answer:`;
    const prompt = PromptTemplate.fromTemplate(template);

    const combineDocsChain = await createStuffDocumentsChain({ llm: llm, prompt: prompt });

    try {
        const docs = await retriever.invoke("What does this standard document talk about?");
        console.log("Documents retrieved:", docs.length);
        const response = await combineDocsChain.invoke({ context: docs, input: "What does this standard document talk about?" });
        console.log("Success:", response);
    } catch (err) {
        console.log("Chain failed:", err);
    }
}
test();
