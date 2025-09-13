FROM node:20-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
COPY tsconfig.json ./
COPY generated ./generated

RUN npm install
# Copy source code (includes /generated/prisma if you keep it in repo)
COPY . .
RUN mkdir -p dist/generated && cp -r generated/prisma dist/generated/

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 1918

CMD ["node", "dist/server.js"]
