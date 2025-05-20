# Converting DXF Files with Ogre

This example demonstrates how to convert DXF files to GeoJSON using Ogre with SQL filtering.

## Using the Web API

You can convert a DXF file to GeoJSON using the Ogre HTTP API:

```bash
# Example curl command to convert a DXF file with SQL filtering
curl -F "upload=@your_file.dxf" \
     -F "dialect=sqlite" \
     -F "sql=SELECT Layer, EntityHandle, Text, OGR_STYLE, * FROM entities" \
     -F "simplify=0.1" \
     -F "configDxfEncoding=true" \
     -F "writeBbox=true" \
     http://localhost:3000/convert > output.geojson
```

## Parameters Explanation

- `dialect=sqlite`: Specifies the SQL dialect to use (SQLite in this case)
- `sql=SELECT Layer, EntityHandle, Text, OGR_STYLE, * FROM entities`: SQL query to filter the data
- `simplify=0.1`: Simplifies geometries (useful for curves in DXF files)
- `configDxfEncoding=true`: Enables UTF-8 encoding for DXF files
- `writeBbox=true`: Enables writing bounding box information

## Node.js Example

```javascript
const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

async function convertDxf() {
  const form = new FormData();
  form.append('upload', fs.createReadStream('your_file.dxf'));
  form.append('dialect', 'sqlite');
  form.append('sql', 'SELECT Layer, EntityHandle, Text, OGR_STYLE, * FROM entities');
  form.append('simplify', '0.1');
  form.append('configDxfEncoding', 'true');
  form.append('writeBbox', 'true');

  const response = await fetch('http://localhost:3000/convert', {
    method: 'POST',
    body: form
  });

  const data = await response.json();
  fs.writeFileSync('output.geojson', JSON.stringify(data));
}

convertDxf().catch(console.error);
```
