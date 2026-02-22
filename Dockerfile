FROM node:20-alpine AS base
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL dependencies (including dev) for building
FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force
COPY . .
RUN npx prisma generate
RUN npm run build

# Production image — only production deps
FROM base AS production
ENV NODE_ENV=production
EXPOSE 3000

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

CMD ["npm", "run", "docker-start"]
