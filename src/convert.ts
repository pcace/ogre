import AdmZip from "adm-zip"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ogr2ogr } from "ogr2ogr"

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
  // Parse form data to extract all files with name "upload"
  const formData = await c.req.formData()
  const allUploads: File[] = []

  for (const [key, value] of formData.entries()) {
    if (key === 'upload' && value instanceof File) {
      allUploads.push(value)
    }
  }

  if (allUploads.length === 0) {
    return c.json({ error: true, msg: "No file provided" }, 400)
  }

  // Normalize upload to array for consistent handling
  const uploads = allUploads

  // Extract other parameters from formData
  const targetSrs = formData.get('targetSrs') as string | null
  const sourceSrs = formData.get('sourceSrs') as string | null
  const rfc7946 = formData.get('rfc7946') as string | null
  const forcePlainText = formData.get('forcePlainText') as string | null
  const forceDownload = formData.get('forceDownload') as string | null
  const callback = formData.get('callback') as string | null
  const dialect = formData.get('dialect') as string | null
  const sql = formData.get('sql') as string | null
  const simplify = formData.get('simplify') as string | null
  const configDxfEncoding = formData.get('configDxfEncoding') as string | null
  const writeBbox = formData.get('writeBbox') as string | null

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

  let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(uploads[0].name)
  let extractPath: string | null = null
  let responseBody: string

  try {
    let data: any

    // Case 1: Multiple files uploaded (e.g., shapefile components)
    if (uploads.length > 1) {
      extractPath = TMP_DIR + "/" + randomBytes(16).toString("hex")
      await mkdir(extractPath, { recursive: true })

      // Write all uploaded files to the temp directory
      for (const file of uploads) {
        const filePath = join(extractPath, sanitizeFilename(file.name))
        const buf = await file.arrayBuffer()
        await writeFile(filePath, new Uint8Array(buf))
      }

      // Find all shapefiles in the directory
      const { shapefiles, error } = await findAllShapefiles(extractPath)

      if (error) {
        return c.json({ error: true, msg: error }, 400)
      }

      if (shapefiles.length === 0) {
        return c.json({ error: true, msg: "No valid shapefiles found in uploaded files" }, 400)
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
    }
    // Case 2: Single file - could be ZIP or other format
    else {
      let buf = await uploads[0].arrayBuffer()
      await writeFile(path, new Uint8Array(buf))

      // Check if it's a ZIP file (potentially containing shapefile(s))
      if (isZipFile(uploads[0].name)) {
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
    }

    if (callback) {
      responseBody = callback + "(" + JSON.stringify(data) + ")"
    } else {
      responseBody = JSON.stringify(data)
    }
  } finally {
    // Cleanup uploaded file (only for single file uploads)
    if (uploads.length === 1) {
      unlink(path).catch((er) => console.error("unlink error", er.message))
    }

    // Cleanup extracted files if ZIP was processed or multi-file upload
    if (extractPath) {
      rm(extractPath, { recursive: true, force: true })
        .catch((er) => console.error("cleanup error", er.message))
    }
  }
  return c.body(responseBody)
}
