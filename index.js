import { Client, GatewayIntentBits } from "discord.js";
import { NodeSSH } from "node-ssh";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ssh = new NodeSSH();

client.once("ready", () => console.log("Bot online!"));

// ======================= FUNÇÕES HELPERS =======================

// Garante que o bot esteja conectado via SSH
async function ensureSSHConnection() {
    if (!ssh.isConnected()) {
        await ssh.connect({
            host: process.env.SFTP_HOST, // apenas o host puro, sem sftp://
            port: Number(process.env.SFTP_PORT) || 22,
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });
    }
}

// Lista mods do servidor
async function listMods() {
    await ensureSSHConnection();
    const modsPath = process.env.MODS_PATH || "/home/usuario/minecraft-server/mods"; // caminho absoluto
    const res = await ssh.execCommand(`ls -1 ${modsPath}`);
    if (res.stderr) throw new Error(res.stderr);
    return res.stdout.trim() || "Nenhum mod encontrado";
}

// Reinicia o servidor
async function restartServer() {
    await ensureSSHConnection();
    const restartCmd = process.env.RESTART_CMD || "sudo systemctl restart minecraft"; // ajuste conforme seu servidor
    const res = await ssh.execCommand(restartCmd);
    if (res.stderr) throw new Error(res.stderr);
    return "Servidor reiniciado com sucesso!";
}

// Sanitiza nomes de arquivo
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

// ======================= HANDLER =======================
client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {
        const modsPath = process.env.MODS_PATH || "/home/usuario/minecraft-server/mods";

        // ----------- /PING -----------------
        if (interaction.commandName === "ping") {
            return interaction.reply("🏓 Pong!");
        }

        // ----------- /LISTMODS --------------
        if (interaction.commandName === "listmods") {
            await interaction.reply("🔍 Listando mods...");
            const modsList = await listMods();
            return interaction.editReply(`📦 **Mods instalados:**\n\`\`\`\n${modsList}\n\`\`\``);
        }

        // ----------- /UPLOADMOD -------------
        if (interaction.commandName === "uploadmod") {
            const arquivo = interaction.options.getAttachment("arquivo");

            if (!arquivo.name.endsWith(".jar")) {
                return interaction.reply("❌ Apenas arquivos `.jar` são permitidos.");
            }

            await interaction.reply("📤 Enviando mod para o servidor...");

            const tempPath = `${os.tmpdir()}/${arquivo.name}`;
            const response = await fetch(arquivo.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.promises.writeFile(tempPath, buffer);

            await ensureSSHConnection();
            await ssh.putFile(tempPath, `${modsPath}/${arquivo.name}`);

            return interaction.editReply(`✅ Mod **${arquivo.name}** enviado com sucesso!`);
        }

        // ----------- /REMOVEMOD -------------
        if (interaction.commandName === "removemod") {
            const nome = sanitizeFileName(interaction.options.getString("nome"));
            await interaction.reply("🗑 Removendo mod...");

            await ensureSSHConnection();
            const result = await ssh.execCommand(`rm ${modsPath}/${nome}`);

            if (result.stderr) {
                return interaction.editReply("❌ Erro ao remover o mod. Verifique o nome.");
            }

            return interaction.editReply(`✅ Mod **${nome}** removido!`);
        }

        // ----------- /RESTART ----------------
        if (interaction.commandName === "restart") {
            await interaction.reply("🔄 Reiniciando o servidor...");
            const message = await restartServer();
            return interaction.editReply(`✅ ${message}`);
        }

        // ----------- /HELP -------------------
        if (interaction.commandName === "help") {
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
        }

        // ----------- /INFO -------------------
        if (interaction.commandName === "info") {
            await interaction.reply("📡 Coletando informações...");
            const modsList = await listMods();
            return interaction.editReply(`**ℹ️ STATUS DO SERVIDOR**\n\n📁 **Mods instalados:**\n\`\`\`\n${modsList}\n\`\`\``);
        }

    } catch (err) {
        console.error(err);
        return interaction.editReply(`❌ Ocorreu um erro:\n\`\`\`\n${err.message}\n\`\`\``);
    }
});

// ======================= LOGIN DO BOT =======================
client.login(process.env.DISCORD_TOKEN);
