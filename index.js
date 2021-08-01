const Bolt = require("@slack/bolt");
const {MongoClient} = require("mongodb");
const secrets = require("./secrets.json");
const generateCard = require("./imageGen");
const fetch = require("node-fetch");
const FormData = require("form-data");
const fs = require("fs").promises;

const mongoClient = new MongoClient(
  secrets.mongoUri || "mongodb://localhost:27017"
);
// I don't care that this is a race condition
let db;
const ensureDB = new Promise((res, rej) => {
  mongoClient.connect((err) => {
    if (err) {
      throw err;
    }

    db = mongoClient.db("daniel-demandson");
  });
});

function request(url, options) {
  if (!options) {
    options = {};
  }
  if (!options.headers) {
    options.headers = {};
  }
  options.headers.Authorization = `Basic ${Buffer.from(
    secrets.clicksendUsername + ":" + secrets.clicksendToken
  ).toString("base64")}`;
  // lazy debug
  if (options.body && options.body[0] == "{") {
    console.log(JSON.parse(options.body));
  }
  // options.headers["Content-Type"] = "application/json";
  return fetch(`https://rest.clicksend.com/v3${url}`, options);
}

const app = new Bolt.App({
  token: secrets.slackToken,
  appToken: secrets.slackAppToken,
  socketMode: true,
});

app.start().then(() => {
  console.log("Ready!");
});

app.event("app_mention", async (ctx) => {
  console.log(ctx);
  const date = new Date();
  if (!ctx.payload.files?.length) {
    await ctx.client.chat.postMessage({
      thread_ts: ctx.payload.thread_ts || ctx.payload.ts,
      text: "Sorry, I can only send images!",
      channel: ctx.payload.channel,
    });
    return;
  }
  console.log(ctx.payload.files);
  const files = [];

  await db.collection("images").insertMany(
    ctx.payload.files.map((file) => ({
      url: file.url_private,
      pending: true,
      date,
    }))
  );
  await ctx.client.chat.postMessage({
    text: `Hello! Your demands should be sent in the next collection at ${monthScheduler} (${
      (Date.now() - monthScheduler) / 1000 / 60 / 60 / 24
    } days)`,
    thread_ts: ctx.payload.thread_ts || ctx.payload.ts,
    channel: ctx.payload.channel,
  });
});

const monthScheduler = new Date();
function resetMonth() {
  // Jump to next month:
  monthScheduler.setUTCMonth(monthScheduler.getUTCMonth() + 1);
  // Set to midnight!
  monthScheduler.setUTCDate(1);
  monthScheduler.setUTCHours(0);
  monthScheduler.setUTCMinutes(0);
  monthScheduler.setUTCSeconds(0);
  monthScheduler.setUTCMilliseconds(0);
}
resetMonth();

function tickTimer() {
  const waitTime = monthScheduler.getTime() - Date.now();
  if (waitTime > 2 ** 30) {
    setTimeout(tickTimer, 2 ** 30);
  } else {
    setTimeout(runPostcard, waitTime);
  }
}
async function runPostcard() {
  await ensureDB;
  const images = await db.collection("images").find({
    pending: true,
  });
  const sources = [];
  for await (const image of images) {
    sources.push({
      path: {
        url: image.url,
        headers: {
          Authorization: "Bearer " + secrets.slackToken,
        },
      },
      metadata: {
        name: image.name,
      },
    });
  }
  if (!sources.length) {
    console.error(
      "Attempted to send an empty postcard... Surely you have more demands for Dan... Right?"
    );
    return;
  }
  console.log(sources);
  const image = await generateCard(sources);
  const imageBuffer = await image.getBufferAsync("image/png");

  const back = await fs.readFile(path.join(__dirname, "back.png"));
  const urls = [];
  for (const buffer of [imageBuffer, back]) {
    // send our buffer to postcard service
    const form = new FormData();
    form.append("file", buffer, {
      // These are needed by backend, probably for mimetype
      filename: "demands-for-dan.png",
      contentType: "image/png",
      knownLength: buffer.length,
    });
    const upload = await request("/uploads?convert=postcard", {
      method: "POST",
      body: form,
      headers: form.getHeaders(),
    }).then((res) => res.json());
    console.log(upload);
    urls.push(upload.data._url);
  }
  const sendCard = await request("/post/postcards/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipients: [
        {
          ...secrets.address,
          // schedule: 0,
        },
      ],

      file_urls: urls,
    }),
  }).then((res) => res.json());
  console.log(buffer.length, sendCard);
  await db.collection("images").updateMany(
    {
      pending: true,
    },
    {
      $set: {pending: false},
    }
  );
  resetMonth();
  tickTimer();
}

tickTimer();
