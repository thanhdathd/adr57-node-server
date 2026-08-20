import swaggerJsdoc from "swagger-jsdoc";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Auth Demo API",
      version: "1.0.0",
      description:
        "Demo JWT authentication backend for Android / mobile clients. " +
        "Login to get tokens, then use the Bearer token to access protected routes.",
    },
    servers: [
      {
        url: "/",
        description: "Current host (local / Vercel)",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Paste the access_token received from /login or /refresh. Format: Bearer <token>",
        },
      },
    },
  },
  apis: [path.join(__dirname, "server.js").split(path.sep).join("/")],
};

export const swaggerSpec = swaggerJsdoc(options);
