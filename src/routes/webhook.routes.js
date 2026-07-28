import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/webhook.controller.js";

const router = Router();

router.post("/razorpay", handleRazorpayWebhook);

export default router;
