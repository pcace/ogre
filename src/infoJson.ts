import { randomBytes } from "node:crypto"
import { unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import type { OgrInfoOpts } from "../index"

const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').substring(0, 255)
}

export async function infoJsonHandler(c: any, opts: { timeout: number; limit: number }) {
  let { jsonUrl, json, layerName }: Record<string, string> = await c.req.parseBody()

  if (!jsonUrl && !json) {
    return c.json({ error: true, msg: "No json provided" }, 400)
  }

  let data
  if (json) {
    try {
      data = JSON.parse(json)
    } catch (_er) {
      return c.json({ error: true, msg: "Invalid json provided" }, 400)
    }
  }

  let path = TMP_DIR + "/" + randomBytes(16).toString("hex") + ".geojson"

  try {
    if (jsonUrl) {
      let response = await fetch(jsonUrl)
      if (!response.ok) {
        return c.json({ error: true, msg: "Failed to fetch JSON from URL" }, 400)
      }
      data = await response.json()
    }
    await writeFile(path, JSON.stringify(data))
    let args = ["ogrinfo", "-json", "-features", path]
    if (layerName) args.push(layerName)
    const { promisify } = await import("node:util")
    const { exec } = await import("node:child_process")
    const execAsync = promisify(exec)
    let { stdout, stderr } = await execAsync(args.join(" "), {
      timeout: opts.timeout,
      maxBuffer: opts.limit * 10,
    })
    if (stderr && stderr.trim()) {
      console.warn("ogrinfo stderr:", stderr)
    }
    try {
      let result = JSON.parse(stdout)
      return c.json(result)
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
