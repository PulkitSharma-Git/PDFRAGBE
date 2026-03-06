import { QdrantClient } from '@qdrant/js-client-rest';
import * as dotenv from 'dotenv';
dotenv.config();
(async () => {
    try {
        const client = new QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            apiKey: process.env.QDRANT_API_KEY || undefined,
        });
        await client.createPayloadIndex('pdf_docs', {
            field_name: 'metadata.source_filename',
            field_schema: 'keyword',
        });
        console.log('Index created successfully');
    } catch (e) {
        console.error('Failed to create index:', e);
    }
})();
