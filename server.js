const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const users = [
    {
        username: 'admin',
        password: 'root',
    },
];

let botSocket = null;
let latestQR = null;

const settingsFile = path.join("/tmp", "settings.json");

// ✅ Fungsi untuk membaca dan menyimpan pengaturan ke file JSON (gunakan `/tmp/` untuk Vercel)
function loadSettings() {
    if (!fs.existsSync(settingsFile)) {
        fs.writeFileSync(settingsFile, JSON.stringify({ prefixes: ["!"], commands: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(settingsFile));
}
function saveSettings(settings) {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

// ✅ Muat pengaturan saat bot dimulai
let settings = loadSettings();

async function startBot() {
    if (botSocket) {
        console.log("✅ Bot sudah berjalan!");
        return;
    }

    try {
        console.log("🚀 Memulai bot...");
        const sessionPath = path.join("/tmp", "session");
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        botSocket = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });

        botSocket.ev.on("creds.update", saveCreds);
        botSocket.ev.on("connection.update", (update) => {
            const { qr, connection, lastDisconnect } = update;

            if (qr) {
                latestQR = qr;
                console.log("📌 Scan QR Code untuk login:");
                qrcode.generate(qr, { small: true });
            }

            if (connection === "open") {
                console.log("✅ WhatsApp bot terhubung!");
                latestQR = null;
            } else if (connection === "close") {
                latestQR = null;
                const reason = lastDisconnect?.error?.output?.statusCode;

                if (reason === DisconnectReason.loggedOut) {
                    console.log("⚠️ Bot logout, perlu scan ulang.");
                    botSocket = null;
                } else {
                    console.log("🔄 Bot terputus, mencoba reconnect...");
                    botSocket = null;
                    setTimeout(startBot, 5000);
                }
            }
        });

    } catch (error) {
        console.error("❌ Gagal memulai bot:", error.message);
    }
}

// ✅ API untuk memulai bot
app.get("/api/start-bot", async (req, res) => {
    if (botSocket) {
        return res.json({ success: false, message: "Bot sudah berjalan" });
    }
    await startBot();
    res.json({ success: true, message: "Bot sedang dimulai, scan QR jika diperlukan" });
});

// ✅ API untuk mendapatkan daftar perintah
app.get("/api/get-commands", (req, res) => {
    res.json({ success: true, commands: settings.commands });
});

// ✅ API untuk menambahkan perintah baru
app.post("/api/add-command", (req, res) => {
    const { command, response } = req.body;
    if (!command || !response) {
        return res.json({ success: false, message: "Command dan response tidak boleh kosong." });
    }

    if (settings.commands[command]) {
        return res.json({ success: false, message: "Command sudah ada!" });
    }

    settings.commands[command] = response;
    saveSettings(settings);
    res.json({ success: true, message: `Command '/${command}' ditambahkan.` });
});

// ✅ API untuk menghapus perintah
app.post("/api/remove-command", (req, res) => {
    const { command } = req.body;
    if (!settings.commands[command]) {
        return res.json({ success: false, message: "Command tidak ditemukan!" });
    }

    delete settings.commands[command];
    saveSettings(settings);
    res.json({ success: true, message: `Command '/${command}' dihapus.` });
});

// ✅ API login
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.json({ success: false, message: "Invalid request" });
    }

    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ success: true });
    } else {
        res.json({ success: false, message: "Invalid credentials" });
    }
});

// ✅ API untuk mengecek status bot
app.get("/api/status-bot", (req, res) => {
    const isRunning = !!botSocket;
    res.json({ success: isRunning, status: isRunning ? "Running" : "Disconnected" });
});

module.exports = app;
