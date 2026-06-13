Here is the final, consolidated architecture migration guide. Save this entire block as `LOCAL_MIGRATION_GUIDE.md` in the root of your project directory.

```markdown
# Architecture Migration Guide: Cloud API to Local RAG

## Overview
This document serves as the enterprise blueprint for switching your AI Copilot architecture from the **Cloud API (Google Gemini 1.5 Flash)** used during the hackathon demonstration to a **100% Local, Air-Gapped RAG System (Ollama + Llama 3)** optimized for production data privacy.

---

## Architectural Comparison

| Component | Hackathon / Cloud Demo | Production / Local Privacy |
| :--- | :--- | :--- |
| **Orchestration** | Node.js + LangChain | Node.js + LangChain |
| **Inference Engine (Brain)** | Google Gemini 1.5 Flash | Ollama (`llama3` or `phi3`) |
| **Embeddings Model** | Google `gemini-embedding-001` | Ollama (`nomic-embed-text`) |
| **Vector Storage** | Persistent DB (MongoDB Atlas / Chroma) | Local Persistent Instance / File Cache |

---

## Step 1: De-coupling the Cloud API Setup

Before setting up your local infrastructure, cleanly tear down or disable the cloud API connections to avoid network leakages.

1. **Purge Cloud Variables:** Remove the `GEMINI_API_KEY` from your production environment variables or your active `.env` file.
2. **Prune Packages (Optional):** If you wish to minimize package weight, you can uninstall the Google integration libraries once your code migration is complete:
```bash
   npm uninstall @langchain/google-genai @google/generative-ai

```

---

## Step 2: Provisioning the Local Infrastructure

To run an open-source model with reasonable latency, ensure your production host server has adequate hardware assets (minimum 16GB RAM, or dedicated GPU VRAM).

1. **Install the Ollama Host Daemon:** Download and execute the installer from [ollama.com](https://ollama.com) for your target server operating system.
2. **Download the Specialized Models:** Open your command line and pull down the models. We split the workloads between a massive reasoning model and a tiny, ultra-fast mathematical embedding model to protect memory allocations:

```bash
   # Pull the foundational reasoning engine (The Brain)
   ollama pull llama3

   # Pull the highly optimized vector embedding model 
   ollama pull nomic-embed-text

```

3. **Verify Local Access:** Confirm that the local server is alive and listening on its default port by curling the network footprint:

```bash
   curl http://localhost:11434

```

*(Expected response: `Ollama is running`)*

---

## Step 3: Vector Store Strategy Adjustment

> **Enterprise Note on Persistence:** In the cloud demonstration, embeddings are typically fed directly into a persistent vector index (such as **MongoDB Atlas Vector Search** or **ChromaDB**) so that documents don't have to be re-embedded on every single server boot.
> When migrating to the local setup, ensure that your chosen Vector Store class is swapped to connect to your local database container (e.g., a local Chroma Docker container or a local MongoDB instance running vector indexes) instead of hitting cloud-managed database endpoints. If your deployment footprint must be completely standalone with zero database dependencies, use the lightweight, localized file system memory store shown in the migration code below.

---

## Step 4: Codebase Migration (`copilotService.js`)

Install the local integration packages required by LangChain to manage Ollama components:

```bash
npm install @langchain/ollama @langchain/classic

```

Replace the contents of `src/services/copilotService.js` with the completely localized configuration below. This implementation reads directly from your flat text data file, uses the local text splitter, and runs queries entirely within your local perimeter:

```javascript
const fs = require("fs");
const path = require("path");
const { MemoryVectorStore } = require("@langchain/classic/vectorstores/memory");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { Document } = require("@langchain/core/documents");

// Local Ollama specific integrations
const { OllamaEmbeddings, ChatOllama } = require("@langchain/ollama");

let vectorStore;

// --- INITIALIZE LOCAL RETRIEVAL STORAGE ---
async function initVectorStore() {
  console.log("[Copilot] Initializing Local Air-Gapped Knowledge Base...");
  
  // 1. Read documentation file natively
  const filePath = path.join(__dirname, "../docs/system_knowledge.txt");
  const rawText = fs.readFileSync(filePath, "utf-8");
  const rawDocs = [new Document({ pageContent: rawText })];

  // 2. Fragment documentation into search optimized chunks
  const textSplitter = new RecursiveCharacterTextSplitter({ 
    chunkSize: 500, 
    chunkOverlap: 50 
  });
  const docs = await textSplitter.splitDocuments(rawDocs);

  // 3. Connect to local embedding model
  const embeddings = new OllamaEmbeddings({ 
    model: "nomic-embed-text" 
  });

  // Note: For production implementations utilizing ChromaDB or MongoDB Atlas, 
  // replace MemoryVectorStore with your persistent connector instance here.
  vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
  console.log(`[Copilot] Local Knowledge Base safely loaded into vector storage. (${docs.length} chunks)`);
}

// --- LOCAL RAG RETRIEVAL PIPELINE ---
async function askCopilot(question) {
  if (!vectorStore) throw new Error("Knowledge base not initialized");

  // Step A: Search local vector store for the top 3 contextual rules
  const relevantDocs = await vectorStore.similaritySearch(question, 3);
  const contextText = relevantDocs.map(doc => doc.pageContent).join("\n");

  // Step B: Connect to local Llama-3 model
  const llm = new ChatOllama({ 
    model: "llama3", 
    temperature: 0.1 // Kept low to guarantee deterministic, factual answers
  });

  // Step C: Construct context-isolated prompt
  const prompt = `
    You are the AASIST-L Support Copilot, an AI assistant for a voice spoof detection dashboard.
    Answer the user's question accurately using ONLY the provided System Context. 
    If the context doesn't contain the answer, say "I don't have enough system data to answer that."

    System Context:
    ${contextText}

    User Question: ${question}
  `;

  // Step D: Request inference execution completely on-premise
  const response = await llm.invoke([{ role: "user", content: prompt }]);
  return response.content;
}

module.exports = {
  initVectorStore,
  askCopilot
};

```

---

## Step 5: System Cleanup & Complete Ollama Removal

If you ever need to clean up your local development space and reclaim the storage allocated by the downloaded weights, use the following manual purge steps:

### Windows Clean Environment Wipe:

1. **Shutdown Daemon:** Right-click the Ollama logo in your taskbar system tray and click **Quit Ollama**.
2. **Uninstall Host:** Navigate to Windows Settings -> Apps -> Installed Apps. Locate **Ollama** and choose **Uninstall**.
3. **Purge Weighted Asset Folders (Critical Space Recovery):** The uninstaller does not sweep away your multi-gigabyte models. You must manually delete them:
* Open File Explorer and delete the directory: `C:\Users\<YourUsername>\.ollama`


4. **Clean Registry Paths:** Inspect your Environment Variables window; drop any custom user or system strings referencing `OLLAMA_HOST` or `OLLAMA_MODELS`.

### macOS Clean Environment Wipe:

1. Quit the application from the top status menu bar.
2. Open your `/Applications` directory and move the **Ollama** application file to the Trash.
3. Open your terminal emulator and purge all caching, models, and configurations directly:

```bash
   rm -rf ~/.ollama

```

```

```