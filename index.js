import { Client, GatewayIntentBits } from "discord.js";
import { NodeSSH } from "node-ssh";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ssh = new NodeSSH();

// ======================= HELPERS =======================

async function ensureSSHConnection() {
    if (!ssh.isConnected()) {
        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT) || 22,
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS,
            hostVerifier: (hash) => {
                console.log("Fingerprint do host:", hash);
                return true;
            }
        });
    }
}

// Lista mods com tratamento de erros
async function listMods() {
    await ensureSSHConnection();
    const modsPath = process.env.SFTP_MODS_PATH || "/home/minecraft/mgt/mods";
    const sftp = await ssh.requestSFTP();

    return new Promise((resolve) => {
        sftp.readdir(modsPath, (err, list) => {
            if (err) {
                console.error("Erro ao listar mods:", err.message);
                return resolve(`❌ Não foi possível listar os mods: ${err.message}`);
            }
            if (!list || list.length === 0) return resolve("Nenhum mod encontrado");

            const filenames = list
                .map(f => f.filename)
                .filter(name => name && name.trim() !== "");
            resolve(filenames.join("\n") || "Nenhum mod encontrado");
        });
    });
}

// Upload de mod
async function uploadMod(file) {
    const modsPath = process.env.SFTP_MODS_PATH || "/home/minecraft/mgt/mods";
    const tempPath = `${os.tmpdir()}/${file.name}`;
    const response = await fetch(file.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(tempPath, buffer);

    await ensureSSHConnection();
    try {
        await ssh.putFile(tempPath, `${modsPath}/${file.name}`);
    } catch (err) {
        throw new Error(`Falha ao enviar o mod: ${err.message}`);
    }
}

// Remove mod com tratamento de erros
async function removeMod(filename) {
    const modsPath = process.env.SFTP_MODS_PATH || "/home/minecraft/mgt/mods";
    const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");

    await ensureSSHConnection();
    const sftp = await ssh.requestSFTP();

    return new Promise((resolve, reject) => {
        sftp.unlink(`${modsPath}/${sanitized}`, (err) => {
            if (err) {
                console.error(`Erro ao remover ${sanitized}:`, err.message);
                return reject(new Error(`Não foi possível remover ${sanitized}: ${err.message}`));
            }
            resolve(sanitized);
        });
    });
}

// Reinicia servidor via script
async function restartServer() {
    const cmd = process.env.RESTART_CMD || "/home/minecraft/mgt/restart.sh";
    await ensureSSHConnection();
    const res = await ssh.execCommand(cmd);
    if (res.stderr) throw new Error(res.stderr);
    return "Servidor reiniciado com sucesso!";
}

// ======================= HANDLER =======================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case "ping":
                return interaction.reply("🏓 Pong!");

            case "listmods":
                await interaction.reply("🔍 Listando mods...");
                const modsList = await listMods();
                return interaction.editReply(`📦 **Mods instalados:**\n\`\`\`\n${modsList}\n\`\`\``);

            case "uploadmod":
                const file = interaction.options.getAttachment("arquivo");
                if (!file.name.endsWith(".jar")) return interaction.reply("❌ Apenas arquivos `.jar` são permitidos.");
                await interaction.reply("📤 Enviando mod...");
                await uploadMod(file);
                return interaction.editReply(`✅ Mod **${file.name}** enviado com sucesso!`);

            case "removemod":
                const name = interaction.options.getString("nome");
                await interaction.reply("🗑 Removendo mod...");
                try {
                    const removed = await removeMod(name);
                    return interaction.editReply(`✅ Mod **${removed}** removido!`);
                } catch (err) {
                    return interaction.editReply(`❌ ${err.message}`);
                }

            case "restart":
                await interaction.reply("🔄 Reiniciando servidor...");
                const msg = await restartServer();
                return interaction.editReply(`✅ ${msg}`);

            case "info":
                await interaction.reply("📡 Coletando informações...");
                const mods = await listMods();
                return interaction.editReply(`**ℹ️ STATUS DO SERVIDOR**\n\n📁 **Mods instalados:**\n\`\`\`\n${mods}\n\`\`\``);

            case "help":
                return interaction.reply({
                    content:
                        "📘 **Lista de comandos:**\n\n" +
                        "• `/ping` — Testa o bot\n" +
                        "• `/listmods` — Lista mods instalados\n" +
                        "• `/uploadmod` — Enviar mod (.jar)\n" +
                        "• `/removemod` — Remover mod\n" +
                        "• `/restart` — Reiniciar servidor\n" +
                        "• `/info` — Informações gerais\n" +
                        "• `/help` — Ajuda",
                    ephemeral: true
                });

            default:
                return interaction.reply("❌ Comando desconhecido.");
        }
    } catch (err) {
        console.error(err);
        return interaction.editReply(`❌ Ocorreu um erro:\n\`\`\`\n${err.message}\n\`\`\``);
    }
});

// ======================= LOGIN =======================
client.login(process.env.DISCORD_TOKEN);
