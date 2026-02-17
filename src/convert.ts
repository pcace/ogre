import AdmZip from "adm-zip"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ogr2ogr } from "ogr2ogr"
import type { UploadOpts } from "../index"

const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^"+/, '').substring(0, 255)
}

function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip')
}

interface ShapefileInfo {
  shpPath: string
  basename: string
}

async function findAllShapefiles(extractPath: string): Promise<{ shapefiles: ShapefileInfo[]; error?: string }> {
  const files = await readdir(extractPath)

  // Find all .shp files
  const shpFiles = files.filter(f => f.toLowerCase().endsWith('.shp'))

  if (shpFiles.length === 0) {
    return { shapefiles: [], error: "No .shp file found in ZIP" }
  }

  const validShapefiles: ShapefileInfo[] = []
  const errors: string[] = []

  // Validate each shapefile
  for (const shpFile of shpFiles) {
    const basename = shpFile.substring(0, shpFile.lastIndexOf('.'))

    // Check for required companion files (.shx and .dbf)
    const hasShx = files.some(f =>
      f.toLowerCase() === (basename.toLowerCase() + '.shx')
    )
    const hasDbf = files.some(f =>
      f.toLowerCase() === (basename.toLowerCase() + '.dbf')
    )

    if (!hasShx) {
      errors.push(`Shapefile '${basename}' is incomplete: missing .shx file`)
      continue
    }

    if (!hasDbf) {
      errors.push(`Shapefile '${basename}' is incomplete: missing .dbf file`)
      continue
    }

    validShapefiles.push({
      shpPath: join(extractPath, shpFile),
      basename: basename
    })
  }

  if (validShapefiles.length === 0) {
    return { shapefiles: [], error: errors.join('; ') }
  }

  return { shapefiles: validShapefiles }
}

function mergeFeatureCollections(geojsons: any[]): any {
  const mergedFeatureCollection = {
    type: "FeatureCollection",
    features: [] as any[]
  }

  for (const geojson of geojsons) {
    if (geojson && geojson.type === "FeatureCollection" && Array.isArray(geojson.features)) {
      mergedFeatureCollection.features.push(...geojson.features)
    } else if (geojson && geojson.type === "Feature") {
      // Single feature
      mergedFeatureCollection.features.push(geojson)
    }
  }

  return mergedFeatureCollection
}

export async function convertHandler(
  c: any,
  opts: { timeout: number; limit: number }
) {
  let {
    upload,
    targetSrs,
    sourceSrs,
    rfc7946,
    forcePlainText,
    forceDownload,
    callback,
    dialect,
    sql,
    simplify,
    configDxfEncoding,
    writeBbox,
  }: UploadOpts = await c.req.parseBody()
  if (!upload) {
    return c.json({ error: true, msg: "No file provided" }, 400)
  }

  let ogrOpts = {
    timeout: opts.timeout,
    options: [] as string[],
    maxBuffer: opts.limit * 10,
  }

  if (targetSrs) ogrOpts.options.push("-t_srs", targetSrs)
  if (sourceSrs) ogrOpts.options.push("-s_srs", sourceSrs)
  if (rfc7946 != null) ogrOpts.options.push("-lco", "RFC7946=YES")
  if (dialect) ogrOpts.options.push("-dialect", dialect)
  if (sql) ogrOpts.options.push("-sql", sql)
  if (simplify) ogrOpts.options.push("-simplify", simplify)
  if (configDxfEncoding) ogrOpts.options.push("--config", "DXF_ENCODING", "UTF-8")
  if (writeBbox) ogrOpts.options.push("-lco", "WRITE_BBOX=YES")

  c.header(
    "content-type",
    forcePlainText != null
      ? "text/plain; charset=utf-8"
      : "application/json; charset=utf-8"
  )

  if (forceDownload != null) {
    c.header("content-disposition", "attachment;")
  }

  let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
  let extractPath: string | null = null
  let body: string

  try {
    let buf = await upload.arrayBuffer()
    await writeFile(path, Buffer.from(buf))

    let data: any

    // Check if it's a ZIP file (potentially containing shapefile(s))
    if (isZipFile(upload.name)) {
      extractPath = TMP_DIR + "/" + randomBytes(16).toString("hex")
      await mkdir(extractPath, { recursive: true })

      try {
        // Extract ZIP file
        const zip = new AdmZip(path)
        zip.extractAllTo(extractPath, true)

        // Find all shapefiles in the ZIP
        const { shapefiles, error } = await findAllShapefiles(extractPath)

        if (error) {
          return c.json({ error: true, msg: error }, 400)
        }

        if (shapefiles.length === 0) {
          return c.json({ error: true, msg: "No valid shapefiles found in ZIP" }, 400)
        }

        // Convert all shapefiles and merge them
        const geojsons: any[] = []

        for (const shapefile of shapefiles) {
          try {
            const result = await ogr2ogr(shapefile.shpPath, ogrOpts)
            geojsons.push(result.data)
          } catch (ogrError: any) {
            console.error(`Error converting ${shapefile.basename}:`, ogrError.message)
            // Continue with other shapefiles even if one fails
          }
        }

        if (geojsons.length === 0) {
          return c.json({ error: true, msg: "Failed to convert any shapefiles" }, 400)
        }

        // Merge all GeoJSONs into a single FeatureCollection
        data = mergeFeatureCollections(geojsons)

      } catch (zipError: any) {
        return c.json({
          error: true,
          msg: "Failed to extract ZIP file: " + zipError.message
        }, 400)
      }
    } else {
      // Single file (not ZIP)
      const result = await ogr2ogr(path, ogrOpts)
      data = result.data
    }

    if (callback) {
      body = callback + "(" + JSON.stringify(data) + ")"
    } else {
      body = JSON.stringify(data)
    }
  } finally {
    // Cleanup uploaded file
    unlink(path).catch((er) => console.error("unlink error", er.message))

    // Cleanup extracted files if ZIP was processed
    if (extractPath) {
      rm(extractPath, { recursive: true, force: true })
        .catch((er) => console.error("cleanup error", er.message))
    }
  }
  return c.body(body)
}
