import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { ogr2ogr } from "ogr2ogr"
import type { UploadOpts } from "../index"

const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^"+/, '').substring(0, 255)
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
  let body: string
  try {
    let buf = await upload.arrayBuffer()
    await writeFile(path, Buffer.from(buf))
    let { data } = await ogr2ogr(path, ogrOpts)
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
