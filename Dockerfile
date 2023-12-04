FROM node:21

WORKDIR /app

COPY ["package.json", "package-lock.json*", "./"]

RUN npm install

COPY . .

CMD [ "node", "--max-old-space-size=8192", "ingest/index.js" ]