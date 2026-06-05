import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { exec } from "node:child_process"
import type { OgrInfoOpts } from "../index"

const execAsync = promisify(exec)
const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').substring(0, 255)
}
function sanitizeCommandArg(arg: string): string {
  return arg.replace(/[;&|`$(){}[\]<>\'"\\]/g, '')
}

export async function ogrinfoHandler(c: any, opts: { timeout: number; limit: number }) {
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
    return c.json({ error: true, msg: "No file provided" }, 400)
  }

  let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + sanitizeFilename(upload.name)

  try {
    let buf = await upload.arrayBuffer()
    await writeFile(path, Buffer.from(buf))

    // Build ogrinfo command
    let args = ["ogrinfo"]
    args.push("-json")
    if (summary) args.push("-summary")
    if (features || (!summary && !al)) args.push("-features")
    if (al) args.push("-al")
    if (where) args.push("-where", sanitizeCommandArg(where))
    if (sql) args.push("-sql", sanitizeCommandArg(sql))
    if (dialect) args.push("-dialect", sanitizeCommandArg(dialect))
    if (limit) args.push("-limit", sanitizeCommandArg(limit))
    if (spat) {
      let coords = spat.split(" ")
      if (coords.length === 4) {
        args.push("-spat", ...coords)
      }
    }
    if (geomfield) args.push("-geomfield", geomfield)
    if (fid) args.push("-fid", fid)
    args.push(path)
    if (layerName) args.push(layerName)

    let command = args.join(" ")
    let { stdout, stderr } = await execAsync(command, {
      timeout: opts.timeout,
      maxBuffer: opts.limit * 10,
    })

    if (stderr && stderr.trim()) {
      console.warn("ogrinfo stderr:", stderr)
    }

    try {
      let data = JSON.parse(stdout)
      return c.json(data)
    } catch (parseError) {
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
