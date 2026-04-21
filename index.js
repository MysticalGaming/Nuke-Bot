require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const crypto = require("crypto");

const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const app = express();
const PORT = process.env.PORT || 3000;

// Tip4Serv raw body
app.use("/tip4serv-webhook", express.raw({ type: "application/json" }));

const dataPath = path.join(__dirname, "data.json");

function loadData() {
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(
      dataPath,
      JSON.stringify(
        {
          users: {},
          leaderboardMessage: {
            channelId: "",
            messageId: "",
          },
          processedRequests: [],
        },
        null,
        2
      )
    );
  }

  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function ensureUser(data, userId, username) {
  if (!data.users[userId]) {
    data.users[userId] = {
      name: username || `User ${userId}`,
      points: 0,
    };
  }

  if (username) {
    data.users[userId].name = username;
  }
}

function getSortedUsers(data) {
  return Object.values(data.users || {}).sort((a, b) => b.points - a.points);
}

function getTotalEntries(data) {
  return Object.values(data.users || {}).reduce(
    (sum, user) => sum + (user.points || 0),
    0
  );
}

function buildHomeEmbed(data) {
  const topUsers = getSortedUsers(data).slice(0, 10);
  const totalEntries = getTotalEntries(data);

  let description = "No entries yet.";

  if (topUsers.length > 0) {
    description = topUsers
      .map((user, index) => {
        let rank = `**#${index + 1}**`;
        if (index === 0) rank = "🥇 **#1**";
        if (index === 1) rank = "🥈 **#2**";
        if (index === 2) rank = "🥉 **#3**";

        return `${rank} ${user.name} — **${user.points} ENTRIES**`;
      })
      .join("\n");
  }

  return new EmbedBuilder()
    .setColor(0xff3b30)
    .setTitle("💣 MONTHLY NUKE BATTLE")
    .setDescription(
      [
        "**TOP 10**",
        "",
        description,
        "",
        `**TOTAL ENTRIES:** ${totalEntries.toLocaleString()}`,
      ].join("\n")
    )
    .setFooter({ text: "Monthly Nuke Battle" })
    .setTimestamp();
}

function buildFullLeaderboardEmbed(data) {
  const users = getSortedUsers(data);
  const totalEntries = getTotalEntries(data);

  let description = "No entries yet.";

  if (users.length > 0) {
    description = users
      .map(
        (user, index) =>
          `**#${index + 1}** ${user.name} — **${user.points} ENTRIES**`
      )
      .join("\n");

    if (description.length > 3800) {
      description = description.slice(0, 3800) + "\n...";
    }
  }

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📊 MONTHLY NUKE BATTLE LEADERBOARD")
    .setDescription(
      [
        description,
        "",
        `**TOTAL ENTRIES:** ${totalEntries.toLocaleString()}`,
      ].join("\n")
    )
    .setFooter({ text: "Full leaderboard" })
    .setTimestamp();
}

function buildRewardsEmbed() {
  return new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle("🏆 MONTHLY NUKE BATTLE REWARDS")
    .setDescription(
      [
        "💰 **Top Rewards**",
        "",
        "🥇 **1st Place** — $1,000 Store Credit",
        "🥈 **2nd Place** — $750 Store Credit",
        "🥉 **3rd Place** — $500 Store Credit",
        "**4th Place** — $300 Store Credit",
        "**5th Place** — $200 Store Credit",
        "",
        "━━━━━━━━━━━━━━━━━━",
        "💣 **NUKE TIERS**",
        "",
        "🎁 **T1 NUKE — $10**",
        "Includes **$15 Store Credit**",
        "➜ **+1 Leaderboard Entry**",
        "",
        "🎁 **T2 NUKE — $15**",
        "Includes **$25 Store Credit**",
        "➜ **+2 Leaderboard Entries**",
        "",
        "🎁 **T3 NUKE — $25**",
        "Includes **$50 Store Credit**",
        "➜ **+3 Leaderboard Entries**",
      ].join("\n")
    )
    .setFooter({ text: "Monthly Nuke Battle Rewards" })
    .setTimestamp();
}

function buildButtons(activePage = "home") {
  const safeNukeUrl =
    process.env.NUKE_URL && process.env.NUKE_URL.startsWith("http")
      ? process.env.NUKE_URL
      : "https://nylzxs.tip4serv.com/category/extras";

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("NUKE")
        .setStyle(ButtonStyle.Link)
        .setURL(safeNukeUrl),

      new ButtonBuilder()
        .setCustomId("home_page")
        .setLabel("HOME")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(activePage === "home"),

      new ButtonBuilder()
        .setCustomId("leaderboard_page")
        .setLabel("LEADERBOARD")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(activePage === "leaderboard"),

      new ButtonBuilder()
        .setCustomId("rewards_page")
        .setLabel("REWARDS")
        .setStyle(ButtonStyle.Success)
        .setDisabled(activePage === "rewards")
    ),
  ];
}

async function repostLeaderboardMessage() {
  const data = loadData();
  const { channelId, messageId } = data.leaderboardMessage || {};

  if (!channelId) return false;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return false;

    const newMessage = await channel.send({
      embeds: [buildHomeEmbed(data)],
      components: buildButtons("home"),
    });

    if (messageId) {
      try {
        const oldMessage = await channel.messages.fetch(messageId);
        await oldMessage.delete();
      } catch (error) {
        console.log("Old leaderboard message could not be deleted.");
      }
    }

    data.leaderboardMessage = {
      channelId: channel.id,
      messageId: newMessage.id,
    };

    saveData(data);
    return true;
  } catch (error) {
    console.error("Failed to repost leaderboard message:", error);
    return false;
  }
}

function getPointsFromProduct(productName) {
  const name = (productName || "").toLowerCase().trim();

  if (name.includes("tier 1 nuke")) return 1;
  if (name.includes("tier 2 nuke")) return 2;
  if (name.includes("tier 3 nuke")) return 3;

  return 0;
}

app.post("/tip4serv-webhook", async (req, res) => {
  try {
    const rawBody = req.body.toString("utf8");
    const timestamp = req.header("X-Pay-Timestamp") || "";
    const signature = req.header("X-Pay-Signature") || "";

    if (!timestamp || !signature) {
      return res.status(401).send("Missing signature headers");
    }

    const parsedTimestamp = parseInt(timestamp, 10);
    if (
      Number.isNaN(parsedTimestamp) ||
      Math.abs(Date.now() / 1000 - parsedTimestamp) > 300
    ) {
      return res.status(401).send("Invalid timestamp");
    }

    const secret = Buffer.from(process.env.TIP4SERV_WEBHOOK_SECRET, "base64");
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    if (
      expected.length !== signature.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(rawBody);

    if (event.event !== "payment.success") {
      return res.status(200).send("ignored");
    }

    const data = loadData();

    if (event.request_id && data.processedRequests.includes(event.request_id)) {
      return res.status(200).send("already processed");
    }

    const discordId = event?.data?.user?.discord_id;
    const username =
      event?.data?.user?.discord_username ||
      event?.data?.user?.username ||
      "Unknown User";

    const basket = event?.data?.basket || [];
    let totalPointsAdded = 0;

    for (const item of basket) {
      const pointsPerUnit = getPointsFromProduct(item.name);
      if (pointsPerUnit > 0) {
        const quantity = Number(item.quantity || 1);
        totalPointsAdded += pointsPerUnit * quantity;
      }
    }

    if (discordId && totalPointsAdded > 0) {
      ensureUser(data, discordId, username);
      data.users[discordId].points += totalPointsAdded;

      if (event.request_id) {
        data.processedRequests.push(event.request_id);
      }

      if (data.processedRequests.length > 500) {
        data.processedRequests = data.processedRequests.slice(-500);
      }

      saveData(data);
      await repostLeaderboardMessage();

      console.log(
        `Added ${totalPointsAdded} point(s) to ${username} from Tip4Serv webhook.`
      );
    } else {
      console.log(
        "Webhook received but no matching nuke products or missing Discord ID."
      );
    }

    return res.status(200).send("ok");
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).send("server error");
  }
});

const commands = [
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View the leaderboard"),

  new SlashCommandBuilder()
    .setName("leaderboardpost")
    .setDescription("Post the leaderboard message"),

  new SlashCommandBuilder()
    .setName("leaderboardrefresh")
    .setDescription("Refresh the leaderboard message"),

  new SlashCommandBuilder()
    .setName("nukeadd")
    .setDescription("Add entries to a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to add entries to")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("How many entries to add")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("nukeremove")
    .setDescription("Remove entries from a user")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to remove entries from")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("How many entries to remove")
        .setRequired(true)
        .setMinValue(1)
    ),
].map(command => command.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

async function registerCommands() {
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
    body: commands,
  });
  console.log("Commands registered.");
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await repostLeaderboardMessage().catch(() => {});
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    const data = loadData();

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "leaderboard") {
        await interaction.reply({
          embeds: [buildHomeEmbed(data)],
          components: buildButtons("home"),
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "leaderboardpost") {
        const msg = await interaction.channel.send({
          embeds: [buildHomeEmbed(data)],
          components: buildButtons("home"),
        });

        data.leaderboardMessage = {
          channelId: interaction.channel.id,
          messageId: msg.id,
        };

        saveData(data);

        await interaction.reply({
          content: "Monthly Nuke Battle leaderboard posted.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "leaderboardrefresh") {
        await interaction.deferReply({ ephemeral: true });

        const success = await repostLeaderboardMessage();

        await interaction.editReply(
          success
            ? "Monthly Nuke Battle leaderboard refreshed."
            : "No saved leaderboard message found yet. Use /leaderboardpost first."
        );
        return;
      }

      if (interaction.commandName === "nukeadd") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        ensureUser(data, user.id, user.username);
        data.users[user.id].points += amount;

        saveData(data);
        await repostLeaderboardMessage();

        await interaction.reply({
          content: `Added ${amount} entries to ${user.username}.`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "nukeremove") {
        const user = interaction.options.getUser("user");
        const amount = interaction.options.getInteger("amount");

        ensureUser(data, user.id, user.username);
        data.users[user.id].points -= amount;

        if (data.users[user.id].points < 0) {
          data.users[user.id].points = 0;
        }

        saveData(data);
        await repostLeaderboardMessage();

        await interaction.reply({
          content: `Removed ${amount} entries from ${user.username}.`,
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "home_page") {
        await interaction.reply({
          embeds: [buildHomeEmbed(loadData())],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "leaderboard_page") {
        await interaction.reply({
          embeds: [buildFullLeaderboardEmbed(loadData())],
          ephemeral: true,
        });
        return;
      }

      if (interaction.customId === "rewards_page") {
        await interaction.reply({
          embeds: [buildRewardsEmbed()],
          ephemeral: true,
        });
        return;
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Something broke while processing that interaction.",
          ephemeral: true,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content: "Something broke while processing that interaction.",
          ephemeral: true,
        }).catch(() => {});
      }
    }
  }
});

app.get("/", (req, res) => {
  res.send("Bot + webhook server is running.");
});

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

registerCommands()
  .then(() => client.login(process.env.TOKEN))
  .catch(console.error);