const fs = require("fs");
const path = require("path");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { Document } = require("@langchain/core/documents");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { Embeddings } = require("@langchain/core/embeddings");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function embedWithRetry(client, text, retries = 5) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await client.embedContent({
        content: { role: "user", parts: [{ text: text.replace(/\n/g, " ") }] },
      });
      return result.embedding.values ?? [];
    } catch (err) {
      if (err?.status === 429) {
        let waitMs = 30000;
        try {
          const retryInfo = err.errorDetails?.find(
            (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
          );
          if (retryInfo?.retryDelay) {
            waitMs = (parseInt(retryInfo.retryDelay.replace("s", ""), 10) + 2) * 1000;
          }
        } catch (_) {}
        console.log(`[Copilot] Rate limited. Waiting ${waitMs / 1000}s (attempt ${attempt + 1}/${retries})...`);
        await sleep(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries exceeded for embedding request");
}

class GeminiEmbeddingsV1 extends Embeddings {
  constructor(fields) {
    super(fields ?? {});
    const apiKey = fields?.apiKey || process.env.GEMINI_API_KEY;
    const model = fields?.model || "models/gemini-embedding-001";
    const genAI = new GoogleGenerativeAI(apiKey);
    this.client = genAI.getGenerativeModel({ model }, { apiVersion: "v1beta" });
  }

  async embedQuery(text) {
    return embedWithRetry(this.client, text);
  }

  // Sequential: 1 at a time, 650ms gap = ~90 req/min, safely under free tier limit of 100
  async embedDocuments(documents) {
    const results = [];
    for (let i = 0; i < documents.length; i++) {
      if (i > 0 && i % 10 === 0) console.log(`[Copilot] Embedded ${i}/${documents.length} chunks...`);
      results.push(await embedWithRetry(this.client, documents[i]));
      if (i < documents.length - 1) await sleep(650);
    }
    return results;
  }
}

let vectorStore;

async function initVectorStore() {
  console.log("[Copilot] Reading Knowledge Base via Gemini Embeddings...");

  const filePath = path.join(__dirname, "../docs/system_knowledge.txt");
  const rawText = fs.readFileSync(filePath, "utf-8");
  const rawDocs = [new Document({ pageContent: rawText })];

  const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 });
  const docs = await textSplitter.splitDocuments(rawDocs);
  console.log(`[Copilot] ${docs.length} chunks — sequential embed, ~${Math.ceil(docs.length * 0.65)}s...`);

  const embeddings = new GeminiEmbeddingsV1({
    model: "models/gemini-embedding-001",
    apiKey: process.env.GEMINI_API_KEY,
  });

  vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
  console.log(`[Copilot] Knowledge Base loaded! (${docs.length} chunks embedded)`);
}

async function askCopilot(question) {
  if (!vectorStore) throw new Error("Knowledge base not initialized");

  const relevantDocs = await vectorStore.similaritySearch(question, 3);
  const contextText = relevantDocs.map((doc) => doc.pageContent).join("\n");

  const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash",  // ← try this first
  temperature: 0.1,
  maxOutputTokens: 500,
  apiKey: process.env.GEMINI_API_KEY,
});

  const prompt = `
    You are the AASIST-L Support Copilot, an AI assistant for a voice spoof detection dashboard.
    Answer the user's question accurately using ONLY the provided System Context.
    If the context doesn't contain the answer, say "I don't have enough system data to answer that."

    System Context:
    ${contextText}

    User Question: ${question}
  `;

  const response = await llm.invoke([{ role: "user", content: prompt }]);
  return response.content;
}

module.exports = { initVectorStore, askCopilot };