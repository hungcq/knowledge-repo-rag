# Knowledge Repo RAG
## Overview
**Knowledge Repo RAG** is an end-to-end, production-minded demonstration of a Retrieval-Augmented Generation (RAG) application.
It enables efficient semantic search and augmentation of large knowledge bases using modern LLMs.
The project features a TypeScript/Node.js backend (Express), a React frontend,
and a script to ingest data into Qdrant vector database.

## Features
- **RAG with OpenAI Integration:** Combines vector search with GPT-powered answer completion.
- **Semantic Search:** Use Qdrant vector database for fast similarity search over knowledge repositories.
- **Document Ingestion:** Simple scripts to upload and vectorize knowledge sources.
- **Responsive, Real-time Frontend:** Modern React UI for querying and visualizing results; chat responses displayed token by token.
- **API-First Backend:** Express and Socket.IO APIs serving search and chat endpoints.
- **Docker & K8s Ready:** Out-of-the-box Dockerfile and Kubernetes manifest for smooth deployment.
- **Prisma ORM:** Type-safe and robust DB layer (for SQL metadata, optional).

## Architecture
``` mermaid
flowchart TD
  subgraph Frontend [React App]
    UI["User Interface"]
    UI -->|Sends Question| FAPI["/api/search"]
  end

  subgraph Backend [Express API]
    FAPI --> SRV["RAG Service"]
    SRV -->|Semantic Query| Qdrant[(Qdrant Vector DB)]
    SRV -->|Doc Lookup| PrismaDB[(SQL DB)]
    SRV -->|LLM Completion| OpenAI[(OpenAI API)]
  end

  Frontend --> Backend
  Backend --> Qdrant
  Backend --> OpenAI
  Backend --> PrismaDB

  subgraph Lambda [Optional Lambda]
    LambdaAPI["/search"]
    LambdaAPI --> Qdrant
    LambdaAPI --> OpenAI
  end

  Note1[("Document Uploader<br/>(Node Script)")];
  Note1 --> Qdrant
```
## Code Organization
``` 
knowledge-repo-rag/
├── backend-express/    # Express API backend (TypeScript, Prisma, Qdrant integration)
│   ├── k8s/           # Kubernetes deployment manifests
│   ├── migrations/    # Database migrations (Prisma)
│   ├── prisma/        # Prisma schema
│   ├── load-knowledge-repo-qdrant.ts # Data ingestion script
│   └── server.ts      # Entry point for Express API
├── frontend/          # React client
│   ├── public/        # Static public assets
│   └── src/           # React app source
│       ├── App.jsx
│       └── main.jsx
│   └── deploy-s3.sh   # S3 deployment script
└── .github/           # GitHub Actions workflows
```

## Run Locally and Deploy
### Prerequisites
- Node.js v18+
- npm
- Docker (for local Qdrant, PostgreSQL, or full-stack dev)
- OpenAI API key
- (Optional) AWS CLI for deployment

### Local Development
1. **Clone the repo & install dependencies:**
``` bash
   git clone <this_repo_url>
   cd knowledge-repo-rag/backend-express
   npm install
   # Same for frontend
```
2. **Configure environment:**
- Create a `.env` file in `backend-express`
- Set OpenAI keys, Qdrant URL, DB params, etc.

3. **Start development stack:**
- Run Qdrant (Docker):
``` bash
     docker run -p 6333:6333 qdrant/qdrant
```
- (Optional) Launch Postgres if using SQL features.
- Start backend:
``` bash
     npm run dev
```
- Start frontend:
``` bash
     cd ../frontend && npm install && npm run dev
```

4. **Ingest sample data (optional):**
``` bash
   cd backend-express
   npx tsx load-knowledge-repo-qdrant.ts <your-documents-dir>
```

### Deploying
- **Docker:** Build and push the Docker images from `backend-express/Dockerfile`
- **Kubernetes:** Apply manifests from `k8s/`
- **Frontend static deploy:** Serve the build from S3 static site hosting `deploy-s3.sh`

## Security
- Credentials are managed via k8s secret, encrypted in `secret.enc.yaml`.
- K8s config file, Docker hub credentials, and AWS keys are stored as GitHub Actions secrets.
- HTTPS and WSS are used in production.
- Limit prompt injection by sanitizing inputs and constraining the LLM context window.

## Production-ready Improvements
This demo is suitable for experimentation and as a reference for real-world productionization.
For robust deployments, consider the following improvements:
- **Auth & RBAC:** Add authentication and role-based access control.
- **Rate Limiting:** Prevent abuse of backend and LLM quota.
- **Observability:** Add logging, tracing, and metrics (Prometheus/Grafana).
- **Robust Error Handling:** Improve edge-case handling, return proper error codes, support retries.
- **Scalable Storage:** Use managed Qdrant/Weaviate and cloud SQL for data storage.
- **Compliance:** Ensure data privacy, e.g., GDPR, by logging and/or auditing data usage.
- **Input/Output Validation:** Strictly validate and sanitize incoming and outgoing API traffic.
- **CI/CD:** Automate tests and evals to reduce risk of regression.

**Feel free to fork, experiment, or deploy in your own organization! Pull requests and questions are welcome.**
