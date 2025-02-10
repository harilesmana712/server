const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = 3000;
const users = [
    {
      username: 'admin',
      password: 'root',
    },
  ];
  app.use(cors());
  
app.use(bodyParser.json());

let botSocket = null;
let latestQR = null;

// ✅ Fungsi untuk membaca dan menyimpan pengaturan ke file JSON
const settingsFile = "settings.json";
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
        const { state, saveCreds } = await useMultiFileAuthState("session");
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

        botSocket.ev.on("messages.upsert", (m) => {
            const msg = m.messages[0];
            if (!msg.message) return;

            const sender = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (text) {
                console.log(`📩 Pesan masuk dari ${sender}: ${text}`);

                // ✅ Periksa apakah pesan memiliki prefix
                const prefix = settings.prefixes.find((p) => text.startsWith(p));
                if (prefix) {
                    const command = text.slice(prefix.length).trim();
                    handleCommand(sender, command, msg);
                }
            }
        });

    } catch (error) {
        console.error("❌ Gagal memulai bot:", error.message);
    }
}

// ✅ Fungsi menangani perintah
async function handleCommand(sender, command, msg) {
    if (settings.commands[command]) {
        sendMessage(sender, settings.commands[command], msg);
    } else if (command === "tagall") {
        tagAllMembers(msg);
    }  else if (command.startsWith("leveling")) {
        await handleLeveling(sender, command, msg);
    }
    
    else {
        sendMessage(sender, "❌ Perintah tidak dikenali.", msg);
    }
}

// ✅ Fungsi untuk mengirim pesan dengan quoted reply
function sendMessage(to, message, originalMsg) {
    if (botSocket) {
        botSocket.sendMessage(to, { text: message }, { quoted: originalMsg });
    }
}
//fungsi leveling
async function handleLeveling(sender, command, msg) {
    try {
        // Ambil argumen setelah "leveling"
        const args = command.split(" ").slice(1);
        
        if (args.length === 0) {
            return sendMessage(sender, "⚠️ Format salah! Gunakan: `!leveling [level] | [bonus exp]`", msg);
        }

        // Ambil level dan bonus exp dari input
        let [lvl, bexp = "0"] = args.join(" ").split("|").map(s => s.trim());

        if (!/^\d+$/.test(lvl) || !/^\d+$/.test(bexp)) {
            return sendMessage(sender, "⚠️ Level dan bonus EXP harus berupa angka!", msg);
        }

        sendMessage(sender, "⏳ Sedang mengambil data...", msg);

        const response = await axios.get(`https://coryn.club/leveling.php?lv=${lvl}&gap=7&bonusEXP=${bexp}`);
        const html = response.data;
        const $ = cheerio.load(html);
        let result = [];

        $(".level-row").each(function () {
            let level = $(this).find(".level-col-1 > b").text().trim();
            let boss = $(this).find(".level-col-2 > p:nth-child(1) > b > a").text().trim();
            let location = $(this).find(".level-col-2 > p:nth-child(2)").text().trim();
            let fullBreak = $(this).find(".level-col-3 > p:nth-child(1) > b").text().trim();
            let noBreak = $(this).find(".level-col-3 > p:nth-child(4)").text().trim();

            if (fullBreak) {
                result.push({
                    level,
                    boss,
                    location,
                    exp: { fullBreak, noBreak }
                });
            }
        });

        if (result.length === 0) {
            return sendMessage(sender, `❌ Tidak ada hasil untuk level ${lvl} dengan bonus EXP ${bexp}%`, msg);
        }

        let replyMsg = `*📌 Leveling Level ${lvl} & Bonus EXP ${bexp}%*\n`;
        result.forEach(data => {
            replyMsg += `\n----------------------\n`;
            replyMsg += `📌 *Boss:* ${data.boss}\n`;
            replyMsg += `📌 *Level:* ${data.level}\n`;
            replyMsg += `📌 *Lokasi:* ${data.location}\n`;
            replyMsg += `📌 *EXP Full Break:* ${data.exp.fullBreak}\n`;
            replyMsg += `📌 *EXP No Break:* ${data.exp.noBreak}\n`;
        });

        sendMessage(sender, replyMsg, msg);
    } catch (err) {
        sendMessage(sender, `❌ Terjadi kesalahan: ${err.message}`, msg);
    }
}

// ✅ Fungsi untuk men-tag semua anggota grup
async function tagAllMembers(msg) {
    if (!msg.key.remoteJid.endsWith("@g.us")) {
        return sendMessage(msg.key.remoteJid, "⚠️ Perintah ini hanya bisa digunakan dalam grup.", msg);
    }

    const groupMetadata = await botSocket.groupMetadata(msg.key.remoteJid);
    const members = groupMetadata.participants.map((member) => member.id);
    const mentions = members.map((id) => `@${id.split("@")[0]}`).join(" ");

    sendMessage(msg.key.remoteJid, `📢 TAG ALL:\n${mentions}`, msg);
}

// ✅ Endpoint untuk memulai bot
app.get("/start-bot", async (req, res) => {
    if (botSocket) {
        return res.json({ success: false, message: "Bot sudah berjalan" });
    }

    await startBot();
    res.json({ success: true, message: "Bot sedang dimulai, scan QR jika diperlukan" });
});

// ✅ Endpoint untuk mendapatkan daftar perintah
app.get("/get-commands", (req, res) => {
    res.json({ success: true, commands: settings.commands });
});

// ✅ Endpoint untuk menambahkan perintah baru
app.post("/add-command", (req, res) => {
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

// ✅ Endpoint untuk menghapus perintah
app.post("/remove-command", (req, res) => {
    const { command } = req.body;

    if (!settings.commands[command]) {
        return res.json({ success: false, message: "Command tidak ditemukan!" });
    }

    delete settings.commands[command];
    saveSettings(settings);
    res.json({ success: true, message: `Command '/${command}' dihapus.` });
});

// ✅ Endpoint untuk mendapatkan daftar prefix
app.get("/get-prefixes", (req, res) => {
    res.json({ success: true, prefixes: settings.prefixes });
});

// ✅ Endpoint untuk menambahkan prefix baru
app.post("/add-prefix", (req, res) => {
    const { prefix } = req.body;

    if (!prefix || prefix.length > 3) {
        return res.json({ success: false, message: "Prefix tidak valid (maks 3 karakter)." });
    }

    if (settings.prefixes.includes(prefix)) {
        return res.json({ success: false, message: "Prefix sudah ada!" });
    }

    settings.prefixes.push(prefix);
    saveSettings(settings);
    res.json({ success: true, message: `Prefix '${prefix}' ditambahkan.` });
});

// ✅ Endpoint untuk menghapus prefix
app.post("/remove-prefix", (req, res) => {
    const { prefix } = req.body;

    if (!settings.prefixes.includes(prefix)) {
        return res.json({ success: false, message: "Prefix tidak ditemukan!" });
    }

    settings.prefixes = settings.prefixes.filter(p => p !== prefix);
    saveSettings(settings);
    res.json({ success: true, message: `Prefix '${prefix}' dihapus.` });
});
// ✅ Endpoint untuk mengecek status bot
app.get("/status-bot", (req, res) => {
    const isRunning = !!botSocket;
    res.json({ success: isRunning, status: isRunning ? "Running" : "Disconnected" });
});

// ✅ Endpoint login
app.post("/login", (req, res) => {
    const { username, password } = req.body;
  
    // Validasi input
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
// ✅ Menjalankan server
app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});