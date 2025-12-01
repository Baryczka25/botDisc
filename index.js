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
  InteractionResponseFlags,
} = pkg;

import fs from "fs";
import path from "path";
import os from "os";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";
dotenv.config();

// ---------- CONFIG ----------
const COOLDOWN_TIME = 1000 * 60 * 5; // 5 minutos
const uploadCooldowns = new Map(); // userId -> timestamp

// Local mods folder (no SFTP mode)
const LOCAL_MODS_PATH = process.env.LOCAL_MODS_PATH || path.resolve("./mods");
const HISTORY_FILE = process.env.HISTORY_FILE || path.resolve("./modHistory.json");

// Create mods dir if not exists
if (!fs.existsSync(LOCAL_MODS_PATH)) {
  fs.mkdirSync(LOCAL_MODS_PATH, { recursive: true });
}

// ---------- State ----------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const pendingApprovals = new Map(); // messageId -> { file, uploader, requestMessageId }
let modHistory = []; // loaded from disk

// ---------- Utils: load/save history ----------
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf8");
      modHistory = JSON.parse(raw);
      if (!Array.isArray(modHistory)) modHistory = [];
    } else {
      modHistory = [];
    }
  } catch (e) {
    console.error("Erro ao ler histórico:", e);
    modHistory = [];
  }
}
function saveHistory() {
  try {
    // atomic write
    const tmp = `${HISTORY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(modHistory, null, 2), "utf8");
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (e) {
    console.error("Erro ao salvar histórico:", e);
  }
}
function addHistory(action, fileName, user) {
  const entry = {
    action, // "add" | "remove"
    fileName,
    userId: user?.id ?? String(user),
    username: user?.tag ?? user?.username ?? String(user),
    timestamp: Date.now(),
  };
  modHistory.push(entry);
  // keep growth manageable (optional): keep last 5000
  if (modHistory.length > 5000) modHistory = modHistory.slice(-5000);
  saveHistory();
}

// load at startup
loadHistory();

// ---------- GITHUB (kept, optional) ----------
const octokit = new Octokit({ auth: process.env.MGT_ID });
const GITHUB_OWNER = process.env.MGT_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_PATH = process.env.GITHUB_PATH || "mods";

async function uploadToGitHub(file, buffer) {
  if (!process.env.MGT_ID || !GITHUB_OWNER || !GITHUB_REPO) return;
  const fullPath = `${GITHUB_PATH}/${file.name}`;
  const content = buffer.toString("base64");

  let sha;
  try {
    const existing = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: fullPath,
    });
    if (existing && existing.data && existing.data.sha) sha = existing.data.sha;
  } catch (e) {
    // não existe, segue
  }

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
  if (!process.env.MGT_ID || !GITHUB_OWNER || !GITHUB_REPO) return filename;
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  try {
    const { data } = await octokit.repos.getContent({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
    });
    const sha = data.sha;
    await octokit.repos.deleteFile({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      path: `${GITHUB_PATH}/${sanitized}`,
      message: `Removido mod ${sanitized} via bot`,
      sha,
    });
    return sanitized;
  } catch (err) {
    // se falhar, logue e continue (pode não existir no GitHub)
    console.warn("removeFromGitHub warning:", err.message);
    return sanitized;
  }
}

// ---------- PTERODACTYL helpers (kept optional) ----------
async function getServerStatusPtero() {
  try {
    if (!process.env.PTERO_PANEL_URL) return { online: false, error: "PTERO não configurado" };
    const res = await fetch(
      `${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
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
    if (!process.env.PTERO_PANEL_URL) return "PTERO não configurado";
    await fetch(`${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/power`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signal: "restart" }),
    });
    return "🔄 Servidor reiniciado!";
  } catch (err) {
    return `Erro: ${err.message}`;
  }
}

async function sendCommandPtero(command) {
  try {
    if (!process.env.PTERO_PANEL_URL) return false;
    await fetch(`${process.env.PTERO_PANEL_URL}/servers/${process.env.PTERO_SERVER_ID}/command`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PTERO_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command }),
    });
    return true;
  } catch {
    return false;
  }
}

// ---------- Local mods operations ----------
async function listModsRaw() {
  const files = await fs.promises.readdir(LOCAL_MODS_PATH, { withFileTypes: true });
  return files.filter((f) => f.isFile()).map((f) => ({ name: f.name }));
}
async function listMods() {
  const raw = await listModsRaw();
  // sort alphabetically
  return raw.map((m) => m.name).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

async function saveFileToLocal(file, buffer) {
  const dest = path.join(LOCAL_MODS_PATH, file.name);
  await fs.promises.writeFile(dest, buffer);
  return dest;
}

async function removeLocalMod(filename) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "");
  const p = path.join(LOCAL_MODS_PATH, sanitized);
  await fs.promises.unlink(p);
  return sanitized;
}

// ---------- Rules: NeoForge 1.21.1 check ----------
function isAllowedFilename(filename) {
  if (!filename) return false;
  const s = filename.toLowerCase();
  if (s.includes("21.1.213")) return true;
  return s.includes("neoforge") && s.includes("1.21.1");
}

// ---------- Approval flow ----------
async function pedirAprovacao(interaction, file) {
  // reply to author using flags for ephemeral
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `📨 Pedido de aprovação enviado para revisores. Você será notificado aqui quando aprovado ou rejeitado.`,
        embeds: [],
        components: [],
      });
    } else {
      await interaction.reply({
        content: `📨 Pedido de aprovação enviado para revisores. Você será notificado aqui quando aprovado ou rejeitado.`,
        flags: InteractionResponseFlags.Ephemeral,
      });
    }
  } catch (e) {
    // ignore
  }

  const modChannelId = process.env.MOD_APPROVAL_CHANNEL;
  if (!modChannelId) {
    return interaction.followUp({ content: "❌ Canal de aprovação não configurado.", flags: InteractionResponseFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle("📢 Pedido de aprovação de mod")
    .addFields(
      { name: "Arquivo", value: file.name, inline: false },
      { name: "Enviado por", value: `${interaction.user.tag} (${interaction.user.id})`, inline: false },
      { name: "Download", value: file.url ?? "Anexo não acessível", inline: false }
    )
    .setColor("#FFA500")
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("approve_mod").setLabel("✔️ Aprovar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reject_mod").setLabel("❌ Rejeitar").setStyle(ButtonStyle.Danger)
  );

  const modChannel = await client.channels.fetch(modChannelId).catch(() => null);
  if (!modChannel || !modChannel.send) {
    return interaction.followUp({ content: "❌ Não consegui postar o pedido no canal de aprovação.", flags: InteractionResponseFlags.Ephemeral });
  }

  const msg = await modChannel.send({ embeds: [embed], components: [row] });
  pendingApprovals.set(msg.id, { file, uploader: interaction.user, requestMessageId: interaction.id });
  return;
}

// ---------- Interaction handler ----------
client.on("interactionCreate", async (interaction) => {
  try {
    // AUTOCOMPLETE
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === "removermod") {
        const focused = String(interaction.options.getFocused() ?? "");
        const mods = await listMods();
        const filtered = mods
          .filter((m) => m.toLowerCase().includes(focused.toLowerCase()))
          .slice(0, 25)
          .map((m) => ({ name: m, value: m }));
        await interaction.respond(filtered);
      }
      return;
    }

    // BUTTONS
    if (interaction.isButton()) {
      // painel buttons
      if (interaction.customId === "painel_listar") {
        const mods = await listMods();
        const text = mods.length ? mods.join("\n") : "Nenhum mod.";
        // if large send as file
        if (text.length > 1800) {
          const filePath = path.join(os.tmpdir(), `mods-list-${Date.now()}.txt`);
          await fs.promises.writeFile(filePath, text, "utf8");
          return interaction.reply({ files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })], flags: InteractionResponseFlags.Ephemeral });
        } else {
          return interaction.reply({ content: text, flags: InteractionResponseFlags.Ephemeral });
        }
      }

      if (interaction.customId === "painel_restart") {
        const msg = await restartServerPtero();
        return interaction.reply({ content: msg, flags: InteractionResponseFlags.Ephemeral });
      }

      if (interaction.customId === "painel_info") {
        const status = await getServerStatusPtero();
        const pretty = status.online
          ? `🟢 Online — CPU ${status.cpu}% — Mem ${Math.round(status.memory / 1024 / 1024)} MB`
          : `🔴 Offline — ${status.error || "erro desconhecido"}`;
        return interaction.reply({ content: pretty, flags: InteractionResponseFlags.Ephemeral });
      }

      // approval buttons in moderator channel
      if (interaction.customId === "approve_mod" || interaction.customId === "reject_mod") {
        const member = interaction.member;
        const isMod = member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member?.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (!isMod) {
          return interaction.reply({ content: "❌ Você não tem permissão para moderar.", flags: InteractionResponseFlags.Ephemeral });
        }

        const msgId = interaction.message.id;
        const pending = pendingApprovals.get(msgId);
        if (!pending) return interaction.reply({ content: "❌ Pedido expirado ou não encontrado.", flags: InteractionResponseFlags.Ephemeral });
        pendingApprovals.delete(msgId);

        if (interaction.customId === "reject_mod") {
          try { await pending.uploader.send(`❌ Seu mod **${pending.file.name}** foi rejeitado pelos moderadores.`); } catch {}
          await interaction.update({ content: "❌ Mod rejeitado.", embeds: [], components: [] });
          return;
        }

        // approve
        await interaction.update({ content: "✔️ Mod aprovado — processando upload...", embeds: [], components: [] });
        try {
          // download file
          const res = await fetch(pending.file.url);
          const buf = Buffer.from(await res.arrayBuffer());
          // save locally
          await saveFileToLocal(pending.file, buf);
          // upload to github (optional)
          try { await uploadToGitHub(pending.file, buf); } catch (e) { console.warn("GitHub upload fail:", e.message); }
          // history
          addHistory("add", pending.file.name, pending.uploader);
          try { await pending.uploader.send(`✔️ Seu mod **${pending.file.name}** foi aprovado e enviado.`); } catch {}
          const logChannelId = process.env.DISCORD_LOG_CHANNEL;
          if (logChannelId) {
            const log = await client.channels.fetch(logChannelId).catch(() => null);
            if (log && log.send) {
              await log.send(`📥 Mod aprovado e enviado: **${pending.file.name}** (por ${pending.uploader.tag || pending.uploader.id})`);
            }
          }
          // optional notify server
          await sendCommandPtero(`say Novo mod adicionado: ${pending.file.name}`);
          await restartServerPtero();
        } catch (e) {
          await interaction.followUp({ content: `❌ Falha no upload: ${e.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
        return;
      }
      return;
    }

    // COMMANDS
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // histórico (admin only)
      if (name === "historico") {
        const member = interaction.member;
        const isAdmin = member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || member?.permissions?.has?.(PermissionFlagsBits.Administrator);
        if (!isAdmin) {
          return interaction.reply({ content: "❌ Apenas administradores podem ver o histórico.", flags: InteractionResponseFlags.Ephemeral });
        }
        if (modHistory.length === 0) {
          return interaction.reply({ content: "📭 O histórico está vazio.", flags: InteractionResponseFlags.Ephemeral });
        }

        // Prepare text: last 200 actions (configurable)
        const items = modHistory.slice(-200).reverse();
        let text = "📝 **Histórico de Mods** (últimas ações)\n\n";
        for (const h of items) {
          const date = new Date(h.timestamp).toLocaleString("pt-BR");
          const icon = h.action === "add" ? "📥 Adicionado" : "🗑 Removido";
          text += `**${icon}** — \`${h.fileName}\`\n👤 ${h.username} (${h.userId})\n📅 ${date}\n\n`;
        }

        // if too large, send as file
        if (text.length > 1800) {
          const filePath = path.join(os.tmpdir(), `mod-history-${Date.now()}.txt`);
          await fs.promises.writeFile(filePath, text, "utf8");
          return interaction.reply({ files: [new AttachmentBuilder(filePath, { name: "mod-history.txt" })], flags: InteractionResponseFlags.Ephemeral });
        } else {
          return interaction.reply({ content: text, flags: InteractionResponseFlags.Ephemeral });
        }
      }

      // ping
      if (name === "ping") return interaction.reply({ content: "🏓 Pong!", flags: InteractionResponseFlags.Ephemeral });

      // listmods
      if (name === "listmods") {
        await interaction.deferReply({ ephemeral: true });
        const mods = await listMods();
        const text = mods.length ? mods.join("\n") : "Nenhum mod";
        // write file and send (safer)
        const filePath = path.join(os.tmpdir(), `mods-list-${Date.now()}.txt`);
        await fs.promises.writeFile(filePath, text, "utf8");
        return interaction.editReply({ content: `📦 Mods instalados: ${mods.length}`, files: [new AttachmentBuilder(filePath, { name: "mods-list.txt" })] });
      }

      // adicionarmod
      if (name === "adicionarmod") {
        const file = interaction.options.getAttachment("arquivo");
        if (!file || !file.name.endsWith(".jar")) return interaction.reply({ content: "❌ Envie um arquivo .jar", flags: InteractionResponseFlags.Ephemeral });

        // quick reply to avoid timeout
        await interaction.reply({ content: "📤 Recebido — processando...", flags: InteractionResponseFlags.Ephemeral });

        const userId = interaction.user.id;
        const now = Date.now();
        if (uploadCooldowns.has(userId) && now - uploadCooldowns.get(userId) < COOLDOWN_TIME) {
          return interaction.editReply({ content: "⏱ Aguarde antes de enviar outro mod.", flags: InteractionResponseFlags.Ephemeral });
        }

        // check allowed
        if (!isAllowedFilename(file.name)) {
          return pedirAprovacao(interaction, file);
        }

        // direct upload: fetch file and save locally, upload to GitHub if configured
        try {
          const res = await fetch(file.url);
          const buf = Buffer.from(await res.arrayBuffer());
          await saveFileToLocal(file, buf);
          try { await uploadToGitHub(file, buf); } catch (e) { console.warn("GitHub upload failed:", e.message); }
          addHistory("add", file.name, interaction.user);
          uploadCooldowns.set(userId, Date.now());
          // notify server optionally
          await sendCommandPtero(`say Novo mod adicionado: ${file.name}`);
          await restartServerPtero();
          return interaction.editReply({ content: `✅ Mod enviado!\n${file.name}`, flags: InteractionResponseFlags.Ephemeral });
        } catch (e) {
          return interaction.editReply({ content: `❌ Erro no upload: ${e.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
      }

      // removermod
      if (name === "removermod") {
        const filename = interaction.options.getString("nome");
        if (!filename) return interaction.reply({ content: "❌ Informe o nome do mod.", flags: InteractionResponseFlags.Ephemeral });
        await interaction.reply({ content: "🗑 Removendo...", flags: InteractionResponseFlags.Ephemeral });

        try {
          // try GitHub removal (optional)
          try { await removeFromGitHub(filename); } catch (e) { console.warn("GitHub removal warn:", e.message); }

          const removed = await removeLocalMod(filename);
          addHistory("remove", removed, interaction.user);
          await interaction.editReply({ content: `✅ Removido: ${removed}`, flags: InteractionResponseFlags.Ephemeral });
          await sendCommandPtero(`say Mod removido: ${removed}`);
          await restartServerPtero();
        } catch (e) {
          return interaction.editReply({ content: `❌ Erro ao remover: ${e.message}`, flags: InteractionResponseFlags.Ephemeral });
        }
        return;
      }

      // painel
      if (name === "painel") {
        const embed = new EmbedBuilder()
          .setTitle("⚙️ Painel de Gerenciamento")
          .setDescription("Gerencie o servidor com os botões abaixo")
          .setColor("#5865F2");

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("painel_listar").setLabel("📦 Listar Mods").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("painel_restart").setLabel("🔄 Reiniciar").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId("painel_info").setLabel("ℹ️ Info").setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      // info
      if (name === "info") {
        await interaction.deferReply({ ephemeral: true });
        const status = await getServerStatusPtero();
        const text = status.online
          ? `🟢 Online\nCPU: ${status.cpu}%\nMem: ${Math.round(status.memory / 1024 / 1024)} MB\nEstado: ${status.status}`
          : `🔴 Offline\nErro: ${status.error}`;
        return interaction.editReply({ content: `**STATUS DO SERVIDOR**\n${text}`, flags: InteractionResponseFlags.Ephemeral });
      }

      // modpack (link)
      if (name === "modpack") {
        const replyText = process.env.MODPACK_TEXT || "📥 **Modpack (GitHub)**\n`git clone https://github.com/Baryczka25/MGT-Server.git`";
        return interaction.reply({ content: replyText, flags: InteractionResponseFlags.Ephemeral });
      }

      if (name === "help") {
        return interaction.reply({ content: "Use os comandos /listmods /adicionarmod /removermod /painel /modpack /historico", flags: InteractionResponseFlags.Ephemeral });
      }
    }

  } catch (err) {
    console.error("Interaction handler error:", err);
    try {
      if (interaction?.deferred || interaction?.replied) {
        await interaction.editReply({ content: `❌ Erro: ${err.message}` });
      } else if (interaction) {
        await interaction.reply({ content: `❌ Erro: ${err.message}`, flags: InteractionResponseFlags.Ephemeral });
      }
    } catch (e) {
      console.error("Failed to notify user about error:", e);
    }
  }
});

// ---------- Login ----------
client.once("ready", () => console.log("🤖 Bot online!"));
client.login(process.env.DISCORD_TOKEN);
