# Use the correct Playwright version
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy service code
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
