import {
    Client,
    GatewayIntentBits,
    AttachmentBuilder
} from "discord.js";
import { NodeSSH } from "node-ssh";
import fs from "fs";   // <-- NECESSÁRIO PARA UPLOAD
import dotenv from "dotenv";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const ssh = new NodeSSH();

client.once("ready", () => console.log("Bot online!"));

// ============================================================
// ======================= HANDLER ============================
// ============================================================

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ----------- COMANDO /PING -----------------
    if (interaction.commandName === "ping") {
        return interaction.reply("🏓 Pong!");
    }

    // ----------- COMANDO /LISTMODS --------------
    if (interaction.commandName === "listmods") {
        await interaction.reply("🔍 Listando mods...");

        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });

        const result = await ssh.execCommand("ls mods");

        return interaction.editReply(
            "📦 **Mods instalados:**\n```\n" +
            (result.stdout || "Nenhum mod encontrado") +
            "\n```"
        );
    }

    // ----------- COMANDO /UPLOADMOD -------------
    if (interaction.commandName === "uploadmod") {
        const arquivo = interaction.options.getAttachment("arquivo");

        if (!arquivo.name.endsWith(".jar")) {
            return interaction.reply("❌ Apenas arquivos `.jar` são permitidos.");
        }

        await interaction.reply("📤 Enviando mod para o servidor...");

        // Baixar arquivo do Discord
        const tempPath = `/tmp/${arquivo.name}`;
        const response = await fetch(arquivo.url);
        const buffer = Buffer.from(await response.arrayBuffer());
        await fs.promises.writeFile(tempPath, buffer);

        // Conectar no SFTP
        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });

        // Enviar arquivo
        await ssh.putFile(tempPath, `mods/${arquivo.name}`);

        return interaction.editReply(`✅ Mod **${arquivo.name}** enviado com sucesso!`);
    }

    // ----------- COMANDO /REMOVEMOD -------------
    if (interaction.commandName === "removemod") {
        const nome = interaction.options.getString("nome");

        await interaction.reply("🗑 Removendo mod...");

        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });

        const result = await ssh.execCommand(`rm mods/${nome}`);

        if (result.stderr) {
            return interaction.editReply("❌ Erro ao remover o mod. Verifique o nome.");
        }

        return interaction.editReply(`✅ Mod **${nome}** removido!`);
    }

    // ----------- COMANDO /RESTART ----------------
    if (interaction.commandName === "restart") {
        await interaction.reply("🔄 Reiniciando a instância...");

        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });

        await ssh.execCommand("restart"); // EnxadaHost reinicia 

        return interaction.editReply("✅ Servidor reiniciado!");
    }

    // ----------- COMANDO /HELP -------------------
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

    // ----------- COMANDO /INFO -------------------
    if (interaction.commandName === "info") {
        await interaction.reply("📡 Coletando informações...");

        await ssh.connect({
            host: process.env.SFTP_HOST,
            port: Number(process.env.SFTP_PORT),
            username: process.env.SFTP_USER,
            password: process.env.SFTP_PASS
        });

        const mods = await ssh.execCommand("ls mods");

        return interaction.editReply(
            "**ℹ️ STATUS DO SERVIDOR**\n\n" +
            "📁 **Mods instalados:**\n```\n" +
            (mods.stdout || "Nenhum mod") +
            "\n```"
        );
    }
});

// ==============================================
// LOGIN DO BOT CORRIGIDO
// ==============================================

client.login(process.env.DISCORD_TOKEN);
