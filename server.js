const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ────────────────────────────────────────────────────
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:4173",
      process.env.FRONTEND_URL || "",
    ].filter(Boolean),
    credentials: true,
  })
);

app.use(express.json());

// ── MongoDB Connect ──────────────────────────────────────────
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not set in .env");
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    process.exit(1);
  }
}

// ── ChatSession Model ────────────────────────────────────────
const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ChatSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    messages: { type: [MessageSchema], default: [] },
  },
  { timestamps: true }
);

// 24 ghante baad auto delete
ChatSessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

const ChatSession = mongoose.model("ChatSession", ChatSessionSchema);

// ── ContactMessage Model ────────────────────────────────────
const ContactMessageSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    email:     { type: String, required: true, trim: true, lowercase: true },
    message:   { type: String, required: true, trim: true },
    ipAddress: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true }
);

const ContactMessage = mongoose.model("ContactMessage", ContactMessageSchema);

// ── Rate Limiter ─────────────────────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many requests. Please try again in a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── System Prompt ────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Easha 🌸, a warm, witty, and intelligent female AI assistant living inside M. Aayan Qasim's personal portfolio website.

━━━ YOUR PERSONALITY ━━━
- You are friendly, fun, and conversational — like a smart friend, not a robot
- You use light humor when appropriate
- You are encouraging and positive
- When someone greets you (hi, hello, salam, kya hal hai, wassup), respond warmly and ask how you can help
- When someone asks "kya kar rahi ho" or "what are you doing" — say something fun like "Aayan ke visitors ki madad kar rahi hoon, aur aap? 😄"
- When someone asks your name → "Main Easha hoon! Aayan ki AI assistant 🌸"
- When someone asks who made you → "Aayan ne mujhe banaya hai — quite talented hai na? 😄"
- Use emojis naturally but not excessively
- Be concise — don't write essays unless asked

━━━ CRITICAL LANGUAGE RULE ━━━
Detect language from the user's message:
- Roman Urdu (e.g. "ap ka naam kya hai", "kya hal hai", "mujhe batao") → Reply in Roman Urdu
- English → Reply in English
- Mixed → Match the dominant language
- NEVER switch language unless user switches first
- Roman Urdu reply style example: "Ji zaroor! Aayan abhi SkyPulse mein kaam kar rahe hain 😊"

━━━ YOUR TWO ROLES ━━━
1. PORTFOLIO EXPERT — You know everything about Aayan and answer accurately
2. GENERAL AI — Answer ANY question: coding, math, general knowledge, advice, fun facts, anything. Never say "I can't answer that" or redirect.

━━━━━━━━━━━━━━━━━━━━━━━
AAYAN'S COMPLETE INFO
━━━━━━━━━━━━━━━━━━━━━━━

Full Name: M. Aayan Qasim
Title: Web Developer
Location: Islamabad, Pakistan
Phone: +92307-5177781, +92327-9899966
Email: qasimaayan92@gmail.com
GitHub: github.com/Aayan-Qasim
LinkedIn: linkedin.com/in/aayan-qasim-9b426138b
Available for: Freelance & Full-time work

CURRENT JOB:
→ Web Developer at SkyPulse, Islamabad (2025 – Present)
  • Building client-facing web applications
  • React.js UI development with Tailwind CSS
  • API integration using Node.js & Express.js
  • Performance optimization & cross-browser compatibility

PREVIOUS EXPERIENCE:
→ Web Developer at Engineering Equipment Pvt. Limited, Islamabad (2024–2025 | 1 Year)
  • Responsive websites with HTML, CSS, JavaScript, React
  • Reusable components & state management
  • REST API integration & form validations
  • UI/UX improvements based on client feedback

→ Web Development Intern at SkyPulse, Islamabad (2024 | 3 Months)
  • Front-end dev with HTML, CSS, JavaScript
  • UI component building & cross-browser debugging
  • Git & GitHub for version control

SKILLS:
• Frontend: HTML5, CSS3, JavaScript (ES6+), React.js, Tailwind CSS, Bootstrap, Responsive Web Design
• Backend: Node.js, Express.js, REST APIs
• Database: MongoDB, MySQL
• Tools: Git, GitHub, VS Code, NPM, Browser DevTools
• Other: UI/UX Best Practices, Debugging & Problem Solving, Clean Code

EDUCATION:
• F.A Intermediate (2025) — 550 marks
• Matriculation (2023) — 663 marks

PROJECTS:
• Portfolio Website — React, Tailwind CSS, Framer Motion
• Weather App — JavaScript, REST API
• Task Manager — React, Bootstrap

Personal:
• Father's Name: Ghulam Qasim
• Address: House Plot # No C4A, Main Park Road, Chak Shehzad, Islamabad

━━━━━━━━━━━━━━━━━━━━━━━

Always be helpful, warm, and human. Match the user's energy — if they're casual, be casual. If they're formal, be professional. You are the best part of Aayan's portfolio! 🌸`;

const GROK_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROK_MODEL = "llama-3.3-70b-versatile";

// ── Health Check ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Root & Favicon (suppress 404s) ───────────────────────────
app.get("/", (_req, res) => res.json({ status: "Aayan Portfolio Backend ✅", version: "1.0.0" }));
app.get("/favicon.ico", (_req, res) => res.status(204).end());
app.get("/favicon.png", (_req, res) => res.status(204).end());

// ── POST /api/chat ───────────────────────────────────────────
app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId required" });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message required" });
    }

    const GROK_API_KEY = process.env.GROK_API_KEY;
    if (!GROK_API_KEY) {
      return res.status(500).json({ error: "GROK_API_KEY not set in .env" });
    }

    // Session lo ya banao
    let session = await ChatSession.findOne({ sessionId });
    if (!session) {
      session = new ChatSession({ sessionId, messages: [] });
    }

    session.messages.push({
      role: "user",
      content: message.trim(),
      createdAt: new Date(),
    });

    const historyForGrok = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const grokRes = await fetch(GROK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...historyForGrok],
        stream: true,
      }),
    });

    if (!grokRes.ok) {
      session.messages.pop();
      if (grokRes.status === 429) return res.status(429).json({ error: "Grok rate limit. Try later." });
      if (grokRes.status === 401) return res.status(401).json({ error: "Invalid GROK_API_KEY." });
      return res.status(500).json({ error: "AI service error" });
    }

    // Streaming response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = grokRes.body.getReader();
    const decoder = new TextDecoder();
    let assistantReply = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      res.write(chunk);

      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const json = line.slice(6).trim();
        if (json === "[DONE]") break;
        try {
          const parsed = JSON.parse(json);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) assistantReply += content;
        } catch {}
      }
    }

    if (assistantReply) {
      session.messages.push({
        role: "assistant",
        content: assistantReply,
        createdAt: new Date(),
      });
    }
    await session.save();
    res.end();
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ── GET /api/chat/history/:sessionId ────────────────────────
app.get("/api/chat/history/:sessionId", async (req, res) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.sessionId });
    if (!session) {
      return res.json({ sessionId: req.params.sessionId, messages: [], count: 0 });
    }
    res.json({
      sessionId: session.sessionId,
      messages: session.messages,
      count: session.messages.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// ── DELETE /api/chat/history/:sessionId ─────────────────────
app.delete("/api/chat/history/:sessionId", async (req, res) => {
  try {
    await ChatSession.findOneAndDelete({ sessionId: req.params.sessionId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to clear history" });
  }
});

// ── Nodemailer Transporter ────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,   // aapki Gmail: e.g. qasimaayan92@gmail.com
      pass: process.env.EMAIL_PASS,   // Gmail App Password (16 char)
    },
  });
}

// ── POST /api/contact ─────────────────────────────────────────
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many contact requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/contact", contactLimiter, async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ error: "Name, email and message are required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const transporter = createTransporter();

    // ── 1. Aayan ko notification email ───────────────────────
    await transporter.sendMail({
      from: `"Portfolio Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `📬 New Message from ${name} — Portfolio`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #e5e5e5; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #6d28d9, #7c3aed); padding: 24px 32px;">
            <h2 style="margin: 0; color: #fff; font-size: 22px;">📬 New Portfolio Message</h2>
          </div>
          <div style="padding: 32px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 10px 0; color: #a1a1aa; font-size: 13px; width: 100px;">Name</td>
                <td style="padding: 10px 0; color: #e5e5e5; font-weight: 600;">${name}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #a1a1aa; font-size: 13px;">Email</td>
                <td style="padding: 10px 0;"><a href="mailto:${email}" style="color: #7c3aed;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #a1a1aa; font-size: 13px; vertical-align: top;">Message</td>
                <td style="padding: 10px 0; color: #e5e5e5; line-height: 1.6;">${message.replace(/\n/g, "<br>")}</td>
              </tr>
            </table>
            <div style="margin-top: 24px; padding: 16px; background: #1a1a1a; border-radius: 8px; font-size: 13px; color: #71717a;">
              Sent from your portfolio contact form • ${new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}
            </div>
          </div>
        </div>
      `,
    });

    // ── 2. User ko auto-reply ─────────────────────────────────
    await transporter.sendMail({
      from: `"Aayan Qasim" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `Thanks for reaching out, ${name}! 👋`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0f0f0f; color: #e5e5e5; border-radius: 12px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #6d28d9, #7c3aed); padding: 24px 32px;">
            <h2 style="margin: 0; color: #fff; font-size: 22px;">Hey ${name}! 👋</h2>
          </div>
          <div style="padding: 32px; line-height: 1.7;">
            <p>Thanks for getting in touch through my portfolio!</p>
            <p>I've received your message and will get back to you <strong style="color: #a78bfa;">within 24 hours</strong>.</p>
            ${message.toLowerCase().includes("meet") || message.toLowerCase().includes("book") || message.toLowerCase().includes("call") ? `
            <div style="margin: 24px 0; padding: 16px 20px; background: #1a1a1a; border-left: 3px solid #7c3aed; border-radius: 0 8px 8px 0;">
              <p style="margin: 0; font-size: 14px; color: #a1a1aa;">📅 <strong style="color: #e5e5e5;">Meeting Request Received!</strong><br>
              I'll confirm a time that works for both of us via email. Looking forward to it!</p>
            </div>
            ` : ""}
            <p>In the meantime, feel free to check out my work:</p>
            <div style="margin: 20px 0;">
              <a href="https://github.com/Aayan-Qasim" style="display: inline-block; margin-right: 12px; padding: 10px 20px; background: #1a1a1a; color: #a78bfa; text-decoration: none; border-radius: 8px; font-size: 14px; border: 1px solid #333;">GitHub →</a>
              <a href="https://www.linkedin.com/in/aayan-qasim-9b426138b/" style="display: inline-block; padding: 10px 20px; background: #1a1a1a; color: #a78bfa; text-decoration: none; border-radius: 8px; font-size: 14px; border: 1px solid #333;">LinkedIn →</a>
            </div>
            <hr style="border: none; border-top: 1px solid #262626; margin: 24px 0;">
            <p style="margin: 0; font-size: 14px; color: #71717a;">
              M. Aayan Qasim · Web Developer · Islamabad, Pakistan<br>
              📱 0307-5177781 · 📧 qasimaayan92@gmail.com
            </p>
          </div>
        </div>
      `,
    });

    // ── Save to MongoDB ──────────────────────────────────────
    const contactDoc = new ContactMessage({
      name,
      email,
      message,
      ipAddress: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
    });
    await contactDoc.save();

    res.json({ success: true, message: "Message sent successfully!" });
  } catch (err) {
    console.error("Contact email error:", err);
    res.status(500).json({ error: "Failed to send email. Please try again." });
  }
});

// ── GET /api/contacts (admin — all messages) ─────────────────
app.get("/api/contacts", async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    res.json({ total: messages.length, messages });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages." });
  }
});

// ── Start ────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
});