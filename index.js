// index.js
import pkg from "discord.js";
const { Client, GatewayIntentBits, AttachmentBuilder } = pkg;

import SFTPClient from "ssh2-sftp-client";
import { Rcon } from "rcon-client";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const sftp = new SFTPClient();

// ======================= HELPERS =======================

// Conecta no servidor SFTP
async function ensureSFTP() {
  if (!sftp.sftp) {
    await sftp.connect({
      host: process.env.SFTP_HOST,
      port: Number(process.env.SFTP_PORT) || 22,
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASS,
      hostVerifier: () => true,
    });
    console.log("✅ Conectado ao servidor via SFTP!");
  }
}

// Lista mods
async function listMods() {
  await ensureSFTP();
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  try {
    const files = await sftp.list(modsPath);
    if (!files || files.length === 0) return "Nenhum mod encontrado";
    return files.map(f => f.name).join("\n");
  } catch (err) {
    console.error("Erro ao listar mods:", err.message);
    return `❌ Não foi possível listar os mods: ${err.message}`;
  }
}

// Upload de mod
async function uploadMod(file) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const tempPath = `${os.tmpdir()}/${file.name}`;
  const response = await fetch(file.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(tempPath, buffer);

  await ensureSFTP();
  try {
    await sftp.put(tempPath, `${modsPath}/${file.name}`);
  } catch (err) {
    throw new Error(`Falha ao enviar o mod: ${err.message}`);
  }
}

// Remove mod
async function removeMod(filename) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");

  await ensureSFTP();
  try {
    await sftp.delete(`${modsPath}/${sanitized}`);
    return sanitized;
  } catch (err) {
    console.error(`Erro ao remover ${sanitized}:`, err.message);
    throw new Error(`Não foi possível remover ${sanitized}: ${err.message}`);
  }
}

// ======================= STATUS DO SERVIDOR VIA RCON =======================
async function getServerStatus() {
  try {
    const rcon = await Rcon.connect({
      host: "enx-cirion-95.enx.host",
      port: 25575,
      password: "buhter",
    });

    const players = await rcon.send("list");
    const version = await rcon.send("version");
    const motd = await rcon.send("motd").catch(() => "Indisponível");
    const tps = await rcon.send("forge tps").catch(() => "Não disponível");

    await rcon.end();

    return {
      online: true,
      players,
      version,
      motd,
      tps,
    };
  } catch (err) {
    return {
      online: false,
      error: err.message,
    };
  }
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

        const modsListRaw = await listMods();
        const modsArray = modsListRaw
          .split("\n")
          .map(name => name.trim())
          .filter(name => name)
          .map(name => name.replace(/\.jar$/i, ""))
          .sort();

        const cleanedList = modsArray.join("\n");
        const tempFile = `${os.tmpdir()}/mods-list.txt`;
        await fs.promises.writeFile(tempFile, cleanedList);

        const attachment = new AttachmentBuilder(tempFile, {
          name: "mods-list.txt",
        });

        return interaction.editReply({
          content: `📦 **Lista de mods (${modsArray.length})**`,
          files: [attachment],
        });

      case "uploadmod":
        const file = interaction.options.getAttachment("arquivo");
        if (!file.name.endsWith(".jar"))
          return interaction.reply("❌ Apenas arquivos `.jar` são permitidos.");
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

      case "info":
        await interaction.reply("📡 Coletando informações...");

        const status = await getServerStatus();
        let msg = "";

        if (status.online) {
          msg += "🟢 **Servidor Online**\n";
          msg += `🎮 **Jogadores:** ${status.players}\n\n`;
          msg += `🔧 **Versão:**\n${status.version}\n\n`;
          msg += `📝 **MOTD:**\n${status.motd}\n\n`;
          msg += `📊 **TPS:**\n${status.tps}\n\n`;
        } else {
          msg += "🔴 **Servidor Offline**\n";
          msg += `Erro: ${status.error}\n\n`;
        }

        const modsInfoRaw = await listMods();
        const modsInfoArray = modsInfoRaw
          .split("\n")
          .map(name => name.trim())
          .filter(name => name)
          .map(name => name.replace(/\.jar$/i, ""))
          .sort();

        const modsFileContent = modsInfoArray.join("\n");
        const tempInfoFile = `${os.tmpdir()}/mods-info.txt`;
        await fs.promises.writeFile(tempInfoFile, modsFileContent);

        const infoAttachment = new AttachmentBuilder(tempInfoFile, {
          name: "mods-info.txt",
        });

        return interaction.editReply({
          content: `**ℹ️ STATUS DO SERVIDOR**\n\n${msg}📁 **Mods instalados (${modsInfoArray.length})**`,
          files: [infoAttachment],
        });

      case "help":
        return interaction.reply({
          content:
            "📘 **Lista de comandos:**\n\n" +
            "• `/ping` — Testa o bot\n" +
            "• `/listmods` — Lista mods instalados\n" +
            "• `/uploadmod` — Enviar mod (.jar)\n" +
            "• `/removemod` — Remover mod\n" +
            "• `/info` — Informações gerais\n" +
            "• `/help` — Ajuda",
          ephemeral: true,
        });

      default:
        return interaction.reply("❌ Comando desconhecido.");
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply(
      `❌ Ocorreu um erro:\n\`\`\`\n${err.message}\n\`\`\``
    );
  }
});

// ======================= LOGIN =======================
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
