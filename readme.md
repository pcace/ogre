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

Additional POST parameters for /rasterize:
 upload         File to rasterize (required, or use json/jsonUrl)
 json           GeoJSON string to rasterize
 jsonUrl        URL to GeoJSON to rasterize
 outputFormat   Output format: 'GTiff' (default) or 'PNG'
 width          Output width in pixels (use with height)
 height         Output height in pixels (use with width)
 xres           Output X resolution (use with yres)
 yres           Output Y resolution (use with xres)
 xmin           Minimum X extent
 ymin           Minimum Y extent
 xmax           Maximum X extent
 ymax           Maximum Y extent
 burn           Fixed value to burn (default: 255)
 attribute      Attribute name to get burn values from
 nodata         NoData value for output
 init           Initialize raster with this value
 srs            Spatial reference system
 allTouched     Set to any value to enable ALL_TOUCHED option
 outputType     Output data type (e.g., 'Byte', 'Int16', 'Float32')
 layerName      Specific layer name to rasterize
 sql            SQL query for filtering data
 dialect        SQL dialect
 where          WHERE clause for filtering
```

## Rasterization with gdal_rasterize

To convert GeoJSON or other vector formats to raster images (GeoTIFF or PNG), you can use the rasterize endpoint:

```sh
# Convert GeoJSON file to GeoTIFF
curl -F "upload=@your_file.geojson" \
     -F "outputFormat=GTiff" \
     -F "width=1024" \
     -F "height=1024" \
     -F "burn=255" \
     http://localhost:3000/rasterize > output.tif

# Convert GeoJSON with custom extent and resolution
curl -F "upload=@your_file.geojson" \
     -F "outputFormat=PNG" \
     -F "xmin=-180" \
     -F "ymin=-90" \
     -F "xmax=180" \
     -F "ymax=90" \
     -F "xres=0.1" \
     -F "yres=0.1" \
     -F "burn=255" \
     -F "srs=EPSG:4326" \
     http://localhost:3000/rasterize > output.png

# Convert with attribute-based burn values
curl -F "upload=@your_file.geojson" \
     -F "attribute=population" \
     -F "width=512" \
     -F "height=512" \
     -F "outputType=Float32" \
     http://localhost:3000/rasterize > output.tif

# Convert GeoJSON from URL
curl -F "jsonUrl=https://example.com/data.geojson" \
     -F "outputFormat=PNG" \
     -F "width=800" \
     -F "height=600" \
     http://localhost:3000/rasterize > output.png
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

## GDALInfo (Raster File Information)

To get information about a raster file (e.g. GeoTIFF), use the new gdalinfo endpoint:

```sh
# Get raster file information as JSON
curl -F "upload=@your_file.tif" \
     http://localhost:3000/gdalinfo
```

- The response will be a JSON object with all metadata and raster information as returned by `gdalinfo -json`.

See the [examples directory](/examples) for more usage examples.

[1]: https://gdal.org/download.html
[2]: https://github.com/wavded/ogr2ogr
[3]: https://ogre.adc4gis.com
[4]: https://github.com/wavded/ogre/wiki
