import {
    Client,
    GatewayIntentBits
} from "discord.js";
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
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });
    }
}

// Lista mods do servidor
async function listMods() {
    await ensureSSHConnection();
    const path = process.env.MODS_PATH || "mods";
    const res = await ssh.execCommand(`ls -1 ${path}`);
    if (res.stderr) throw new Error(res.stderr);
    return res.stdout.trim() || "Nenhum mod encontrado";
}

// Sanitiza nomes de arquivo para evitar problemas
function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "");
}

// ======================= HANDLER =======================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {

        // ----------- /PING -----------------
        if (interaction.commandName === "ping") {
            return interaction.reply("🏓 Pong!");
        }

        // ----------- /LISTMODS --------------
        if (interaction.commandName === "listmods") {
            await interaction.reply("🔍 Listando mods...");
            const modsList = await listMods();
            return interaction.editReply(
                "📦 **Mods instalados:**\n```\n" + modsList + "\n```"
            );
        }

        // ----------- /UPLOADMOD -------------
        if (interaction.commandName === "uploadmod") {
            const arquivo = interaction.options.getAttachment("arquivo");

            if (!arquivo.name.endsWith(".jar")) {
                return interaction.reply("❌ Apenas arquivos `.jar` são permitidos.");
            }

            await interaction.reply("📤 Enviando mod para o servidor...");

            // Baixar arquivo temporariamente
            const tempPath = `${os.tmpdir()}/${arquivo.name}`;
            const response = await fetch(arquivo.url);
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.promises.writeFile(tempPath, buffer);

            // Upload para servidor
            await ensureSSHConnection();
            const modsPath = process.env.MODS_PATH || "mods";
            await ssh.putFile(tempPath, `${modsPath}/${arquivo.name}`);

            return interaction.editReply(`✅ Mod **${arquivo.name}** enviado com sucesso!`);
        }

        // ----------- /REMOVEMOD -------------
        if (interaction.commandName === "removemod") {
            const nome = interaction.options.getString("nome");
            const nomeSanitizado = sanitizeFileName(nome);

            await interaction.reply("🗑 Removendo mod...");
            await ensureSSHConnection();

            const modsPath = process.env.MODS_PATH || "mods";
            const result = await ssh.execCommand(`rm ${modsPath}/${nomeSanitizado}`);

            if (result.stderr) {
                return interaction.editReply("❌ Erro ao remover o mod. Verifique o nome.");
            }

            return interaction.editReply(`✅ Mod **${nomeSanitizado}** removido!`);
        }

        // ----------- /RESTART ----------------
        if (interaction.commandName === "restart") {
            await interaction.reply("🔄 Reiniciando a instância...");
            await ensureSSHConnection();

            // Ajuste o comando conforme seu servidor
            await ssh.execCommand("restart");

            return interaction.editReply("✅ Servidor reiniciado!");
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

            return interaction.editReply(
                "**ℹ️ STATUS DO SERVIDOR**\n\n" +
                "📁 **Mods instalados:**\n```\n" +
                modsList +
                "\n```"
            );
        }

    } catch (err) {
        console.error(err);
        return interaction.editReply(`❌ Ocorreu um erro:\n\`\`\`\n${err.message}\n\`\`\``);
    }
});

// ======================= LOGIN DO BOT =======================
client.login(process.env.DISCORD_TOKEN);
