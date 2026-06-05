import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { Handler } from "hono"
import type { TranslateOpts } from "../index"

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
function validateStringInput(value: string | undefined, allowedChars?: RegExp): boolean {
  if (!value) return true
  if (value.length > 1000) return false
  if (allowedChars && !allowedChars.test(value)) return false
  return true
}
function sanitizeCommandArg(arg: string): string {
  return arg.replace(/[;&|`$(){}[\]<>\'"\\]/g, '')
}

export async function translateHandler(c: any, opts: { timeout: number; limit: number }) {
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
  } = await c.req.parseBody() as unknown as {
    upload?: File
    outputFormat?: string
    outputType?: string
    band?: string[]
    mask?: string
    expand?: string
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
    projwinSrs?: string
    quality?: string
    compress?: string
    nodata?: string
  }

  if (!upload) {
    return c.json({ error: true, msg: "No file provided (upload required)" }, 400)
  }

  if (!validateNumericInput(width, 1, 65536)) {
    return c.json({ error: true, msg: "Invalid width parameter" }, 400)
  }
  if (!validateNumericInput(height, 1, 65536)) {
    return c.json({ error: true, msg: "Invalid height parameter" }, 400)
  }
  if (!validateNumericInput(quality, 1, 100)) {
    return c.json({ error: true, msg: "Invalid quality parameter (1-100)" }, 400)
  }
  if (!validateStringInput(outputFormat, /^[A-Za-z]+$/)) {
    return c.json({ error: true, msg: "Invalid output format" }, 400)
  }
  if (!validateStringInput(outputType, /^[A-Za-z0-9]+$/)) {
    return c.json({ error: true, msg: "Invalid output type" }, 400)
  }

  let inputPath = ""
  let outputPath = ""
  let format = outputFormat || "JPEG"
  let extension: string
  let contentType: string

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
      return c.json({ error: true, msg: `Unsupported output format: ${format}` }, 400)
  }

  try {
    inputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)
    let buf = await upload.arrayBuffer()
    await writeFile(inputPath, Buffer.from(buf))
    outputPath = TMP_DIR + "/" + randomBytes(16).toString("hex") + extension
    let args = ["gdal_translate"]
    args.push("-of", sanitizeCommandArg(format))
    if (outputType) args.push("-ot", sanitizeCommandArg(outputType))
    if (band && band.length > 0) {
      band.forEach(b => args.push("-b", sanitizeCommandArg(b)))
    }
    if (mask) args.push("-mask", sanitizeCommandArg(mask))
    if (expand) args.push("-expand", sanitizeCommandArg(expand))
    if (width && height) {
      args.push("-outsize", sanitizeCommandArg(width), sanitizeCommandArg(height))
    }
    if (scale_srcMin || scale_srcMax || scale_dstMin || scale_dstMax) {
      let scaleArgs = ["-scale"]
      if (scale_srcMin) scaleArgs.push(scale_srcMin)
      if (scale_srcMax) scaleArgs.push(scale_srcMax)
      if (scale_dstMin) scaleArgs.push(scale_dstMin)
      if (scale_dstMax) scaleArgs.push(scale_dstMax)
      args.push(...scaleArgs)
    }
    if (srcwin_xoff && srcwin_yoff && srcwin_xsize && srcwin_ysize) {
      args.push("-srcwin", srcwin_xoff, srcwin_yoff, srcwin_xsize, srcwin_ysize)
    }
    if (projwin_ulx && projwin_uly && projwin_lrx && projwin_lry) {
      args.push("-projwin", projwin_ulx, projwin_uly, projwin_lrx, projwin_lry)
    }
    if (projwinSrs) args.push("-projwin_srs", projwinSrs)
    if (nodata) args.push("-a_nodata", nodata)
    if (format.toUpperCase() === "JPEG") {
      if (quality) {
        args.push("-co", `QUALITY=${quality}`)
      } else {
        args.push("-co", "QUALITY=85")
      }
    }
    if (compress) {
      args.push("-co", `COMPRESS=${compress}`)
    }
    args.push(inputPath, outputPath)
    const { promisify } = await import("node:util")
    const { exec } = await import("node:child_process")
    const execAsync = promisify(exec)
    let { stderr } = await execAsync(args.join(" "), {
      timeout: opts.timeout,
      maxBuffer: opts.limit * 10,
    })
    if (stderr && stderr.trim()) {
      console.warn("gdal_translate stderr:", stderr)
    }
    let { readFile } = await import("node:fs/promises")
    let outputBuffer = await readFile(outputPath)
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
    if (inputPath) {
      unlink(inputPath).catch((er) => console.error("unlink error (input):", er.message))
    }
    if (outputPath) {
      unlink(outputPath).catch((er) => console.error("unlink error (output):", er.message))
    }
  }
}
