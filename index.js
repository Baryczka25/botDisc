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

        return interaction.editReply(`✅ Mod **${arqu**
