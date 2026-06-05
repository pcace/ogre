import type { Handler } from "hono"
import { randomBytes } from "node:crypto"
import { writeFile, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { exec } from "node:child_process"

const execAsync = promisify(exec)
const TMP_DIR = tmpdir()

export async function gdalinfoHandler(
  c: any,
  opts: { timeout: number; limit: number }
) {
  const body = await c.req.parseBody()
  const file = body["upload"] as File | undefined
  if (!file) {
    return c.json({ error: "No file uploaded" }, 400)
  }

  // Generate a random filename, keep original extension if possible
  let ext = ""
  if (file.name && file.name.includes(".")) {
    ext = "." + file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "")
    if (ext.length > 10) ext = ""
  }
  const filename = `${randomBytes(8).toString("hex")}${ext || ""}`
  const filepath = `${TMP_DIR}/${filename}`

  try {
    // Write file to temp dir
    const arrayBuffer = await file.arrayBuffer()
    await writeFile(filepath, Buffer.from(arrayBuffer))

    // Run gdalinfo -json
    const { stdout } = await execAsync(`gdalinfo -json ${filepath}`)
    let json
    try {
      json = JSON.parse(stdout)
    } catch (e) {
      return c.json({ error: "Failed to parse gdalinfo output", raw: stdout }, 500)
    }
    return c.json(json)
  } catch (err: any) {
    return c.json({ error: true, message: err.message }, 500)
  } finally {
    // Clean up temp file
    try { await unlink(filepath) } catch {}
  }
}
