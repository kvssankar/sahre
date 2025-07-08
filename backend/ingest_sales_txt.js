import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { BedrockEmbeddings } from "@langchain/aws";

dotenv.config({ path: path.resolve(".env") });

async function main() {
  const filePath = path.resolve("E:/Github/sahre/assets/heythere.txt");
  const text = fs.readFileSync(filePath, "utf-8");
  const chunkSize = 1000;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  const embedder = new BedrockEmbeddings({
    region: process.env.AWS_REGION || "us-east-1",
    model: "amazon.titan-embed-text-v1",
  });

  const embeddings = [];
  for (const chunk of chunks) {
    const [vector] = await embedder.embedDocuments([chunk]);
    embeddings.push({ chunk, vector });
  }

  fs.writeFileSync(
    path.resolve("heythere_vectors.json"),
    JSON.stringify(embeddings)
  );
  console.log("Saved embeddings to backend/heythere_vectors.json");
}

main();
