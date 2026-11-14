
import express from "express";

import {
  register,
  login,
  getCurrentUser,
} from "../controllers/authController.js";

import { authenticateToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public authentication routes
router.post("/register", register);
router.post("/login", login);

// Protected route: retrieve logged-in user
router.get("/me", authenticateToken, getCurrentUser);

// Export router for server.js
export default router;
