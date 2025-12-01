import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

// ===== VERIFICAÇÃO DE TOKEN =====
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN ou CLIENT_ID não definido no .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// ===== COMANDOS =====
const commands = [
  {
    name: "ping",
    description: "Testa se o bot está online"
  },
  {
    name: "listmods",
    description: "Lista os mods instalados no servidor"
  },
  {
    name: "adicionarmod",
    description: "Envia um mod .jar (com curadoria e cooldown)",
    options: [
      {
        name: "arquivo",
        description: "Envie o arquivo .jar do mod",
        type: 11, // Attachment
        required: true
      }
    ]
  },
  {
    name: "removermod",
    description: "Remove um mod pelo nome",
    options: [
      {
        name: "nome",
        description: "Nome exato do mod (ex: mod.jar)",
        type: 3, // String
        required: true
      }
    ]
  },
  {
    name: "historico",
    description: "Lista histórico de uploads (apenas admin)"
  },
  {
    name: "info",
    description: "Mostra informações do servidor (status, mods, etc)"
  },
  {
    name: "restart",
    description: "Reinicia o servidor de Minecraft"
  },
  {
  name: "modpack",
  description: "Baixe o modpack completo do servidor (GitHub)"
  },
  {
    name: "painel",
    description: "Abre o painel de gerenciamento do servidor"
  },
  {
    name: "help",
    description: "Mostra todos os comandos disponíveis"
  }
];

// ===== REGISTRO =====
(async () => {
  try {
    console.log("Registrando comandos...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Comandos registrados!");
  } catch (err) {
    console.error("❌ Erro ao registrar comandos:", err);
  }
})();
