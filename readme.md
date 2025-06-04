[![build](https://github.com/wavded/ogre/actions/workflows/build.yml/badge.svg)](https://github.com/wavded/ogre/actions/workflows/build.yml) [![NPM](https://img.shields.io/npm/v/ogre.svg)](https://npmjs.com/package/ogre) ![NPM Downloads](https://img.shields.io/npm/dt/ogre.svg)

Ogre is a web frontend and API for the [ogr2ogr][2] module. See a [live demo here][3].

## Installation

1. [Install GDAL tools][1] (includes the `ogr2ogr` command line tool)

2. Install package:

```sh
npm install -g ogre
```

## Usage

To run the app:

```sh
ogre -p 3000
```

Then visit <http://localhost:3000> in a your favorite browser.

Options include:

```
Usage: ogre [options]

Options:
 -h, --help      help
 -p, --port      port number (default 3000)
 -v, --version   version number
 -t, --timeout   timeout before ogre kills a job in ms (default 15000)
 -l, --limit     byte limit for uploads (default 50000000)

Additional POST parameters for /convert:
 dialect        SQL dialect (e.g., 'sqlite')
 sql            SQL query for filtering data
 simplify       Value for simplifying geometries (e.g., '0.1')
 configDxfEncoding  Set to any value to enable DXF_ENCODING=UTF-8 config
 writeBbox      Set to any value to enable WRITE_BBOX=YES

Additional POST parameters for /info:
 upload         File to analyze (required)
 summary        Set to any value to show summary only
 features       Set to any value to show features (default)
 al             Set to any value to list all layers
 where          Attribute query (e.g., 'name="test"')
 sql            SQL query for filtering data
 dialect        SQL dialect (e.g., 'sqlite')
 limit          Limit number of features (e.g., '10')
 spat           Spatial filter 'xmin ymin xmax ymax'
 geomfield      Geometry field name
 fid            Feature ID to show
 layerName      Specific layer name to analyze
```

## DXF Conversion

To convert DXF files with SQL queries, you can use the additional parameters:

```sh
curl -F "upload=@your_file.dxf" \
     -F "dialect=sqlite" \
     -F "sql=SELECT Layer, EntityHandle, Text, OGR_STYLE, * FROM entities" \
     -F "simplify=0.1" \
     -F "configDxfEncoding=true" \
     -F "writeBbox=true" \
     http://localhost:3000/convert > output.geojson
```

## File Information with ogrinfo

To get information about spatial files, you can use the new ogrinfo endpoints:

```sh
# Get basic information about a file
curl -F "upload=@your_file.shp" \
     http://localhost:3000/info

# Get summary information only
curl -F "upload=@your_file.shp" \
     -F "summary=true" \
     http://localhost:3000/info

# Get information with SQL filter
curl -F "upload=@your_file.shp" \
     -F "sql=SELECT * FROM layer WHERE population > 1000000" \
     -F "dialect=sqlite" \
     http://localhost:3000/info

# Get information about GeoJSON from URL
curl -X POST \
     -F "jsonUrl=https://example.com/data.geojson" \
     http://localhost:3000/infoJson

# Get information about GeoJSON data
curl -X POST \
     -F 'json={"type":"FeatureCollection","features":[...]}' \
     http://localhost:3000/infoJson
```

See the [examples directory](/examples) for more usage examples.

[1]: https://gdal.org/download.html
[2]: https://github.com/wavded/ogr2ogr
[3]: https://ogre.adc4gis.com
[4]: https://github.com/wavded/ogre/wiki
