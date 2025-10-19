FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY dist ./dist
COPY nginx ./nginx
COPY server ./server
COPY .github ./.github
RUN npm install -g pnpm && pnpm install --shamefully-hoist
CMD ["pnpm", "dev"]
