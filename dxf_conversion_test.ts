import {serve} from "@hono/node-server"
import request from "supertest"
import {assert, test} from "vitest"
import {Ogre, OgreOpts} from "./"

test("DXF conversion with SQL parameters", async () => {
  // Create a mock FormData for testing
  const mockForm = new FormData()
  
  // Add a simple test file - this should be replaced with a real DXF test file
  // For the purpose of this test, we'll just use the existing sample.shp.zip
  mockForm.append("upload", "./testdata/sample.shp.zip")
  mockForm.append("dialect", "sqlite")
  mockForm.append("sql", "SELECT * FROM entities")
  mockForm.append("simplify", "0.1")
  mockForm.append("configDxfEncoding", "true")
  mockForm.append("writeBbox", "true")
  
  // Initialize Ogre
  const ogre = new Ogre()
  const app = serve({fetch: ogre.app.fetch})
  
  // Make a request with the new parameters
  const res = await request(app)
    .post("/convert")
    .attach("upload", "./testdata/sample.shp.zip") // Replace with actual DXF file for a real test
    .field("dialect", "sqlite")
    .field("sql", "SELECT * FROM entities")
    .field("simplify", "0.1")
    .field("configDxfEncoding", "true")
    .field("writeBbox", "true")
  
  // Verify the response
  assert.equal(res.status, 200)
  // In a real test, you would validate that the options were passed to ogr2ogr correctly
})
