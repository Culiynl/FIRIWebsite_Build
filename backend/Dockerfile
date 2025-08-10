# Use an official lightweight Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Install build tools and Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    g++ \
    make \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Bundle app source
COPY . .

# Your app binds to port 8080 so you'll use the EXPOSE instruction
EXPOSE 8080

# Define the command to run your app
CMD [ "node", "index.js" ]