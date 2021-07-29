const fs = require("fs");
const path = require("path");
require("./imageGen")(
  // ["images/768x1024.png"]
  fs
    .readdirSync(path.join(__dirname, "images"))
    .filter((img) => !img.endsWith(".bak"))
    .map((image) => ({
      path: path.join(__dirname, "images", image),
      metadata: {name: image},
    }))
).then((img) => img.write("/tmp/blah.png"));
