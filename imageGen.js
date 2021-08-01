const fs = require("fs/promises");
const path = require("path");
const Jimp = require("jimp");
const linearPartition = require("@prezly/linear-partition").default;

const SCALE = 300; // dpi
const TARGET_WIDTH = 8.26667 * SCALE;
const TARGET_HEIGHT = 5.82667 * SCALE;

function drawDecals(image, metadata, font) {
  console.log("Drawing decals", metadata);
  const width = Jimp.measureText(font, metadata.name);
  const height = Jimp.measureTextHeight(font, metadata.name);
  // Black out corner
  const padLeft = SCALE * 0.15;
  image.scan(
    image.bitmap.width - padLeft - width,
    SCALE * 0.1,
    width + padLeft,
    height + padLeft / 10,
    (x, y, idx) => {
      image.bitmap.data[idx] = 0;
      image.bitmap.data[idx + 1] = 0;
      image.bitmap.data[idx + 2] = 0;
    }
  );
  image.print(
    font,
    SCALE * 0.1,
    SCALE * 0.1,
    {
      text: metadata.name,
      alignmentX: Jimp.HORIZONTAL_ALIGN_RIGHT,
      alignmentY: Jimp.VERTICAL_ALIGN_TOP,
    },
    image.bitmap.width - SCALE * 0.2,
    image.bitmap.height - SCALE * 0.2
  );
  console.log(SCALE * 0.1, SCALE * 0.1);
}

module.exports = async function dump(sources) {
  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
  const output = await new Promise(
    (resolve, reject) =>
      new Jimp(TARGET_WIDTH, TARGET_HEIGHT, (err, output) =>
        err ? reject(err) : resolve(output)
      )
  );

  const feetDir = path.join(__dirname, "feet");
  const feetPaths = await fs.readdir(feetDir);
  const feet = await Promise.all(
    feetPaths
      .filter((footPath) => footPath.endsWith(".png"))
      .map((footPath) => Jimp.read(path.join(feetDir, footPath)))
  );
  const feetHeight = SCALE / 6;
  for (const foot of feet) {
    foot.resize(feetHeight, feetHeight);
  }
  for (let x = 0; x < output.bitmap.width; x += feetHeight) {
    for (let y = 0; y < output.bitmap.width; y += feetHeight) {
      output.blit(feet[Math.floor(Math.random() * feet.length)], x, y);
    }
  }

  // Cheese it! This is our background...
  // const output = await Jimp.read("./template.png");
  console.log(sources[0].path, sources);
  const images = await Promise.all(
    sources.map(async ({path, metadata}) => ({
      image: await Jimp.read(path),
      metadata,
    }))
  );
  console.log("Grabbed for sources");
  let idealHeight = TARGET_HEIGHT / 3;
  let summedWidth;
  while (idealHeight < TARGET_HEIGHT) {
    summedWidth = images.reduce(
      (collector, {image}) =>
        (image.bitmap.width / image.bitmap.height) * idealHeight + collector,
      0
    );
    if (summedWidth * idealHeight > TARGET_HEIGHT * TARGET_WIDTH) break;
    // Incr. by thousandths of the original (500 steps)
    idealHeight += TARGET_HEIGHT / 3 / 500;
  }
  const rows = Math.round(summedWidth / TARGET_WIDTH);
  let x = 0;
  let y = 0;
  console.log(
    "Generating",
    rows,
    idealHeight,
    TARGET_HEIGHT / 3,
    TARGET_HEIGHT
  );
  if (rows < 1 || summedWidth <= TARGET_WIDTH) {
    for (const {image, metadata} of images) {
      image.resize(
        idealHeight * (image.bitmap.width / image.bitmap.height),
        idealHeight
      );
      console.log("Placing", metadata, x, 0);
      drawDecals(image, metadata, font);
      output.blit(image, x, 0);
      x += image.bitmap.width;
    }
  } else {
    // Linear partition
    const weights = images.map(
      ({image}) => 100 * (image.bitmap.width / image.bitmap.height)
    );
    const partitions = linearPartition(weights, rows).reverse();
    let index = 0;
    for (const partition in partitions) {
      const row = partitions[partition];
      const rowData = [];
      for (const image of row) {
        const image = images[index];
        rowData.push(image);
        ++index;
      }
      const ratios = rowData.reduce(
        (collector, {image}) =>
          collector + image.bitmap.width / image.bitmap.height,
        0
      );
      const rowHeight = TARGET_WIDTH / ratios;
      for (const {image, metadata} of rowData) {
        image.resize(
          (TARGET_WIDTH / ratios) * (image.bitmap.width / image.bitmap.height),
          rowHeight
        );
        drawDecals(image, metadata, font);
        console.log("Placing", metadata, x, y);
        output.blit(image, x, y);
        x += image.bitmap.width;
      }
      y += rowHeight;
      x = 0;
    }
  }

  // await output.write("/tmp/blah.png");
  return output;
};
