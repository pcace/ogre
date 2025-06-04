import { ogr2ogr } from "ogr2ogr"
import { Readable } from "node:stream"

export async function convertJsonHandler(c: any, opts: { timeout: number; limit: number }) {
  let { jsonUrl, json, outputName, format, forceUTF8 }: Record<string, string> = await c.req.parseBody()
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
  let input = jsonUrl || data
  let output = outputName || "ogre"
  let ogrOpts = {
    format: (format || "ESRI Shapefile").toLowerCase(),
    timeout: opts.timeout,
    options: [] as string[],
    maxBuffer: opts.limit * 10,
  }
  if (outputName) ogrOpts.options.push("-nln", outputName)
  if (forceUTF8 != null) ogrOpts.options.push("-lco", "ENCODING=UTF-8")
  let out = await ogr2ogr(input, ogrOpts)
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
