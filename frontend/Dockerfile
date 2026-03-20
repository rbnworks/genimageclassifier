FROM node:20-slim

WORKDIR /app

COPY package*.json ./
# npm ci is faster than npm install: reads package-lock.json directly, no resolution step
RUN npm ci

# Source is bind-mounted at runtime; COPY is only used for 'docker build' without compose.
COPY . .

EXPOSE 3000
# --host 0.0.0.0 exposes Vite outside the container
# Vite already watches the file system by default; poll mode handles Windows/WSL FS events
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
