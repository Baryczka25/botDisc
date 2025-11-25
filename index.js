import pkg from "discord.js";
const { Client, GatewayIntentBits, AttachmentBuilder } = pkg;

import SFTPClient from "ssh2-sftp-client";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ======================= CONFIGURAÇÕES =======================
const COOLDOWN_TIME = 1000 * 60 * 5; // 5 minutos
const allowedMods = ["examplemod", "forge", "fabric"];
const uploadCooldowns = new Map();
const uploadHistory = [];

// ======================= GITHUB =======================
const octokit = new Octokit({ auth: process.env.MGT_ID });
const GITHUB_OWNER = process.env.MGT_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "mods";

async function uploadToGitHub(file) {
  const fullPath = `${GITHUB_PATH}/${file.name}`;

  // Baixar o arquivo enviado pelo Discord
  const response = await fetch(file.url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentBase64 = buffer.toString("base64");

  let sha = null;

  // ===== 1. Verificar se o arquivo já existe =====
  try {
    const existing = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });

    if (existing && existing.data && existing.data.sha) {
      sha = existing.data.sha; // arquivo já existe → atualizar
      console.log(`🔄 Atualizando arquivo existente no GitHub: ${file.name}`);
    }
  } catch (err) {
    console.log(`📄 Arquivo não existe no GitHub, criando novo: ${file.name}`);
  }

  // ===== 2. Criar ou atualizar =====
  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: fullPath,
    message: `Adicionado/Atualizado mod ${file.name} via bot`,
    content: contentBase64,
    sha: sha ?? undefined, // só manda sha se existir
  });

  console.log(`✅ Upload GitHub: ${file.name}`);
}

async function removeFromGitHub(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
    });

    await octokit.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
      message: `Removido mod ${sanitized} via bot`,
      sha: fileData.sha,
    });

    console.log(`✅ Mod ${sanitized} removido do GitHub!`);
  } catch (err) {
    console.log(`⚠️ Não foi possível remover do GitHub: ${err.message}`);
  }
}

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
  await sftp.put(tempPath, `${modsPath}/${file.name}`);
}

async function removeModSFTP(filename) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  await ensureSFTP();
  await sftp.delete(`${modsPath}/${sanitized}`);
  console.log(`✅ Mod ${sanitized} removido do SFTP!`);
  return sanitized;
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
      status: data.attributes.current_state,
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

async function sendCommandPtero(command) {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/command`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ command }),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (e) {
    console.log("Erro ao enviar comando:", e.message);
    return false;
  }
}

// ======================= UPLOAD CURADO =======================
function registerUpload(userId, username, fileName) {
  uploadHistory.push({
    userId,
    username,
    fileName,
    timestamp: Date.now(),
  });
}

async function uploadModCurated(interaction, file) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const now = Date.now();

  // ======= COOLDOWN =======
  if (uploadCooldowns.has(userId)) {
    const lastUpload = uploadCooldowns.get(userId);
    const diff = now - lastUpload;
    if (diff < COOLDOWN_TIME) {
      const remaining = Math.ceil((COOLDOWN_TIME - diff) / 1000);
      return interaction.editReply(
        `⏱ Você precisa esperar mais ${remaining} segundos antes de enviar outro mod.`
      );
    }
  }

  // ======= CHECAR MOD PERMITIDO =======
  const fileNameLower = file.name.toLowerCase();
  const allowed = allowedMods.some(keyword => fileNameLower.includes(keyword));
  if (!allowed) {
    return interaction.editReply(
      `❌ Mod **${file.name}** não está na lista de mods permitidos.`
    );
  }

  // ======= UPLOAD =======
  await uploadMod(file);
  await uploadToGitHub(file);

  // ======= HISTÓRICO =======
  uploadCooldowns.set(userId, now);
  registerUpload(userId, username, file.name);

  // ======= NOTIFICAÇÕES =======
  try {
    const logChannel = client.channels.cache.get(process.env.DISCORD_LOG_CHANNEL);
    if (logChannel) {
      await logChannel.send({
        content:
          `📥 **Novo mod enviado!**\n👤 Autor: **${username}**\n📦 Mod: \`${file.name}\`\n🔄 **Reiniciando o servidor...**`
      });
    }
  } catch (err) {
    console.log("Erro ao enviar mensagem no Discord:", err.message);
  }

  await sendCommandPtero(`say §eNovo mod adicionado: §b${file.name} §e— reiniciando o servidor!`);
  const restartMsg = await restartServerPtero();

  return interaction.editReply(`✅ Mod **${file.name}** enviado!\n${restartMsg}`);
}

// ======================= REMOVER MOD =======================
async function removeModFull(interaction, filename) {
  await interaction.editReply("🗑 Removendo mod...");

  try {
    await removeFromGitHub(filename);
    const removed = await removeModSFTP(filename);

    await sendCommandPtero(`say §cMod removido: §b${filename} §c— reiniciando o servidor!`);
    const restartMsg = await restartServerPtero();

    return interaction.editReply(`✅ Mod **${removed}** removido!\n${restartMsg}`);
  } catch (err) {
    return interaction.editReply(`❌ Erro ao remover mod:\n\`\`\`\n${err.message}\n\`\`\``);
  }
}

// ======================= HISTÓRICO =======================
async function listUploadHistory(interaction) {
  if (!uploadHistory.length) {
    return interaction.reply("📭 Nenhum upload registrado ainda.");
  }

  const lines = uploadHistory
    .slice(-20)
    .map(item => {
      const date = new Date(item.timestamp).toLocaleString("pt-BR");
      return `👤 **${item.username}** — 📦 *${item.fileName}* — 🕒 ${date}`;
    })
    .join("\n");

  return interaction.reply({
    content: `📜 **Últimos uploads registrados:**\n\n${lines}`,
    ephemeral: true
  });
}

// ======================= HANDLER =======================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "ping": return interaction.reply("🏓 Pong!");
      case "listmods":
        await interaction.reply("🔍 Listando mods...");
        const raw = await listMods();
        const mods = raw
          .split("\n").map(x => x.trim()).filter(Boolean)
          .map(x => x.replace(/\.jar$/i, "")).sort();
        const filePath = `${os.tmpdir()}/mods-list.txt`;
        await fs.promises.writeFile(filePath, mods.join("\n"));
        return interaction.editReply({
          content: `📦 **Mods instalados: ${mods.length}**`,
          files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })],
        });

      case "adicionarmod":
        const file = interaction.options.getAttachment("arquivo");
        if (!file.name.endsWith(".jar"))
          return interaction.reply("❌ Só aceito arquivos `.jar`.");
        await interaction.reply("📤 Enviando mod...");
        return uploadModCurated(interaction, file);

      case "removermod":
        const name = interaction.options.getString("nome");
        return removeModFull(interaction, name);

      case "historico": await listUploadHistory(interaction); break;

      case "info":
        await interaction.reply("📡 Obtendo informações...");
        const status = await getServerStatusPtero();
        let msg = "";
        if (status.online) {
          msg += `🟢 **Servidor Online**\n💻 CPU: ${status.cpu}%\n`;
          msg += `🧠 Memória: ${Math.round(status.memory/1024/1024)} MB\n`;
          msg += `💾 Disco: ${Math.round(status.disk/1024/1024)} MB\n📊 Estado: ${status.status}\n`;
        } else { msg += "🔴 **Servidor Offline**\nErro: "+status.error+"\n"; }
        return interaction.editReply({ content: `**ℹ️ STATUS DO SERVIDOR**\n\n${msg}` });

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
            "• `/adicionarmod` — Envia um mod (curadoria + cooldown + GitHub)\n" +
            "• `/removermod` — Remove um mod (SFTP + GitHub)\n" +
            "• `/historico` — Lista histórico de uploads (admin)\n" +
            "• `/info` — Informações gerais\n" +
            "• `/restart` — Reinicia o servidor\n" +
            "• `/help` — Ajuda",
          ephemeral: true,
        });

      default: return interaction.reply("❌ Comando desconhecido.");
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply(`❌ Erro:\n\`\`\`\n${err.message}\n\`\`\``);
  }
});

// ======================= LOGIN =======================
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
