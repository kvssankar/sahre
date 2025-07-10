# AI Live Call Insights Solution - Backend

A modular, real-time transcription and AI-powered suggestion system for live customer support and sales conversations.

## 🏗️ Architecture Overview

The backend has been refactored into a clean, modular architecture following best engineering practices:

```
backend/
├── server.js                 # Main entry point
├── config/
│   └── environment.js        # Environment configuration
├── constants/
│   └── index.js             # Constants, prompts, and enums
├── services/
│   ├── aiService.js         # Claude AI interactions
│   ├── ragService.js        # Vector search and RAG
│   └── transcriptionService.js # AWS Transcribe handling
├── utils/
│   └── index.js             # Utility functions
├── websocket/
│   ├── webSocketManager.js  # WebSocket server management
│   └── connectionHandler.js # Individual connection logic
└── package.json
```

## 🚀 Features

- **Real-time Audio Transcription**: AWS Transcribe Streaming with speaker identification
- **AI-Powered Analysis**: Claude-based conversation analysis and summaries
- **RAG Integration**: Vector-based knowledge retrieval for contextual suggestions
- **Live Suggestion Cards**: Real-time agent assistance during calls
- **Modular Architecture**: Clean separation of concerns for maintainability
- **Error Handling**: Robust error handling and graceful degradation
- **Environment Configuration**: Flexible configuration management

## 📦 Modules

### Core Services

#### 1. **AI Service** (`services/aiService.js`)
- Manages all Claude AI interactions
- Handles conversation summarization
- Evaluates when suggestions are needed
- Generates contextual suggestion cards
- Parses and validates AI responses

#### 2. **RAG Service** (`services/ragService.js`)
- Loads and manages vector embeddings
- Performs semantic search over knowledge base
- Provides relevant context for AI suggestions
- Handles Bedrock embeddings integration

#### 3. **Transcription Service** (`services/transcriptionService.js`)
- Manages AWS Transcribe Streaming
- Handles audio stream processing
- Processes transcription events
- Manages speaker identification

### Infrastructure

#### 4. **WebSocket Manager** (`websocket/webSocketManager.js`)
- Manages WebSocket server lifecycle
- Handles new connections
- Provides connection statistics
- Implements graceful shutdown

#### 5. **Connection Handler** (`websocket/connectionHandler.js`)
- Manages individual WebSocket connections
- Orchestrates conversation flow
- Handles conversation state
- Coordinates between services

### Configuration & Utilities

#### 6. **Environment Config** (`config/environment.js`)
- Centralized environment variable management
- Configuration validation
- Service-specific settings
- Type-safe configuration access

#### 7. **Constants** (`constants/index.js`)
- AI model configurations
- System prompts
- WebSocket message types
- Default values and error messages

#### 8. **Utils** (`utils/index.js`)
- JSON parsing utilities
- Vector operations
- Validation helpers
- Common utility functions

## 🔧 Setup & Installation

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Configuration**
   Create a `.env` file in the backend directory:
   ```env
   # AWS Configuration
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key
   AWS_SECRET_ACCESS_KEY=your_secret_key

   # Anthropic Configuration
   ANTHROPIC_API_KEY=your_anthropic_key

   # Server Configuration (Optional)
   PORT=8080
   HOST=localhost

   # Transcription Configuration (Optional)
   LANGUAGE_CODE=en-IN
   MEDIA_ENCODING=pcm
   SAMPLE_RATE=8000
   MAX_SPEAKERS=2

   # Embedding Configuration (Optional)
   EMBEDDING_MODEL=amazon.titan-embed-text-v1
   VECTOR_FILE=heythere_vectors.json
   ```

3. **Prepare Vector Data**
   Ensure your vector file (`heythere_vectors.json`) is in the backend directory.

4. **Start the Server**
   ```bash
   npm start
   ```

## 🔄 Application Flow

1. **Initialization**
   - Load environment configuration
   - Initialize RAG service (load vectors)
   - Start WebSocket server
   - Set up graceful shutdown handlers

2. **Connection Handling**
   - New WebSocket connection established
   - Precompute RAG summary for the session
   - Set up audio buffer and transcription stream

3. **Real-time Processing**
   - Receive audio chunks from client
   - Stream to AWS Transcribe
   - Process transcription events
   - Update conversation state

4. **AI Analysis**
   - Evaluate customer messages for suggestion triggers
   - Determine if RAG context is needed
   - Generate contextual suggestions
   - Send real-time updates to client

## 📊 Message Types

The WebSocket server sends different message types to clients:

- `transcript`: Real-time transcription data
- `summary`: Updated conversation summary
- `llm_eval`: AI evaluation results
- `suggestions`: Generated suggestion cards
- `error`: Error messages

## 🛡️ Error Handling

- **Service Initialization**: Validates required environment variables
- **Connection Errors**: Graceful handling of WebSocket disconnections
- **AI Failures**: Fallback responses when AI services are unavailable
- **Transcription Errors**: Handles AWS Transcribe stream issues
- **RAG Failures**: Continues operation without vector context

## 🧪 Development

### Adding New Features

1. **New Service**: Create in `services/` directory with proper initialization
2. **Configuration**: Add to `config/environment.js`
3. **Constants**: Define in `constants/index.js`
4. **Integration**: Wire into main application flow

### Testing

The modular architecture makes unit testing straightforward:
- Each service can be tested independently
- Mock dependencies easily with dependency injection
- Clear separation of business logic and infrastructure

## 🔍 Monitoring

The application provides status and statistics through:
- Startup configuration logging
- Connection count tracking
- Service initialization status
- Vector loading statistics

## 🚦 Performance Considerations

- **RAG Summary Caching**: Precomputed per connection to reduce latency
- **Vector Loading**: One-time initialization on startup
- **Stream Processing**: Efficient audio buffer management
- **Memory Management**: Proper cleanup on connection close

## 🔐 Security

- Environment variable validation
- Graceful error handling without exposing internals
- Proper WebSocket connection management
- AWS credentials isolation

## 📈 Scalability

The modular architecture supports:
- Horizontal scaling through load balancing
- Service-specific optimization
- Easy feature addition/removal
- Database integration for conversation persistence
- Multi-tenant support

---

This modular architecture provides a solid foundation for maintainable, scalable real-time AI applications.
