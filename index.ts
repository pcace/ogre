import {serve} from "@hono/node-server"
import {ErrorHandler, Handler, Hono, NotFoundHandler} from "hono"
import {bodyLimit} from "hono/body-limit"
import {cors} from "hono/cors"
import {BlankEnv, BlankSchema} from "hono/types"
import {randomBytes} from "node:crypto"
import {unlink, writeFile} from "node:fs/promises"
import {tmpdir} from "node:os"
import {Readable} from "node:stream"
import {promisify} from "node:util"
import {exec} from "node:child_process"
import {ogr2ogr} from "ogr2ogr"
import index from "./index.html?raw"

const execAsync = promisify(exec)

export interface OgreOpts {
  port?: number
  timeout?: number
  limit?: number
}

interface UploadOpts {
  targetSrs?: string
  upload: File
  sourceSrs?: string
  rfc7946?: string
  forcePlainText?: string
  forceDownload?: string
  callback?: string
  dialect?: string
  sql?: string
  simplify?: string
  configDxfEncoding?: string
  writeBbox?: string
}

interface OgrInfoOpts {
  upload?: File
  json?: string
  summary?: string
  features?: string
  al?: string
  where?: string
  sql?: string
  dialect?: string
  limit?: string
  spat?: string
  geomfield?: string
  fid?: string
  layerName?: string
}

interface RasterizeOpts {
  upload?: File
  json?: string
  jsonUrl?: string
  outputFormat?: string // Only 'GTiff' supported
  width?: string
  height?: string
  xres?: string
  yres?: string
  xmin?: string
  ymin?: string
  xmax?: string
  ymax?: string
  burn?: string
  attribute?: string
  nodata?: string
  init?: string
  srs?: string
  allTouched?: string
  outputType?: string // 'Byte', 'Int16', 'Float32', etc.
  bands?: string[]
  layerName?: string
  sql?: string
  dialect?: string
  where?: string
}

interface TranslateOpts {
  upload: File
  outputFormat?: string // 'JPEG', 'PNG', 'GTiff', etc.
  outputType?: string // 'Byte', 'Int16', 'Float32', etc.
  band?: string[] // band selection
  mask?: string
  expand?: string // 'gray', 'rgb', 'rgba'
  outsize?: { width: string; height: string } // output size
  scale?: { srcMin?: string; srcMax?: string; dstMin?: string; dstMax?: string }
  srcwin?: { xoff: string; yoff: string; xsize: string; ysize: string }
  projwin?: { ulx: string; uly: string; lrx: string; lry: string }
  projwinSrs?: string
  quality?: string // for JPEG output
  compress?: string // compression method
  nodata?: string
}

const TMP_DIR = tmpdir()

// Security functions for input validation and sanitization
function sanitizeFilename(filename: string): string {
  // Remove potentially dangerous characters and paths
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').substring(0, 255)
}

function validateNumericInput(value: string | undefined, min?: number, max?: number): boolean {
  if (!value) return true // optional parameters
  const num = parseFloat(value)
  if (isNaN(num)) return false
  if (min !== undefined && num < min) return false
  if (max !== undefined && num > max) return false
  return true
}

function validateStringInput(value: string | undefined, allowedChars?: RegExp): boolean {
  if (!value) return true // optional parameters
  if (value.length > 1000) return false // prevent extremely long inputs
  if (allowedChars && !allowedChars.test(value)) return false
  return true
}

function sanitizeCommandArg(arg: string): string {
  // Remove shell metacharacters to prevent command injection
  return arg.replace(/[;&|`$(){}[\]<>'"\\]/g, '')
}

export class Ogre {
  app: Hono<BlankEnv, BlankSchema, "">
  private timeout: number
  private port: number
  private limit: number

  constructor({
    port = 3000,
    timeout = 150000,
    limit = 50000000,
  }: OgreOpts = {}) {
    this.port = port
    this.timeout = timeout
    this.limit = limit

    let app = (this.app = new Hono())
    app.notFound(this.notFound())
    app.onError(this.serverError())

    app.options("/", this.heartbeat())
    app.get("/", this.index())
    app.use(cors(), bodyLimit({maxSize: this.limit}))
    app.post("/convert", this.convert())
    app.post("/convertJson", this.convertJson())
    app.post("/rasterize", this.rasterize())
    app.post("/translate", this.translate())
    app.post("/info", this.info())
    app.post("/infoJson", this.infoJson())
  }

  start(): void {
    serve({fetch: this.app.fetch, port: this.port})
  }

  private notFound = (): NotFoundHandler => (c) => {
    return c.json({error: "Not found"}, 404)
  }

  private serverError = (): ErrorHandler => (er, c) => {
    console.error(er.stack)
    return c.json({error: true, message: er.message}, 500)
  }

  private heartbeat = (): Handler => async () => new Response()

  private index = (): Handler => async (c) => c.html(index)

  private convert = (): Handler => async (c) => {
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
      return c.json({error: true, msg: "No file provided"}, 400)
    }

    let opts = {
      timeout: this.timeout,
      options: [] as string[],
      maxBuffer: this.limit * 10,
    }

    if (targetSrs) opts.options.push("-t_srs", targetSrs)
    if (sourceSrs) opts.options.push("-s_srs", sourceSrs)
    if (rfc7946 != null) opts.options.push("-lco", "RFC7946=YES")
    
    // Add support for SQL dialect and query
    if (dialect) opts.options.push("-dialect", dialect)
    if (sql) opts.options.push("-sql", sql)
    
    // Add simplify option (e.g. for DXF with curves)
    if (simplify) opts.options.push("-simplify", simplify)
    
    // Add DXF encoding configuration
    if (configDxfEncoding) opts.options.push("--config", "DXF_ENCODING", "UTF-8")
    
    // Add write bbox option
    if (writeBbox) opts.options.push("-lco", "WRITE_BBOX=YES")

    c.header(
      "content-type",
      forcePlainText != null
        ? "text/plain; charset=utf-8"
        : "application/json; charset=utf-8",
    )

    if (forceDownload != null) {
      c.header("content-disposition", "attachment;")
    }

    let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
    let body: string
    try {
      let buf = await upload.arrayBuffer()
      await writeFile(path, Buffer.from(buf))
      let {data} = await ogr2ogr(path, opts)
      if (callback) {
        body = callback + "(" + JSON.stringify(data) + ")"
      } else {
        body = JSON.stringify(data)
      }
    } finally {
      unlink(path).catch((er) => console.error("unlink error", er.message))
    }
    return c.body(body)
  }

  private convertJson = (): Handler => async (c) => {
    let {jsonUrl, json, outputName, format, forceUTF8}: Record<string, string> =
      await c.req.parseBody()
    if (!jsonUrl && !json) {
      return c.json({error: true, msg: "No json provided"}, 400)
    }

    let data
    if (json) {
      try {
        data = JSON.parse(json)
      } catch (_er) {
        return c.json({error: true, msg: "Invalid json provided"}, 400)
      }
    }

    let input = jsonUrl || data
    let output = outputName || "ogre"

    let opts = {
      format: (format || "ESRI Shapefile").toLowerCase(),
      timeout: this.timeout,
      options: [] as string[],
      maxBuffer: this.limit * 10,
    }

    if (outputName) opts.options.push("-nln", outputName)
    if (forceUTF8 != null) opts.options.push("-lco", "ENCODING=UTF-8")

    let out = await ogr2ogr(input, opts)
    c.header(
      "content-disposition",
      "attachment; filename=" + output + out.extname,
    )

    if (out.stream) {
      return c.body(Readable.toWeb(out.stream) as ReadableStream)
    } else if (out.text) {
      return c.text(out.text)
    } else {
      return c.json(out.data)
    }
  }

  private info = (): Handler => async (c) => {
    let body = await c.req.parseBody()
    let {
      upload,
      summary,
      features,
      al,
      where,
      sql,
      dialect,
      limit,
      spat,
      geomfield,
      fid,
      layerName,
    } = body as OgrInfoOpts
    
    if (!upload) {
      return c.json({error: true, msg: "No file provided"}, 400)
    }

    let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
    
    try {
      let buf = await upload.arrayBuffer()
      await writeFile(path, Buffer.from(buf))

      // Build ogrinfo command
      let args = ["ogrinfo"]
      
      // Always output JSON format for API consumption
      args.push("-json")
      
      // Add options based on parameters
      if (summary) args.push("-summary")
      if (features || (!summary && !al)) args.push("-features") // Default to features if not summary
      if (al) args.push("-al")
      if (where) args.push("-where", sanitizeCommandArg(where))
      if (sql) args.push("-sql", sanitizeCommandArg(sql))
      if (dialect) args.push("-dialect", sanitizeCommandArg(dialect))
      if (limit) args.push("-limit", sanitizeCommandArg(limit))
      if (spat) {
        // spat should be "xmin ymin xmax ymax"
        let coords = spat.split(" ")
        if (coords.length === 4) {
          args.push("-spat", ...coords)
        }
      }
      if (geomfield) args.push("-geomfield", geomfield)
      if (fid) args.push("-fid", fid)
      
      // Add the file path
      args.push(path)
      
      // Add layer name if specified
      if (layerName) args.push(layerName)
      
      let command = args.join(" ")
      let {stdout, stderr} = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: this.limit * 10,
      })
      
      if (stderr && stderr.trim()) {
        console.warn("ogrinfo stderr:", stderr)
      }
      
      try {
        let data = JSON.parse(stdout)
        return c.json(data)
      } catch (parseError) {
        // If JSON parsing fails, return the raw output
        return c.json({
          error: false,
          rawOutput: stdout,
          message: "ogrinfo output was not valid JSON"
        })
      }
      
    } catch (error: any) {
      console.error("ogrinfo error:", error)
      return c.json({
        error: true,
        message: error.message || "ogrinfo command failed"
      }, 500)
    } finally {
      unlink(path).catch((er) => console.error("unlink error", er.message))
    }
  }

  private infoJson = (): Handler => async (c) => {
    let {jsonUrl, json, layerName}: Record<string, string> = await c.req.parseBody()
    
    if (!jsonUrl && !json) {
      return c.json({error: true, msg: "No json provided"}, 400)
    }

    let data
    if (json) {
      try {
        data = JSON.parse(json)
      } catch (_er) {
        return c.json({error: true, msg: "Invalid json provided"}, 400)
      }
    }

    // Create a temporary GeoJSON file
    let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + ".geojson"
    
    try {
      if (jsonUrl) {
        // For URL, we'll download and then process
        let response = await fetch(jsonUrl)
        if (!response.ok) {
          return c.json({error: true, msg: "Failed to fetch JSON from URL"}, 400)
        }
        data = await response.json()
      }
      
      // Write the GeoJSON to a temporary file
      await writeFile(path, JSON.stringify(data))
      
      // Build ogrinfo command
      let args = ["ogrinfo", "-json", "-features", path]
      
      // Add layer name if specified
      if (layerName) args.push(layerName)
      
      let command = args.join(" ")
      let {stdout, stderr} = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: this.limit * 10,
      })
      
      if (stderr && stderr.trim()) {
        console.warn("ogrinfo stderr:", stderr)
      }
      
      try {
        let result = JSON.parse(stdout)
        return c.json(result)
      } catch (parseError) {
        // If JSON parsing fails, return the raw output
        return c.json({
          error: false,
          rawOutput: stdout,
          message: "ogrinfo output was not valid JSON"
        })
      }
      
    } catch (error: any) {
      console.error("ogrinfo error:", error)
      return c.json({
        error: true,
        message: error.message || "ogrinfo command failed"
      }, 500)
    } finally {
      unlink(path).catch((er) => console.error("unlink error", er.message))
    }
  }

  private rasterize = (): Handler => async (c) => {
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
      return c.json({error: true, msg: "No data provided (upload, json, or jsonUrl required)"}, 400)
    }

    // Validate numeric inputs for rasterize
    if (!validateNumericInput(width, 1, 65536)) {
      return c.json({error: true, msg: "Invalid width parameter"}, 400)
    }
    if (!validateNumericInput(height, 1, 65536)) {
      return c.json({error: true, msg: "Invalid height parameter"}, 400)
    }
    if (!validateNumericInput(burn, -999999, 999999)) {
      return c.json({error: true, msg: "Invalid burn value"}, 400)
    }

    let inputPath: string = ""
    let outputPath: string = ""
    let format = "GTiff"  // Only GTiff supported
    let extension = ".tif"
    
    try {
      // Handle input data
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
            return c.json({error: true, msg: "Invalid json provided"}, 400)
          }
        } else if (jsonUrl) {
          let response = await fetch(jsonUrl)
          if (!response.ok) {
            return c.json({error: true, msg: "Failed to fetch JSON from URL"}, 400)
          }
          data = await response.json()
        }
        
        await writeFile(inputPath, JSON.stringify(data))
      }

      outputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + extension

      // Build gdal_rasterize command
      let args = ["gdal_rasterize"]

      // Output format
      if (format) args.push("-of", sanitizeCommandArg(format))

      // Output data type
      if (outputType) args.push("-ot", sanitizeCommandArg(outputType))

      // Burn value or attribute
      if (burn) {
        args.push("-burn", sanitizeCommandArg(burn))
      } else if (attribute) {
        args.push("-a", sanitizeCommandArg(attribute))
      } else {
        // Default burn value if none specified
        args.push("-burn", "255")
      }

      // Bands to burn into
      if (bands && bands.length > 0) {
        bands.forEach(band => args.push("-b", band))
      }

      // Raster size or resolution
      if (width && height) {
        args.push("-ts", width, height)
      } else if (xres && yres) {
        args.push("-tr", xres, yres)
      } else {
        // Default resolution if none specified
        args.push("-ts", "512", "512")
      }

      // Extent
      if (xmin && ymin && xmax && ymax) {
        args.push("-te", xmin, ymin, xmax, ymax)
      }

      // Spatial reference system
      if (srs) args.push("-a_srs", srs)

      // NoData value
      if (nodata) args.push("-a_nodata", nodata)

      // Initialization value
      if (init) args.push("-init", init)

      // All touched option
      if (allTouched) args.push("-at")

      // Layer selection
      if (layerName) args.push("-l", layerName)

      // SQL query
      if (sql) args.push("-sql", sql)

      // SQL dialect
      if (dialect) args.push("-dialect", dialect)

      // WHERE clause
      if (where) args.push("-where", where)

      // Add input and output paths
      args.push(inputPath, outputPath)

      let command = args.join(" ")
      console.log("Executing gdal_rasterize command:", command)

      let {stderr} = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: this.limit * 10,
      })

      if (stderr && stderr.trim()) {
        console.warn("gdal_rasterize stderr:", stderr)
      }

      // Read the output file and return it
      let {readFile} = await import("node:fs/promises")
      let outputBuffer = await readFile(outputPath)

      // Set appropriate headers
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
      // Clean up temporary files
      if (inputPath) {
        unlink(inputPath).catch((er) => console.error("unlink error (input):", er.message))
      }
      if (outputPath) {
        unlink(outputPath).catch((er) => console.error("unlink error (output):", er.message))
      }
    }
  }

  private translate = (): Handler => async (c) => {
    let {
      upload,
      outputFormat,
      outputType,
      band,
      mask,
      expand,
      width,
      height,
      scale_srcMin,
      scale_srcMax,
      scale_dstMin,
      scale_dstMax,
      srcwin_xoff,
      srcwin_yoff,
      srcwin_xsize,
      srcwin_ysize,
      projwin_ulx,
      projwin_uly,
      projwin_lrx,
      projwin_lry,
      projwinSrs,
      quality,
      compress,
      nodata,
    } = await c.req.parseBody() as TranslateOpts & {
      width?: string
      height?: string
      scale_srcMin?: string
      scale_srcMax?: string
      scale_dstMin?: string
      scale_dstMax?: string
      srcwin_xoff?: string
      srcwin_yoff?: string
      srcwin_xsize?: string
      srcwin_ysize?: string
      projwin_ulx?: string
      projwin_uly?: string
      projwin_lrx?: string
      projwin_lry?: string
    }

    if (!upload) {
      return c.json({error: true, msg: "No file provided (upload required)"}, 400)
    }

    // Validate numeric inputs
    if (!validateNumericInput(width, 1, 65536)) {
      return c.json({error: true, msg: "Invalid width parameter"}, 400)
    }
    if (!validateNumericInput(height, 1, 65536)) {
      return c.json({error: true, msg: "Invalid height parameter"}, 400)
    }
    if (!validateNumericInput(quality, 1, 100)) {
      return c.json({error: true, msg: "Invalid quality parameter (1-100)"}, 400)
    }

    // Validate string inputs
    if (!validateStringInput(outputFormat, /^[A-Za-z]+$/)) {
      return c.json({error: true, msg: "Invalid output format"}, 400)
    }
    if (!validateStringInput(outputType, /^[A-Za-z0-9]+$/)) {
      return c.json({error: true, msg: "Invalid output type"}, 400)
    }

    let inputPath: string = ""
    let outputPath: string = ""
    let format = outputFormat || "JPEG"
    let extension: string
    let contentType: string

    // Set extension and content type based on format
    switch (format.toUpperCase()) {
      case "JPEG":
        extension = ".jpg"
        contentType = "image/jpeg"
        break
      case "PNG":
        extension = ".png"
        contentType = "image/png"
        break
      case "GTIFF":
        extension = ".tif"
        contentType = "image/tiff"
        break
      default:
        return c.json({error: true, msg: `Unsupported output format: ${format}`}, 400)
    }

    try {
      // Handle input file
      inputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
      let buf = await upload.arrayBuffer()
      await writeFile(inputPath, Buffer.from(buf))

      outputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + extension

      // Build gdal_translate command
      let args = ["gdal_translate"]

      // Output format
      args.push("-of", sanitizeCommandArg(format))

      // Output data type
      if (outputType) args.push("-ot", sanitizeCommandArg(outputType))

      // Band selection
      if (band && band.length > 0) {
        band.forEach(b => args.push("-b", sanitizeCommandArg(b)))
      }

      // Mask band
      if (mask) args.push("-mask", sanitizeCommandArg(mask))

      // Expand option
      if (expand) args.push("-expand", sanitizeCommandArg(expand))

      // Output size
      if (width && height) {
        args.push("-outsize", sanitizeCommandArg(width), sanitizeCommandArg(height))
      }

      // Scaling
      if (scale_srcMin || scale_srcMax || scale_dstMin || scale_dstMax) {
        let scaleArgs = ["-scale"]
        if (scale_srcMin) scaleArgs.push(scale_srcMin)
        if (scale_srcMax) scaleArgs.push(scale_srcMax)
        if (scale_dstMin) scaleArgs.push(scale_dstMin)
        if (scale_dstMax) scaleArgs.push(scale_dstMax)
        args.push(...scaleArgs)
      }

      // Source window
      if (srcwin_xoff && srcwin_yoff && srcwin_xsize && srcwin_ysize) {
        args.push("-srcwin", srcwin_xoff, srcwin_yoff, srcwin_xsize, srcwin_ysize)
      }

      // Projection window
      if (projwin_ulx && projwin_uly && projwin_lrx && projwin_lry) {
        args.push("-projwin", projwin_ulx, projwin_uly, projwin_lrx, projwin_lry)
      }

      // Projection window SRS
      if (projwinSrs) args.push("-projwin_srs", projwinSrs)

      // NoData value
      if (nodata) args.push("-a_nodata", nodata)

      // Creation options for specific formats
      if (format.toUpperCase() === "JPEG") {
        if (quality) {
          args.push("-co", `QUALITY=${quality}`)
        } else {
          args.push("-co", "QUALITY=85") // Default quality
        }
      }

      if (compress) {
        args.push("-co", `COMPRESS=${compress}`)
      }

      // Add input and output paths
      args.push(inputPath, outputPath)

      let command = args.join(" ")
      console.log("Executing gdal_translate command:", command)

      let {stderr} = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: this.limit * 10,
      })

      if (stderr && stderr.trim()) {
        console.warn("gdal_translate stderr:", stderr)
      }

      // Read the output file and return it
      let {readFile} = await import("node:fs/promises")
      let outputBuffer = await readFile(outputPath)

      // Set appropriate headers
      c.header("content-type", contentType)
      c.header("content-disposition", `attachment; filename=translated${extension}`)

      return c.body(outputBuffer)

    } catch (error: any) {
      console.error("gdal_translate error:", error)
      return c.json({
        error: true,
        message: error.message || "gdal_translate command failed"
      }, 500)
    } finally {
      // Clean up temporary files
      if (inputPath) {
        unlink(inputPath).catch((er) => console.error("unlink error (input):", er.message))
      }
      if (outputPath) {
        unlink(outputPath).catch((er) => console.error("unlink error (output):", er.message))
      }
    }
  }
}
