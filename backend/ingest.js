import { Chroma } from "@langchain/community/vectorstores/chroma";
import { BedrockEmbeddings } from "@langchain/aws";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(".env") });

async function ingest() {
  // Read text from sales.txt
  const salesText = fs.readFileSync(path.resolve("../assets/sales.txt"), "utf-8");

  // Prepare docs array (single doc, but you can split if needed)
  const docs = [
    {
      id: "salesdoc",
      text: salesText,
      metadata: {
        source: "sales.txt",
      },
    },
  ];

  // Use Bedrock Titan as embedder
  const embedder = new BedrockEmbeddings({
    region: process.env.AWS_REGION || "us-east-1",
    model: "amazon.titan-embed-text-v1",
  });

  // Ingest into ChromaDB
  const vectorStore = await Chroma.fromTexts(
    docs.map((d) => d.text),
    docs.map((d) => d.metadata),
    embedder,
    { collectionName: "reference_docs" }
  );
  console.log("Ingested sales.txt into ChromaDB using Bedrock Titan embeddings");
}

ingest();