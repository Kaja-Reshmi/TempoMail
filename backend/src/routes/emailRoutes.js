
import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { authenticateToken } from "../middleware/authMiddleware.js";
import {
  createEmail,
  getEmails,
  getEmailStats,
  getQueueStatus,
} from "../controllers/emailController.js";

const router = Router();

const createEmailLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many scheduling requests. Please try again shortly.",
  },
});

router.use(authenticateToken);

router.post("/", createEmailLimiter, createEmail);
router.get("/stats", getEmailStats);
router.get("/queue-status", getQueueStatus);
router.get("/", getEmails);

export default router;
