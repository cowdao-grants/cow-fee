FROM node:lts

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./

# Install dependencies with yarn
RUN yarn

# Copy the rest of the application code
COPY . .

# Run the script with yarn ts-node index.ts
CMD ["yarn", "ts-node", "index.ts"]
