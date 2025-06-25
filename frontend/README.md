## Problem Statement

**AI-Driven Live Call Insights:**  
Sales and support teams struggle to provide real-time, context-aware responses during live customer calls. Manual note-taking and delayed follow-ups lead to missed opportunities and inconsistent customer experiences.

**Scope:**  
We address real-time transcription of live calls, instant retrieval of relevant insights from pre-trained sales data, and dynamic suggestion cards to assist agents during the call.

---

## Solution Approach

**Proposed Solution:**  
A GenAI-powered platform that streams live audio from the frontend (React) to a Node.js backend, transcribes speech in real-time using AWS Transcribe, and provides actionable insights using Retrieval-Augmented Generation (RAG) with OpenSearch and Bedrock Claude Sonnet 4.

**Key Features:**
- Real-time speech-to-text transcription (AWS Transcribe Streaming)
- Dynamic suggestion cards based on sales scenarios (RAG)
- WebSocket-based low-latency communication
- Scalable, stateless backend (Dockerized, deployable on EC2/Fargate)
- Frontend deployed on S3 for demo (can scale via CloudFront)

**Scope of Scaling:**
- **Horizontal:** Add more backend containers (EC2/Fargate) to handle more concurrent calls.
- **Vertical:** Increase instance size for higher throughput (CPU/RAM) as needed.

---

## Techstack Selection

- **Frontend:** React (TypeScript) – rapid UI development, component reusability
- **Backend:** Node.js (ESM) – async streaming, easy AWS SDK integration
- **WebSocket:** For real-time, bidirectional audio and data transfer
- **AWS Services:**
  - **Transcribe Streaming:** Real-time speech-to-text
  - **Bedrock (Claude Sonnet 4):** Advanced GenAI for RAG and summarization
  - **OpenSearch Serverless:** Vector database for fast semantic search (RAG)
  - **S3:** Static frontend hosting
  - **EC2/Fargate:** Backend compute (Dockerized for portability)
- **Vector DB:** OpenSearch (serverless) – scalable, managed, integrates with Bedrock
- **Why this stack?**  
  - Fully managed, scalable, and secure AWS services
  - Real-time streaming and GenAI integration
  - Minimal ops overhead, easy to extend for production

---

## Architecture Design/Diagram

**Flow:**
1. User uploads/streams audio via React frontend.
2. Audio is chunked and sent over WebSocket to Node.js backend.
3. Backend buffers audio, converts to PCM, and streams to AWS Transcribe.
4. Transcribe returns real-time transcripts.
5. Backend queries OpenSearch (vector DB) with transcript for relevant sales insights.
6. Bedrock Claude Sonnet 4 generates suggestion cards (RAG).
7. Suggestions and transcripts are sent back to frontend via WebSocket.

**Diagram:**  
*(Add a diagram with these components: User → React (S3) → WebSocket → Node.js (EC2/Fargate) → AWS Transcribe → OpenSearch → Bedrock → Node.js → WebSocket → React)*

---

## Implementation Plan

| Phase            | Tasks                                                                 | Timeline      |
|------------------|-----------------------------------------------------------------------|--------------|
| 1. Setup         | AWS account, S3, EC2, OpenSearch, Bedrock, Transcribe                | Day 1        |
| 2. Frontend      | React UI for audio upload/stream, WebSocket integration               | Day 2-3      |
| 3. Backend       | Node.js server, audio chunking, ffmpeg conversion, WebSocket logic    | Day 3-4      |
| 4. Transcription | Integrate AWS Transcribe streaming                                    | Day 4        |
| 5. RAG           | Ingest sales data into OpenSearch, connect Bedrock Claude             | Day 5        |
| 6. Suggestion UI | Dynamic cards, transcript display                                     | Day 6        |
| 7. Testing       | End-to-end dry runs, error handling, edge cases                       | Day 7        |
| 8. Deployment    | Dockerize backend, deploy to EC2, frontend to S3                      | Day 8        |

---

## Cost Estimates

- **AWS Transcribe Streaming:** ~$0.0004 per second
- **Bedrock Claude Sonnet 4:** Pay-per-use (see [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/))
- **OpenSearch Serverless:** ~$0.10 per GB storage/month + compute
- **EC2 (t3.medium for demo):** ~$30/month (or use Fargate for auto-scaling)
- **S3 (frontend):** ~$1/month (static hosting)
- **Total (demo scale):** ~$50–$100/month

---

## Impact Potential & Limitations

**Potential Impact:**
- Faster, more consistent sales/support calls
- Improved agent productivity and customer satisfaction
- Scalable to any domain with new data

**Benefits:**
- Real-time, actionable insights
- Easy integration with existing call workflows
- Cloud-native, scalable, and secure

**Dependencies:**
- AWS managed services (Transcribe, Bedrock, OpenSearch)
- Node.js, React, WebSocket, ffmpeg

**Limitations:**
- Latency depends on network and AWS service response
- Bedrock Claude Sonnet 4 may have usage limits or region restrictions
- Audio quality and accents may affect transcription accuracy

---

## Ethical & Security Considerations

- **Data Privacy:** All audio and transcripts are processed in-memory and not stored long-term.
- **Security:** WebSocket connections are authenticated (add JWT/Auth for prod), backend is isolated in VPC.
- **Ethics:** Only use customer data with consent; comply with GDPR/CCPA.
- **Bias:** Claude Sonnet 4 is a general model; ensure prompt engineering to avoid biased suggestions.

---

## Video Pitch & Demo

- **[Insert your shareable video link here]**
- In the video, show:
  - Live call simulation (audio upload/stream)
  - Real-time transcript and suggestion cards
  - Architecture diagram and flow explanation

---

## Suggestions for Additional AWS Services

- **Amazon Comprehend:** For sentiment analysis or entity extraction on transcripts.
- **Amazon Kinesis:** For large-scale, multi-user audio streaming.
- **Amazon Cognito:** For user authentication and access control.
- **CloudWatch:** For monitoring and logging.
- **API Gateway + Lambda:** For serverless backend scaling (if moving away from EC2).

---

Let me know if you need a PPT-ready version or a diagram template!