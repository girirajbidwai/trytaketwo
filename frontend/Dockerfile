FROM node:18-alpine

WORKDIR /app/frontend

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Host 0.0.0.0 is required for Vite to be accessible outside the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
