import { randomBytes } from "node:crypto"
import { unlink, writeFile, readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { exec } from "node:child_process"
import { join } from "node:path"
import type { ConvertToDwgOpts } from "../index"

const execAsync = promisify(exec)
const TMP_DIR = tmpdir()

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').substring(0, 255)
}

export async function convertToDwgHandler(
  c: any,
  opts: { timeout: number; limit: number }
) {
  const { upload, outputName }: ConvertToDwgOpts = await c.req.parseBody()
  
  if (!upload) {
    return c.json({ error: true, msg: "No file provided" }, 400)
  }

  // Check if the uploaded file is a DXF file
  const fileName = upload.name?.toLowerCase() || ""
  if (!fileName.endsWith('.dxf')) {
    return c.json({ 
      error: true, 
      msg: "Only DXF files are supported. Please upload a .dxf file." 
    }, 400)
  }

  let dxfPath: string | undefined
  let dwgPath: string | undefined
  let inputDir: string | undefined
  let outputDir: string | undefined

  try {
    // Step 1: Create temp input/output folders and save the uploaded DXF file
    inputDir = await mkdtemp(TMP_DIR + "/dxf2dwg-in-")
    outputDir = await mkdtemp(TMP_DIR + "/dxf2dwg-out-")
    const dxfFilename = randomBytes(16).toString("hex") + ".dxf"
    dxfPath = join(inputDir, dxfFilename)
    const buf = await upload.arrayBuffer()
    await writeFile(dxfPath, Buffer.from(buf))

    // Step 2: Convert DXF to DWG using ODAFileConverter
    const dwgBaseName = (outputName || "converted") + ".dwg"
    // ODAFileConverter will output to outputDir with same base name as input
    const command = `xvfb-run ODAFileConverter "${inputDir}" "${outputDir}" ACAD2018 DWG 0 1`
    console.log(`Converting DXF to DWG using ODAFileConverter...`)
    let conversionOutput = { stdout: "", stderr: "" }
    try {
      const { stderr, stdout } = await execAsync(command, {
        timeout: opts.timeout,
        maxBuffer: opts.limit * 10,
      })
      conversionOutput = { stdout, stderr }
    } catch (execError: any) {
      conversionOutput = {
        stdout: execError.stdout || "",
        stderr: execError.stderr || execError.message || ""
      }
    }
    console.log("ODAFileConverter stdout:", conversionOutput.stdout)
    if (conversionOutput.stderr && conversionOutput.stderr.trim()) {
      console.warn("ODAFileConverter stderr:", conversionOutput.stderr)
    }

    // Step 3: Find the DWG file in outputDir
    const outputFiles = await import('node:fs/promises').then(fs => fs.readdir(outputDir!))
    const dwgFile = outputFiles.find(f => f.toLowerCase().endsWith('.dwg'))
    if (!dwgFile) throw new Error('No DWG file created by ODAFileConverter.')
    dwgPath = join(outputDir, dwgFile)
    const dwgBuffer = await readFile(dwgPath)
    c.header("content-type", "application/octet-stream")
    c.header("content-disposition", `attachment; filename=\"${sanitizeFilename(dwgBaseName)}\"`)
    return c.body(dwgBuffer)
  } catch (error: any) {
    console.error("convertToDwg error:", error)
    return c.json({
      error: true,
      message: error.message || "DWG conversion failed"
    }, 500)
  } finally {
    // Clean up temporary files and folders
    if (dxfPath) {
      unlink(dxfPath).catch((er) => console.error("unlink error (dxf):", er.message))
    }
    if (dwgPath) {
      unlink(dwgPath).catch((er) => console.error("unlink error (dwg):", er.message))
    }
    if (inputDir) {
      rm(inputDir, { recursive: true, force: true }).catch((er) => console.error("rm error (inputDir):", er.message))
    }
    if (outputDir) {
      rm(outputDir, { recursive: true, force: true }).catch((er) => console.error("rm error (outputDir):", er.message))
    }
  }
}
