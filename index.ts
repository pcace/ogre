import { serve } from "@hono/node-server"
import { ErrorHandler, Handler, Hono, NotFoundHandler } from "hono"
import { bodyLimit } from "hono/body-limit"
import { cors } from "hono/cors"
import { BlankEnv, BlankSchema } from "hono/types"
import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { Readable } from "node:stream"
import { promisify } from "node:util"
import { exec } from "node:child_process"
import { ogr2ogr } from "ogr2ogr"
import index from "./index.html?raw"
import { convertHandler } from "./src/convert"
import { ogrinfoHandler } from "./src/ogrinfo"
import { rasterizeHandler } from "./src/rasterize"
import { translateHandler } from "./src/translate"
import { infoJsonHandler } from "./src/infoJson"
import { convertJsonHandler } from "./src/convertJson"
import { gdalinfoHandler } from "./src/gdalinfo"
import { convertToDwgHandler } from "./src/convertToDwg"

const execAsync = promisify(exec)

export interface OgreOpts {
  port?: number
  timeout?: number
  limit?: number
}

export interface UploadOpts {
  targetSrs?: string
  upload: File | File[]
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

export interface OgrInfoOpts {
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

export interface RasterizeOpts {
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

export interface TranslateOpts {
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

export interface ConvertToDwgOpts {
  upload: File
  outputName?: string
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
    app.use(cors(), bodyLimit({ maxSize: this.limit }))
    app.post("/convert", this.convert())
    app.post("/convertJson", this.convertJson())
    app.post("/convertToDwg", this.convertToDwg())
    app.post("/rasterize", this.rasterize())
    app.post("/translate", this.translate())
    app.post("/ogrinfo", this.ogrinfo())
    app.post("/infoJson", this.infoJson())
    app.post("/gdalinfo", this.gdalinfo())
  }

  start(): void {
    serve({ fetch: this.app.fetch, port: this.port })
  }

  private notFound = (): NotFoundHandler => (c) => {
    return c.json({ error: "Not found" }, 404)
  }

  private serverError = (): ErrorHandler => (er, c) => {
    console.error(er.stack)
    return c.json({ error: true, message: er.message }, 500)
  }

  private heartbeat = (): Handler => async () => new Response()

  private index = (): Handler => async (c) => c.html(index)

  private convert = (): Handler => async (c) => {
    return convertHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private convertJson = (): Handler => async (c) => {
    return convertJsonHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private convertToDwg = (): Handler => async (c) => {
    return convertToDwgHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private ogrinfo = (): Handler => async (c) => {
    return ogrinfoHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private infoJson = (): Handler => async (c) => {
    return infoJsonHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private rasterize = (): Handler => async (c) => {
    return rasterizeHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private translate = (): Handler => async (c) => {
    return translateHandler(c, { timeout: this.timeout, limit: this.limit })
  }

  private gdalinfo = (): Handler => async (c) => {
    return gdalinfoHandler(c, { timeout: this.timeout, limit: this.limit })
  }
}
