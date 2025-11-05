import multer from "multer";
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import os from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import ms from 'ms';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------
// config Multer for upload images
// ---------------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });



// ===== INIT =====
dotenv.config();
const app = express();
app.use(express.json());

// ===== CONFIG =====
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "demo_access_secret";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "demo_refresh_secret";
const ACCESS_TOKEN_EXPIRES = "1m"; // access token 1 phút
const REFRESH_TOKEN_EXPIRES = "7d"; // refresh token 7 ngày

// ===== DATA =====
const users = JSON.parse(fs.readFileSync("./data/users.json", "utf-8"));
const user_list = JSON.parse(fs.readFileSync("./data/user_list.json", "utf-8"));
const products = JSON.parse(fs.readFileSync("./data/products.json", "utf-8"));

// ===== IN-MEMORY STORE =====
let refreshTokens = [];

// ===== ROUTES =====
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.json({
    message: "File uploaded successfully",
    filename: req.file.filename,
    url: fileUrl,
  });
});

// Cho phép truy cập public tới thư mục uploads
app.use("/uploads", express.static(uploadDir));

// Download endpoint
const downloadDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

app.get("/download/:filename", (req, res) => {
  const filePath = path.join(downloadDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  res.download(filePath); // Express tự gửi file với header download
});


// Login endpoint
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = users.find(
    (u) => u.email === email && u.password === password
  );
  if (!user) return res.status(401).json({ message: "Invalid credentials" });

  const accessToken = jwt.sign({ email: email }, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  });
  const refreshToken = jwt.sign({ email: email }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES,
  });

  refreshTokens.push(refreshToken);
  res.json({ message: "Success", user_id: user.id, email: user.email, username: user.username, access_token: accessToken, refresh_token: refreshToken });
});

// Refresh token endpoint
app.post("/refresh", (req, res) => {
  console.log("Request body:", req.body);
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(401).json({ message: "Missing refresh token" });
  if (!refreshTokens.includes(refresh_token))
    return res.status(403).json({ message: "Invalid refresh token" });

  jwt.verify(refresh_token, REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid refresh token", success: false });
    const newAccessToken = jwt.sign(
      { username: user.username },
      ACCESS_TOKEN_SECRET,
      { expiresIn: ms(ACCESS_TOKEN_EXPIRES) / 1000 }
    );
    res.json({ success: true, access_token: newAccessToken, refresh_token: refresh_token, token_type: "Bearer", expires_in: ms(ACCESS_TOKEN_EXPIRES) / 1000  });
  });
});

// Logout endpoint
app.post("/logout", (req, res) => {
  const { refresh_token } = req.body;
  refreshTokens = refreshTokens.filter((t) => t !== refresh_token);
  res.json({ message: "Logged out successfully" });
});

// Middleware xác thực access token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Missing token" });

  jwt.verify(token, ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

// Protected route: /products
app.get("/products", authenticateToken, (req, res) => {
  res.json({
    user: req.user,
    products,
  });
});

// ---------------------------
// Route: GET /users (có pagination)
// ---------------------------

app.get("/users", authenticateToken, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  const totalUsers = user_list.length;
  const totalPages = Math.ceil(totalUsers / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  const usersPage = user_list.slice(startIndex, endIndex).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    avatar: u.avatar,
    display_name: u.display_name,
  }));

  res.json({
    success: true,
    message: "User list fetched successfully",
    pagination: {
      current_page: page,
      limit,
      total_items: totalUsers,
      total_pages: totalPages,
    },
    data: usersPage,
  });
});

// Public route
app.get("/", (req, res) => {
  res.json({ message: "Auth demo server is running" });
});

// ===== START =====
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  const networkInterfaces = os.networkInterfaces();
  let lanIP = "localhost";

  for (const iface of Object.values(networkInterfaces)) {
    for (const net of iface) {
      if (net.family === "IPv4" && !net.internal) {
        lanIP = net.address;
        break;
      }
    }
  }
  console.log("=======================================");
  console.log("🚀 Auth Demo Server is running!");
  console.log(`➡ Local:   http://localhost:${PORT}`);
  console.log(`➡ Network: http://${lanIP}:${PORT}`);
  console.log("=======================================");
});


