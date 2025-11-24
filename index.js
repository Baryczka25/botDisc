// index.js
import pkg from "discord.js";
const { Client, GatewayIntentBits, AttachmentBuilder } = pkg;

import SFTPClient from "ssh2-sftp-client";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ======================= SFTP =======================
const sftp = new SFTPClient();

async function ensureSFTP() {
  try {
    await sftp.list("/");
  } catch {
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
    } catch (err) {
      console.error("❌ Falha ao conectar SFTP:", err.message);
      throw err;
    }
  }
}

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

// ======================= PTERODACTYL API =======================
async function getServerStatusPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    return {
      online: data.attributes.current_state === "running",
      cpu: data.attributes.resources.cpu_absolute,
      memory: data.attributes.resources.memory_bytes,
      disk: data.attributes.resources.disk_bytes,
      status: data.attributes.current_state
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

async function restartServerPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ signal: "restart" }),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return "✅ Servidor reiniciado!";
  } catch (err) {
    return `❌ Falha ao reiniciar: ${err.message}`;
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
        const status = await getServerStatusPtero();
        let msg = "";

        if (status.online) {
          msg += `🟢 **Servidor Online**\n`;
          msg += `💻 CPU: ${status.cpu}%\n`;
          msg += `🧠 Memória: ${Math.round(status.memory / 1024 / 1024)} MB\n`;
          msg += `💾 Disco: ${Math.round(status.disk / 1024 / 1024)} MB\n`;
          msg += `📊 Estado: ${status.status}\n`;
        } else {
          msg += "🔴 **Servidor Offline**\n";
          msg += `Erro: ${status.error}\n`;
        }

        return interaction.editReply({
          content: `**ℹ️ STATUS DO SERVIDOR**\n\n${msg}`,
        });

      case "restart":
        await interaction.reply("🔄 Reiniciando servidor...");
        const restartMsg = await restartServerPtero();
        return interaction.editReply(restartMsg);

      case "help":
        return interaction.reply({
          content:
            "📘 **Comandos Disponíveis:**\n\n" +
            "• `/ping` — Testa o bot\n" +
            "• `/listmods` — Lista mods instalados\n" +
            "• `/uploadmod` — Envia um mod\n" +
            "• `/removemod` — Remove um mod\n" +
            "• `/info` — Informações gerais\n" +
            "• `/restart` — Reinicia o servidor\n" +
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
