import { randomBytes } from "node:crypto"
import { unlink, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import { exec } from "node:child_process"
import { basename } from "node:path"
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

  try {
    // Step 1: Save the uploaded DXF file
    const dxfFilename = randomBytes(16).toString("hex") + ".dxf"
    dxfPath = TMP_DIR + "/" + dxfFilename
    
    const buf = await upload.arrayBuffer()
    await writeFile(dxfPath, Buffer.from(buf))

    // Step 2: Convert DXF to DWG using LibreDWG's dxf2dwg
    const dwgFilename = (outputName || "converted") + ".dwg"
    
    // dxf2dwg creates the output file in the current directory with the same base name
    const dxfBasename = basename(dxfPath, '.dxf')
    const expectedDwgName = dxfBasename + ".dwg"
    dwgPath = TMP_DIR + "/" + expectedDwgName

    // Execute dxf2dwg command in the temp directory
    console.log(`Converting DXF to DWG using dxf2dwg...`)
    const command = `cd "${TMP_DIR}" && dxf2dwg "${dxfFilename}"`
    
    let conversionOutput = { stdout: "", stderr: "" }
    try {
      const { stderr, stdout } = await execAsync(command, {
        timeout: opts.timeout,
        maxBuffer: opts.limit * 10,
      })
      conversionOutput = { stdout, stderr }
    } catch (execError: any) {
      // Don't throw immediately - check if DWG was created despite errors
      conversionOutput = { 
        stdout: execError.stdout || "", 
        stderr: execError.stderr || execError.message || "" 
      }
    }

    console.log("dxf2dwg stdout:", conversionOutput.stdout)
    if (conversionOutput.stderr && conversionOutput.stderr.trim()) {
      console.warn("dxf2dwg stderr:", conversionOutput.stderr)
    }

    // Step 3: Check if the DWG file was created and read it
    try {
      const dwgBuffer = await readFile(dwgPath)
      
      // Success! DWG file was created, ignore any warnings/errors
      console.log("DWG file successfully created despite any warnings")
      
      // Set appropriate headers
      c.header("content-type", "application/octet-stream")
      c.header("content-disposition", `attachment; filename="${sanitizeFilename(dwgFilename)}"`)

      return c.body(dwgBuffer)
    } catch (fileError) {
      // Only now throw an error since no DWG was created
      const errorMsg = conversionOutput.stderr || "No specific error message"
      throw new Error(`DWG file was not created. Conversion failed with:\n${errorMsg}`)
    }

  } catch (error: any) {
    console.error("convertToDwg error:", error)
    return c.json({
      error: true,
      message: error.message || "DWG conversion failed"
    }, 500)
  } finally {
    // Clean up temporary files
    // if (dxfPath) {
    //   unlink(dxfPath).catch((er) => console.error("unlink error (dxf):", er.message))
    // }
    // if (dwgPath) {
    //   unlink(dwgPath).catch((er) => console.error("unlink error (dwg):", er.message))
    // }
  }
}
