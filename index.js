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

// Criar instancia única de SFTP
const sftp = new SFTPClient();

// ======================= SFTP SAFE CONNECT =======================
async function ensureSFTP() {
  try {
    // Testa se está conectado realmente
    await sftp.list("/");
  } catch (err) {
    console.log("🔄 SFTP desconectado — reconectando...");

    try {
      await sftp.connect({
        host: process.env.SFTP_HOST,
        port: Number(process.env.SFTP_PORT) || 22,
        username: process.env.SFTP_USER,
        password: process.env.SFTP_PASS,
        hostVerifier: () => true,
      });

      console.log("✅ SFTP conectado!");
    } catch (connectionError) {
      console.error("❌ Falha ao reconectar ao SFTP:", connectionError.message);
      throw connectionError;
    }
  }
}

// ======================= LISTAR MODS =======================
async function listMods() {
  await ensureSFTP();
  const modsPath = process.env.SFTP_MODS_PATH || "mods";

  try {
    const files = await sftp.list(modsPath);
    if (!files?.length) return "Nenhum mod encontrado";
    return files.map(f => f.name).join("\n");
  } catch (err) {
    console.error("Erro ao listar mods:", err.message);
    return `❌ Não foi possível listar os mods: ${err.message}`;
  }
}

// ======================= UPLOAD =======================
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

// ======================= REMOVER =======================
async function removeMod(filename) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");

  await ensureSFTP();
  try {
    await sftp.delete(`${modsPath}/${sanitized}`);
    return sanitized;
  } catch (err) {
    throw new Error(`❌ Não foi possível remover ${sanitized}: ${err.message}`);
  }
}

// ======================= RCON STATUS =======================
async function getServerStatus() {
  try {
    const rcon = await Rcon.connect({
      host: process.env.RCON_HOST,
      port: Number(process.env.RCON_PORT),
      password: process.env.RCON_PASS,
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
        const raw = await listMods();

        const mods = raw
          .split("\n")
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => x.replace(/\.jar$/i, ""))
          .sort();

        const filePath = `${os.tmpdir()}/mods-list.txt`;
        await fs.promises.writeFile(filePath, mods.join("\n"));

        return interaction.editReply({
          content: `📦 **Mods instalados: ${mods.length}**`,
          files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })],
        });

      case "uploadmod":
        const file = interaction.options.getAttachment("arquivo");
        if (!file.name.endsWith(".jar"))
          return interaction.reply("❌ Só aceito arquivos `.jar`.");

        await interaction.reply("📤 Enviando mod...");
        await uploadMod(file);
        return interaction.editReply(`✅ Mod **${file.name}** enviado!`);

      case "removemod":
        const name = interaction.options.getString("nome");
        await interaction.reply("🗑 Removendo...");
        try {
          const removed = await removeMod(name);
          return interaction.editReply(`✅ Mod **${removed}** removido!`);
        } catch (err) {
          return interaction.editReply(err.message);
        }

      case "info":
        await interaction.reply("📡 Obtendo informações...");

        const status = await getServerStatus();
        let msg = "";

        if (status.online) {
          msg += "🟢 **Servidor Online**\n";
          msg += `🎮 Jogadores: ${status.players}\n`;
          msg += `🔧 Versão:\n${status.version}\n`;
          msg += `📝 MOTD:\n${status.motd}\n`;
          msg += `📊 TPS:\n${status.tps}\n\n`;
        } else {
          msg += "🔴 **Servidor Offline**\n";
          msg += `Erro: ${status.error}\n\n`;
        }

        const modsInfoRaw = await listMods();
        const modsList = modsInfoRaw
          .split("\n")
          .map(x => x.trim())
          .filter(Boolean)
          .sort();

        const modsInfoPath = `${os.tmpdir()}/mods-info.txt`;
        await fs.promises.writeFile(modsInfoPath, modsList.join("\n"));

        return interaction.editReply({
          content: `**ℹ️ STATUS DO SERVIDOR**\n\n${msg}📁 **Mods instalados (${modsList.length})**`,
          files: [new AttachmentBuilder(modsInfoPath, { name: "mods-info.txt" })],
        });

      case "help":
        return interaction.reply({
          content:
            "📘 **Comandos Disponíveis:**\n\n" +
            "• `/ping` — Testa o bot\n" +
            "• `/listmods` — Lista mods instalados\n" +
            "• `/uploadmod` — Envia um mod\n" +
            "• `/removemod` — Remove um mod\n" +
            "• `/info` — Informações gerais\n" +
            "• `/help` — Ajuda",
          ephemeral: true,
        });

      default:
        return interaction.reply("❌ Comando desconhecido.");
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply(`❌ Erro:\n\`\`\`\n${err.message}\n\`\`\``);
  }
});

// ======================= LOGIN =======================
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
