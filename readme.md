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

See the [examples directory](/examples) for more usage examples.

[1]: https://gdal.org/download.html
[2]: https://github.com/wavded/ogr2ogr
[3]: https://ogre.adc4gis.com
[4]: https://github.com/wavded/ogre/wiki
