const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Razorpay = require("razorpay");
const redis = require("redis");
const util = require("util");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379"
});
redisClient.on("error", (error) => console.error(`Redis error: ${error}`));
redisClient.on("connect", () => console.log("Connected to Redis"));
redisClient.get = util.promisify(redisClient.get);
redisClient.set = util.promisify(redisClient.set);

mongoose
  .connect(
    "mongodb+srv://priyanshg615:p87lEoTCim6jnidH@cluster0.kjvtciy.mongodb.net/",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      ssl: true,
    }
  )
  .then(() => {
    console.log("Connected to MongoDB Atlas");
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB Atlas:", error);
  });

const urlSchema = new mongoose.Schema({
  originalUrl: String,
  shortUrl: String,
});

const userSchema = new mongoose.Schema({
  email: String,
  credits: Number,
});

const URL = mongoose.model("URL", urlSchema);
const User = mongoose.model("User", userSchema);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(num) {
  let base62 = "";
  do {
    base62 = BASE62_CHARS[num % 62] + base62;
    num = Math.floor(num / 62);
  } while (num > 0);
  return base62;
}

app.post("/sign-in", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user) {
      res.status(200).json({ user });
    } else {
      const newUser = new User({ email: email, credits: 5 });
      await newUser.save();
      res.status(200).json({ newUser });
    }
  } catch (error) {
    console.error("Error fetching the User:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/get-user", async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    res.status(200).json({ user });
  } catch (error) {
    console.error("Error fetching the User:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/shorten", async (req, res) => {
  const { originalUrl, email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (user.credits > 0) {
      const cacheKey = `url:${originalUrl}`;
      let shortUrl = await redisClient.get(cacheKey);
      if (shortUrl) {
        return res.json({ shortUrl });
      }

      const existingUrl = await URL.findOne({ originalUrl });
      if (existingUrl) {
        shortUrl = existingUrl.shortUrl;
        await redisClient.set(cacheKey, shortUrl);
        res.json({ shortUrl: existingUrl.shortUrl });
      } else {
        const uniqueId = Date.now();
        const shortCode = toBase62(uniqueId);
        shortUrl = `${req.protocol}://${req.get("host")}/${shortCode}`;

        const url = new URL({ originalUrl, shortUrl });
        user.credits = user.credits - 1;
        await url.save();
        await user.save();
        await redisClient.set(cacheKey, shortUrl);
        res.json({ shortUrl });
      }
    } else {
      res.status(200).json({ message: "Not enough credits" });
    }
  } catch (error) {
    console.error("Error fetching the User:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/:shortCode", async (req, res) => {
  const { shortCode } = req.params;
  const cacheKey = `shortUrl:${shortCode}`;
  try {
    let originalUrl = await redisClient.get(cacheKey);
    if (originalUrl) {
      return res.redirect(originalUrl);
    }

    const url = await URL.findOne({
      shortUrl: `${req.protocol}://${req.get("host")}/${shortCode}`,
    });
    if (!url) {
      return res.status(404).json({ error: "URL not found" });
    }
    await redisClient.set(cacheKey, url.originalUrl);
    res.redirect(url.originalUrl);
  } catch (error) {
    console.error("Error fetching URL from database:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/order", async (req, res) => {
  try {
    const razorpay = new Razorpay({
      key_id: "rzp_test_KHV6PzqYixh3G1",
      key_secret: "UFt91YFvSiRKmi54hsDs30QW",
    });

    const options = req.body;
    const order = await razorpay.orders.create(options);
    if (!order) {
      return res.status(500).send("Error");
    }
    res.json(order);
  } catch (error) {
    console.log(error);
    res.status(500).send("Error");
  }
});

app.post("/order-successful", async (req, res) => {
  try {
    const { email, creditsCredited } = req.body;
    console.log(email, creditsCredited);
    const user = await User.findOne({ email });
    user.credits = user.credits + creditsCredited;
    await user.save();
    res.status(200).json({ message: "Purchase successful" });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
