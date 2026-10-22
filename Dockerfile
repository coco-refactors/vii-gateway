FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Durable data (sessions, quest assignments, tool key). Mount a volume on /data.
ENV PORT=3000 \
    NODE_ENV=production \
    DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

CMD ["node", "src/index.js"]
