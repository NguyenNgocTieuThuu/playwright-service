FROM mcr.microsoft.com/playwright:v1.53.1-jammy

WORKDIR /app

# Copy only package files to install dependencies
COPY package*.json ./

# Install dependencies only (no devDependencies for production)
RUN npm install --omit=dev

# Copy the rest of your service
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
