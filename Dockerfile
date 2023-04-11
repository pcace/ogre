FROM node:19-alpine3.16 AS node
FROM ghcr.io/osgeo/gdal:alpine-normal-latest

COPY --from=node /usr/lib /usr/lib
COPY --from=node /usr/local/share /usr/local/share
COPY --from=node /usr/local/lib /usr/local/lib
COPY --from=node /usr/local/include /usr/local/include
COPY --from=node /usr/local/bin /usr/local/bin

COPY . . 

RUN npm -g install
RUN npm install -g ts-node
RUN npm install -g typescript
RUN npm i --save-dev @types/node

# COPY . .    
EXPOSE 3000
CMD [ "npm", "start" ]
