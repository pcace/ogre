import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { RasterizeOpts } from "../index"

const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').substring(0, 255)
}
function validateNumericInput(value: string | undefined, min?: number, max?: number): boolean {
  if (!value) return true
  const num = parseFloat(value)
  if (isNaN(num)) return false
  if (min !== undefined && num < min) return false
  if (max !== undefined && num > max) return false
  return true
}
function sanitizeCommandArg(arg: string): string {
  return arg.replace(/[;&|`$(){}[\]<>\'"\\]/g, '')
}

export async function rasterizeHandler(c: any, opts: { timeout: number; limit: number }) {
  let {
    upload,
    json,
    jsonUrl,
    width,
    height,
    xres,
    yres,
    xmin,
    ymin,
    xmax,
    ymax,
    burn,
    attribute,
    nodata,
    init,
    srs,
    allTouched,
    outputType,
    bands,
    layerName,
    sql,
    dialect,
    where,
  } = await c.req.parseBody() as RasterizeOpts

  if (!upload && !json && !jsonUrl) {
    return c.json({ error: true, msg: "No data provided (upload, json, or jsonUrl required)" }, 400)
  }

  if (!validateNumericInput(width, 1, 65536)) {
    return c.json({ error: true, msg: "Invalid width parameter" }, 400)
  }
  if (!validateNumericInput(height, 1, 65536)) {
    return c.json({ error: true, msg: "Invalid height parameter" }, 400)
  }
  if (!validateNumericInput(burn, -999999, 999999)) {
    return c.json({ error: true, msg: "Invalid burn value" }, 400)
  }

  let inputPath = ""
  let outputPath = ""
  let format = "GTiff"
  let extension = ".tif"

  try {
    if (upload) {
      inputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
      let buf = await upload.arrayBuffer()
      await writeFile(inputPath, Buffer.from(buf))
    } else if (json || jsonUrl) {
      inputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + ".geojson"
      let data
      if (json) {
        try {
          data = JSON.parse(json)
        } catch (_er) {
          return c.json({ error: true, msg: "Invalid json provided" }, 400)
        }
      } else if (jsonUrl) {
        let response = await fetch(jsonUrl)
        if (!response.ok) {
          return c.json({ error: true, msg: "Failed to fetch JSON from URL" }, 400)
        }
        data = await response.json()
      }
      await writeFile(inputPath, JSON.stringify(data))
    }

    outputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + extension

    let args = ["gdal_rasterize"]
    if (format) args.push("-of", sanitizeCommandArg(format))
    if (outputType) args.push("-ot", sanitizeCommandArg(outputType))
    if (burn) {
      args.push("-burn", sanitizeCommandArg(burn))
    } else if (attribute) {
      args.push("-a", sanitizeCommandArg(attribute))
    } else {
      args.push("-burn", "255")
    }
    if (bands && bands.length > 0) {
      (bands as string[]).forEach((band: string) => args.push("-b", band))
    }
    if (width && height) {
      args.push("-ts", width, height)
    } else if (xres && yres) {
      args.push("-tr", xres, yres)
    } else {
      args.push("-ts", "512", "512")
    }
    if (xmin && ymin && xmax && ymax) {
      args.push("-te", xmin, ymin, xmax, ymax)
    }
    if (srs) args.push("-a_srs", srs)
    if (nodata) args.push("-a_nodata", nodata)
    if (init) args.push("-init", init)
    if (allTouched) args.push("-at")
    if (layerName) args.push("-l", layerName)
    if (sql) args.push("-sql", sql)
    if (dialect) args.push("-dialect", dialect)
    if (where) args.push("-where", where)
    args.push(inputPath, outputPath)

    const { promisify } = await import("node:util")
    const { exec } = await import("node:child_process")
    const execAsync = promisify(exec)
    let { stderr } = await execAsync(args.join(" "), {
      timeout: opts.timeout,
      maxBuffer: opts.limit * 10,
    })
    if (stderr && stderr.trim()) {
      console.warn("gdal_rasterize stderr:", stderr)
    }
    let { readFile } = await import("node:fs/promises")
    let outputBuffer = await readFile(outputPath)
    c.header("content-type", "image/tiff")
    c.header("content-disposition", `attachment; filename=rasterized${extension}`)
    return c.body(outputBuffer)
  } catch (error: any) {
    console.error("gdal_rasterize error:", error)
    return c.json({
      error: true,
      message: error.message || "gdal_rasterize command failed"
    }, 500)
  } finally {
    if (inputPath) {
      unlink(inputPath).catch((er) => console.error("unlink error (input):", er.message))
    }
    if (outputPath) {
      unlink(outputPath).catch((er) => console.error("unlink error (output):", er.message))
    }
  }
}
