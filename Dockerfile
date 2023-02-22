FROM node:16-alpine
# WORKDIR /
# COPY package*.json ./
COPY . . 
RUN npm -g install
RUN npm install -g ogre

# Make ogr2ogr from src-->
RUN apk add --update wget python3 python3-dev curl cmake doxygen  make gcc g++ musl-dev binutils autoconf automake libtool pkgconfig check-dev file patch linux-headers proj proj-dev
RUN wget https://github.com/OSGeo/gdal/releases/download/v3.6.2/gdal-3.6.2.tar.gz
RUN tar xzf gdal-3.6.2.tar.gz
RUN cd gdal-3.6.2 && cmake . &&  cmake --build . && cmake --build . --target install

# get ogr2ogr from pkg-->
# RUN apk add --update wget gdal


# COPY . .    
EXPOSE 3000
CMD [ "npm", "start" ]
