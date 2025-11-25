import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

// ===== VERIFICAÇÃO =====
if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN ou CLIENT_ID ausente no .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

// === COMANDOS ===
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
    description: "Envia um mod .jar",
    options: [
      {
        name: "arquivo",
        description: "Envie o arquivo .jar do mod",
        type: 11,
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
        description: "Nome do mod",
        type: 3,
        required: true,
        autocomplete: true
      }
    ]
  },
  {
    name: "painel",
    description: "Exibe o painel de gerenciamento"
  },
  {
    name: "help",
    description: "Mostra todos os comandos"
  }
];

// ===== REGISTRAR =====
(async () => {
  try {
    console.log("Registrando comandos...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("✅ Comandos registrados!");
  } catch (err) {
    console.error("❌ Erro ao registrar comandos:", err);
  }
})();
