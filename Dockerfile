FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "apps/server/src/index.ts"]
