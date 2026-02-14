FROM node:18

WORKDIR /app/backend

# Install system dependencies if needed (ffmpeg is handled by ffmpeg-static usually, 
# but installing system ffmpeg is a good backup and typically required for some libs)
# We also ensure python/make/g++ are available for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y ffmpeg python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# Ensure storage directories exist
RUN mkdir -p storage/uploads storage/thumbnails storage/exports data

EXPOSE 3001

CMD ["npm", "start"]
