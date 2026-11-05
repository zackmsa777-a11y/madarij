import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits as P,
  ChannelType,
  MessageFlags,
} from "discord.js";
import { activePath, progress } from "./engine.js";
import { card } from "./cards.js";

export async function discordAdapter(env, store, handlers) {
  for (const k of [
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GUILD_ID",
  ])
    if (!env[k]) throw Error("Missing " + k);
  const contentEnabled = env.MESSAGE_CONTENT === "true";
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      ...(contentEnabled ? [GatewayIntentBits.MessageContent] : []),
    ],
    allowedMentions: { parse: [] },
  });
  const ready = new Promise((resolve) =>
    client.once(Events.ClientReady, resolve),
  );
  await client.login(env.DISCORD_TOKEN);
  await ready;
  const guild = await client.guilds.fetch(env.GUILD_ID);
  const dangerous = [
    P.Administrator,
    P.ManageGuild,
    P.ManageRoles,
    P.ManageChannels,
    P.BanMembers,
    P.KickMembers,
    P.ModerateMembers,
    P.ManageWebhooks,
  ];
  const member = (uid) => guild.members.fetch({ user: uid, force: true });
  const api = {
    id: guild.id,
    contentEnabled,
    close: () => client.destroy(),
    async catalog() {
      await Promise.all([
        guild.roles.fetch(),
        guild.channels.fetch(),
        guild.members.fetchMe(),
      ]);
      const me = guild.members.me;
      return {
        name: guild.name,
        manageRoles: me.permissions.has(P.ManageRoles),
        roles: [...guild.roles.cache.values()]
          .filter((r) => r.id !== guild.id)
          .sort((a, b) => b.position - a.position)
          .map((r) => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
            editable: r.editable,
            sensitive: dangerous.some((p) => r.permissions.has(p)),
          })),
        channels: [...guild.channels.cache.values()]
          .filter((c) =>
            [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
              c.type,
            ),
          )
          .map((c) => {
            const perms = c.permissionsFor(me);
            return {
              id: c.id,
              name: c.name,
              view: perms.has(P.ViewChannel),
              send: perms.has(P.SendMessages),
              attach: perms.has(P.AttachFiles),
              history: perms.has(P.ReadMessageHistory),
            };
          }),
      };
    },
    async user(uid) {
      const m = await member(uid);
      return {
        uid,
        name: m.displayName,
        roles: [...m.roles.cache.keys()],
        owner: uid === guild.ownerId,
        avatar: m.displayAvatarURL({ extension: "png", size: 128 }),
      };
    },
    async grant(uid, path, state) {
      const m = await member(uid);
      const target = await guild.roles.fetch(state.next.role, { force: true });
      if (
        !target?.editable ||
        (!state.next.manual && dangerous.some((p) => target.permissions.has(p)))
      )
        throw Error("راجع صلاحيات الرتبة أو فعّل الموافقة اليدوية");
      await m.roles.add(target, "Madarij / " + path.name);
      if (
        path.replace &&
        state.current &&
        m.roles.cache.has(state.current.role)
      )
        await m.roles.remove(state.current.role, "Madarij / " + path.name);
    },
    async notify(channel, payload) {
      if (!channel) return;
      const dest = await guild.channels.fetch(channel);
      if (!dest?.isTextBased()) throw Error("روم الإرسال غير متاح");
      await dest.send(payload);
    },
    logo: () => guild.iconURL({ extension: "png", size: 64 }),
  };
  const commands = [
    { name: "progress", description: "اعرض بطاقة تقدمك في المسار" },
    { name: "info", description: "معلومات البوت" },
  ];
  for (const command of commands) await guild.commands.create(command);
  client.on(Events.MessageCreate, (msg) => {
    if (
      msg.guildId !== guild.id ||
      msg.author.bot ||
      msg.webhookId ||
      !msg.member
    )
      return;
    handlers
      .message({
        id: msg.id,
        uid: msg.author.id,
        name: msg.member.displayName,
        roles: [...msg.member.roles.cache.keys()],
        channel: msg.channelId,
        content: msg.content ?? "",
        at: msg.createdTimestamp,
      })
      .catch(handlers.error);
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (
      interaction.guildId !== guild.id ||
      !interaction.isChatInputCommand() ||
      !commands.some((c) => c.name === interaction.commandName)
    )
      return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { config } = store.settings(),
        brand = config.brand;
      if (interaction.commandName === "info") {
        await interaction.editReply(
          brand.name + " · تطوير " + brand.credit + " · فكرة " + brand.idea,
        );
        return;
      }
      const u = await api.user(interaction.user.id),
        path = activePath(store, config, u.uid, u.roles);
      if (!path) {
        await interaction.editReply("لا يوجد مسار مفعّل لرتبك حاليًا");
        return;
      }
      const state = progress(store, u.uid, path);
      const role = (id) => guild.roles.cache.get(id)?.name;
      const png = await card({
        brand,
        name: u.name,
        path: path.name,
        count: state.count,
        current: role(state.current?.role),
        next: role(state.next?.role),
        target: state.next?.total,
        avatar: u.avatar,
        logo: api.logo(),
        color: guild.roles.cache.get(state.next?.role)?.hexColor,
      });
      const held = store.one(
        "SELECT 1 FROM flags WHERE uid=? AND path=? AND status='hold'",
        u.uid,
        path.id,
      );
      await interaction.editReply({
        content: held ? "الترقية قيد المراجعة" : undefined,
        files: [{ attachment: png, name: "progress.png" }],
      });
    } catch (e) {
      handlers.error(e);
      if (interaction.deferred)
        await interaction.editReply("تعذّر عرض البطاقة").catch(handlers.error);
    }
  });
  return api;
}
