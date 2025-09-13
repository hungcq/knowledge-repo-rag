FROM node:20-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npm install

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Copy source code (includes /generated/prisma if you keep it in repo)
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 1918

CMD ["node", "dist/server.js"]
