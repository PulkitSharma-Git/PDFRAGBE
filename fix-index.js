import * as dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';

dotenv.config();

async function fixIndex() {
    try {
        const client = new QdrantClient({
            url: process.env.QDRANT_URL || "http://localhost:6333",
            apiKey: process.env.QDRANT_API_KEY || undefined,
        });

        const collectionName = "pdf_docs";
        
        console.log("Creating payload index for metadata.source_filename...");
        await client.createPayloadIndex(collectionName, {
            field_name: "metadata.source_filename",
            field_schema: "keyword",
        });
        
        console.log("Payload index created successfully.");
    } catch (err) {
        console.error("Error creating payload index:", err);
    }
}

fixIndex();
