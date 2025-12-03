import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = pkg;

import SFTPClient from "ssh2-sftp-client";

import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";
dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ========== CONFIGURAÇÃO ==========
const COOLDOWN_TIME = 1000 * 60 * 5;
const uploadCooldowns = new Map();

// ========== HISTÓRICO ==========
const HISTORY_FILE = "./modHistory.json";

function carregarHistorico() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function salvarHistorico() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(modHistory, null, 2));
  } catch {}
}

const modHistory = carregarHistorico();

function addHistory(action, fileName, user) {
  modHistory.push({
    action,
    fileName,
    userId: user.id,
    username: user.tag ?? String(user.id),
    timestamp: Date.now(),
  });
  salvarHistorico();
}

// ========== GITHUB ==========
const octokit = new Octokit({ auth: process.env.MGT_ID });
const GITHUB_OWNER = process.env.MGT_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "mods";

async function uploadToGitHub(file) {
  const fullPath = `${GITHUB_PATH}/${file.name}`;
  const res = await fetch(file.url);
  const buf = Buffer.from(await res.arrayBuffer());
  const content = buf.toString("base64");

  let sha;
  try {
    const existing = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });
    sha = existing.data.sha;
  } catch {}

  await octokit.repos.createOrUpdateFileContents({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    path: fullPath,
    message: `Adicionado/Atualizado mod ${file.name} via bot`,
    content,
    sha: sha ?? undefined,
  });
}

async function removeFromGitHub(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
    });

    await octokit.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
      message: `Removido mod ${sanitized} via bot`,
      sha: data.sha,
    });

    return sanitized;
  } catch (err) {
    throw new Error(`GitHub: ${err.message}`);
  }
}

// ========== SFTP ==========
const sftp = new SFTPClient();

async function ensureSFTP() {
  try {
    await sftp.list("/");
  } catch {
    await sftp.connect({
      host: process.env.SFTP_HOST,
      port: Number(process.env.SFTP_PORT) || 22,
      username: process.env.SFTP_USER,
      password: process.env.SFTP_PASS,
      hostVerifier: () => true,
    });
  }
}

async function listModsRaw() {
  await ensureSFTP();
  return await sftp.list(process.env.SFTP_MODS_PATH || "mods");
}

async function listMods() {
  return (await listModsRaw()).map((m) => m.name);
}

async function uploadModToSFTP(file) {
  const modsPath = process.env.SFTP_MODS_PATH || "mods";
  const tempPath = `${os.tmpdir()}/${file.name}`;

  const res = await fetch(file.url);
  const buf = Buffer.from(await res.arrayBuffer());

  await fs.promises.writeFile(tempPath, buf);
  await ensureSFTP();

  await sftp.put(tempPath, `${modsPath}/${file.name}`);
  try { await fs.promises.unlink(tempPath); } catch {}
}

async function removeModSFTP(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  await ensureSFTP();
  await sftp.delete(`${process.env.SFTP_MODS_PATH || "mods"}/${sanitized}`);
  return sanitized;
}

// ========== PTERODACTYL ==========

// STATUS
async function getServerStatusPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/resources`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();

    return {
      online: json.attributes.current_state === "running",
      cpu: json.attributes.resources.cpu_absolute,
      memory: json.attributes.resources.memory_bytes,
      disk: json.attributes.resources.disk_bytes,
      status: json.attributes.current_state,
    };
  } catch (err) {
    return { online: false, error: err.message };
  }
}

// 🔥 **FUNÇÃO QUE ESTAVA FALTANDO**
async function getPlayerListPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/websocket`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          Accept: "application/json",
        },
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (!data?.data?.players) {
      return { count: 0, names: [] };
    }

    return {
      count: data.data.players.length,
      names: data.data.players,
    };
  } catch (err) {
    return { count: 0, names: [] };
  }
}

// RESTART
async function restartServerPtero() {
  try {
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/power`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signal: "restart" }),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    return "🔄 Servidor reiniciado!";
  } catch (err) {
    return `Erro: ${err.message}`;
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
        },
        body: JSON.stringify({ command }),
      }
    );

    return res.ok;
  } catch {
    return false;
  }
}

// ========== APROVAÇÃO DE MODS ==========
const pendingApprovals = new Map();

function isAllowedFilename(s) {
  s = s.toLowerCase();
  return s.includes("neoforge") && s.includes("1.21.1") || s.includes("21.1.213");
}

async function pedirAprovacao(interaction, file) {
  try {
    if (interaction.deferred || interaction.replied)
      await interaction.editReply("📨 Pedido enviado para revisão.");
    else
      await interaction.reply({ content: "📨 Pedido enviado para revisão.", ephemeral: true });
  } catch {}

  const modChannel = await client.channels.fetch(process.env.MOD_APPROVAL_CHANNEL).catch(() => null);
  if (!modChannel) return;

  const embed = new EmbedBuilder()
    .setTitle("📢 Pedido de aprovação")
    .addFields(
      { name: "Arquivo", value: file.name },
      { name: "Enviado por", value: interaction.user.tag },
      { name: "Download", value: file.url }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("approve_mod").setLabel("✔️ Aprovar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reject_mod").setLabel("❌ Rejeitar").setStyle(ButtonStyle.Danger)
  );

  const msg = await modChannel.send({ embeds: [embed], components: [row] });

  pendingApprovals.set(msg.id, {
    file,
    uploader: interaction.user,
    requestMessageId: interaction.id,
  });
}

// ========== COMANDOS ==========
client.on("interactionCreate", async (interaction) => {
  try {

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // /info
      if (name === "info") {
        try {
          await interaction.deferReply({ ephemeral: true });

          const status = await getServerStatusPtero();

          if (!status.online) {
            return interaction.editReply(`🔴 **Servidor Offline**\nErro: ${status.error}`);
          }

          const players = await getPlayerListPtero();
          const mem = Math.round(status.memory / 1024 / 1024);

          return interaction.editReply(
            `🟢 **Online**\n` +
            `⚙️ CPU: ${status.cpu}%\n` +
            `💾 Memória: ${mem} MB\n` +
            `👥 Jogadores: ${players.count}\n` +
            (players.count ? `📜 Nomes:\n• ${players.names.join("\n• ")}` : "📭 Nenhum jogador online") +
            `\n📌 Estado: ${status.status}`
          );
        } catch (err) {
          return interaction.editReply(`❌ Erro interno: ${err.message}`);
        }
      }

      // (todo o resto do SEU código de comandos permanece idêntico)

    }

  } catch (err) {
    console.error("Interaction handler error:", err);
  }
});

// login
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
