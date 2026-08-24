import multer from "multer";
import express from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import os from "os";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";
import ms from 'ms';
import { logRequestResponse } from './middlewares/logger.js';
import { swaggerSpec } from './swagger.js';

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
app.use(cors({
  origin: "*", // demo thì để *, sau này giới hạn lại
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(logRequestResponse); // Sử dụng middleware log request và response

// ===== CONFIG =====
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "demo_access_secret";
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || "demo_refresh_secret";
const ACCESS_TOKEN_EXPIRES = process.env.ACCESS_TOKEN_EXPIRES || "10m"; // "10m"; // access token 10 phút
const REFRESH_TOKEN_EXPIRES = process.env.REFRESH_TOKEN_EXPIRES || "7d"; //"7d"; // refresh token 7 ngày

// ===== DATA =====
const users = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "users.json"), "utf-8")
);
const user_list = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "user_list.json"), "utf-8")
);
const products = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "products.json"), "utf-8")
);

// ===== IN-MEMORY STORE =====
let refreshTokens = [];

// ===== ROUTES =====

/**
 * @openapi
 * /upload:
 *   post:
 *     summary: Upload an image file
 *     description: Uploads a single image (multipart/form-data) and returns its public URL.
 *     tags:
 *       - Files
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: The image file to upload
 *     responses:
 *       '200':
 *         description: Upload success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 url:
 *                   type: string
 *       '400':
 *         description: No file uploaded
 */
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

/**
 * @openapi
 * /download/{filename}:
 *   get:
 *     summary: Download a file
 *     description: Downloads a file that exists in the downloads directory.
 *     tags:
 *       - Files
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: The filename to download
 *     responses:
 *       '200':
 *         description: File download started
 *       '404':
 *         description: File not found
 */
app.get("/download/:filename", (req, res) => {
  const filePath = path.join(downloadDir, req.params.filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "File not found" });
  }

  res.download(filePath); // Express tự gửi file với header download
});


/**
 * @openapi
 * /login:
 *   post:
 *     summary: Login
 *     description: Authenticates a user and returns access + refresh tokens.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: thanhdat@gmail.com
 *               password:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       '200':
 *         description: Login success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 user_id:
 *                   type: number
 *                 email:
 *                   type: string
 *                 username:
 *                   type: string
 *                 access_token:
 *                   type: string
 *                 refresh_token:
 *                   type: string
 *       '401':
 *         description: Invalid credentials
 */
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

/**
 * @openapi
 * /refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Uses a valid refresh token to obtain a new access token.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refresh_token
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 description: The refresh token from /login
 *     responses:
 *       '200':
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 access_token:
 *                   type: string
 *                 refresh_token:
 *                   type: string
 *                 token_type:
 *                   type: string
 *                 expires_in:
 *                   type: number
 *       '401':
 *         description: Missing refresh token
 *       '403':
 *         description: Invalid refresh token
 */
app.post("/refresh", (req, res) => {
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

/**
 * @openapi
 * /logout:
 *   post:
 *     summary: Logout
 *     description: Invalidates the given refresh token.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refresh_token
 *             properties:
 *               refresh_token:
 *                 type: string
 *                 description: The refresh token to revoke
 *     responses:
 *       '200':
 *         description: Logged out successfully
 */
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

/**
 * @openapi
 * /products:
 *   get:
 *     summary: Get products (protected)
 *     description: Returns the product list. Requires a valid Bearer access token.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Product list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                 products:
 *                   type: array
 *       '401':
 *         description: Missing token
 *       '403':
 *         description: Invalid or expired token
 */
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

/**
 * @openapi
 * /users:
 *   get:
 *     summary: Get user list with pagination (protected)
 *     description: Returns a paginated user list. Requires a valid Bearer access token.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *     responses:
 *       '200':
 *         description: Paginated user list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current_page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total_items:
 *                       type: integer
 *                     total_pages:
 *                       type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: number
 *                       username:
 *                         type: string
 *                       email:
 *                         type: string
 *                       avatar:
 *                         type: string
 *                       display_name:
 *                         type: string
 *       '401':
 *         description: Missing token
 *       '403':
 *         description: Invalid or expired token
 */
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

/**
 * @openapi
 * /users/search:
 *   get:
 *     summary: Search users by username (protected)
 *     description: Searches users whose username partially matches the query. Requires a valid Bearer access token.
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: The search keyword (substring of username)
 *     responses:
 *       '200':
 *         description: Matching users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       '400':
 *         description: Missing search query parameter 'q'
 *       '401':
 *         description: Missing token
 *       '403':
 *         description: Invalid or expired token
 */
// search users by username
app.get("/users/search", authenticateToken, (req, res) => {
  const q = req.query.q || "";
  if (!q) {
        // Trả về 400 Bad Request nếu thiếu tham số tìm kiếm
        return res.status(400).json({ 
            message: "Missing search query parameter 'q'." 
        });
  }
  const matchedUsers = user_list
  .filter((u) => u.username.toLowerCase().includes(q.toLowerCase()))
  .map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    avatar: u.avatar,
    display_name: u.display_name,
  }));

  res.json({
    success: true,
    message: `Found ${matchedUsers.length} users matching "${q}"`,
    data: matchedUsers,
  });
});

// Public route
app.get("/", (req, res) => {
  res.json({ message: "Auth demo server is running" });
});

// ===== SWAGGER DOCS =====
app.get("/docs", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Auth Demo API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: '/docs.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`);
});
app.get("/docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

// ===== START =====
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// Chỉ listen khi chạy local (không phải trên Vercel)
if (process.env.VERCEL !== "1") {
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
}

export default app;


